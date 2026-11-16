//! Developer probe (tests only): replays requests from $PROBE_IN using the app's saved sign-in and writes
//! responses to $PROBE_OUT. Run with: cargo test --lib probe -- --ignored --nocapture

use crate::xauth::Auth;
use crate::xbl::Xbl;
use serde_json::{json, Value};
use std::sync::Arc;

fn app_dir() -> std::path::PathBuf {
    std::path::PathBuf::from(std::env::var("APPDATA").unwrap()).join("com.squadr.app")
}

#[test]
#[ignore]
fn probe_requests() {
    let auth = Arc::new(Auth::new(&app_dir()));
    let x = Xbl::new(auth.clone());
    let me = auth.xsts().expect("signed in").xuid;
    let input = std::fs::read_to_string(std::env::var("PROBE_IN").unwrap()).unwrap().replace("{me}", &me);
    let reqs: Vec<Value> = serde_json::from_str(&input).unwrap();
    let mut out = vec![];
    for r in reqs {
        let m = r["method"].as_str().unwrap_or("GET");
        let url = r["url"].as_str().unwrap();
        let c = r["contract"].as_u64().unwrap_or(1) as u32;
        let body = if r["body"].is_null() { None } else { Some(&r["body"]) };
        let res = x.call(m, url, c, body);
        let (status, v) = match res {
            Ok(v) => (200, v),
            Err(e) => (e.status, json!(e.message)),
        };
        println!("{m} {url} c{c} -> {status}");
        out.push(json!({ "req": r, "status": status, "res": v }));
    }
    std::fs::write(std::env::var("PROBE_OUT").unwrap(), serde_json::to_string_pretty(&out).unwrap()).unwrap();
}

/// Connect a websocket (e.g. wss://chat.xboxlive.com/chat/connect) with our auth and print what arrives.
#[test]
#[ignore]
fn probe_socket() {
    use tungstenite::client::IntoClientRequest;
    let auth = Auth::new(&app_dir());
    let x = auth.xsts().expect("signed in");
    let url = std::env::var("PROBE_WS").unwrap();
    let mut req = url.as_str().into_client_request().unwrap();
    req.headers_mut().insert("Authorization", x.header().parse().unwrap());
    if let Ok(p) = std::env::var("PROBE_WS_PROTO") {
        req.headers_mut().insert("Sec-WebSocket-Protocol", p.parse().unwrap());
    }
    let (mut ws, resp) = match tungstenite::connect(req) {
        Ok(v) => v,
        Err(tungstenite::Error::Http(r)) => {
            println!("HTTP {} {:?} {:?}", r.status(), r.headers(), r.body().as_ref().map(|b| String::from_utf8_lossy(b).to_string()));
            return;
        }
        Err(e) => panic!("{e}"),
    };
    println!("connected {:?}", resp.headers());
    if let Ok(send) = std::env::var("PROBE_WS_SEND") {
        for line in send.split("\n").filter(|l| !l.is_empty()) {
            ws.send(tungstenite::Message::text(line.to_string())).unwrap();
        }
    }
    if let tungstenite::stream::MaybeTlsStream::NativeTls(s) = ws.get_mut() {
        s.get_mut().set_read_timeout(Some(std::time::Duration::from_secs(8))).unwrap();
    }
    for _ in 0..6 {
        match ws.read() {
            Ok(m) => println!("MSG {}", m.to_string().chars().take(1500).collect::<String>()),
            Err(e) => {
                println!("end: {e}");
                break;
            }
        }
    }
}

#[test]
#[ignore]
fn probe_social_reads() {
    let auth = Arc::new(Auth::new(&app_dir()));
    let x = Xbl::new(auth.clone());
    let me = auth.xsts().unwrap().xuid;
    let inbox = crate::messaging::inbox(&x, "primary", &me).unwrap();
    let unread = inbox.iter().filter(|c| c.unread).count();
    let with_text = inbox.iter().filter(|c| !c.last_text.is_empty()).count();
    println!("inbox {} convs, {} unread, {} with preview text, other set: {}", inbox.len(), unread, with_text, inbox.iter().all(|c| !c.other_xuid.is_empty()));
    let groups = crate::messaging::groups(&x).unwrap();
    println!("groups {} (with channel ids: {})", groups.len(), groups.iter().all(|g| !g.group_id.is_empty()));
    let t = crate::messaging::dm_thread(&x, &inbox[0].other_xuid, None).unwrap();
    println!("dm thread {} msgs, sorted: {}, more: {}", t.messages.len(), t.messages.windows(2).all(|w| w[0].time <= w[1].time), t.more.is_some());
    let g = &groups[0];
    let gt = crate::messaging::group_thread(&x, &g.group_id, &g.channel_id, None).unwrap();
    let day = |t: &str| t.get(..16).unwrap_or("").to_string();
    println!("group thread {} msgs, oldest {} newest {} | group last {} | more {}", gt.messages.len(), gt.messages.first().map(|m| day(&m.time)).unwrap_or_default(), gt.messages.last().map(|m| day(&m.time)).unwrap_or_default(), day(&g.last_time), gt.more.is_some());
    for c in inbox.iter().take(6) {
        let t = crate::messaging::dm_thread(&x, &c.other_xuid, None).unwrap();
        println!("dm {} msgs newest {} | conv last {}", t.messages.len(), t.messages.last().map(|m| day(&m.time)).unwrap_or_default(), day(&c.last_time));
    }
    let f = crate::party::friends(&x).unwrap();
    println!("friends {} online {} in party {} joinable {}", f.len(), f.iter().filter(|f| f.state == "Online").count(), f.iter().filter(|f| f.in_party).count(), f.iter().filter(|f| f.party_joinable).count());
    println!("my party: {:?}", crate::party::my_party(&x, &me).map(|p| p.map(|p| p.members.len())));
}


