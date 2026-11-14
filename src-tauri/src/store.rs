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
}

impl Default for Settings {
    fn default() -> Self {
        Settings { show_side_panel: true, show_status_bar: true, language: "en".into(), pinned: vec![], extra_titles: vec![], sound: true }
    }
}
