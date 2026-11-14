//! Xbox Live sign-in, done the way the Xbox mobile app does it:
//! Microsoft account device code (microsoft.com/link) -> device token (proof-of-possession key)
//! -> SISU authorize -> XSTS token for http://xboxlive.com.
//! Everything is kept in auth.bin, encrypted with the Windows user's DPAPI key.

use crate::store::{load_secret, now_ms, save_secret};
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use base64::Engine;
use p256::ecdsa::{signature::Signer, Signature, SigningKey};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

/// Public client id of the Xbox app for iOS (the same one open-source Xbox Live tools use).
const CLIENT_ID: &str = "000000004c12ae6f";
const SCOPE: &str = "service::user.auth.xboxlive.com::MBI_SSL";
const FILE: &str = "auth.bin";

#[derive(Default, Clone, Serialize, Deserialize)]
#[serde(default)]
struct Saved {
    key: String,
    msa_access: String,
    msa_refresh: String,
    msa_exp: u64,
    device_token: String,
    device_exp: u64,
    xsts: Option<Xsts>,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct Xsts {
    pub token: String,
    pub uhs: String,
    pub xuid: String,
    pub gamertag: String,
    pub exp: u64,
}

impl Xsts {
    pub fn header(&self) -> String {
        format!("XBL3.0 x={};{}", self.uhs, self.token)
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AuthStatus {
    pub signed_in: bool,
    pub xuid: String,
    pub gamertag: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DeviceCode {
    pub user_code: String,
    pub verification_uri: String,
    pub expires_in: u64,
    #[serde(skip)]
    pub device_code: String,
    #[serde(skip)]
    pub interval: u64,
}

pub struct Auth {
    dir: PathBuf,
    st: Mutex<Saved>,
    /// Serialises token refreshes so parallel requests don't all refresh at once.
    refresh_lock: Mutex<()>,
    agent: ureq::Agent,
}

pub enum Poll {
    Pending,
    Done,
}

impl Auth {
    pub fn new(dir: &std::path::Path) -> Self {
        let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(20)).build();
        Auth { dir: dir.to_path_buf(), st: Mutex::new(load_secret(dir, FILE)), refresh_lock: Mutex::new(()), agent }
    }

    pub fn status(&self) -> AuthStatus {
        let s = self.st.lock().unwrap();
        let x = s.xsts.clone();
        AuthStatus {
            signed_in: !s.msa_refresh.is_empty() && x.is_some(),
            xuid: x.as_ref().map(|x| x.xuid.clone()).unwrap_or_default(),
            gamertag: x.map(|x| x.gamertag).unwrap_or_default(),
        }
    }

    fn persist(&self, s: &Saved) {
        let _ = save_secret(&self.dir, FILE, s);
    }

    pub fn sign_out(&self) {
        *self.st.lock().unwrap() = Saved::default();
        let _ = std::fs::remove_file(self.dir.join(FILE));
    }

    // ------------------------------------------------------------ device code

    pub fn begin(&self) -> Result<DeviceCode, String> {
        let r: Value = self.form("https://login.live.com/oauth20_connect.srf", &[("client_id", CLIENT_ID), ("scope", SCOPE), ("response_type", "device_code")])?;
        Ok(DeviceCode {
            user_code: r["user_code"].as_str().unwrap_or_default().to_string(),
            verification_uri: r["verification_uri"].as_str().unwrap_or("https://www.microsoft.com/link").to_string(),
            expires_in: r["expires_in"].as_u64().unwrap_or(900),
            device_code: r["device_code"].as_str().ok_or("Microsoft didn't return a sign-in code")?.to_string(),
            interval: r["interval"].as_u64().unwrap_or(5),
        })
    }

    pub fn poll(&self, dc: &DeviceCode) -> Result<Poll, String> {
        let resp = self
            .agent
            .post("https://login.live.com/oauth20_token.srf")
            .send_form(&[("client_id", CLIENT_ID), ("device_code", &dc.device_code), ("grant_type", "urn:ietf:params:oauth:grant-type:device_code")]);
        let v: Value = match resp {
            Ok(r) => r.into_json().map_err(|e| e.to_string())?,
            Err(ureq::Error::Status(_, r)) => r.into_json().unwrap_or(Value::Null),
            Err(e) => return Err(net_err(e)),
        };
        if let Some(tok) = v["access_token"].as_str() {
            {
                let mut s = self.st.lock().unwrap();
                *s = Saved { key: s.key.clone(), ..Default::default() };
                s.msa_access = tok.to_string();
                s.msa_refresh = v["refresh_token"].as_str().unwrap_or_default().to_string();
                s.msa_exp = now_ms() + v["expires_in"].as_u64().unwrap_or(3600) * 1000;
            }
            self.xsts_force()?;
            return Ok(Poll::Done);
        }
        match v["error"].as_str() {
            Some("authorization_pending") | Some("slow_down") => Ok(Poll::Pending),
            Some("expired_token") => Err("The sign-in code expired. Start again for a new one.".into()),
            Some("authorization_declined") | Some("access_denied") => Err("Sign-in was cancelled.".into()),
            Some(e) => Err(format!("Microsoft sign-in failed ({e})")),
            None => Ok(Poll::Pending),
        }
    }

    // ------------------------------------------------------------ tokens

    /// A valid XSTS token, refreshing whatever has expired.
    pub fn xsts(&self) -> Result<Xsts, String> {
        if let Some(x) = self.st.lock().unwrap().xsts.clone() {
            if x.exp > now_ms() + 5 * 60_000 {
                return Ok(x);
            }
        }
        self.xsts_force()
    }

    /// Fetch a fresh XSTS token (after a 401, or when the cached one is close to expiry).
    pub fn xsts_force(&self) -> Result<Xsts, String> {
        let _g = self.refresh_lock.lock().unwrap();
        let mut s = self.st.lock().unwrap().clone();
        if s.msa_refresh.is_empty() {
            return Err("Not signed in".into());
        }
        let key = signing_key(&mut s);
        if s.msa_exp < now_ms() + 120_000 {
            let r: Value = self
                .form("https://login.live.com/oauth20_token.srf", &[("client_id", CLIENT_ID), ("scope", SCOPE), ("grant_type", "refresh_token"), ("refresh_token", &s.msa_refresh)])
                .map_err(|e| if e.contains("invalid_grant") { "Your Xbox sign-in expired. Please sign in again.".to_string() } else { e })?;
            s.msa_access = r["access_token"].as_str().ok_or("Microsoft didn't return a token")?.to_string();
            if let Some(rt) = r["refresh_token"].as_str() {
                s.msa_refresh = rt.to_string();
            }
            s.msa_exp = now_ms() + r["expires_in"].as_u64().unwrap_or(3600) * 1000;
        }
        let jwk = jwk(&key);
        if s.device_token.is_empty() || s.device_exp < now_ms() + 3_600_000 {
            let body = json!({
                "Properties": {
                    "AuthMethod": "ProofOfPossession",
                    "Id": format!("{{{}}}", uuid::Uuid::new_v4()),
                    "DeviceType": "iOS",
                    "SerialNumber": format!("{{{}}}", uuid::Uuid::new_v4()),
                    "Version": "15.6.1",
                    "ProofKey": jwk,
                },
                "RelyingParty": "http://auth.xboxlive.com",
                "TokenType": "JWT",
            });
            let r = self.signed("https://device.auth.xboxlive.com/device/authenticate", &key, &body, true)?;
            s.device_token = r["Token"].as_str().ok_or("No device token")?.to_string();
            s.device_exp = parse_iso_ms(r["NotAfter"].as_str().unwrap_or_default()).unwrap_or(now_ms() + 86_400_000);
        }
        let body = json!({
            "AccessToken": format!("t={}", s.msa_access),
            "AppId": CLIENT_ID,
            "DeviceToken": s.device_token,
            "Sandbox": "RETAIL",
            "UseModernGamertag": true,
            "SiteName": "user.auth.xboxlive.com",
            "RelyingParty": "http://xboxlive.com",
            "ProofKey": jwk,
        });
        let r = self.signed("https://sisu.xboxlive.com/authorize", &key, &body, false)?;
        let a = &r["AuthorizationToken"];
        let xui = &a["DisplayClaims"]["xui"][0];
        let x = Xsts {
            token: a["Token"].as_str().ok_or("Xbox didn't return a token")?.to_string(),
            uhs: xui["uhs"].as_str().unwrap_or_default().to_string(),
            xuid: xui["xid"].as_str().unwrap_or_default().to_string(),
            gamertag: xui["mgt"].as_str().or(xui["gtg"].as_str()).unwrap_or_default().to_string(),
            exp: parse_iso_ms(a["NotAfter"].as_str().unwrap_or_default()).unwrap_or(now_ms() + 3_600_000),
        };
        s.xsts = Some(x.clone());
        self.persist(&s);
        *self.st.lock().unwrap() = s;
        Ok(x)
    }

    fn form(&self, url: &str, fields: &[(&str, &str)]) -> Result<Value, String> {
        match self.agent.post(url).send_form(fields) {
            Ok(r) => r.into_json().map_err(|e| e.to_string()),
            Err(ureq::Error::Status(code, r)) => Err(format!("Microsoft sign-in error {code}: {}", r.into_string().unwrap_or_default().chars().take(200).collect::<String>())),
            Err(e) => Err(net_err(e)),
        }
    }

    fn signed(&self, url: &str, key: &SigningKey, body: &Value, contract: bool) -> Result<Value, String> {
        let body = body.to_string();
        let sig = sign(key, url, &body);
        let mut req = self.agent.post(url).set("Content-Type", "application/json").set("Signature", &sig);
        if contract {
            req = req.set("x-xbl-contract-version", "1");
        }
        match req.send_string(&body) {
            Ok(r) => r.into_json().map_err(|e| e.to_string()),
            Err(ureq::Error::Status(code, r)) => {
                let xerr = r.header("x-err").map(str::to_string);
                let text = r.into_string().unwrap_or_default();
                let v: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
                let x = xerr.or_else(|| v["XErr"].as_u64().map(|n| n.to_string())).or_else(|| v["AuthorizationToken"]["XErr"].as_u64().map(|n| n.to_string()));
                Err(xerr_text(x.as_deref()).unwrap_or_else(|| format!("Xbox sign-in failed ({code})")))
            }
            Err(e) => Err(net_err(e)),
        }
    }
}

pub fn net_err(e: ureq::Error) -> String {
    match e {
        ureq::Error::Transport(t) => format!("Couldn't reach Xbox Live ({})", t.kind()),
        ureq::Error::Status(c, _) => format!("Xbox Live returned {c}"),
    }
}

fn xerr_text(code: Option<&str>) -> Option<String> {
    let t = match code? {
        "2148916227" => "This account is banned from Xbox Live.",
        "2148916229" => "This account is restricted. A parent needs to allow online play at account.microsoft.com/family.",
        "2148916233" => "This Microsoft account has no Xbox profile yet. Sign in once at xbox.com to create one.",
        "2148916234" => "This account hasn't accepted the Xbox terms of use yet. Sign in at xbox.com first.",
        "2148916235" => "Xbox Live isn't available in this account's region.",
        "2148916236" | "2148916237" => "This account needs age verification at account.microsoft.com.",
        "2148916238" => "This account is under 18 and has to be added to a Microsoft family by an adult.",
        c => return Some(format!("Xbox sign-in failed (XErr {c})")),
    };
    Some(t.into())
}

fn signing_key(s: &mut Saved) -> SigningKey {
    if let Ok(b) = STANDARD.decode(&s.key) {
        if let Ok(k) = SigningKey::from_slice(&b) {
            return k;
        }
    }
    let k = SigningKey::random(&mut rand_core::OsRng);
    s.key = STANDARD.encode(k.to_bytes());
    s.device_token.clear();
    k
}

fn jwk(key: &SigningKey) -> Value {
    let p = key.verifying_key().to_encoded_point(false);
    json!({
        "kty": "EC", "crv": "P-256", "alg": "ES256", "use": "sig",
        "x": URL_SAFE_NO_PAD.encode(p.x().unwrap()),
        "y": URL_SAFE_NO_PAD.encode(p.y().unwrap()),
    })
}

/// Xbox "Signature" header: policy version, Windows timestamp and an ES256 signature over the request.
fn sign(key: &SigningKey, url: &str, body: &str) -> String {
    let ts: u64 = (now_ms() / 1000 + 11_644_473_600) * 10_000_000;
    let path = url.splitn(4, '/').nth(3).map(|p| format!("/{}", p.split('?').next().unwrap_or(p))).unwrap_or_else(|| "/".into());
    let mut buf = Vec::with_capacity(body.len() + 128);
    buf.extend_from_slice(&1i32.to_be_bytes());
    buf.push(0);
    buf.extend_from_slice(&ts.to_be_bytes());
    buf.push(0);
    for part in ["POST", path.as_str(), "", body] {
        buf.extend_from_slice(part.as_bytes());
        buf.push(0);
    }
    let sig: Signature = key.sign(&buf);
    let mut out = Vec::with_capacity(76);
    out.extend_from_slice(&1i32.to_be_bytes());
    out.extend_from_slice(&ts.to_be_bytes());
    out.extend_from_slice(&sig.to_bytes());
    STANDARD.encode(out)
}

/// "2026-11-28T05:00:00.1234567Z" -> unix ms.
pub fn parse_iso_ms(s: &str) -> Option<u64> {
    let b = s.as_bytes();
    if b.len() < 19 {
        return None;
    }
    let n = |a: usize, l: usize| s.get(a..a + l)?.parse::<i64>().ok();
    let (y, mo, d, h, mi, se) = (n(0, 4)?, n(5, 2)?, n(8, 2)?, n(11, 2)?, n(14, 2)?, n(17, 2)?);
    let (y2, m2) = if mo <= 2 { (y - 1, mo + 9) } else { (y, mo - 3) };
    let era = y2.div_euclid(400);
    let yoe = y2 - era * 400;
    let doy = (153 * m2 + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    let mut ms = ((days * 86_400 + h * 3600 + mi * 60 + se) * 1000) as u64;
    if b.get(19) == Some(&b'.') {
        let frac: String = s[20..].chars().take_while(|c| c.is_ascii_digit()).take(3).collect();
        if let Ok(f) = format!("{frac:0<3}").parse::<u64>() {
            ms += f;
        }
    }
    Some(ms)
}

#[cfg(test)]
mod tests {
    #[test]
    fn iso() {
        assert_eq!(super::parse_iso_ms("1970-01-01T00:00:01.5Z"), Some(1500));
        assert_eq!(super::parse_iso_ms("2026-11-14T04:55:32.5523434Z"), Some(1_794_632_132_552));
    }
}

#[cfg(test)]
mod live {
    /// Needs network: proves the proof-of-possession signature is accepted by Xbox.
    #[test]
    #[ignore]
    fn device_token_signature_accepted() {
        let dir = std::env::temp_dir().join("squadr-test");
        let a = super::Auth::new(&dir);
        let mut s = super::Saved::default();
        let key = super::signing_key(&mut s);
        let body = serde_json::json!({
            "Properties": { "AuthMethod": "ProofOfPossession", "Id": format!("{{{}}}", uuid::Uuid::new_v4()), "DeviceType": "iOS",
                "SerialNumber": format!("{{{}}}", uuid::Uuid::new_v4()), "Version": "15.6.1", "ProofKey": super::jwk(&key) },
            "RelyingParty": "http://auth.xboxlive.com", "TokenType": "JWT",
        });
        let r = a.signed("https://device.auth.xboxlive.com/device/authenticate", &key, &body, true).expect("device auth");
        assert!(r["Token"].as_str().unwrap().len() > 100);
        assert!(super::parse_iso_ms(r["NotAfter"].as_str().unwrap()).unwrap() > super::now_ms());
    }
}