/// Show what "Your games" becomes with Xbox versions only (read-only; no cache written).
#[test]
#[ignore]
fn probe_console_games() {
    use crate::lfg;
    let auth = Arc::new(Auth::new(&app_dir()));
    let x = Xbl::new(auth.clone());
    let me = auth.xsts().expect("signed in").xuid;
    let list = lfg::title_history(&x, &me).unwrap();
    let (out, todo) = lfg::consoleize(list.clone(), &Default::default(), &[]);
    println!("history {} -> console {} , todo {}", list.len(), out.len(), todo.len());
    let mut map = std::collections::HashMap::new();
    for t in todo.iter().filter(|t| lfg::is_xbl_pc(t)) {
        let n = lfg::count(&x, &t.scid, &Default::default());
        println!("  PC-only {:<36} posts {:?}", t.name, n.map_err(|e| e.status));
    }
    for t in todo.iter().take(24) {
        let r = lfg::find_console_version(&x, &t.name);
        println!("  {:<40} -> {:?}", t.name, r.as_ref().map(|o| o.as_ref().map(|c| format!("{} {}", c.title_id, c.name))));
        if let Ok(o) = r {
            map.insert(t.title_id.clone(), o.map(|c| c.title_id).unwrap_or_default());
        }
    }
    let ids: Vec<String> = map.values().filter(|v| !v.is_empty()).cloned().collect();
    let known = lfg::titles_by_id(&x, &ids).unwrap_or_default();
    let (out, _) = lfg::consoleize(list, &map, &known);
    for t in out.iter().take(30) {
        println!("{} {:?} {}", t.title_id, t.devices, t.name);
    }
}

/// Read-only: what do real applicants' member entries look like (where does the join note live)?
#[test]
#[ignore]
fn probe_applicant_shape() {
    use crate::lfg;
    let auth = Arc::new(Auth::new(&app_dir()));
    let x = Xbl::new(auth.clone());
    let me = auth.xsts().expect("signed in").xuid;
    let titles: Vec<_> = lfg::title_history(&x, &me).unwrap().into_iter().filter(lfg::is_console).take(6).collect();
    let mut seen = 0;
    for t in titles {
        let posts = match lfg::query(&x, &t.scid, &Default::default()) { Ok(p) => p, Err(_) => continue };
        for p in posts.iter().filter(|p| p.members_count > 1).take(12) {
            let Ok(doc) = lfg::session_doc(&x, &p.scid, &p.session_name) else { continue };
            for (_, m) in doc["members"].as_object().cloned().unwrap_or_default() {
                let role = m["roles"]["lfg"].as_str().unwrap_or("-").to_string();
                if role == "confirmed" { continue; }
                let mut props = m["properties"].clone();
                // keep structure, mask values
                fn mask(v: &mut Value) { match v { Value::String(s) => *s = format!("<{} chars>", s.chars().count()), Value::Object(o) => o.values_mut().for_each(mask), Value::Array(a) => a.iter_mut().for_each(mask), _ => {} } }
                mask(&mut props);
                println!("{} role={role} props={}", t.name, props);
                seen += 1;
            }
            if seen > 25 { return; }
        }
    }
}

/// Sign a second Xbox account in to its own folder ($PROBE_DIR), separate from the app's own sign-in.
/// Prints the microsoft.com/link code, then waits for approval.
#[test]
#[ignore]
fn probe_signin() {
    use crate::xauth::Poll;
    use std::io::Write;
    let dir = std::path::PathBuf::from(std::env::var("PROBE_DIR").expect("PROBE_DIR"));
    let auth = Auth::new(&dir);
    if auth.status().signed_in {
        println!("ALREADY {}", auth.status().gamertag);
        return;
    }
    let dc = auth.begin().unwrap();
    println!("CODE {} at {}", dc.user_code, dc.verification_uri);
    std::io::stdout().flush().ok();
    let until = crate::store::now_ms() + dc.expires_in * 1000;
    while crate::store::now_ms() < until {
        std::thread::sleep(std::time::Duration::from_secs(dc.interval.max(2)));
        match auth.poll(&dc) {
            Ok(Poll::Pending) => continue,
            Ok(Poll::Done) => {
                println!("SIGNED IN as {}", auth.status().gamertag);
                return;
            }
            Err(e) if e.contains("Couldn't reach") => {
                println!("RETRY {e}");
                continue;
            }
            Err(e) => {
                println!("ERROR {e}");
                return;
            }
        }
    }
    println!("EXPIRED");
}

