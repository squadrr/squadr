//! Xbox Looking-for-Group, spoken directly to the Multiplayer Session Directory (MPSD).
//!
//! An LFG post is an MPSD session under the game's SCID using the `global(lfg)` template, plus a
//! "search" handle that makes it show up in queries. The host is member 0; people who apply join the
//! session (with an optional message in their member description) and the host gives the ones they
//! accept the `lfg: confirmed` role. Shapes below were taken from real posts.

use crate::xbl::{Xbl, XblError};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

const MPSD: &str = "https://sessiondirectory.xboxlive.com";
pub const TEMPLATE: &str = "global(lfg)";
const MPSD_CONTRACT: u32 = 107;
const CHANGE_TYPES: [&str; 7] = ["memberslist", "membersstatus", "joinability", "customproperty", "memberscustomproperty", "roles", "scheduledtime"];

// ---------------------------------------------------------------- types

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Title {
    pub title_id: String,
    pub name: String,
    pub scid: String,
    pub image: String,
    pub last_played: Option<String>,
    pub devices: Vec<String>,
}

#[derive(Serialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Post {
    pub handle_id: String,
    pub scid: String,
    pub session_name: String,
    pub title_id: String,
    pub title_name: String,
    pub host_xuid: String,
    pub description: String,
    pub locale: String,
    pub tags: Vec<String>,
    pub target: u32,
    pub confirmed: u32,
    pub max: u32,
    pub needs: u32,
    pub members_count: u32,
    pub posted: String,
    pub scheduled: Option<String>,
    pub confirmed_xuids: Vec<String>,
    pub closed: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase")]
pub struct Person {
    pub xuid: String,
    pub gamertag: String,
    pub gamerpic: String,
    pub presence: String,
    pub rep: String,
    pub gamerscore: String,
    pub is_friend: bool,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Member {
    pub index: u32,
    pub xuid: String,
    pub gamertag: String,
    /// "host" | "confirmed" | "applicant"
    pub role: String,
    pub message: String,
    pub join_time: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Detail {
    pub post: Post,
    pub members: Vec<Member>,
    /// Your role in this post, if you're in it.
    pub my_role: Option<String>,
}

#[derive(Deserialize, Clone, Debug, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct Filters {
    pub language: String,
    pub tags: Vec<String>,
    pub min_needs: u32,
}

#[derive(Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NewPost {
    pub scid: String,
    pub title_id: String,
    pub description: String,
    pub language: String,
    pub need: u32,
    pub tags: Vec<String>,
}

// ---------------------------------------------------------------- helpers

