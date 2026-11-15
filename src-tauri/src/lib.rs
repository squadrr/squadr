mod clips;
mod lfg;
mod messaging;
mod party;
#[cfg(test)]
mod probe;
mod rta;
mod store;
mod xauth;
mod xbl;

use lfg::{Detail, Filters, NewPost, Person, Post, Title};
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use store::{load, now_ms, save, Settings};
use tauri::{AppHandle, Emitter, Manager, RunEvent, State};
use xauth::{Auth, AuthStatus, DeviceCode, Poll};
use xbl::Xbl;

/// A post you host or applied to, remembered so the app can keep you active and show it under "My LFG".
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Tracked {
    pub scid: String,
    pub session_name: String,
    pub handle_id: String,
    pub title_id: String,
    pub title_name: String,
    /// "host" | "applicant"
    pub role: String,
    pub since: u64,
}

pub struct App {
    dir: PathBuf,
    auth: Arc<Auth>,
    xbl: Arc<Xbl>,
    rta: Arc<rta::Rta>,
    people: Mutex<HashMap<String, (Person, u64)>>,
    tracked: Mutex<Vec<Tracked>>,
    settings: Mutex<Settings>,
    signing_in: Mutex<u64>,
    clipper: clips::Shared,
}

type St<'a> = State<'a, Arc<App>>;
const TRACKED: &str = "tracked.json";
const SETTINGS: &str = "settings.json";

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T, String> + Send + 'static) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

impl App {
    fn me(&self) -> Result<String, String> {
        let s = self.auth.status();
        if s.xuid.is_empty() {
            Err("Not signed in".into())
        } else {
            Ok(s.xuid)
        }
    }

