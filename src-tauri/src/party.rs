//! Friends and parties.
//! Party voice runs on Xbox's own audio stack inside the Xbox app / Game Bar, so Squadr doesn't carry
//! voice itself. It shows who's in a party, reads your own party, and sends real party invites through
//! MPSD; joining a friend's party is handed to the Xbox app.

use crate::lfg::Person;
use crate::xbl::{Xbl, XblError};
use serde::Serialize;
use serde_json::{json, Value};

pub const PARTY_SCID: &str = "7492BACA-C1B4-440D-A391-B7EF364A8D40";
const MPSD: &str = "https://sessiondirectory.xboxlive.com";

fn s(v: &Value) -> String {
    match v {
        Value::String(x) => x.clone(),
        Value::Number(n) => n.to_string(),
        _ => String::new(),
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Friend {
    pub person: Person,
    /// "Online" | "Offline" | "Away"
    pub state: String,
    pub favorite: bool,
    pub in_party: bool,
    pub party_joinable: bool,
    /// Title names of games they're in that you could join.
    pub joinable_games: Vec<String>,
    pub device: String,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PartyMember {
    pub xuid: String,
    pub gamertag: String,
    pub index: u32,
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Party {
    pub scid: String,
    pub name: String,
    pub join_restriction: String,
    pub members: Vec<PartyMember>,
    pub title_id: String,
}

pub fn friends(x: &Xbl) -> Result<Vec<Friend>, XblError> {
    let v = x.get("https://peoplehub.xboxlive.com/users/me/people/social/decoration/presencedetail,multiplayersummary", 5)?;
    let mut out: Vec<Friend> = v["people"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|p| p["isFollowedByCaller"].as_bool().unwrap_or(false))
        .map(|p| {
            let ms = &p["multiplayerSummary"];
            let party = ms["partyDetails"].as_array().and_then(|a| a.first()).cloned().unwrap_or(Value::Null);
            let primary = p["presenceDetails"].as_array().and_then(|a| a.iter().find(|d| d["IsPrimary"] == true).cloned()).unwrap_or(Value::Null);
            Friend {
                person: Person {
                    xuid: s(&p["xuid"]),
                    gamertag: p["modernGamertag"].as_str().filter(|g| !g.is_empty()).map(str::to_string).unwrap_or_else(|| s(&p["gamertag"])),
                    gamerpic: s(&p["displayPicRaw"]),
                    presence: s(&p["presenceText"]),
                    rep: s(&p["xboxOneRep"]),
                    gamerscore: s(&p["gamerScore"]),
                    is_friend: true,
                },
                state: s(&p["presenceState"]),
                favorite: p["isFavorite"].as_bool().unwrap_or(false),
                in_party: ms["inParty"].as_u64().unwrap_or(0) > 0 || !party.is_null(),
                party_joinable: !party.is_null() && party["joinRestriction"] != "local" && party["status"] == "active",
                joinable_games: ms["joinableActivities"].as_array().map(|a| a.iter().filter_map(|j| j["titleId"].as_u64().map(|t| t.to_string())).collect()).unwrap_or_default(),
                device: match s(&primary["Device"]).as_str() {
                    "Scarlett" => "Xbox Series X|S".into(),
                    "Durango" | "XboxOne" => "Xbox One".into(),
                    "WindowsOneCore" | "PC" | "Win32" => "PC".into(),
                    "iOS" | "Android" => "Mobile".into(),
                    "" => String::new(),
                    d => d.to_string(),
                },
            }
        })
        .collect();
    let rank = |f: &Friend| (if f.in_party { 0 } else if f.state == "Online" { 1 } else { 2 }, !f.favorite);
    out.sort_by(|a, b| rank(a).cmp(&rank(b)).then_with(|| a.person.gamertag.to_lowercase().cmp(&b.person.gamertag.to_lowercase())));
    Ok(out)
}

/// The party you're in right now (started on your Xbox, the Xbox app or Game Bar), if any.
pub fn my_party(x: &Xbl, me: &str) -> Result<Option<Party>, XblError> {
    let v = x.get(&format!("{MPSD}/serviceconfigs/{PARTY_SCID}/sessiontemplates/chat/sessions?xuid={me}"), 107)?;
    let Some(r) = v["results"].as_array().and_then(|a| a.iter().find(|r| r["status"] != "inactive" || r["accepted"] == true).or(a.first())).cloned() else {
        return Ok(None);
    };
    let scid = s(&r["sessionRef"]["scid"]);
    let name = s(&r["sessionRef"]["name"]);
    if name.is_empty() {
        return Ok(None);
    }
    let doc = x.get(&format!("{MPSD}/serviceconfigs/{scid}/sessiontemplates/chat/sessions/{name}"), 107)?;
    if !doc.is_object() {
        return Ok(None);
    }
    let mut title_id = String::new();
    let mut members: Vec<PartyMember> = doc["members"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(k, m)| {
            let xuid = s(&m["constants"]["system"]["xuid"]);
            if xuid == me {
                title_id = s(&m["activeTitleId"]);
            }
            PartyMember { xuid, gamertag: s(&m["gamertag"]), index: k.parse().unwrap_or(0) }
        })
        .collect();
    if !members.iter().any(|m| m.xuid == me) {
        return Ok(None);
    }
    members.sort_by_key(|m| m.index);
    Ok(Some(Party { scid, name, join_restriction: s(&doc["properties"]["system"]["joinRestriction"]), members, title_id }))
}

/// Send someone an invite to your current party (they get the normal Xbox party invite).
pub fn invite(x: &Xbl, party: &Party, xuid: &str) -> Result<(), XblError> {
    let mut body = json!({
        "version": 1,
        "type": "invite",
        "sessionRef": { "scid": party.scid, "templateName": "chat", "name": party.name },
        "invitedXuid": xuid,
    });
    if !party.title_id.is_empty() {
        body["inviteAttributes"] = json!({ "titleId": party.title_id });
    }
    x.post(&format!("{MPSD}/handles"), 107, &body)?;
    Ok(())
}
