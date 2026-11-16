//! Desktop integration: the tray icon (with a red dot when something needs you), the taskbar badge,
//! starting with Windows, Windows notifications, and uploading clips so they can be shared in chat.

use std::io::Read;
use std::path::Path;
use tauri::image::Image;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager};

const TRAY: &str = "main";
const RUN_KEY: &str = "Software\\Microsoft\\Windows\\CurrentVersion\\Run";
const RUN_VALUE: &str = "Squadr";
/// Command-line flag used by the Windows startup entry: start hidden in the tray.
pub const TRAY_FLAG: &str = "--tray";

// ---------------------------------------------------------------- window

/// Bring the main window back from the tray (or from behind other windows).
pub fn show_main(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

// ---------------------------------------------------------------- tray

pub fn create_tray(app: &AppHandle) -> tauri::Result<()> {
    let open = MenuItem::with_id(app, "open", "Open Squadr", true, None::<&str>)?;
    let post = MenuItem::with_id(app, "post", "New post", true, None::<&str>)?;
    let sep = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, "quit", "Quit Squadr", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&open, &post, &sep, &quit])?;
    let mut tray = TrayIconBuilder::with_id(TRAY)
        .tooltip("Squadr")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_menu_event(|app, ev| match ev.id().as_ref() {
            "open" => show_main(app),
            "post" => {
                show_main(app);
                let _ = app.emit("nav", "create");
            }
            "quit" => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, ev| {
            if let TrayIconEvent::Click { button: MouseButton::Left, button_state: MouseButtonState::Up, .. } = ev {
                show_main(tray.app_handle());
            }
        });
    if let Some(icon) = app.default_window_icon() {
        tray = tray.icon(icon.clone());
    }
    tray.build(app)?;
    Ok(())
}

/// The app icon with a red dot in its bottom-right corner.
fn dotted(icon: &Image<'_>) -> Image<'static> {
    let (w, h) = (icon.width(), icon.height());
    let mut px = icon.rgba().to_vec();
    let r = w.min(h) as f32 * 0.24;
    let (cx, cy) = (w as f32 - r - 1.0, h as f32 - r - 1.0);
    for y in 0..h {
        for x in 0..w {
            let d = ((x as f32 + 0.5 - cx).powi(2) + (y as f32 + 0.5 - cy).powi(2)).sqrt();
            let i = ((y * w + x) * 4) as usize;
            if d <= r + 1.5 {
                // white ring, red center
                let (cr, cg, cb) = if d <= r - 0.5 { (0xF0, 0x3E, 0x3E) } else { (0xFF, 0xFF, 0xFF) };
                let a = if d > r + 0.5 { ((r + 1.5 - d).clamp(0.0, 1.0) * 255.0) as u8 } else { 255 };
                let blend = |under: u8, over: u8| ((over as u16 * a as u16 + under as u16 * (255 - a) as u16) / 255) as u8;
                px[i] = blend(px[i], cr);
                px[i + 1] = blend(px[i + 1], cg);
                px[i + 2] = blend(px[i + 2], cb);
                px[i + 3] = px[i + 3].max(a);
            }
        }
    }
    Image::new_owned(px, w, h)
}

/// A 16px red dot for the taskbar button.
fn badge_dot() -> Image<'static> {
    let n = 16u32;
    let mut px = vec![0u8; (n * n * 4) as usize];
    let c = n as f32 / 2.0;
    for y in 0..n {
        for x in 0..n {
            let d = ((x as f32 + 0.5 - c).powi(2) + (y as f32 + 0.5 - c).powi(2)).sqrt();
            let i = ((y * n + x) * 4) as usize;
            let a = ((c - 0.5 - d + 0.5).clamp(0.0, 1.0) * 255.0) as u8;
            let ring = d > c - 2.2;
            px[i..i + 4].copy_from_slice(&if ring { [0xFF, 0xFF, 0xFF, a] } else { [0xF0, 0x3E, 0x3E, a] });
        }
    }
    Image::new_owned(px, n, n)
}

/// Show `count` things waiting for you on the tray icon (red dot + tooltip) and the taskbar button.
pub fn set_badge(app: &AppHandle, count: u32, summary: &str) {
    if let Some(tray) = app.tray_by_id(TRAY) {
        if let Some(icon) = app.default_window_icon() {
            let _ = tray.set_icon(Some(if count > 0 { dotted(icon) } else { icon.clone() }));
        }
        let tip = if count > 0 && !summary.is_empty() { format!("Squadr\n{summary}") } else { "Squadr".to_string() };
        let _ = tray.set_tooltip(Some(tip.chars().take(120).collect::<String>()));
    }
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.set_overlay_icon(if count > 0 { Some(badge_dot()) } else { None });
    }
}

// ---------------------------------------------------------------- notifications

