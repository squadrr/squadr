import { ExternalLink, Gamepad2, Headphones, LoaderCircle, MessageSquare, RefreshCw, Search, Star } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar } from "../components/common";
import { findTitle } from "../lib/actions";
import { api, social, type Friend } from "../lib/api";
import { xboxProfileUrl } from "../lib/format";
import { inviteToParty, joinPartyInXbox, loadFriends, loadParty, messagePerson } from "../lib/social";
import { useApp } from "../lib/store";

type Filter = "all" | "online" | "party";

/** Friends with presence and party status, plus your own party and invites. */
export function Friends() {
  const { friends, friendsError, party, partyChecked, people, auth, busy } = useApp();
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  useEffect(() => {
    loadFriends();
    loadParty();
    const id = setInterval(() => (loadFriends(), loadParty()), 45_000);
    return () => clearInterval(id);
  }, []);

  const list = (friends ?? []).filter((f) => (!q || f.person.gamertag.toLowerCase().includes(q.toLowerCase())) && (filter === "all" || (filter === "online" ? f.state === "Online" : f.inParty)));
  const online = (friends ?? []).filter((f) => f.state === "Online").length;
  const inParty = (friends ?? []).filter((f) => f.inParty).length;

  return (
    <div className="view">
      <div className="toolbar">
        <div className="tb-title">
          <b>Friends & party</b>
          {friends && <span className="muted">{online} online</span>}
        </div>
        <button className="tool" onClick={() => (loadFriends(), loadParty())}>
          <RefreshCw size={15} /> Refresh
        </button>
        <div className="grow" />
        <button className="btn-ghost" onClick={() => social.openXbox("gamebar")} title="Start or manage voice parties in Xbox Game Bar (Win+G)">
          <Headphones size={14} /> Open Game Bar
        </button>
      </div>
      <div className="scroll">
        <div className="feed">
          <div className="party-card">
            <div className="party-head">
              <span className="party-ico">
                <Headphones size={18} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <b>{party ? `Your party · ${party.members.length}` : "You're not in a party"}</b>
                <div className="sub">
                  {party
                    ? "Invite anyone from here; they get the normal Xbox party invite. Voice runs in the Xbox app or Game Bar."
                    : partyChecked
                      ? "Start a party on your Xbox, in the Xbox app, or in Game Bar (Win+G). Squadr picks it up so you can invite people from here."
                      : "Checking…"}
                </div>
              </div>
              <button className="icon-btn" title="Check again" onClick={loadParty}>
                <RefreshCw size={14} />
              </button>
            </div>
            {party && (
              <div className="party-members">
                {party.members.map((m) => (
                  <span key={m.xuid} className="party-member">
                    <Avatar person={people[m.xuid]} gamertag={m.gamertag} size={22} /> {people[m.xuid]?.gamertag ?? m.gamertag}
                    {m.xuid === auth?.xuid && <span className="muted"> (you)</span>}
                  </span>
                ))}
              </div>
            )}
          </div>

          <div className="friends-bar">
            <div className="seg" style={{ margin: 0 }}>
              {(["all", "online", "party"] as Filter[]).map((f) => (
                <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
                  {f === "all" ? "All" : f === "online" ? `Online · ${online}` : `In a party · ${inParty}`}
                </button>
              ))}
            </div>
            <label className="search" style={{ flex: 1, maxWidth: 260 }}>
              <Search size={14} />
              <input placeholder="Search friends" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
            </label>
          </div>

          {friends === null && (
            <div className="empty-note">
              <LoaderCircle size={14} className="spin" style={{ verticalAlign: -2 }} /> Loading friends…
            </div>
          )}
          {friendsError && <div className="banner" style={{ color: "var(--bad)" }}>{friendsError}</div>}
          {friends && !list.length && <div className="empty-note">{q ? "Nobody matches." : filter === "party" ? "None of your friends are in a party right now." : "Nobody here."}</div>}
          {list.length > 0 && (
            <div className="list">
              {list.map((f) => (
                <FriendRow key={f.person.xuid} f={f} canInvite={!!party && !party.members.some((m) => m.xuid === f.person.xuid)} inviting={!!busy[`invite:${f.person.xuid}`]} />
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FriendRow({ f, canInvite, inviting }: { f: Friend; canInvite: boolean; inviting: boolean }) {
  const p = f.person;
  const online = f.state === "Online";
  const games = f.joinableGames.map((id) => findTitle(id)?.name).filter(Boolean);
  return (
    <div className={`item person friend ${online ? "" : "off"}`}>
      <span className="pfp-wrap">
        <Avatar person={p} size={36} />
        <i className={`presence-dot ${online ? "on" : f.state === "Away" ? "away" : ""}`} />
      </span>
      <div className="main-col">
        <div className="name">
          {p.gamertag}
          {f.favorite && <Star size={12} fill="currentColor" style={{ color: "var(--warn)" }} />}
          {f.inParty && (
            <span className="badge good">
              <Headphones size={11} /> In a party
            </span>
          )}
          {f.joinableGames.length > 0 && (
            <span className="badge" title={games.join(", ")}>
              <Gamepad2 size={11} /> Joinable game
            </span>
          )}
        </div>
        <div className="sub">{[p.presence || f.state, f.device && online ? f.device : ""].filter(Boolean).join(" · ")}</div>
      </div>
      <div className="row-btns">
        {f.inParty && (
          <button className="mini-btn good" onClick={() => joinPartyInXbox(p.xuid, p.gamertag)} title="Opens their profile in the Xbox app, where you can join their party with voice">
            <Headphones size={14} /> Join party
          </button>
        )}
        {canInvite && (
          <button className="mini-btn" disabled={inviting} onClick={() => inviteToParty([p.xuid], p.gamertag)} title="Invite to your party">
            <Headphones size={14} /> Invite
          </button>
        )}
        <button className="mini-btn" onClick={() => messagePerson(p.xuid)} title="Message">
          <MessageSquare size={14} />
        </button>
        <button className="icon-btn" title="Xbox profile" onClick={() => api.openUrl(xboxProfileUrl(p.gamertag))}>
          <ExternalLink size={14} />
        </button>
      </div>
    </div>
  );
}
