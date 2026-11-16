import { ExternalLink, MessageSquare, Search, ThumbsDown, ThumbsUp, Trash2, Users } from "lucide-react";
import { useState } from "react";
import { Avatar } from "../components/common";
import { api, type Person } from "../lib/api";
import { xboxProfileUrl } from "../lib/format";
import { forgetPlayer, notePlayer, ratePlayer, type Player } from "../lib/players";
import { messagePerson } from "../lib/social";
import { useApp } from "../lib/store";

type Filter = "all" | "up" | "down";

/** Everyone you've grouped with through Squadr, with your ratings and notes. */
export function Players() {
  const { players } = useApp();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const all = Object.values(players).sort((a, b) => b.lastSeen - a.lastSeen);
  const list = all
    .filter((p) => (filter === "up" ? p.rating === 1 : filter === "down" ? p.rating === -1 : true))
    .filter((p) => !q.trim() || `${p.gamertag} ${p.note} ${p.games.join(" ")}`.toLowerCase().includes(q.trim().toLowerCase()));
  const up = all.filter((p) => p.rating === 1).length;
  const down = all.filter((p) => p.rating === -1).length;

  return (
    <div className="view">
      <div className="toolbar">
        <div className="tb-title">
          <b>Players</b>
          <span className="muted">{all.length} played with</span>
        </div>
      </div>
      <div className="scroll">
        <div className="content narrow">
          <div className="page-head">
            <div>
              <h1>People you've played with</h1>
              <p>Everyone you've grouped with through Squadr. Rate them so you remember. Only you can see this.</p>
            </div>
          </div>
          {all.length > 0 && (
            <div className="friends-bar">
              <div className="seg" style={{ margin: 0 }}>
                {(["all", "up", "down"] as Filter[]).map((f) => (
                  <button key={f} className={filter === f ? "on" : ""} onClick={() => setFilter(f)}>
                    {f === "all" ? "All" : f === "up" ? `Rated up · ${up}` : `Rated down · ${down}`}
                  </button>
                ))}
              </div>
              <label className="search" style={{ flex: 1, maxWidth: 260 }}>
                <Search size={14} />
                <input placeholder="Search players or notes" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
              </label>
            </div>
          )}
          {!all.length && (
            <div className="empty-feed">
              <Users size={28} className="muted" />
              <b>Nobody yet</b>
              <span>When you accept someone into your post, or a host accepts you, they show up here. Rate them so you know who to play with again, or who to skip.</span>
            </div>
          )}
          {all.length > 0 && !list.length && <div className="empty-note">Nobody matches.</div>}
          {list.length > 0 && (
            <div className="list">
              {list.map((p) => (
                <PlayerRow key={p.xuid} p={p} />
              ))}
            </div>
          )}
          {down > 0 && <div className="empty-note" style={{ marginTop: 10 }}>Posts from people you rated down are left out of your alerts.</div>}
        </div>
      </div>
    </div>
  );
}

function PlayerRow({ p }: { p: Player }) {
  const { people } = useApp();
  const person = people[p.xuid] ?? ({ xuid: p.xuid, gamertag: p.gamertag, gamerpic: p.gamerpic } as Person);
  const [note, setNote] = useState(p.note);
  const [confirm, setConfirm] = useState(false);
  const seen = new Date(p.lastSeen).toLocaleDateString([], { month: "short", day: "numeric" });
  return (
    <div className="item person player">
      <Avatar person={person} gamertag={p.gamertag} size={36} />
      <div className="main-col">
        <div className="name">
          {person.gamertag ?? p.gamertag}
          <span className="badge">{p.times === 1 ? "Once" : `${p.times}×`}</span>
        </div>
        <div className="sub">
          {p.lastGame} · {seen}
          {p.games.length > 1 && ` · also ${p.games.slice(1, 3).join(", ")}`}
        </div>
        <input
          className="player-note"
          placeholder="Add a note (mic, skill, vibe…)"
          value={note}
          maxLength={200}
          onChange={(e) => setNote(e.target.value)}
          onBlur={() => note !== p.note && notePlayer(p.xuid, note)}
          onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
          spellCheck={false}
        />
      </div>
      <div className="row-btns">
        <button className={`mini-btn rate ${p.rating === 1 ? "up" : ""}`} onClick={() => ratePlayer(p.xuid, 1)} title="Good to play with">
          <ThumbsUp size={14} />
        </button>
        <button className={`mini-btn rate ${p.rating === -1 ? "down" : ""}`} onClick={() => ratePlayer(p.xuid, -1)} title="Rather not">
          <ThumbsDown size={14} />
        </button>
        <button className="mini-btn" onClick={() => messagePerson(p.xuid)} title="Message">
          <MessageSquare size={14} />
        </button>
        <button className="icon-btn" title="Xbox profile" onClick={() => api.openUrl(xboxProfileUrl(person.gamertag ?? p.gamertag))}>
          <ExternalLink size={14} />
        </button>
        {confirm ? (
          <button className="mini-btn danger" onClick={() => forgetPlayer(p.xuid)} onMouseLeave={() => setConfirm(false)}>
            Forget?
          </button>
        ) : (
          <button className="icon-btn" title="Forget" onClick={() => setConfirm(true)}>
            <Trash2 size={14} />
          </button>
        )}
      </div>
    </div>
  );
}