    /// The live RTA connection id (LFG members must have one). Waits briefly while it (re)connects.
    fn connection(&self) -> Result<String, String> {
        for _ in 0..40 {
            if let Some(c) = self.rta.connection() {
                return Ok(c);
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        Err("Not connected to Xbox Live's real-time service yet. Check your connection and try again.".into())
    }

    fn track(&self, t: Tracked) {
        let mut v = self.tracked.lock().unwrap();
        v.retain(|x| x.session_name != t.session_name);
        v.push(t);
        let _ = save(&self.dir, TRACKED, &*v);
    }

    fn untrack(&self, session_name: &str) {
        let mut v = self.tracked.lock().unwrap();
        v.retain(|x| x.session_name != session_name);
        let _ = save(&self.dir, TRACKED, &*v);
    }

    /// Profiles for these xuids, from a 10-minute cache where possible (the people service is strictly rate limited).
    fn people_for(&self, xuids: &[String]) -> Vec<Person> {
        let now = now_ms();
        let mut missing: Vec<String> = {
            let cache = self.people.lock().unwrap();
            xuids.iter().filter(|x| cache.get(*x).map_or(true, |(_, t)| now - t > 600_000)).cloned().collect()
        };
        missing.sort();
        missing.dedup();
        if !missing.is_empty() {
            if let Ok(found) = lfg::people(&self.xbl, &missing) {
                let mut cache = self.people.lock().unwrap();
                for p in found {
                    cache.insert(p.xuid.clone(), (p, now));
                }
            }
        }
        let cache = self.people.lock().unwrap();
        let mut seen = std::collections::HashSet::new();
        xuids.iter().filter(|x| seen.insert(x.to_string())).filter_map(|x| cache.get(x).map(|(p, _)| p.clone())).collect()
    }

    fn start_rta(self: &Arc<Self>, handle: AppHandle) {
        let app = self.clone();
        let on = Arc::new(move |ev: rta::Event| match ev {
            rta::Event::Connected(cid) => {
                let _ = handle.emit("rta", json!({ "connected": true }));
                // Re-point our memberships at the new connection so MPSD doesn't time us out.
                let app = app.clone();
                let handle = handle.clone();
                std::thread::spawn(move || {
                    let Ok(me) = app.me() else { return };
                    let list = app.tracked.lock().unwrap().clone();
                    let mut changed = false;
                    for t in list {
                        if let Err(e) = lfg::keep_active(&app.xbl, &t.scid, &t.session_name, &me, &cid) {
                            if e.status == 404 || e.status == 403 {
                                app.untrack(&t.session_name);
                                changed = true;
                            }
                        }
                    }
                    if changed {
                        let _ = handle.emit("tap", "*");
                    }
                });
            }
            rta::Event::Disconnected(why) => {
                let _ = handle.emit("rta", json!({ "connected": false, "reason": why }));
            }
            rta::Event::Tap(resource) => {
                let _ = handle.emit("tap", resource);
            }
        });
        self.rta.start(self.auth.clone(), on);
    }
}

// ---------------------------------------------------------------- sign-in

#[tauri::command]
fn auth_status(s: St) -> AuthStatus {
    s.auth.status()
}

/// Start a microsoft.com/link sign-in. The result arrives as an "auth" event.
#[tauri::command]
async fn auth_begin(s: St<'_>, handle: AppHandle) -> Result<DeviceCode, String> {
    let app = s.inner().clone();
    let dc = blocking({
        let app = app.clone();
        move || app.auth.begin()
    })
    .await?;
    let run_id = {
        let mut g = app.signing_in.lock().unwrap();
        *g += 1;
        *g
    };
    let code = dc.clone();
    std::thread::spawn(move || {
        let until = now_ms() + code.expires_in * 1000;
        while now_ms() < until {
            std::thread::sleep(Duration::from_secs(code.interval.max(2)));
            if *app.signing_in.lock().unwrap() != run_id {
                return; // a newer sign-in attempt replaced this one
            }
            match app.auth.poll(&code) {
                Ok(Poll::Pending) => continue,
                Ok(Poll::Done) => {
                    app.start_rta(handle.clone());
                    let _ = handle.emit("auth", json!({ "ok": true, "status": app.auth.status() }));
                    return;
                }
                Err(e) => {
                    let _ = handle.emit("auth", json!({ "ok": false, "error": e }));
                    return;
                }
            }
        }
        let _ = handle.emit("auth", json!({ "ok": false, "error": "The sign-in code expired. Start again for a new one." }));
    });
    Ok(dc)
}

#[tauri::command]
fn auth_cancel(s: St) {
    *s.signing_in.lock().unwrap() += 1;
}

#[tauri::command]
async fn auth_sign_out(s: St<'_>) -> Result<(), String> {
    let app = s.inner().clone();
    blocking(move || {
        leave_everything(&app);
        app.rta.stop();
        app.auth.sign_out();
        app.people.lock().unwrap().clear();
        Ok(())
    })
    .await
}

#[tauri::command]
fn open_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://") {
        return Err("Only https links can be opened".into());
    }
    std::process::Command::new("explorer").arg(url).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn rta_status(s: St) -> bool {
    s.rta.connection().is_some()
}

/// Community links (Discord, YouTube, TikTok). Read from links.json in the GitHub repo so they can
/// change without a new release; the built-in copy is used when that can't be reached.
#[tauri::command]
async fn links_get() -> Result<serde_json::Value, String> {
    let fallback = serde_json::json!({
        "discord": "",
        "youtube": "https://www.youtube.com/@squadr_official",
        "tiktok": "https://www.tiktok.com/@squadr_offical",
        "github": "https://github.com/squadrr/squadr"
    });
    blocking(move || {
        let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(6)).build();
        let mut out = fallback.clone();
        if let Ok(v) = agent.get("https://raw.githubusercontent.com/squadrr/squadr/main/links.json").call().and_then(|r| r.into_json::<serde_json::Value>().map_err(|e| e.into())) {
            for k in ["discord", "youtube", "tiktok", "github"] {
                if let Some(u) = v[k].as_str().filter(|u| u.is_empty() || u.starts_with("https://")) {
                    out[k] = u.into();
                }
            }
        }
        Ok(out)
    })
    .await
}

// ---------------------------------------------------------------- settings

#[tauri::command]
fn settings_get(s: St) -> Settings {
    s.settings.lock().unwrap().clone()
}

#[tauri::command]
fn settings_set(s: St, app: AppHandle, settings: Settings) -> Result<Settings, String> {
    let old = s.settings.lock().unwrap().clone();
    if old.backdrop != settings.backdrop {
        apply_backdrop(&app, &settings.backdrop);
    }
    save(&s.dir, SETTINGS, &settings)?;
    *s.settings.lock().unwrap() = settings.clone();
    if clip_settings_changed(&old, &settings) {
        let (state, app) = (s.inner().clone(), app.clone());
        std::thread::spawn(move || apply_clips(&app, &state));
    }
    Ok(settings)
}

// ---------------------------------------------------------------- clips

fn clip_settings_changed(a: &Settings, b: &Settings) -> bool {
    (a.clips_enabled, a.clip_seconds, &a.clip_hotkey, &a.clip_dir, a.clip_fps, a.clip_height, &a.clip_quality, a.clip_audio, a.clip_monitor)
        != (b.clips_enabled, b.clip_seconds, &b.clip_hotkey, &b.clip_dir, b.clip_fps, b.clip_height, &b.clip_quality, b.clip_audio, b.clip_monitor)
}

fn clip_config(s: &Settings) -> clips::Config {
    clips::Config {
        seconds: s.clip_seconds.clamp(5, 300),
        fps: s.clip_fps.clamp(15, 120),
        monitor: s.clip_monitor,
        height: s.clip_height,
        quality: s.clip_quality.clone(),
        audio: s.clip_audio,
    }
}

