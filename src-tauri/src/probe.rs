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