pub fn notify(app: &AppHandle, title: &str, body: &str) {
    use tauri_plugin_notification::NotificationExt;
    let _ = app.notification().builder().title(title).body(body).show();
}

// ---------------------------------------------------------------- start with Windows

fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}

/// Add or remove the HKCU Run entry that starts Squadr in the tray when you sign in to Windows.
pub fn set_autostart(on: bool) -> Result<(), String> {
    use windows_sys::Win32::System::Registry::{RegDeleteKeyValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_SZ};
    let (key, name) = (wide(RUN_KEY), wide(RUN_VALUE));
    if on {
        let exe = std::env::current_exe().map_err(|e| e.to_string())?;
        let cmd = wide(&format!("\"{}\" {TRAY_FLAG}", exe.display()));
        let rc = unsafe { RegSetKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr(), REG_SZ, cmd.as_ptr() as *const _, (cmd.len() * 2) as u32) };
        if rc != 0 {
            return Err(format!("Couldn't add Squadr to startup (error {rc})"));
        }
    } else {
        // 2 = the value doesn't exist, which is fine
        let rc = unsafe { RegDeleteKeyValueW(HKEY_CURRENT_USER, key.as_ptr(), name.as_ptr()) };
        if rc != 0 && rc != 2 {
            return Err(format!("Couldn't remove Squadr from startup (error {rc})"));
        }
    }
    Ok(())
}

// ---------------------------------------------------------------- clip upload

/// Reader that reports how many bytes have gone out.
struct Counting<R, F: FnMut(u64)> {
    inner: R,
    sent: u64,
    last: u64,
    on: F,
}

impl<R: Read, F: FnMut(u64)> Read for Counting<R, F> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        let n = self.inner.read(buf)?;
        self.sent += n as u64;
        if self.sent - self.last > 512 * 1024 || n == 0 {
            self.last = self.sent;
            (self.on)(self.sent);
        }
        Ok(n)
    }
}

/// Upload a clip to catbox.moe (a permanent link) or litterbox (a link that expires after 72 hours),
/// and return its link. `progress` gets (sent, total) bytes.
pub fn upload_clip(path: &Path, temporary: bool, mut progress: impl FnMut(u64, u64)) -> Result<String, String> {
    let size = std::fs::metadata(path).map_err(|e| format!("Couldn't read the clip: {e}"))?.len();
    let (url, limit, host) = if temporary {
        ("https://litterbox.catbox.moe/resources/internals/api.php", 1000u64 << 20, "Litterbox")
    } else {
        ("https://catbox.moe/user/api.php", 200u64 << 20, "Catbox")
    };
    if size > limit {
        return Err(format!("This clip is {} MB, and {host} takes up to {} MB. Try a shorter clip or a lower quality.", size >> 20, limit >> 20));
    }
    let name: String = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "clip.mp4".into()).chars().filter(|c| *c != '"' && *c != '\r' && *c != '\n').collect();
    let boundary = format!("----squadr{}", uuid::Uuid::new_v4().simple());
    let mut head = String::new();
    let mut field = |k: &str, v: &str| head.push_str(&format!("--{boundary}\r\nContent-Disposition: form-data; name=\"{k}\"\r\n\r\n{v}\r\n"));
    field("reqtype", "fileupload");
    if temporary {
        field("time", "72h");
    }
    head.push_str(&format!("--{boundary}\r\nContent-Disposition: form-data; name=\"fileToUpload\"; filename=\"{name}\"\r\nContent-Type: video/mp4\r\n\r\n"));
    let tail = format!("\r\n--{boundary}--\r\n");
    let total = head.len() as u64 + size + tail.len() as u64;
    let file = std::fs::File::open(path).map_err(|e| format!("Couldn't open the clip: {e}"))?;
    let body = Counting { inner: std::io::Cursor::new(head.into_bytes()).chain(file).chain(std::io::Cursor::new(tail.into_bytes())), sent: 0, last: 0, on: |n| progress(n.min(total), total) };
    let agent = ureq::AgentBuilder::new().timeout_connect(std::time::Duration::from_secs(20)).build();
    let resp = agent
        .post(url)
        .set("Content-Type", &format!("multipart/form-data; boundary={boundary}"))
        .set("Content-Length", &total.to_string())
        .set("User-Agent", "Squadr")
        .send(body)
        .map_err(|e| match e {
            ureq::Error::Status(code, r) => format!("{host} said no ({code}): {}", r.into_string().unwrap_or_default().chars().take(160).collect::<String>()),
            other => format!("Upload failed: {other}"),
        })?;
    let link = resp.into_string().map_err(|e| e.to_string())?.trim().to_string();
    if !link.starts_with("https://") {
        return Err(format!("{host} didn't return a link: {}", link.chars().take(160).collect::<String>()));
    }
    Ok(link)
}
