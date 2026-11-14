import { CirclePlus, Clock, LoaderCircle, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import { Avatar, GameArt, Slots } from "../components/common";
import { createFor, findTitle, openGame, refreshMine, selectPost } from "../lib/actions";
import type { MineItem } from "../lib/api";
import { ago } from "../lib/format";
import { useApp } from "../lib/store";
import { PostDetail } from "./PostDetail";

/** Posts you host (with their requests) and posts you asked to join. */
export function Mine() {
  const { mine, mineLoading, mineError, people } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const [dismissed, setDismissed] = useState<string[]>([]);
  const items = (mine ?? []).filter((m) => !dismissed.includes(m.tracked.sessionName));
  const hosting = items.filter((m) => m.tracked.role === "host");
  const joining = items.filter((m) => m.tracked.role === "applicant");
  const sel = items.find((m) => m.tracked.handleId === open && m.detail) ?? hosting.find((m) => m.detail);

  const card = (m: MineItem) => {
    const d = m.detail;
    const t = findTitle(m.tracked.titleId);
    const requests = d?.members.filter((x) => x.role === "applicant").length ?? 0;
    const host = d ? people[d.post.hostXuid] : null;
    const status = m.gone
      ? null
      : m.tracked.role === "host"
        ? requests > 0
          ? `${requests} ${requests === 1 ? "request" : "requests"}`
          : "Waiting for requests"
        : d?.myRole === "confirmed"
          ? "You're in"
          : "Waiting for the host";
    return (
      <div key={m.tracked.sessionName} className={`mine-card ${sel?.tracked.sessionName === m.tracked.sessionName ? "active" : ""} ${m.gone ? "gone" : ""}`}>
        <button className="mine-main" disabled={!d} onClick={() => setOpen(m.tracked.handleId)}>
          <GameArt title={t} size={40} radius={9} />
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="name">
              {m.tracked.titleName}
              {status && <span className={`status-pill ${status === "You're in" || requests > 0 ? "on" : ""}`}>{status}</span>}
            </div>
            <div className="sub">{m.gone ?? d?.post.description}</div>
            {d && (
              <div className="post-foot" style={{ marginTop: 8 }}>
                <span className="need">
                  <Slots confirmed={d.post.confirmed} target={d.post.target} /> {d.post.confirmed}/{d.post.target} confirmed
                </span>
                {m.tracked.role === "applicant" && host && (
                  <span className="host-mini">
                    <Avatar person={host} size={16} /> {host.gamertag}
                  </span>
                )}
                <span className="when">
                  <Clock size={11} /> {ago(new Date(m.tracked.since).toISOString())}
                </span>
              </div>
            )}
          </div>
        </button>
        {m.gone && (
          <button className="icon-btn" onClick={() => setDismissed((x) => [...x, m.tracked.sessionName])} aria-label="Dismiss">
            <X size={14} />
          </button>
        )}
      </div>
    );
  };

  return (
    <div className="view">
      <div className="toolbar">
        <div className="tb-title">
          <b>My LFG</b>
        </div>
        <button className="tool" onClick={() => refreshMine(true)} disabled={mineLoading}>
          <RefreshCw size={15} className={mineLoading ? "spin" : undefined} /> Refresh
        </button>
        <div className="grow" />
        <button className="btn-white" onClick={() => createFor(null)}>
          <CirclePlus size={14} /> New post
        </button>
      </div>
      <div className={`split ${sel ? "with-detail" : ""}`}>
        <div className="scroll">
          <div className="feed">
            {mineError && <div className="banner" style={{ color: "var(--bad)" }}>{mineError}</div>}
            {mine === null && (
              <div className="empty-note">
                <LoaderCircle size={14} className="spin" style={{ verticalAlign: -2 }} /> Loading…
              </div>
            )}
            <div className="group-title" style={{ marginTop: 4 }}>Hosting</div>
            {hosting.length ? hosting.map(card) : <EmptyHost />}
            <div className="group-title">Asked to join</div>
            {joining.length ? joining.map(card) : <div className="empty-note">When you ask to join a group it shows up here, with whether the host picked you.</div>}
          </div>
        </div>
        {sel?.detail && <PostDetail key={sel.tracked.handleId} handleId={sel.tracked.handleId} fallback={sel.detail.post} known={sel.detail} />}
      </div>
    </div>
  );
}

function EmptyHost() {
  const { games } = useApp();
  const g = games?.[0];
  return (
    <div className="empty-card">
      <span>You're not hosting anything. Post once and people come to you.</span>
      <div className="row-btns">
        <button className="btn-ghost" onClick={() => createFor(null)}>
          <CirclePlus size={14} /> New post
        </button>
        {g && (
          <button className="btn-ghost" onClick={() => (openGame(g), selectPost(g.titleId, null))}>
            Browse {g.name}
          </button>
        )}
      </div>
    </div>
  );
}
