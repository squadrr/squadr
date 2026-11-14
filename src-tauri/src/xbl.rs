//! Authenticated Xbox Live REST calls.

use crate::xauth::{net_err, Auth};
use serde_json::Value;
use std::sync::Arc;
use std::time::Duration;

pub struct Xbl {
    pub auth: Arc<Auth>,
    agent: ureq::Agent,
}

#[derive(Debug)]
pub struct XblError {
    pub status: u16,
    pub message: String,
}

impl From<XblError> for String {
    fn from(e: XblError) -> String {
        e.message
    }
}

impl Xbl {
    pub fn new(auth: Arc<Auth>) -> Self {
        let agent = ureq::AgentBuilder::new().timeout(Duration::from_secs(20)).build();
        Xbl { auth, agent }
    }

    pub fn get(&self, url: &str, contract: u32) -> Result<Value, XblError> {
        self.call("GET", url, contract, None)
    }
    pub fn post(&self, url: &str, contract: u32, body: &Value) -> Result<Value, XblError> {
        self.call("POST", url, contract, Some(body))
    }
    pub fn put(&self, url: &str, contract: u32, body: &Value) -> Result<Value, XblError> {
        self.call("PUT", url, contract, Some(body))
    }
    pub fn delete(&self, url: &str, contract: u32) -> Result<Value, XblError> {
        self.call("DELETE", url, contract, None)
    }

    pub fn call(&self, method: &str, url: &str, contract: u32, body: Option<&Value>) -> Result<Value, XblError> {
        let mut retried = false;
        loop {
            let x = self.auth.xsts().map_err(|m| XblError { status: 401, message: m })?;
            let req = self
                .agent
                .request(method, url)
                .set("Authorization", &x.header())
                .set("x-xbl-contract-version", &contract.to_string())
                .set("Accept-Language", "en-US")
                .set("Accept", "application/json");
            let res = match body {
                Some(b) => req.set("Content-Type", "application/json").send_string(&b.to_string()),
                None => req.call(),
            };
            match res {
                Ok(r) => {
                    let text = r.into_string().unwrap_or_default();
                    return Ok(if text.trim().is_empty() { Value::Null } else { serde_json::from_str(&text).unwrap_or(Value::String(text)) });
                }
                Err(ureq::Error::Status(401, _)) if !retried => {
                    retried = true;
                    self.auth.xsts_force().map_err(|m| XblError { status: 401, message: m })?;
                }
                Err(ureq::Error::Status(429, r)) => {
                    let wait = r.header("Retry-After").and_then(|s| s.parse::<u64>().ok()).unwrap_or(15);
                    return Err(XblError { status: 429, message: format!("Xbox Live is rate-limiting requests. Try again in {wait}s.") });
                }
                Err(ureq::Error::Status(code, r)) => {
                    let text = r.into_string().unwrap_or_default();
                    return Err(XblError { status: code, message: describe(code, &text) });
                }
                Err(e) => return Err(XblError { status: 0, message: net_err(e) }),
            }
        }
    }
}

fn describe(code: u16, body: &str) -> String {
    let detail: String = serde_json::from_str::<Value>(body)
        .ok()
        .and_then(|v| v["message"].as_str().or(v["description"].as_str()).map(str::to_string))
        .unwrap_or_else(|| body.chars().take(160).collect());
    match code {
        403 => format!("Xbox Live said no (403). {detail}").trim().to_string(),
        404 => "That post no longer exists.".into(),
        409 | 412 => "Someone else changed this post at the same time. Refresh and try again.".into(),
        _ => format!("Xbox Live error {code}. {detail}").trim().to_string(),
    }
}
