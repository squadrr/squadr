//! JSON files in the app data dir, DPAPI helpers and settings.

use serde::{de::DeserializeOwned, Deserialize, Serialize};
use std::path::Path;
use std::time::{SystemTime, UNIX_EPOCH};

pub fn load<T: DeserializeOwned + Default>(dir: &Path, name: &str) -> T {
    std::fs::read_to_string(dir.join(name)).ok().and_then(|s| serde_json::from_str(&s).ok()).unwrap_or_default()
}

pub fn save<T: Serialize>(dir: &Path, name: &str, value: &T) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let tmp = dir.join(format!("{name}.tmp"));
    let json = serde_json::to_string_pretty(value).map_err(|e| e.to_string())?;
    std::fs::write(&tmp, json).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(name)).map_err(|e| e.to_string())
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as u64).unwrap_or(0)
}

/// Encrypt/decrypt with the Windows user's DPAPI key (only this Windows account can read it back).
pub fn dpapi(data: &[u8], protect: bool) -> Option<Vec<u8>> {
    use windows_sys::Win32::Foundation::LocalFree;
    use windows_sys::Win32::Security::Cryptography::{CryptProtectData, CryptUnprotectData, CRYPT_INTEGER_BLOB};
    unsafe {
        let input = CRYPT_INTEGER_BLOB { cbData: data.len() as u32, pbData: data.as_ptr() as *mut u8 };
        let mut out = CRYPT_INTEGER_BLOB { cbData: 0, pbData: std::ptr::null_mut() };
        let ok = if protect {
            CryptProtectData(&input, std::ptr::null(), std::ptr::null(), std::ptr::null(), std::ptr::null(), 0, &mut out)
        } else {
            CryptUnprotectData(&input, std::ptr::null_mut(), std::ptr::null(), std::ptr::null(), std::ptr::null(), 0, &mut out)
        };
        if ok == 0 || out.pbData.is_null() {
            return None;
        }
        let v = std::slice::from_raw_parts(out.pbData, out.cbData as usize).to_vec();
        LocalFree(out.pbData as _);
        Some(v)
    }
}

/// Read a DPAPI-protected JSON file.
pub fn load_secret<T: DeserializeOwned + Default>(dir: &Path, name: &str) -> T {
    std::fs::read(dir.join(name)).ok().and_then(|b| dpapi(&b, false)).and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()
}

pub fn save_secret<T: Serialize>(dir: &Path, name: &str, value: &T) -> Result<(), String> {
    std::fs::create_dir_all(dir).map_err(|e| e.to_string())?;
    let json = serde_json::to_vec(value).map_err(|e| e.to_string())?;
    let enc = dpapi(&json, true).ok_or("Couldn't encrypt the sign-in data")?;
    let tmp = dir.join(format!("{name}.tmp"));
    std::fs::write(&tmp, enc).map_err(|e| e.to_string())?;
    std::fs::rename(&tmp, dir.join(name)).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------- settings

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub show_side_panel: bool,
    pub show_status_bar: bool,
    /// Two-letter language posts are written in and filtered by ("" = any).
    pub language: String,
    /// Title ids pinned to the top of the games list.
    pub pinned: Vec<String>,
    /// Games added through search (kept so they stay in the side panel).
    pub extra_titles: Vec<String>,
    pub sound: bool,
    /// Show the Xbox console version of each game (where the LFG posts are) instead of PC listings.
    pub console_only: bool,
    /// The start guide has been shown.
    pub onboarded: bool,
    /// "classic" (tabs + games panel) or "pulse" (game rail, feed, side pane).
    pub layout: String,
    /// Liquid glass look: frosted, see-through panels.
    pub glass: bool,
    /// See-through window: "off", "acrylic" or "mica" (Windows backdrop effects).
    pub backdrop: String,
    /// Clipping: keep a replay buffer and save it with a hotkey.
    pub clips_enabled: bool,
    pub clip_seconds: u32,
    pub clip_hotkey: String,
    /// Folder for saved clips ("" = Videos\Squadr Clips).
    pub clip_dir: String,
    pub clip_fps: u32,
    /// Output height (0 = native).
    pub clip_height: u32,
    pub clip_quality: String,
    pub clip_audio: bool,
    pub clip_monitor: u32,
    /// The window's close button hides Squadr to the tray (so posts stay live) instead of quitting.
    pub close_to_tray: bool,
    /// Start Squadr in the tray when you sign in to Windows.
    pub start_with_windows: bool,
    /// Windows notifications for new requests, messages and alert matches while Squadr isn't focused.
    pub notifications: bool,
    /// LFG alerts (shape owned by the frontend).
    pub alerts: Vec<serde_json::Value>,
    /// Saved post templates (shape owned by the frontend).
    pub templates: Vec<serde_json::Value>,
    /// The hosted post to put back up when it ends without filling (shape owned by the frontend).
    pub auto_repost: Option<serde_json::Value>,
}

impl Default for Settings {
    fn default() -> Self {
        Settings { show_side_panel: true, show_status_bar: true, language: "en".into(), pinned: vec![], extra_titles: vec![], sound: true, console_only: true, onboarded: false, layout: "classic".into(), glass: false, backdrop: "off".into(),
            clips_enabled: false, clip_seconds: 30, clip_hotkey: "Alt+F10".into(), clip_dir: String::new(), clip_fps: 60, clip_height: 1080, clip_quality: "high".into(), clip_audio: true, clip_monitor: 0,
            close_to_tray: true, start_with_windows: false, notifications: true, alerts: vec![], templates: vec![], auto_repost: None }
    }
}
