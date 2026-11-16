//! Xbox Real-Time Activity (RTA) websocket.
//! LFG sessions require every member to be "active", which MPSD ties to a live RTA connection id.
//! MPSD also sends "shoulder taps" over it when a session we're in changes (new applicant, confirmed, ...).

use crate::xauth::Auth;
use serde_json::{json, Value};
use std::io::ErrorKind;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tungstenite::client::IntoClientRequest;
use tungstenite::stream::MaybeTlsStream;
use tungstenite::Message;

const URL: &str = "wss://rta.xboxlive.com/connect";
const CONNECTIONS: &str = "https://sessiondirectory.xboxlive.com/connections/";

pub enum Event {
    Connected(String),
    Disconnected(String),
    Tap(String),
}

pub struct Rta {
    pub connection_id: Mutex<Option<String>>,
    run: AtomicBool,
    generation: AtomicU64,
}

impl Rta {
    pub fn new() -> Self {
        Rta { connection_id: Mutex::new(None), run: AtomicBool::new(false), generation: AtomicU64::new(0) }
    }

    pub fn connection(&self) -> Option<String> {
        self.connection_id.lock().unwrap_or_else(|e| e.into_inner()).clone()
    }

    pub fn stop(&self) {
        self.run.store(false, Ordering::SeqCst);
        self.generation.fetch_add(1, Ordering::SeqCst);
        *self.connection_id.lock().unwrap_or_else(|e| e.into_inner()) = None;
    }

    /// Start (or restart) the connection loop in a background thread.
    pub fn start(self: &Arc<Self>, auth: Arc<Auth>, on: Arc<dyn Fn(Event) + Send + Sync>) {
        let gen = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        self.run.store(true, Ordering::SeqCst);
        let me = self.clone();
        std::thread::spawn(move || {
            let mut backoff = 2u64;
            while me.run.load(Ordering::SeqCst) && me.generation.load(Ordering::SeqCst) == gen {
                let started = Instant::now();
                let why = me.session(&auth, &on, gen).err().unwrap_or_else(|| "closed".into());
                *me.connection_id.lock().unwrap_or_else(|e| e.into_inner()) = None;
                if me.generation.load(Ordering::SeqCst) != gen {
                    return;
                }
                on(Event::Disconnected(why));
                if started.elapsed() > Duration::from_secs(60) {
                    backoff = 2;
                }
                std::thread::sleep(Duration::from_secs(backoff));
                backoff = (backoff * 2).min(60);
            }
        });
    }

    fn session(&self, auth: &Auth, on: &Arc<dyn Fn(Event) + Send + Sync>, gen: u64) -> Result<(), String> {
        let x = auth.xsts()?;
        let mut req = URL.into_client_request().map_err(|e| e.to_string())?;
        let h = req.headers_mut();
        h.insert("Authorization", x.header().parse().map_err(|_| "bad header")?);
        h.insert("Sec-WebSocket-Protocol", "rta.xboxlive.com.V2".parse().unwrap());
        let (mut ws, _) = tungstenite::connect(req).map_err(|e| format!("RTA connect failed: {e}"))?;
        match ws.get_mut() {
            MaybeTlsStream::NativeTls(s) => s.get_mut().set_read_timeout(Some(Duration::from_millis(500))),
            MaybeTlsStream::Plain(s) => s.set_read_timeout(Some(Duration::from_millis(500))),
            _ => Ok(()),
        }
        .map_err(|e| e.to_string())?;
        ws.send(Message::text(json!([1, 1, CONNECTIONS]).to_string())).map_err(|e| e.to_string())?;
        let mut sub_id: Option<u64> = None;
        let mut last_ping = Instant::now();
        loop {
            if !self.run.load(Ordering::SeqCst) || self.generation.load(Ordering::SeqCst) != gen {
                let _ = ws.close(None);
                return Ok(());
            }
            if last_ping.elapsed() > Duration::from_secs(30) {
                last_ping = Instant::now();
                let _ = ws.send(Message::Ping(Vec::new().into()));
            }
            match ws.read() {
                Ok(Message::Text(t)) => {
                    let v: Value = serde_json::from_str(t.as_str()).unwrap_or(Value::Null);
                    match v[0].as_u64() {
                        // [1, seq, code, subId, data] subscribe result
                        Some(1) if v[1].as_u64() == Some(1) => {
                            if v[2].as_u64() != Some(0) {
                                return Err(format!("RTA subscribe failed: {}", v));
                            }
                            sub_id = v[3].as_u64();
                            if let Some(cid) = v[4]["ConnectionId"].as_str() {
                                *self.connection_id.lock().unwrap_or_else(|e| e.into_inner()) = Some(cid.to_string());
                                on(Event::Connected(cid.to_string()));
                            }
                        }
                        // [3, subId, data] event
                        Some(3) if v[1].as_u64() == sub_id => {
                            if let Some(taps) = v[2]["shoulderTaps"].as_array() {
                                for tap in taps {
                                    if let Some(r) = tap["resource"].as_str() {
                                        on(Event::Tap(r.to_string()));
                                    }
                                }
                            }
                        }
                        // [4] resync: everything we know may be stale
                        Some(4) => on(Event::Tap("*".into())),
                        _ => {}
                    }
                }
                Ok(Message::Close(_)) => return Err("RTA closed by server".into()),
                Ok(_) => {}
                Err(tungstenite::Error::Io(e)) if matches!(e.kind(), ErrorKind::WouldBlock | ErrorKind::TimedOut) => {
                    let _ = ws.flush();
                }
                Err(e) => return Err(e.to_string()),
            }
        }
    }
}
