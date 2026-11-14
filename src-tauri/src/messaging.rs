//! Xbox messages (xblmessaging.xboxlive.com): the same inbox, requests and group chats as the Xbox app.

use crate::xbl::{Xbl, XblError};
use serde::Serialize;
use serde_json::{json, Value};

const BASE: &str = "https://xblmessaging.xboxlive.com/network/xbox/users/me";

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Conversation {
    /// "dm" | "group"
    pub kind: String,
    pub id: String,
    pub folder: String,
    pub title: String,
    pub participants: Vec<String>,
    /// For a DM: the other person.
    pub other_xuid: String,
    pub group_id: String,
    pub channel_id: String,
    pub last_text: String,
    pub last_sender: String,
    pub last_time: String,
    pub last_message_id: String,
    pub unread: bool,
    pub muted: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Message {
    pub id: String,
    pub sender: String,
    pub text: String,
    pub time: String,
    /// "text" | "image" | "other"
    pub kind: String,
    pub deleted: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Thread {
    pub conversation_id: String,
    /// Oldest first.
    pub messages: Vec<Message>,
    pub more: Option<String>,
}

fn s(v: &Value) -> String {
    match v {
        Value::String(x) => x.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

/// Text of a message's parts; non-text parts become short placeholders.
fn text_of(payload: &Value) -> (String, String) {
    let parts = payload["contentPayload"]["content"]["parts"].as_array().cloned().unwrap_or_default();
    let mut text = String::new();
    let mut kind = "text";
    for p in &parts {
        match p["contentType"].as_str().unwrap_or("") {
            "text" => text.push_str(p["text"].as_str().unwrap_or("")),
            "image" | "gif" => {
                kind = "image";
                if text.is_empty() {
                    text = "[Image]".into();
                }
            }
            "weblink" | "link" => text.push_str(p["url"].as_str().or(p["text"].as_str()).unwrap_or("[Link]")),
            "directMention" => text.push_str(&format!("@{}", p["text"].as_str().or(p["gamertag"].as_str()).unwrap_or(""))),
            "" => {}
            other => {
                kind = "other";
                if text.is_empty() {
                    text = format!("[{other}]");
                }
            }
        }
    }
    if parts.is_empty() {
        if let Some(t) = payload["contentPayload"]["content"].as_str() {
            text = t.to_string();
        }
    }
    (text, kind.into())
}

fn message_from(m: &Value) -> Message {
    let (text, kind) = text_of(m);
    Message {
        id: s(&m["messageId"]),
        sender: s(&m["sender"]),
        text,
        time: s(&m["timestamp"]),
        kind,
        deleted: m["isDeleted"].as_bool().unwrap_or(false),
    }
}

pub fn inbox(x: &Xbl, folder: &str, me: &str) -> Result<Vec<Conversation>, XblError> {
    let v = x.get(&format!("{BASE}/inbox/{folder}?maxItems=100"), 1)?;
    Ok(v["conversations"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|c| c["type"] == "OneToOne")
        .map(|c| {
            let lm = &c["lastMessage"];
            let (text, _) = text_of(lm);
            let participants: Vec<String> = c["participants"].as_array().map(|a| a.iter().map(s).collect()).unwrap_or_default();
            Conversation {
                kind: "dm".into(),
                id: s(&c["conversationId"]),
                folder: folder.to_lowercase(),
                other_xuid: participants.iter().find(|p| *p != me).cloned().unwrap_or_default(),
                participants,
                last_text: text,
                last_sender: s(&lm["sender"]),
                last_time: s(&lm["timestamp"]).max(s(&c["timestamp"])),
                last_message_id: s(&lm["messageId"]),
                unread: !c["isRead"].as_bool().unwrap_or(true),
                muted: c["muted"].as_bool().unwrap_or(false),
                ..Default::default()
            }
        })
        .collect())
}

pub fn groups(x: &Xbl) -> Result<Vec<Conversation>, XblError> {
    let v = x.get(&format!("{BASE}/groups"), 1)?;
    let mut out = vec![];
    for g in v["groups"].as_array().into_iter().flatten() {
        let Some(ch) = g["channels"].as_array().and_then(|c| c.first()) else { continue };
        let lm = &ch["lastMessage"]["payload"];
        let (text, _) = text_of(lm);
        out.push(Conversation {
            kind: "group".into(),
            id: s(&ch["id"]),
            folder: "primary".into(),
            title: s(&g["groupName"]),
            participants: g["participants"].as_array().map(|a| a.iter().map(s).collect()).unwrap_or_default(),
            group_id: s(&g["groupId"]),
            channel_id: s(&ch["channelId"]),
            last_text: text,
            last_sender: s(&lm["sender"]),
            last_time: s(&lm["timestamp"]).max(s(&ch["timestamp"])),
            last_message_id: s(&ch["lastMessage"]["messageId"]),
            unread: !ch["isRead"].as_bool().unwrap_or(true),
            muted: ch["notificationOptions"] == "None",
            ..Default::default()
        });
    }
    Ok(out)
}

fn finish(mut messages: Vec<Message>, more: Option<String>, conversation_id: String) -> Thread {
    messages.retain(|m| !m.deleted);
    messages.sort_by(|a, b| a.time.cmp(&b.time));
    Thread { conversation_id, messages, more: more.filter(|m| !m.is_empty()) }
}

pub fn dm_thread(x: &Xbl, xuid: &str, before: Option<&str>) -> Result<Thread, XblError> {
    let mut url = format!("{BASE}/conversations/users/xuid({xuid})?maxItems=60");
    if let Some(b) = before {
        url += &format!("&continuationToken={b}");
    }
    match x.get(&url, 1) {
        Ok(v) => {
            let msgs = v["messages"].as_array().into_iter().flatten().filter(|m| m["type"] == "ContentMessage").map(message_from).collect();
            Ok(finish(msgs, v["continuationToken"].as_str().map(str::to_string), s(&v["conversationId"])))
        }
        // never talked before: empty thread
        Err(e) if e.status == 404 => Ok(Thread { conversation_id: String::new(), messages: vec![], more: None }),
        Err(e) => Err(e),
    }
}

pub fn group_thread(x: &Xbl, group: &str, channel: &str, before: Option<&str>) -> Result<Thread, XblError> {
    let mut url = format!("{BASE}/groups/{group}/channels/{channel}/messages?maxItems=60");
    if let Some(b) = before {
        url += &format!("&continuationToken={b}");
    }
    let v = x.get(&url, 1)?;
    let msgs = v["messages"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|m| !m["flagIsDeleted"].as_bool().unwrap_or(false) && m["payload"]["type"] == "ContentMessage")
        .map(|m| message_from(&m["payload"]))
        .collect();
    Ok(finish(msgs, v["continuationToken"].as_str().map(str::to_string), String::new()))
}

fn text_body(text: &str) -> Value {
    json!({ "parts": [{ "contentType": "text", "version": 0, "text": text.trim().chars().take(1000).collect::<String>() }] })
}

pub fn send_dm(x: &Xbl, xuid: &str, text: &str) -> Result<(), XblError> {
    x.post(&format!("{BASE}/conversations/users/xuid({xuid})"), 1, &text_body(text))?;
    Ok(())
}

pub fn send_group(x: &Xbl, group: &str, channel: &str, text: &str) -> Result<(), XblError> {
    x.post(&format!("{BASE}/groups/{group}/channels/{channel}/messages"), 1, &text_body(text))?;
    Ok(())
}

/// Mark a one-to-one conversation read up to `message_id`.
pub fn mark_read(x: &Xbl, conversation_id: &str, message_id: &str) -> Result<(), XblError> {
    x.put(
        &format!("{BASE}/conversations/horizon"),
        3,
        &json!({ "conversations": [{ "conversationId": conversation_id, "conversationType": "OneToOne", "horizonType": "Read", "horizon": message_id }] }),
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parts() {
        let m: Value = serde_json::from_str(r#"{"contentPayload":{"content":{"parts":[{"contentType":"text","text":"gg ","version":0},{"contentType":"text","text":"wp","version":0}]}},"messageId":"1","sender":"2","timestamp":"t","type":"ContentMessage"}"#).unwrap();
        let msg = message_from(&m);
        assert_eq!((msg.text.as_str(), msg.kind.as_str()), ("gg wp", "text"));
        let img: Value = serde_json::from_str(r#"{"contentPayload":{"content":{"parts":[{"contentType":"image"}]}}}"#).unwrap();
        assert_eq!(text_of(&img), ("[Image]".to_string(), "image".to_string()));
    }
}
