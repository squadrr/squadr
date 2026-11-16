import { BellPlus, BellRing, CirclePlus, Clock, LoaderCircle, RefreshCw, SlidersHorizontal, X } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Avatar, GameArt, PlayerBadge, RepBadge, Slots } from "../components/common";
import { alertFromBrowse } from "./Alerts";
import { createFor, findTitle, openTab, refreshBrowse, selectPost, setFilters, toggleTagFilter } from "../lib/actions";
import type { Post } from "../lib/api";
import { ago, LANGUAGES, tagLabel, when } from "../lib/format";
import { defaultFilters, useApp } from "../lib/store";
import { PostDetail } from "./PostDetail";
import { Glance } from "../components/Pulse";

/** One game's open LFG posts, newest/most relevant first, with a detail pane on the right. */
export function Browse({ titleId }: { titleId: string }) {
  const { browse, counts, settings, people, applied } = useApp();
  const t = findTitle(titleId);
  const b = browse[titleId];
  const filters = b?.filters ?? defaultFilters(settings?.language ?? "");
  const posts = b?.posts;

  useEffect(() => {
    // gentle auto-refresh while this tab is open
    const id = setInterval(() => refreshBrowse(titleId), 120_000);
    return () => clearInterval(id);
  }, [titleId]);

  const popular = useMemo(() => {
    const n = new Map<string, number>();
    for (const p of posts ?? []) for (const tag of p.tags) n.set(tag.toLowerCase(), (n.get(tag.toLowerCase()) ?? 0) + 1);
    return [...n.entries()].filter(([, c]) => c > 1).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([tag]) => tag);
  }, [posts]);
  const activeTags = filters.tags.map((x) => x.toLowerCase());
  const selected = b?.selected ?? null;
  const selPost = posts?.find((p) => p.handleId === selected);
  const pulse = settings?.layout === "pulse";
  const hasAlert = (settings?.alerts ?? []).some((a) => a.titleId === titleId);

  return (
    <div className="view">
      <div className="toolbar">
        <div className="tb-title">
          <GameArt title={t} size={22} radius={5} />
          <b>{t?.name ?? "Game"}</b>
          {counts[titleId] != null && <span className="muted">{counts[titleId].toLocaleString()} open</span>}
        </div>
        <button className="tool" onClick={() => refreshBrowse(titleId)} disabled={b?.loading}>
          <RefreshCw size={15} className={b?.loading ? "spin" : undefined} /> Refresh
        </button>
        <label className="tool sel" title="Minimum open spots">
          <SlidersHorizontal size={15} />
          <select value={filters.minNeeds} onChange={(e) => setFilters(titleId, { minNeeds: Number(e.target.value) })}>
            {[1, 2, 3, 4].map((n) => (
              <option key={n} value={n}>
                {n === 1 ? "Any group size" : `Needs ${n}+`}
              </option>
            ))}
          </select>
        </label>
        <label className="tool sel">
          <select value={filters.language} onChange={(e) => setFilters(titleId, { language: e.target.value })}>
            {LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.name}
              </option>
            ))}
          </select>
        </label>
        <div className="grow" />
        {hasAlert ? (
          <button className="tool" onClick={() => openTab("alerts")} title="You have an alert for this game">
            <BellRing size={15} /> Alert on
          </button>
        ) : (
          <button className="tool" onClick={() => alertFromBrowse(titleId)} title="Get a ping when a new post matching these filters goes up">
            <BellPlus size={15} /> Alert me
          </button>
        )}
        <button className="btn-white" onClick={() => createFor(titleId)}>
          <CirclePlus size={14} /> Create post
        </button>
      </div>

      <div className={`split ${selected || pulse ? "with-detail" : ""}`}>
        <div className="scroll">
          <div className="feed">
            {(popular.length > 0 || activeTags.length > 0) && (
              <div className="chips tag-bar">
                {activeTags.map((tag) => (
                  <button key={tag} className="chip on" onClick={() => toggleTagFilter(titleId, tag)}>
                    {tagLabel(tag)} <X size={12} />
                  </button>
                ))}
                {popular
                  .filter((tag) => !activeTags.includes(tag))
                  .map((tag) => (
                    <button key={tag} className="chip" onClick={() => toggleTagFilter(titleId, tag)}>
                      {tagLabel(tag)}
                    </button>
                  ))}
              </div>
            )}

            {b?.error && (
              <div className="banner">
                <span style={{ color: "var(--bad)" }}>{b.error}</span>
                <button className="btn-ghost x" onClick={() => refreshBrowse(titleId)}>
                  Try again
                </button>
              </div>
            )}
            {!posts && !b?.error && (
              <div className="empty-note" style={{ padding: 24 }}>
                <LoaderCircle size={15} className="spin" style={{ verticalAlign: -3 }} /> Finding groups…
              </div>
            )}
            {posts && posts.length === 0 && (
              <div className="empty-feed">
                <b>No open groups{activeTags.length || filters.minNeeds > 1 ? " match these filters" : " right now"}.</b>
                <span>Be the first. Posts show up for {t?.name ?? "this game"} players on Xbox, PC and the Xbox app.</span>
                <button className="btn-white" onClick={() => createFor(titleId)}>
                  <CirclePlus size={14} /> Create post
                </button>
              </div>
            )}
            {posts?.map((p) => (
              <PostCard key={p.handleId} p={p} active={p.handleId === selected} requested={!!applied[p.handleId]} host={people[p.hostXuid]} onClick={() => selectPost(titleId, p.handleId === selected ? null : p.handleId)} />
            ))}
            {posts && posts.length >= 100 && <div className="empty-note" style={{ textAlign: "center" }}>Showing the top 100. Use tags or filters to narrow it down.</div>}
          </div>
        </div>
        {selected ? <PostDetail key={selected} handleId={selected} fallback={selPost} onClose={() => selectPost(titleId, null)} /> : pulse && <Glance titleId={titleId} />}
      </div>
    </div>
  );
}

function PostCard({ p, active, requested, host, onClick }: { p: Post; active: boolean; requested: boolean; host?: import("../lib/api").Person; onClick: () => void }) {
  const name = host?.gamertag ?? "Xbox player";
  return (
    <button className={`post ${active ? "active" : ""}`} onClick={onClick}>
      <Avatar person={host} gamertag={name} size={40} />
      <span className="post-ring" style={{ "--pct": p.target ? Math.min(1, p.confirmed / p.target) : 0 } as React.CSSProperties}>
        <span>
          {p.confirmed}/{p.target}
        </span>
      </span>
      <div className="post-main">
        <div className="post-top">
          <b>{name}</b>
          <RepBadge rep={host?.rep} />
          {host?.isFriend && <span className="badge good">Friend</span>}
          <PlayerBadge xuid={p.hostXuid} />
          <span className="when">{p.scheduled ? <><Clock size={11} /> {when(p.scheduled)}</> : ago(p.posted)}</span>
        </div>
        <div className="post-desc">{p.description || <i style={{ color: "var(--faint)" }}>No description</i>}</div>
        <div className="post-foot">
          <span className="need">
            <Slots confirmed={p.confirmed} target={p.target} />
            {p.needs > 0 ? `Needs ${p.needs}` : "Full"}
          </span>
          {p.tags.slice(0, 4).map((t) => (
            <span key={t} className="chip sm">{tagLabel(t)}</span>
          ))}
          {p.tags.length > 4 && <span className="chip sm">+{p.tags.length - 4}</span>}
          {requested && <span className="badge good" style={{ marginLeft: "auto" }}>Requested</span>}
        </div>
      </div>
    </button>
  );
}