fn clips_dir_for(app: &AppHandle, s: &Settings) -> PathBuf {
    if !s.clip_dir.trim().is_empty() {
        return PathBuf::from(s.clip_dir.trim());
    }
    app.path().video_dir().unwrap_or_else(|_| std::env::temp_dir()).join("Squadr Clips")
}

/// Start/stop the replay buffer and (re)register the save hotkey to match the settings.
fn apply_clips(app: &AppHandle, state: &Arc<App>) {
    use tauri_plugin_global_shortcut::GlobalShortcutExt;
    let s = state.settings.lock().unwrap().clone();
    let gs = app.global_shortcut();
    let _ = gs.unregister_all();
    let dir = clips_dir_for(app, &s);
    let _ = std::fs::create_dir_all(&dir);
    let _ = app.asset_protocol_scope().allow_directory(&dir, false);
    if !s.clips_enabled {
        state.clipper.stop();
        let _ = app.emit("clips-status", state.clipper.status());
        return;
    }
    let mut status = match state.clipper.start(clip_config(&s)) {
        Ok(()) => state.clipper.status(),
        Err(e) => {
            let mut st = state.clipper.status();
            st.error = Some(e);
            st
        }
    };
    if !s.clip_hotkey.trim().is_empty() {
        if let Err(e) = gs.register(s.clip_hotkey.as_str()) {
            status.error = Some(format!("Couldn't use the keybind {}: {e}", s.clip_hotkey));
        }
    }
    let _ = app.emit("clips-status", status);
}

/// Save a clip and tell the window (used by the hotkey and the Save button).
fn save_clip(app: &AppHandle) -> Result<String, String> {
    let state = app.state::<Arc<App>>().inner().clone();
    let dir = clips_dir_for(app, &state.settings.lock().unwrap().clone());
    let res = state.clipper.save(&dir).map(|p| p.to_string_lossy().to_string());
    let _ = app.emit(
        "clip",
        match &res {
            Ok(p) => json!({ "ok": true, "path": p }),
            Err(e) => json!({ "ok": false, "error": e }),
        },
    );
    res
}

#[tauri::command]
fn clips_status(s: St) -> clips::Status {
    s.clipper.status()
}

#[tauri::command]
async fn clips_install(s: St<'_>, app: AppHandle) -> Result<(), String> {
    let state = s.inner().clone();
    blocking(move || {
        let a = app.clone();
        state.clipper.install(move |p| {
            let _ = a.emit("clips-install", p);
        })?;
        apply_clips(&app, &state);
        Ok(())
    })
    .await
}

#[tauri::command]
async fn clips_save(app: AppHandle) -> Result<String, String> {
    blocking(move || save_clip(&app)).await
}

#[tauri::command]
fn clips_dir(s: St, app: AppHandle) -> String {
    clips_dir_for(&app, &s.settings.lock().unwrap()).to_string_lossy().to_string()
}

#[tauri::command]
fn clips_list(s: St, app: AppHandle) -> Vec<clips::ClipFile> {
    clips::list(&clips_dir_for(&app, &s.settings.lock().unwrap()))
}

/// Only .mp4 files directly inside the clips folder can be opened, revealed or deleted.
fn clip_path(s: &St, app: &AppHandle, path: &str) -> Result<PathBuf, String> {
    let dir = clips_dir_for(app, &s.settings.lock().unwrap());
    let p = PathBuf::from(path);
    let ok = p.parent().map(|d| d == dir).unwrap_or(false) && p.extension().map(|e| e.eq_ignore_ascii_case("mp4")).unwrap_or(false) && p.exists();
    if ok {
        Ok(p)
    } else {
        Err("That isn't a clip in your clips folder".into())
    }
}

