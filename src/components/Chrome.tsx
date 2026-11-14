// Activity bar, tabs, status bar and toasts: the frame around every view.
import { CircleAlert, CircleCheck, Download, Gamepad2, Headphones, Info, Plus, Radio, Users, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { closeTab, openGame, openTab } from "../lib/actions";
import { tabGame, useApp } from "../lib/store";
import { useUpdate } from "../lib/update";
import { Avatar, GameArt, tabInfo, VIEWS } from "./common";

export function ActivityBar() {
  const { active, auth, people, mine, inbox, party } = useApp();
  const me = auth ? people[auth.xuid] : null;
  const pending = (mine ?? []).filter((m) => m.tracked.role === "host").reduce((n, m) => n + (m.detail?.members.filter((x) => x.role === "applicant").length ?? 0), 0);
  const unread = (inbox ?? []).filter((c) => c.unread && !c.muted).length;
  const top = ["home", "mine", "messages", "friends", "create"] as const;
  return (
    <nav className="activity">
      {top.map((v) => {
        const Icon = VIEWS[v].icon;
        return (
          <button key={v} className={`act-btn ${active === v ? "active" : ""}`} title={VIEWS[v].label} onClick={() => openTab(v)}>
            <Icon size={20} />
            {v === "mine" && pending > 0 && <span className="act-badge">{pending}</span>}
            {v === "messages" && unread > 0 && <span className="act-badge">{unread > 99 ? "99+" : unread}</span>}
            {v === "friends" && party && <span className="act-dot" title="You're in a party" />}
          </button>
        );
      })}
      <button className={`act-btn ${tabGame(active) ? "active" : ""}`} title="Games" onClick={() => document.getElementById("game-search")?.focus()}>
        <Gamepad2 size={20} />
      </button>
      <div className="act-spacer" />
      <button className={`act-btn ${active === "settings" ? "active" : ""}`} title="Settings" onClick={() => openTab("settings")}>
        {(() => {
          const I = VIEWS.settings.icon;
          return <I size={19} />;
        })()}
      </button>
      <button className="act-btn" title={auth?.gamertag} onClick={() => openTab("settings")}>
        <Avatar person={me} gamertag={auth?.gamertag} size={26} />
      </button>
    </nav>
  );
}

export function Tabs() {
  const { tabs, active, games } = useApp();
  const [adding, setAdding] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setAdding(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);
  const closedViews = (["home", "mine", "messages", "friends", "create", "settings"] as const).filter((v) => !tabs.includes(v));
  const closedGames = (games ?? []).filter((g) => !tabs.includes(`game:${g.titleId}`)).slice(0, 8);
  return (
    <div className="tabs">
      <div className="tab-strip">
        {tabs.map((id) => {
          const { label, icon: Icon } = tabInfo(id);
          return (
            <div key={id} className={`tab ${active === id ? "active" : ""}`} onMouseDown={(e) => e.button === 1 && closeTab(id)} onClick={() => openTab(id)} role="tab">
              <Icon size={14} style={{ flex: "none" }} />
              <span className="tab-label">{label}</span>
              <button
                className="x"
                aria-label={`Close ${label}`}
                onClick={(e) => {
                  e.stopPropagation();
                  closeTab(id);
                }}
              >
                <X size={13} />
              </button>
            </div>
          );
        })}
      </div>
      <div className="tab-add" ref={ref}>
        <button className="icon-btn" onClick={() => setAdding(!adding)} aria-label="Open a tab">
          <Plus size={17} />
        </button>
        {adding && (
          <div className="menu-pop" style={{ left: "auto", right: 4 }}>
            {closedViews.map((v) => {
              const Icon = VIEWS[v].icon;
              return (
                <button key={v} className="menu-item" onClick={() => (setAdding(false), openTab(v))}>
                  <Icon size={15} /> {VIEWS[v].label}
                </button>
              );
            })}
            {closedViews.length > 0 && closedGames.length > 0 && <div className="menu-sep" />}
            {closedGames.map((g) => (
              <button key={g.titleId} className="menu-item" onClick={() => (setAdding(false), openGame(g))}>
                <GameArt title={g} size={16} radius={4} /> <span className="txt">{g.name}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function StatusBar() {
  const { auth, rta, mine, party } = useApp();
  const hosting = (mine ?? []).filter((m) => m.tracked.role === "host" && m.detail).length;
  const applied = (mine ?? []).filter((m) => m.tracked.role === "applicant" && m.detail).length;
  const update = useUpdate();
  return (
    <footer className="statusbar">
      <span className="item-s" title={rta ? "Connected to Xbox Live real-time updates" : "Reconnecting to Xbox Live…"}>
        <span className="dot" style={{ background: rta ? "var(--good)" : "var(--warn)" }} />
        {rta ? "Live" : "Reconnecting…"}
      </span>
      <span className="item-s">{auth?.gamertag}</span>
      <span className="item-s" title="Posts you host">
        <Radio size={13} /> {hosting ? "Hosting 1 post" : "Not hosting"}
      </span>
      <span className="item-s" title="Posts you asked to join">
        <Users size={13} /> {applied} {applied === 1 ? "request" : "requests"}
      </span>
      <span className="grow" />
      {party && (
        <span className="item-s" title="Your current Xbox party">
          <Headphones size={13} /> In a party · {party.members.length}
        </span>
      )}
      {update.available && (
        <button className="item-s update-pill" onClick={() => openTab("settings")} title="A new version of Squadr is ready">
          <Download size={13} /> {update.installing ? `Updating${update.progress != null ? ` ${Math.round(update.progress * 100)}%` : "…"}` : `Update to ${update.available.version}`}
        </button>
      )}
      <span className="item-s">Xbox Live</span>
    </footer>
  );
}

export function Toasts() {
  const { toasts } = useApp();
  return (
    <div className="toasts">
      {toasts.map((t) => {
        const Icon = t.kind === "error" ? CircleAlert : t.kind === "good" ? CircleCheck : Info;
        return (
          <div key={t.id} className={`toast ${t.kind}`}>
            <Icon size={17} style={{ flex: "none", marginTop: 1, color: t.kind === "error" ? "var(--bad)" : t.kind === "good" ? "var(--good)" : "var(--muted)" }} />
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 700 }}>{t.title}</div>
              {t.body && <div style={{ color: "var(--muted)", marginTop: 3, whiteSpace: "pre-line", overflowWrap: "anywhere" }}>{t.body}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