fn s(v: &Value) -> String {
    match v {
        Value::String(x) => x.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}
fn u(v: &Value) -> u32 {
    v.as_u64().unwrap_or(0) as u32
}

pub fn session_url(scid: &str, name: &str) -> String {
    format!("{MPSD}/serviceconfigs/{scid}/sessiontemplates/{TEMPLATE}/sessions/{name}")
}

/// Tags must start with a letter, have no spaces and be under 100 characters.
pub fn clean_tag(t: &str) -> Option<String> {
    let t: String = t.chars().filter(|c| c.is_alphanumeric()).take(40).collect();
    t.chars().next().filter(|c| c.is_alphabetic()).map(|_| t)
}

fn odata(s: &str) -> String {
    s.replace('\'', "''").to_lowercase()
}

pub fn post_from_handle(h: &Value) -> Post {
    let r = &h["relatedInfo"];
    let c = &h["roleInfo"]["lfg"]["roles"]["confirmed"];
    let target = u(&c["target"]).max(if c["target"].is_null() { u(&c["max"]) } else { 0 });
    let confirmed = u(&c["count"]);
    Post {
        handle_id: s(&h["id"]),
        scid: s(&h["sessionRef"]["scid"]),
        session_name: s(&h["sessionRef"]["name"]),
        title_id: s(&h["activityInfo"]["titleId"]),
        title_name: s(&h["activityInfo"]["titleName"]),
        host_xuid: r["sessionOwners"].get(0).map(s).unwrap_or_default(),
        description: s(&r["description"]["text"]).trim().to_string(),
        locale: s(&h["searchAttributes"]["locale"]),
        tags: h["searchAttributes"]["tags"].as_array().map(|a| a.iter().map(s).filter(|t| !t.is_empty()).collect()).unwrap_or_default(),
        target,
        confirmed,
        max: u(&c["max"]),
        needs: target.saturating_sub(confirmed),
        members_count: u(&r["membersCount"]),
        posted: s(&r["postedTime"]),
        scheduled: r["scheduledTime"].as_str().map(str::to_string),
        confirmed_xuids: c["memberXuids"].as_array().map(|a| a.iter().map(s).collect()).unwrap_or_default(),
        closed: r["closed"].as_bool().unwrap_or(false),
    }
}

fn member_body(xuid: &str, connection: &str, message: Option<&str>, initialize: bool) -> Value {
    let sub = uuid::Uuid::new_v4().to_string();
    let mut system = json!({
        "active": true,
        "connection": connection,
        "subscription": { "id": sub, "changeTypes": CHANGE_TYPES },
    });
    if let Some(m) = message.map(str::trim).filter(|m| !m.is_empty()) {
        system["description"] = json!({ "text": m.chars().take(256).collect::<String>(), "locale": "en-US" });
    }
    let mut me = json!({ "properties": { "system": system } });
    if initialize {
        me["constants"] = json!({ "system": { "xuid": xuid, "initialize": true } });
    }
    me
}

// ---------------------------------------------------------------- games

fn title_from(t: &Value) -> Title {
    Title {
        title_id: s(&t["titleId"]),
        name: s(&t["name"]),
        scid: s(&t["serviceConfigId"]),
        image: s(&t["displayImage"]).replacen("http://", "https://", 1),
        last_played: t["titleHistory"]["lastTimePlayed"].as_str().map(str::to_string),
        devices: t["devices"].as_array().map(|a| a.iter().map(s).collect()).unwrap_or_default(),
    }
}

/// Games you've played that have an Xbox service config (only those can have LFG posts).
pub fn title_history(x: &Xbl, xuid: &str) -> Result<Vec<Title>, XblError> {
    let v = x.get(&format!("https://titlehub.xboxlive.com/users/xuid({xuid})/titles/titlehistory/decoration/scid,image,detail?maxItems=200"), 2)?;
    Ok(v["titles"].as_array().map(|a| a.iter().filter(|t| t["type"] == "Game").map(title_from).filter(|t| !t.scid.is_empty()).collect()).unwrap_or_default())
}

pub fn titles_by_id(x: &Xbl, ids: &[String]) -> Result<Vec<Title>, XblError> {
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let v = x.post("https://titlehub.xboxlive.com/titles/batch/decoration/scid,image,detail", 2, &json!({ "titleIds": ids }))?;
    Ok(v["titles"].as_array().map(|a| a.iter().map(title_from).filter(|t| !t.scid.is_empty()).collect()).unwrap_or_default())
}

/// Search the Microsoft Store catalog and keep games that resolve to an Xbox title id.
pub fn search_games(x: &Xbl, query: &str) -> Result<Vec<Title>, String> {
    let agent = ureq::AgentBuilder::new().timeout(std::time::Duration::from_secs(15)).build();
    let ac: Value = agent
        .get("https://displaycatalog.mp.microsoft.com/v7.0/productFamilies/autosuggest")
        .query("market", "US")
        .query("languages", "en-US")
        .query("productFamilyNames", "Games")
        .query("query", query)
        .call()
        .map_err(|e| format!("Store search failed: {e}"))?
        .into_json()
        .map_err(|e| e.to_string())?;
    let ids: Vec<String> = ac["Results"].as_array().into_iter().flatten().flat_map(|r| r["Products"].as_array().cloned().unwrap_or_default()).map(|p| s(&p["ProductId"])).filter(|i| !i.is_empty()).take(20).collect();
    if ids.is_empty() {
        return Ok(vec![]);
    }
    let prods: Value = agent
        .get("https://displaycatalog.mp.microsoft.com/v7.0/products")
        .query("bigIds", &ids.join(","))
        .query("market", "US")
        .query("languages", "en-US")
        .call()
        .map_err(|e| format!("Store lookup failed: {e}"))?
        .into_json()
        .map_err(|e| e.to_string())?;
    let mut title_ids: Vec<String> = vec![];
    let mut pfns: Vec<String> = vec![];
    for p in prods["Products"].as_array().into_iter().flatten() {
        let tid = p["AlternateIds"].as_array().and_then(|a| a.iter().find(|i| i["IdType"] == "XboxTitleId")).map(|i| s(&i["Value"]));
        match tid {
            Some(t) if !t.is_empty() => title_ids.push(t),
            _ => {
                let pfn = s(&p["Properties"]["PackageFamilyName"]);
                if !pfn.is_empty() {
                    pfns.push(pfn)
                }
            }
        }
    }
    let mut out = titles_by_id(x, &title_ids).unwrap_or_default();
    if !pfns.is_empty() {
        if let Ok(v) = x.post("https://titlehub.xboxlive.com/titles/batch/decoration/scid,image,detail", 2, &json!({ "pfns": pfns })) {
            out.extend(v["titles"].as_array().into_iter().flatten().map(title_from).filter(|t| !t.scid.is_empty()));
        }
    }
    let mut seen = std::collections::HashSet::new();
    out.retain(|t| seen.insert(t.title_id.clone()));
    // keep the store's relevance order
    out.sort_by_key(|t| title_ids.iter().position(|i| *i == t.title_id).unwrap_or(usize::MAX));
    Ok(out)
}

// ---------------------------------------------------------------- browse

fn query_body(scid: &str, f: &Filters, order: bool) -> Value {
    let mut filter = format!("session/roles/lfg/confirmed/needs ge {}", f.min_needs.max(1));
    for t in f.tags.iter().filter_map(|t| clean_tag(t)) {
        filter += &format!(" and tags/any(d:tolower(d) eq '{}')", odata(&t));
    }
    if !f.language.is_empty() {
        filter += &format!(" and language eq '{}'", odata(&f.language));
    }
    let mut b = json!({
        "type": "search",
        "scid": scid,
        "templateName": TEMPLATE,
        "communicatePermissionRequired": true,
        "includeScheduled": true,
        "filter": filter,
    });
    if order {
        b["orderBy"] = json!("suggestedLfg desc");
    }
    b
}

pub fn query(x: &Xbl, scid: &str, f: &Filters) -> Result<Vec<Post>, XblError> {
    let v = x.post(&format!("{MPSD}/handles/query?include=relatedInfo,roleInfo,activityInfo"), MPSD_CONTRACT, &query_body(scid, f, true))?;
    Ok(v["results"].as_array().map(|a| a.iter().map(post_from_handle).filter(|p| !p.closed).collect()).unwrap_or_default())
}

pub fn count(x: &Xbl, scid: &str, f: &Filters) -> Result<u32, XblError> {
    let v = x.post(&format!("{MPSD}/handles/query?include=countonly"), MPSD_CONTRACT, &query_body(scid, f, false))?;
    Ok(u(&v["count"]))
}

pub fn handle(x: &Xbl, handle_id: &str) -> Result<Post, XblError> {
    let v = x.get(&format!("{MPSD}/handles/{handle_id}?include=relatedInfo,roleInfo,activityInfo"), MPSD_CONTRACT)?;
    Ok(post_from_handle(&v))
}

pub fn session_doc(x: &Xbl, scid: &str, name: &str) -> Result<Value, XblError> {
    x.get(&session_url(scid, name), MPSD_CONTRACT)
}

/// Members of a session document, with roles worked out.
pub fn members(doc: &Value) -> Vec<Member> {
    let owners: Vec<u64> = doc["properties"]["system"]["owners"].as_array().map(|a| a.iter().filter_map(Value::as_u64).collect()).unwrap_or_default();
    let mut out: Vec<Member> = doc["members"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(k, m)| {
            let index = k.parse::<u32>().unwrap_or(0);
            let role = if owners.contains(&(index as u64)) {
                "host"
            } else if m["roles"]["lfg"] == "confirmed" {
                "confirmed"
            } else {
                "applicant"
            };
            Member {
                index,
                xuid: s(&m["constants"]["system"]["xuid"]),
                gamertag: s(&m["gamertag"]),
                role: role.into(),
                message: s(&m["properties"]["system"]["description"]["text"]).trim().to_string(),
                join_time: s(&m["joinTime"]),
            }
        })
        .collect();
    out.sort_by_key(|m| (m.role != "host", m.role != "confirmed", m.index));
    out
}

pub fn detail(x: &Xbl, handle_id: &str, my_xuid: &str) -> Result<Detail, XblError> {
    let mut post = handle(x, handle_id)?;
    let doc = session_doc(x, &post.scid, &post.session_name)?;
    let members = members(&doc);
    if let Some(d) = doc["properties"]["system"]["description"]["text"].as_str() {
        post.description = d.trim().to_string();
    }
    post.members_count = members.len() as u32;
    let my_role = members.iter().find(|m| m.xuid == my_xuid).map(|m| m.role.clone());
    Ok(Detail { post, members, my_role })
}

// ---------------------------------------------------------------- people

pub fn people(x: &Xbl, xuids: &[String]) -> Result<Vec<Person>, XblError> {
    let mut out = vec![];
    for chunk in xuids.chunks(100) {
        let v = x.post("https://peoplehub.xboxlive.com/users/me/people/batch/decoration/presencedetail", 5, &json!({ "xuids": chunk }))?;
        for p in v["people"].as_array().into_iter().flatten() {
            out.push(Person {
                xuid: s(&p["xuid"]),
                gamertag: p["modernGamertag"].as_str().filter(|g| !g.is_empty()).map(str::to_string).unwrap_or_else(|| s(&p["gamertag"])),
                gamerpic: s(&p["displayPicRaw"]),
                presence: s(&p["presenceText"]),
                rep: s(&p["xboxOneRep"]),
                gamerscore: s(&p["gamerScore"]),
                is_friend: p["isFollowedByCaller"].as_bool().unwrap_or(false),
            });
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------- write

/// Create a post: the session first (with us as host), then the search handle that lists it.
pub fn create(x: &Xbl, my_xuid: &str, connection: &str, p: &NewPost) -> Result<Post, XblError> {
    let name = uuid::Uuid::new_v4().to_string();
    let lang = if p.language.is_empty() { "en".to_string() } else { p.language.clone() };
    let need = p.need.clamp(1, 15);
    let body = json!({
        "properties": { "system": {
            "description": { "text": p.description.trim().chars().take(256).collect::<String>(), "locale": lang },
            "searchHandleVisibility": "xboxlive",
            "joinRestriction": "local",
            "readRestriction": "local",
        }},
        "roleTypes": { "lfg": { "roles": { "confirmed": { "target": need } } } },
        "members": { "me": member_body(my_xuid, connection, None, true) },
    });
    let url = session_url(&p.scid, &name);
    x.put(&url, MPSD_CONTRACT, &body)?;
    let tags: Vec<String> = p.tags.iter().filter_map(|t| clean_tag(t)).take(10).collect();
    let handle = json!({
        "version": 1,
        "type": "search",
        "sessionRef": { "scid": p.scid, "templateName": TEMPLATE, "name": name },
        "searchAttributes": { "tags": tags, "achievementIds": [], "locale": lang },
    });
    match x.post(&format!("{MPSD}/handles"), MPSD_CONTRACT, &handle) {
        Ok(h) => {
            let id = s(&h["id"]);
            Ok(self::handle(x, &id).unwrap_or_else(|_| {
                let mut post = post_from_handle(&h);
                post.handle_id = id;
                post
            }))
        }
        Err(e) => {
            // Don't leave a half-made session behind.
            let _ = x.put(&url, MPSD_CONTRACT, &json!({ "members": { "me": null } }));
            Err(e)
        }
    }
}

/// Ask to join someone's post (shows up for them as an applicant with your message).
pub fn apply(x: &Xbl, handle_id: &str, my_xuid: &str, connection: &str, message: &str) -> Result<(), XblError> {
    x.put(&format!("{MPSD}/handles/{handle_id}/session"), MPSD_CONTRACT, &json!({ "members": { "me": member_body(my_xuid, connection, Some(message), true) } }))?;
    Ok(())
}

pub fn leave(x: &Xbl, scid: &str, name: &str) -> Result<(), XblError> {
    match x.put(&session_url(scid, name), MPSD_CONTRACT, &json!({ "members": { "me": null } })) {
        Ok(_) => Ok(()),
        // the session already ended (host cancelled / everyone left)
        Err(e) if e.status == 404 || e.status == 204 => Ok(()),
        Err(e) => Err(e),
    }
}

pub fn set_confirmed(x: &Xbl, scid: &str, name: &str, index: u32, confirmed: bool) -> Result<(), XblError> {
    let role = if confirmed { json!("confirmed") } else { Value::Null };
    x.put(&session_url(scid, name), MPSD_CONTRACT, &json!({ "members": { index.to_string(): { "roles": { "lfg": role } } } }))?;
    Ok(())
}

pub fn remove_member(x: &Xbl, scid: &str, name: &str, index: u32) -> Result<(), XblError> {
    x.put(&session_url(scid, name), MPSD_CONTRACT, &json!({ "members": { index.to_string(): null } }))?;
    Ok(())
}

/// Host ends their post: remove the search handle, then leave (the session ends with its owner).
pub fn cancel(x: &Xbl, scid: &str, name: &str, handle_id: &str) -> Result<(), XblError> {
    if !handle_id.is_empty() {
        let _ = x.delete(&format!("{MPSD}/handles/{handle_id}"), MPSD_CONTRACT);
    }
    leave(x, scid, name)
}

/// Point our membership at a (new) RTA connection so MPSD keeps us active.
pub fn keep_active(x: &Xbl, scid: &str, name: &str, my_xuid: &str, connection: &str) -> Result<(), XblError> {
    x.put(&session_url(scid, name), MPSD_CONTRACT, &json!({ "members": { "me": member_body(my_xuid, connection, None, false) } }))?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tags() {
        assert_eq!(clean_tag("mic required!"), Some("micrequired".into()));
        assert_eq!(clean_tag("1v1"), None);
    }

    #[test]
    fn filter() {
        let b = query_body("x", &Filters { language: "en".into(), tags: vec!["Mic Required".into()], min_needs: 2 }, true);
        assert_eq!(b["filter"], "session/roles/lfg/confirmed/needs ge 2 and tags/any(d:tolower(d) eq 'micrequired') and language eq 'en'");
    }

    #[test]
    fn parses_handle() {
        let h: Value = serde_json::from_str(r#"{"type":"search","sessionRef":{"scid":"s","templateName":"global(lfg)","name":"n"},"id":"h1",
          "searchAttributes":{"tags":["micrequired"],"locale":"en"},
          "relatedInfo":{"closed":false,"membersCount":3,"sessionOwners":["111"],"description":{"text":"hi ","locale":"en"},"postedTime":"2026-11-14T04:55:32Z"},
          "roleInfo":{"lfg":{"roles":{"confirmed":{"max":15,"count":1,"target":3,"memberXuids":["222"]}}}},
          "activityInfo":{"titleId":"267695549","titleName":"Fortnite"}}"#).unwrap();
        let p = post_from_handle(&h);
        assert_eq!((p.needs, p.target, p.confirmed, p.host_xuid.as_str(), p.description.as_str()), (2, 3, 1, "111", "hi"));
    }
}
