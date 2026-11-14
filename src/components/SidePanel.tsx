import { LoaderCircle, Pin, Plus, RefreshCw, Search, X } from "lucide-react";
import { useEffect, useState } from "react";
import { addGame, loadGames, openGame, removeGame, searchStore, togglePin } from "../lib/actions";
import type { Title } from "../lib/api";
import { set, tabGame, useApp } from "../lib/store";
import { GameArt } from "./common";

function fmtCount(n: number | undefined) {
  if (n == null) return "";
  return n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n);
}

/** Games list: your recently played games (with how many open posts each has), plus store search to add any game. */
export function SidePanel() {
  const { games, gamesError, counts, active, search, storeResults, storeSearching, settings } = useApp();
  const [menu, setMenu] = useState<string | null>(null);
  const current = tabGame(active);
  const q = search.trim().toLowerCase();
  const pinned = settings?.pinned ?? [];

  useEffect(() => {
    const t = setTimeout(() => searchStore(search), 450);
    return () => clearTimeout(t);
  }, [search]);
  useEffect(() => {
    const close = () => setMenu(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);

  const list = (games ?? []).filter((g) => !q || g.name.toLowerCase().includes(q));
  const sorted = [...list].sort((a, b) => Number(pinned.includes(b.titleId)) - Number(pinned.includes(a.titleId)));
  const fromStore = (storeResults ?? []).filter((t) => !(games ?? []).some((g) => g.titleId === t.titleId));

  const row = (g: Title, onClick: () => void, end?: React.ReactNode) => (
    <div key={g.titleId} className="game-row-wrap">
      <button
        className={`tree-row game-row ${current === g.titleId ? "active" : ""}`}
        onClick={onClick}
        onContextMenu={(e) => {
          e.preventDefault();
          setMenu(g.titleId);
        }}
        title={g.name}
      >
        <GameArt title={g} size={24} radius={6} />
        <span className="game-name">{g.name}</span>
        {end}
      </button>
      {menu === g.titleId && (
        <div className="menu-pop ctx" onMouseDown={(e) => e.stopPropagation()}>
          <button className="menu-item" onClick={() => (setMenu(null), togglePin(g.titleId))}>
            <Pin size={14} /> {pinned.includes(g.titleId) ? "Unpin" : "Pin to top"}
          </button>
          {!g.lastPlayed && (
            <button className="menu-item" onClick={() => (setMenu(null), removeGame(g.titleId))}>
              <X size={14} /> Remove from list
            </button>
          )}
        </div>
      )}
    </div>
  );

  return (
    <aside className="side">
      <div className="side-head">
        <h2>Games</h2>
        <button className="icon-btn" title="Reload games" onClick={() => loadGames()}>
          <RefreshCw size={14} />
        </button>
      </div>
      <label className="search">
        {storeSearching ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />}
        <input id="game-search" placeholder="Find a game" value={search} onChange={(e) => set({ search: e.target.value })} spellCheck={false} />
        {search && (
          <button onClick={() => set({ search: "", storeResults: null })} aria-label="Clear">
            <X size={14} />
          </button>
        )}
      </label>
      <div className="tree">
        {games === null && <div className="empty-note">Loading your games…</div>}
        {gamesError && <div className="empty-note" style={{ color: "var(--bad)" }}>{gamesError}</div>}
        {sorted.map((g) =>
          row(
            g,
            () => openGame(g),
            <span className="end">
              {pinned.includes(g.titleId) && <Pin size={11} style={{ marginRight: 5, verticalAlign: -1 }} />}
              {fmtCount(counts[g.titleId])}
            </span>,
          ),
        )}
        {games && !list.length && !q && <div className="empty-note">No Xbox games in your history yet. Search above to add one.</div>}
        {q.length >= 2 && (
          <>
            <div className="side-sub">From the Store</div>
            {fromStore.map((t) =>
              row(
                t,
                () => addGame(t),
                <span className="end">
                  <Plus size={13} />
                </span>,
              ),
            )}
            {!storeSearching && storeResults && !fromStore.length && <div className="empty-note">No other Xbox games match.</div>}
          </>
        )}
      </div>
    </aside>
  );
}