#[tauri::command]
fn clips_open(s: St, app: AppHandle, path: String) -> Result<(), String> {
    let p = clip_path(&s, &app, &path)?;
    std::process::Command::new("explorer").arg(p).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn clips_reveal(s: St, app: AppHandle, path: String) -> Result<(), String> {
    let p = clip_path(&s, &app, &path)?;
    std::process::Command::new("explorer").arg(format!("/select,{}", p.to_string_lossy())).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
fn clips_delete(s: St, app: AppHandle, path: String) -> Result<(), String> {
    let p = clip_path(&s, &app, &path)?;
    std::fs::remove_file(p).map_err(|e| e.to_string())
}

#[tauri::command]
fn clips_open_folder(s: St, app: AppHandle) -> Result<(), String> {
    let dir = clips_dir_for(&app, &s.settings.lock().unwrap());
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    std::process::Command::new("explorer").arg(dir).spawn().map(|_| ()).map_err(|e| e.to_string())
}

#[tauri::command]
async fn clips_pick_folder(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;
    blocking(move || {
        Ok(app
            .dialog()
            .file()
            .set_title("Choose a folder for your clips")
            .blocking_pick_folder()
            .and_then(|p| p.into_path().ok())
            .map(|p| p.to_string_lossy().to_string()))
    })
    .await
}

// ---------------------------------------------------------------- games

const CONSOLE_MAP: &str = "console_map.json";
const PC_COUNTS: &str = "pc_counts.json";
/// A PC-only game (no Xbox version) is listed only with at least this many open LFG posts.
const PC_MIN_POSTS: u32 = 15;

/// Open-post counts for PC-only games, cached in pc_counts.json as id -> (count, when).
/// Counts older than `max_age` ms are fetched again, 4 at a time.
fn pc_counts(app: &App, titles: &[Title], max_age: Option<u64>) -> HashMap<String, u32> {
    let mut cache: HashMap<String, (u32, u64)> = load(&app.dir, PC_COUNTS);
    if let Some(age) = max_age {
        let now = now_ms();
        let stale: Vec<&Title> = titles.iter().filter(|t| cache.get(&t.title_id).map_or(true, |c| now.saturating_sub(c.1) > age)).take(24).collect();
        if !stale.is_empty() {
            let got: Vec<(String, u32)> = std::thread::scope(|sc| {
                stale
                    .chunks(stale.len().div_ceil(4))
                    .map(|chunk| {
                        let xbl = app.xbl.clone();
                        sc.spawn(move || chunk.iter().filter_map(|t| lfg::count(&xbl, &t.scid, &Default::default()).ok().map(|n| (t.title_id.clone(), n))).collect::<Vec<_>>())
                    })
                    .collect::<Vec<_>>()
                    .into_iter()
                    .flat_map(|h| h.join().unwrap_or_default())
                    .collect()
            });
            for (id, n) in got {
                cache.insert(id, (n, now));
            }
            let _ = save(&app.dir, PC_COUNTS, &cache);
        }
    }
    cache.into_iter().map(|(k, v)| (k, v.0)).collect()
}

/// Your games. With "Xbox versions only" on, PC listings are swapped for their Xbox console
/// versions, because console players post LFG under the Xbox title. A PC game with no Xbox version
/// stays only if it has PC_MIN_POSTS open posts. `resolve` also does the slow part (Store lookups
/// for PC games we haven't matched before, fresh PC post counts), so the app calls it second.
#[tauri::command]
async fn games_list(s: St<'_>, resolve: Option<bool>) -> Result<Vec<Title>, String> {
    let app = s.inner().clone();
    blocking(move || {
        let me = app.me()?;
        let resolve = resolve.unwrap_or(false);
        let mut list = lfg::title_history(&app.xbl, &me)?;
        let (extra_ids, console_only) = {
            let st = app.settings.lock().unwrap();
            (st.extra_titles.clone(), st.console_only)
        };
        let extra: Vec<String> = extra_ids.into_iter().filter(|id| !list.iter().any(|t| &t.title_id == id)).collect();
        if let Ok(more) = lfg::titles_by_id(&app.xbl, &extra) {
            list.extend(more);
        }
        if !console_only {
            return Ok(list);
        }
        let mut map: HashMap<String, String> = load(&app.dir, CONSOLE_MAP);
        let fetch = |map: &HashMap<String, String>, list: &[Title]| {
            let ids: Vec<String> = map.values().filter(|v| !v.is_empty() && !list.iter().any(|t| &t.title_id == *v)).cloned().collect::<std::collections::HashSet<_>>().into_iter().collect();
            lfg::titles_by_id(&app.xbl, &ids).unwrap_or_default()
        };
        let (_, unmatched) = lfg::consoleize(list.clone(), &map, &fetch(&map, &list));
        let todo: Vec<Title> = unmatched.into_iter().filter(|t| !map.contains_key(&t.title_id)).take(24).collect();
        if resolve && !todo.is_empty() {
            // Look up the Xbox version of up to 24 unmatched PC games, 6 at once.
            let found: Vec<(String, Result<Option<Title>, String>)> = std::thread::scope(|sc| {
                todo.chunks(4)
                    .map(|chunk| {
                        let xbl = app.xbl.clone();
                        sc.spawn(move || chunk.iter().map(|t| (t.title_id.clone(), lfg::find_console_version(&xbl, &t.name))).collect::<Vec<_>>())
                    })
                    .collect::<Vec<_>>()
                    .into_iter()
                    .flat_map(|h| h.join().unwrap_or_default())
                    .collect()
            });
            // remember answers (including "no Xbox version"); lookups that failed are retried next time
            for (pc, res) in found {
                if let Ok(xbox) = res {
                    map.insert(pc, xbox.map(|t| t.title_id).unwrap_or_default());
                }
            }
            let _ = save(&app.dir, CONSOLE_MAP, &map);
        }
        let (mut out, unmatched) = lfg::consoleize(list.clone(), &map, &fetch(&map, &list));
        // PC-only games with enough posts of their own stay in the list.
        let pc: Vec<Title> = unmatched.into_iter().filter(lfg::is_xbl_pc).collect();
        let counts = pc_counts(&app, &pc, resolve.then_some(6 * 3600_000));
        out.extend(pc.into_iter().filter(|t| counts.get(&t.title_id).is_some_and(|n| *n >= PC_MIN_POSTS)));
        out.sort_by(|a, b| b.last_played.cmp(&a.last_played));
        Ok(out)
    })
    .await
}

#[tauri::command]
async fn games_search(s: St<'_>, query: String) -> Result<Vec<Title>, String> {
    let app = s.inner().clone();
    let console_only = app.settings.lock().unwrap().console_only;
    blocking(move || {
        let mut res = lfg::search_games(&app.xbl, query.trim())?;
        if console_only {
            // PC-only results stay when they have enough posts of their own
            let pc: Vec<Title> = res.iter().filter(|t| !lfg::is_console(t)).cloned().collect();
            let counts = pc_counts(&app, &pc, Some(3600_000));
            res.retain(|t| lfg::is_console(t) || counts.get(&t.title_id).is_some_and(|n| *n >= PC_MIN_POSTS));
        }
        Ok(res)
    })
    .await
}

// ---------------------------------------------------------------- browse

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct PostsResult {
    posts: Vec<Post>,
    people: Vec<Person>,
}

#[tauri::command]
async fn lfg_query(s: St<'_>, scid: String, filters: Filters) -> Result<PostsResult, String> {
    let app = s.inner().clone();
    blocking(move || {
        let posts = lfg::query(&app.xbl, &scid, &filters)?;
        let hosts: Vec<String> = posts.iter().map(|p| p.host_xuid.clone()).collect();
        let people = app.people_for(&hosts);
        Ok(PostsResult { posts, people })
    })
    .await
}

#[tauri::command]
async fn lfg_count(s: St<'_>, scid: String, filters: Filters) -> Result<u32, String> {
    let app = s.inner().clone();
    blocking(move || Ok(lfg::count(&app.xbl, &scid, &filters)?)).await
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DetailResult {
    detail: Detail,
    people: Vec<Person>,
}

#[tauri::command]
async fn lfg_detail(s: St<'_>, handle_id: String) -> Result<DetailResult, String> {
    let app = s.inner().clone();
    blocking(move || {
        let me = app.me()?;
        let detail = lfg::detail(&app.xbl, &handle_id, &me)?;
        let xuids: Vec<String> = detail.members.iter().map(|m| m.xuid.clone()).collect();
        let people = app.people_for(&xuids);
        Ok(DetailResult { detail, people })
    })
    .await
}

#[tauri::command]
async fn people_get(s: St<'_>, xuids: Vec<String>) -> Result<Vec<Person>, String> {
    let app = s.inner().clone();
    blocking(move || Ok(app.people_for(&xuids))).await
}

// ---------------------------------------------------------------- my LFG

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MineItem {
    tracked: Tracked,
    detail: Option<Detail>,
    /// Set when the post is gone or you were removed from it.
    gone: Option<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MineResult {
    items: Vec<MineItem>,
    people: Vec<Person>,
}

#[tauri::command]
async fn lfg_mine(s: St<'_>) -> Result<MineResult, String> {
    let app = s.inner().clone();
    blocking(move || {
        let me = app.me()?;
        let list = app.tracked.lock().unwrap().clone();
        let mut items = vec![];
        let mut xuids = vec![];
        for t in list {
            match lfg::detail(&app.xbl, &t.handle_id, &me) {
                Ok(d) if d.my_role.is_some() => {
                    xuids.extend(d.members.iter().map(|m| m.xuid.clone()));
                    items.push(MineItem { tracked: t, detail: Some(d), gone: None });
                }
                Ok(_) => {
                    app.untrack(&t.session_name);
                    let why = if t.role == "host" { "Your post ended." } else { "The host didn't pick you this time, or the post filled up." };
                    items.push(MineItem { tracked: t, detail: None, gone: Some(why.into()) });
                }
                Err(e) if e.status == 404 => {
                    app.untrack(&t.session_name);
                    let why = if t.role == "host" { "Your post ended." } else { "This post was closed by its host." };
                    items.push(MineItem { tracked: t, detail: None, gone: Some(why.into()) });
                }
                Err(e) => items.push(MineItem { tracked: t, detail: None, gone: Some(e.message) }),
            }
        }
        let people = app.people_for(&xuids);
        Ok(MineResult { items, people })
    })
    .await
}

#[tauri::command]
async fn lfg_create(s: St<'_>, post: NewPost, title_name: String) -> Result<Post, String> {
    let app = s.inner().clone();
    blocking(move || {
        let me = app.me()?;
        if post.description.trim().is_empty() {
            return Err("Write a short description so people know what you're looking for.".into());
        }
        // One hosted post at a time, like on console.
        let hosting: Vec<Tracked> = app.tracked.lock().unwrap().iter().filter(|t| t.role == "host").cloned().collect();
        for t in hosting {
            let _ = lfg::cancel(&app.xbl, &t.scid, &t.session_name, &t.handle_id);
            app.untrack(&t.session_name);
        }
        let conn = app.connection()?;
        let mut p = lfg::create(&app.xbl, &me, &conn, &post)?;
        if p.title_name.is_empty() {
            p.title_name = title_name.clone();
        }
        app.track(Tracked {
            scid: p.scid.clone(),
            session_name: p.session_name.clone(),
            handle_id: p.handle_id.clone(),
            title_id: post.title_id.clone(),
            title_name: if p.title_name.is_empty() { title_name } else { p.title_name.clone() },
            role: "host".into(),
            since: now_ms(),
        });
        Ok(p)
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct PostRef {
    handle_id: String,
    scid: String,
    session_name: String,
    title_id: String,
    title_name: String,
}

#[tauri::command]
async fn lfg_apply(s: St<'_>, post: PostRef, message: String) -> Result<(), String> {
    let app = s.inner().clone();
    blocking(move || {
        let me = app.me()?;
        let conn = app.connection()?;
        let _ = message; // sent by the frontend as an Xbox message
        lfg::apply(&app.xbl, &post.handle_id, &me, &conn)?;
        app.track(Tracked {
            scid: post.scid,
            session_name: post.session_name,
            handle_id: post.handle_id,
            title_id: post.title_id,
            title_name: post.title_name,
            role: "applicant".into(),
            since: now_ms(),
        });
        Ok(())
    })
    .await
}

#[tauri::command]
async fn lfg_leave(s: St<'_>, scid: String, session_name: String) -> Result<(), String> {
    let app = s.inner().clone();
    blocking(move || {
        lfg::leave(&app.xbl, &scid, &session_name)?;
        app.untrack(&session_name);
        Ok(())
    })
    .await
}

#[tauri::command]
async fn lfg_cancel(s: St<'_>, scid: String, session_name: String, handle_id: String) -> Result<(), String> {
    let app = s.inner().clone();
    blocking(move || {
        lfg::cancel(&app.xbl, &scid, &session_name, &handle_id)?;
        app.untrack(&session_name);
        Ok(())
    })
    .await
}

#[tauri::command]
async fn lfg_confirm(s: St<'_>, scid: String, session_name: String, index: u32, confirmed: bool) -> Result<(), String> {
    let app = s.inner().clone();
    blocking(move || Ok(lfg::set_confirmed(&app.xbl, &scid, &session_name, index, confirmed)?)).await
}

#[tauri::command]
async fn lfg_decline(s: St<'_>, scid: String, session_name: String, index: u32) -> Result<(), String> {
    let app = s.inner().clone();
    blocking(move || Ok(lfg::remove_member(&app.xbl, &scid, &session_name, index)?)).await
}

// ---------------------------------------------------------------- messages

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct InboxResult {
    conversations: Vec<messaging::Conversation>,
    requests: Vec<messaging::Conversation>,
    people: Vec<Person>,
}

#[tauri::command]
async fn msg_inbox(s: St<'_>) -> Result<InboxResult, String> {
    let app = s.inner().clone();
    blocking(move || {
        let me = app.me()?;
        let mut conversations = messaging::inbox(&app.xbl, "primary", &me)?;
        conversations.extend(messaging::groups(&app.xbl).unwrap_or_default());
        conversations.sort_by(|a, b| b.last_time.cmp(&a.last_time));
        let requests = messaging::inbox(&app.xbl, "secondary", &me).unwrap_or_default();
        let mut xuids: Vec<String> = conversations.iter().chain(requests.iter()).filter(|c| c.kind == "dm").map(|c| c.other_xuid.clone()).collect();
        xuids.extend(conversations.iter().filter(|c| c.kind == "group").map(|c| c.last_sender.clone()));
        xuids.retain(|x| !x.is_empty());
        let people = app.people_for(&xuids);
        Ok(InboxResult { conversations, requests, people })
    })
    .await
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ThreadRef {
    kind: String,
    xuid: String,
    group_id: String,
    channel_id: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ThreadResult {
    thread: messaging::Thread,
    people: Vec<Person>,
}

#[tauri::command]
async fn msg_thread(s: St<'_>, r: ThreadRef, before: Option<String>) -> Result<ThreadResult, String> {
    let app = s.inner().clone();
    blocking(move || {
        let thread = if r.kind == "group" {
            messaging::group_thread(&app.xbl, &r.group_id, &r.channel_id, before.as_deref())?
        } else {
            messaging::dm_thread(&app.xbl, &r.xuid, before.as_deref())?
        };
        let mut xuids: Vec<String> = thread.messages.iter().map(|m| m.sender.clone()).collect();
        if !r.xuid.is_empty() {
            xuids.push(r.xuid.clone());
        }
        let people = app.people_for(&xuids);
        Ok(ThreadResult { thread, people })
    })
    .await
}

#[tauri::command]
async fn msg_send(s: St<'_>, r: ThreadRef, text: String) -> Result<(), String> {
    let app = s.inner().clone();
    blocking(move || {
        if text.trim().is_empty() {
            return Ok(());
        }
        if r.kind == "group" {
            messaging::send_group(&app.xbl, &r.group_id, &r.channel_id, &text)?;
        } else {
            messaging::send_dm(&app.xbl, &r.xuid, &text)?;
        }
        Ok(())
    })
    .await
}

#[tauri::command]
async fn msg_read(s: St<'_>, conversation_id: String, message_id: String) -> Result<(), String> {
    let app = s.inner().clone();
    blocking(move || Ok(messaging::mark_read(&app.xbl, &conversation_id, &message_id)?)).await
}

// ---------------------------------------------------------------- friends + party

#[tauri::command]
async fn friends_list(s: St<'_>) -> Result<Vec<party::Friend>, String> {
    let app = s.inner().clone();
    blocking(move || {
        let list = party::friends(&app.xbl)?;
        let now = now_ms();
        let mut cache = app.people.lock().unwrap();
        for f in &list {
            cache.insert(f.person.xuid.clone(), (f.person.clone(), now));
        }
        Ok(list)
    })
    .await
}

#[tauri::command]
async fn party_mine(s: St<'_>) -> Result<Option<party::Party>, String> {
    let app = s.inner().clone();
    blocking(move || {
        let me = app.me()?;
        Ok(party::my_party(&app.xbl, &me)?)
    })
    .await
}

#[tauri::command]
async fn party_invite(s: St<'_>, xuids: Vec<String>) -> Result<u32, String> {
    let app = s.inner().clone();
    blocking(move || {
        let me = app.me()?;
        let p = party::my_party(&app.xbl, &me)?.ok_or("You're not in a party. Start one on your Xbox, in the Xbox app or in Game Bar (Win+G), then invite from here.")?;
        let mut sent = 0;
        let mut last_err = None;
        for x in xuids.iter().filter(|x| !p.members.iter().any(|m| &m.xuid == *x)) {
            match party::invite(&app.xbl, &p, x) {
                Ok(()) => sent += 1,
                Err(e) => last_err = Some(e.message),
            }
        }
        match (sent, last_err) {
            (0, Some(e)) => Err(e),
            _ => Ok(sent),
        }
    })
    .await
}

/// Open the Xbox app: a friend's profile (where "Join party" lives), a chat, or the social pane.
#[tauri::command]
fn open_xbox(target: String, xuid: Option<String>) -> Result<(), String> {
    let digits = |x: &Option<String>| x.as_deref().filter(|x| !x.is_empty() && x.chars().all(|c| c.is_ascii_digit())).map(str::to_string);
    let uri = match target.as_str() {
        "profile" => format!("msxbox://profile?xuid={}", digits(&xuid).ok_or("bad xuid")?),
        "social" => "msxbox://social".to_string(),
        "gamebar" => "ms-gamebar://launch/activate".to_string(),
        _ => return Err("unknown target".into()),
    };
    std::process::Command::new("explorer").arg(uri).spawn().map(|_| ()).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- updates (GitHub Releases)

#[derive(serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct UpdateInfo {
    version: String,
    current: String,
    notes: String,
    date: Option<String>,
}

#[tauri::command]
async fn update_check(app: AppHandle) -> Result<Option<UpdateInfo>, String> {
    use tauri_plugin_updater::UpdaterExt;
    let u = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?;
    Ok(u.map(|u| UpdateInfo { version: u.version.clone(), current: u.current_version.clone(), notes: u.body.clone().unwrap_or_default(), date: u.date.map(|d| d.to_string()) }))
}

/// Downloads the update, then takes down your posts and withdraws requests before the installer closes the app
/// (on Windows the installer exits the process, so the normal exit cleanup wouldn't run).
#[tauri::command]
async fn update_install(app: AppHandle, s: St<'_>) -> Result<(), String> {
    use tauri_plugin_updater::UpdaterExt;
    let u = app.updater().map_err(|e| e.to_string())?.check().await.map_err(|e| e.to_string())?.ok_or("Squadr is already up to date.")?;
    let mut got: u64 = 0;
    let h = app.clone();
    let bytes = u
        .download(
            move |chunk, total| {
                got += chunk as u64;
                let _ = h.emit("update-progress", serde_json::json!({ "got": got, "total": total }));
            },
            || {},
        )
        .await
        .map_err(|e| format!("Download failed: {e}"))?;
    let st = s.inner().clone();
    blocking(move || {
        leave_everything(&st);
        st.rta.stop();
        Ok(())
    })
    .await?;
    u.install(bytes).map_err(|e| format!("Install failed: {e}"))?;
    app.restart();
}

/// On exit / sign-out: end hosted posts and withdraw applications instead of leaving them to time out.
fn leave_everything(app: &App) {
    let list = app.tracked.lock().unwrap().clone();
    for t in &list {
        let _ = if t.role == "host" { lfg::cancel(&app.xbl, &t.scid, &t.session_name, &t.handle_id) } else { lfg::leave(&app.xbl, &t.scid, &t.session_name) };
    }
    app.tracked.lock().unwrap().clear();
    let _ = save(&app.dir, TRACKED, &Vec::<Tracked>::new());
}

/// Windows backdrop behind the (transparent) window: Acrylic, Mica, or none.
fn apply_backdrop(app: &AppHandle, mode: &str) {
    use tauri::utils::config::WindowEffectsConfig;
    use tauri::window::Effect;
    let Some(w) = app.get_webview_window("main") else { return };
    let effect = match mode {
        "acrylic" => Some(Effect::Acrylic),
        "mica" => Some(Effect::Mica),
        _ => None,
    };
    let _ = w.set_effects(effect.map(|e| WindowEffectsConfig { effects: vec![e], ..Default::default() }));
}

pub fn run() {
    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(w) = app.get_webview_window("main") {
                let _ = w.unminimize();
                let _ = w.set_focus();
            }
        }))
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(|app, _shortcut, event| {
                    if event.state() == tauri_plugin_global_shortcut::ShortcutState::Pressed {
                        let app = app.clone();
                        std::thread::spawn(move || {
                            let _ = save_clip(&app);
                        });
                    }
                })
                .build(),
        )
        .setup(|app| {
            let dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&dir)?;
            let auth = Arc::new(Auth::new(&dir));
            let state = Arc::new(App {
                xbl: Arc::new(Xbl::new(auth.clone())),
                auth,
                rta: Arc::new(rta::Rta::new()),
                people: Mutex::new(HashMap::new()),
                tracked: Mutex::new(load(&dir, TRACKED)),
                settings: Mutex::new(load(&dir, SETTINGS)),
                signing_in: Mutex::new(0),
                clipper: Arc::new(clips::Clipper::new(&dir)),
                dir,
            });
            apply_backdrop(app.handle(), &state.settings.lock().unwrap().backdrop.clone());
            app.manage(state.clone());
            if state.auth.status().signed_in {
                state.start_rta(app.handle().clone());
            }
            {
                let (state, app) = (state.clone(), app.handle().clone());
                std::thread::spawn(move || apply_clips(&app, &state));
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth_status,
            auth_begin,
            auth_cancel,
            auth_sign_out,
            open_url,
            rta_status,
            settings_get,
            settings_set,
            clips_status,
            clips_install,
            clips_save,
            clips_dir,
            clips_list,
            clips_open,
            clips_reveal,
            clips_delete,
            clips_open_folder,
            clips_pick_folder,
            games_list,
            games_search,
            lfg_query,
            lfg_count,
            lfg_detail,
            people_get,
            lfg_mine,
            lfg_create,
            lfg_apply,
            lfg_leave,
            lfg_cancel,
            lfg_confirm,
            lfg_decline,
            msg_inbox,
            msg_thread,
            msg_send,
            msg_read,
            friends_list,
            party_mine,
            party_invite,
            open_xbox,
            update_check,
            update_install,
            links_get
        ])
        .build(tauri::generate_context!())
        .expect("error while building Squadr");
    app.run(|handle, ev| {
        if let RunEvent::Exit = ev {
            if let Some(state) = handle.try_state::<Arc<App>>() {
                state.clipper.stop();
                leave_everything(&state);
                state.rta.stop();
            }
        }
    });
}