/// From the account in $PROBE_DIR: send $PROBE_TEXT to xuid $PROBE_TO (if set), then print the last
/// messages of that conversation (newest last) so replies can be read.
#[test]
#[ignore]
fn probe_dm() {
    use crate::messaging;
    let dir = std::path::PathBuf::from(std::env::var("PROBE_DIR").expect("PROBE_DIR"));
    let auth = Arc::new(Auth::new(&dir));
    let x = Xbl::new(auth.clone());
    let me = auth.xsts().expect("signed in").xuid;
    let to = std::env::var("PROBE_TO").expect("PROBE_TO");
    if let Ok(text) = std::env::var("PROBE_TEXT") {
        match messaging::send_dm(&x, &to, &text) {
            Ok(()) => println!("SENT"),
            Err(e) => println!("SEND FAILED {} {}", e.status, e.message),
        }
    }
    match messaging::dm_thread(&x, &to, None) {
        Ok(t) => {
            let mut m = t.messages.clone();
            m.sort_by(|a, b| a.time.cmp(&b.time));
            for msg in m.iter().rev().take(8).rev() {
                println!("MSG {} {} {}", msg.time, if msg.sender == me { "me" } else { "them" }, msg.text.replace('\n', " "));
            }
        }
        Err(e) => println!("THREAD FAILED {} {}", e.status, e.message),
    }
}

/// Clipping end to end in $PROBE_DIR: install FFmpeg if needed, record ~12s, save a 10s clip there.
#[test]
#[ignore]
fn probe_clips() {
    use crate::clips::{Clipper, Config};
    let dir = std::path::PathBuf::from(std::env::var("PROBE_DIR").expect("PROBE_DIR"));
    let c = Clipper::new(&dir);
    if !c.status().installed {
        let t = std::time::Instant::now();
        c.install(|p| if (p * 100.0) as u32 % 20 == 0 { println!("install {:.0}%", p * 100.0) }).unwrap();
        println!("installed in {:?}", t.elapsed());
    }
    c.start(Config { seconds: 10, fps: 60, monitor: 0, height: 1080, quality: "high".into(), audio: true }).unwrap();
    println!("status {:?}", serde_json::to_string(&c.status()).unwrap());
    std::thread::sleep(std::time::Duration::from_secs(13));
    let t = std::time::Instant::now();
    let out = c.save(&dir.join("out"));
    println!("save {:?} in {:?}", out, t.elapsed());
    println!("status {:?}", serde_json::to_string(&c.status()).unwrap());
    c.stop();
}

/// Loopback audio check: capture 6s of what the default output device plays, print stats.
#[test]
#[ignore]
fn probe_loopback() {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    let host = cpal::default_host();
    let dev = host.default_output_device().unwrap();
    let cfg = dev.default_output_config().unwrap();
    println!("device {:?} cfg {:?}", dev.name(), cfg);
    let stats = Arc::new(std::sync::Mutex::new((0usize, 0usize, 0f32)));
    let s2 = stats.clone();
    let stream = dev
        .build_input_stream(&cfg.clone().into(), move |d: &[f32], _: &_| {
            let mut s = s2.lock().unwrap_or_else(|e| e.into_inner());
            s.0 += 1;
            s.1 += d.len();
            for x in d { s.2 = s.2.max(x.abs()); }
        }, |e| println!("err {e}"), None)
        .unwrap();
    stream.play().unwrap();
    std::thread::sleep(std::time::Duration::from_secs(6));
    println!("callbacks {:?}", stats.lock().unwrap_or_else(|e| e.into_inner()));
}

/// Capture every output device at once for 6s and print each one's peak level.
#[test]
#[ignore]
fn probe_loopback_all() {
    use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
    let host = cpal::default_host();
    let mut keep = vec![];
    for dev in host.output_devices().unwrap() {
        let name = dev.name().unwrap_or_default();
        let Ok(cfg) = dev.default_output_config() else { continue };
        if cfg.sample_format() != cpal::SampleFormat::F32 { println!("{name}: {:?}", cfg.sample_format()); continue; }
        let peak = Arc::new(std::sync::Mutex::new(0f32));
        let p2 = peak.clone();
        if let Ok(s) = dev.build_input_stream(&cfg.into(), move |d: &[f32], _: &_| { let mut p = p2.lock().unwrap_or_else(|e| e.into_inner()); for x in d { *p = p.max(x.abs()); } }, |_| {}, None) {
            if s.play().is_ok() { keep.push((name, peak, s)); }
        }
    }
    std::thread::sleep(std::time::Duration::from_secs(6));
    for (n, p, _) in &keep { println!("PEAK {n}: {}", *p.lock().unwrap_or_else(|e| e.into_inner())); }
}
