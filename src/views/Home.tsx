import { CirclePlus, Gamepad2, Radio, Search, Users } from "lucide-react";
import { Avatar, GameArt } from "../components/common";
import { createFor, openGame, openTab } from "../lib/actions";
import { useApp } from "../lib/store";

export function Home() {
  const { auth, people, games, counts, mine, rta } = useApp();
  const me = auth ? people[auth.xuid] : null;
  const hosting = (mine ?? []).find((m) => m.tracked.role === "host" && m.detail);
  const requests = hosting?.detail?.members.filter((m) => m.role === "applicant").length ?? 0;
  const joined = (mine ?? []).filter((m) => m.tracked.role === "applicant" && m.detail);
  const recent = (games ?? []).slice(0, 8);
  const busiest = [...(games ?? [])].filter((g) => counts[g.titleId]).sort((a, b) => (counts[b.titleId] ?? 0) - (counts[a.titleId] ?? 0)).slice(0, 5);

  return (
    <div className="view" style={{ gridTemplateRows: "1fr" }}>
      <div className="scroll glow">
        <div className="content">
          <div className="hero">
            <div className="hero-title">
              <Avatar person={me} gamertag={auth?.gamertag} size={58} />
              <div>
                <h1>Hey, {me?.gamertag ?? auth?.gamertag}</h1>
                <div className="muted" style={{ marginTop: 4 }}>{me?.gamerscore ? `${Number(me.gamerscore).toLocaleString()} G · ` : ""}Looking for Group</div>
              </div>
            </div>
            <div style={{ display: "flex", gap: 10 }}>
              <div className="stat-card">
                <div className="label">
                  <Radio size={12} /> Hosting
                </div>
                <div className="value">{hosting ? `${requests} ${requests === 1 ? "request" : "requests"}` : "No post"}</div>
              </div>
              <div className="stat-card">
                <div className="label">
                  <Users size={12} /> Joining
                </div>
                <div className="value">{joined.length ? `${joined.filter((j) => j.detail?.myRole === "confirmed").length}/${joined.length} accepted` : "None"}</div>
              </div>
              <div className="stat-card">
                <div className="label">
                  <span className="dot" style={{ background: rta ? "var(--good)" : "var(--warn)" }} /> Xbox Live
                </div>
                <div className="value">{rta ? "Connected" : "Connecting"}</div>
              </div>
            </div>
          </div>

          <div className="cards">
            <button className="big-card" onClick={() => (recent[0] ? openGame(recent[0]) : document.getElementById("game-search")?.focus())}>
              <Search size={110} className="ghost" />
              <span className="t">Find a group</span>
              <span className="s">{recent[0] ? `Browse open posts for ${recent[0].name}` : "Search for a game on the left"}</span>
            </button>
            <button className="big-card" onClick={() => createFor(recent[0]?.titleId ?? null)}>
              <CirclePlus size={110} className="ghost" />
              <span className="t">Create a post</span>
              <span className="s">Say what you want to play and let people come to you</span>
            </button>
          </div>

          <div className="sections">
            <div>
              <div className="sec-title">Your games</div>
              {recent.map((g) => (
                <button key={g.titleId} className="row-link" onClick={() => openGame(g)}>
                  <GameArt title={g} size={22} radius={5} />
                  <span className="txt">{g.name}</span>
                  <span className="when">{counts[g.titleId] != null ? `${counts[g.titleId].toLocaleString()} open` : ""}</span>
                </button>
              ))}
              {games && !games.length && <div className="empty-note">No Xbox games in your history yet.</div>}
              {!games && <div className="empty-note">Loading…</div>}
            </div>
            <div>
              <div className="sec-title">Busiest right now</div>
              {busiest.map((g) => (
                <button key={g.titleId} className="row-link" onClick={() => openGame(g)}>
                  <Gamepad2 size={16} className="ico" />
                  <span className="txt">{g.name}</span>
                  <span className="when">{counts[g.titleId].toLocaleString()} groups</span>
                </button>
              ))}
              {!busiest.length && <div className="empty-note">Counting groups…</div>}
              <div className="sec-title" style={{ marginTop: 26 }}>Shortcuts</div>
              <button className="row-link" onClick={() => createFor(null)}>
                <CirclePlus size={16} className="ico" /> New post <span className="kbd">Ctrl+N</span>
              </button>
              <button className="row-link" onClick={() => openTab("mine")}>
                <Users size={16} className="ico" /> My LFG <span className="kbd">Ctrl+M</span>
              </button>
              <button className="row-link" onClick={() => document.getElementById("game-search")?.focus()}>
                <Search size={16} className="ico" /> Find a game <span className="kbd">Ctrl+F</span>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
