// Pulse layout: a game rail on the left, the feed in the middle and a side pane that's always open.
// It reuses every view from the classic layout; only the frame around them changes.
import { BellRing, Clapperboard, Compass, Contact, Download, Headphones, MessageCircle, Plus, Radio, Settings, Sparkles, Users, X } from "lucide-react";
import { useEffect, useRef } from "react";
import { createFor, openGame, openTab } from "../lib/actions";
import { openChat, convRef } from "../lib/social";
import { set, tabGame, useApp } from "../lib/store";
import { useUpdate } from "../lib/update";
import { Avatar, GameArt, Logo } from "./common";
import { SidePanel } from "./SidePanel";

const VIEWS = [
  ["home", Compass, "Home"],
  ["mine", Radio, "Host"],
  ["messages", MessageCircle, "Chats"],
  ["friends", Users, "Friends"],
  ["alerts", BellRing, "Alerts"],
  ["players", Contact, "Players"],
  ["clips", Clapperboard, "Clips"],
  ["create", Plus, "Post"],
] as const;

export function PulseRail() {
  const { active, auth, people, mine, inbox, party, games, settings, pickGames, alertNew } = useApp();
  const update = useUpdate();
  const me = auth ? people[auth.xuid] : null;
  const pending = (mine ?? []).filter((m) => m.tracked.role === "host").reduce((n, m) => n + (m.detail?.members.filter((x) => x.role === "applicant").length ?? 0), 0);
  const unread = (inbox ?? []).filter((c) => c.unread && !c.muted).length;
  const pinned = settings?.pinned ?? [];
  const list = [...(games ?? [])].sort((a, b) => Number(pinned.includes(b.titleId)) - Number(pinned.includes(a.titleId)));
  const current = tabGame(active);

  return (
    <aside className="pu-rail">
      <div className="pu-logo" title="Squadr">
        <Logo size={24} />
      </div>
      <div className="pu-views">
        {VIEWS.map(([v, Icon, label]) => (
          <button key={v} className={active === v ? "on" : ""} onClick={() => openTab(v)} title={label}>
            <Icon size={20} />
            <span>{label}</span>
            {v === "mine" && pending > 0 && <i className="pu-count">{pending}</i>}
            {v === "messages" && unread > 0 && <i className="pu-count">{unread > 99 ? "99+" : unread}</i>}
            {v === "alerts" && alertNew.length > 0 && <i className="pu-count">{alertNew.length > 99 ? "99+" : alertNew.length}</i>}
            {v === "friends" && party && <i className="pu-dot-badge" title="You're in a party" />}
          </button>
        ))}
      </div>
      <div className="pu-sep" />
      <div className="pu-games">
        {list.map((g) => (
          <button key={g.titleId} className={current === g.titleId ? "on" : ""} onClick={() => openGame(g)} title={g.name}>
            <GameArt title={g} size={44} radius={14} />
          </button>
        ))}
        <button className={`pu-add ${pickGames ? "on" : ""}`} title="Find a game (Ctrl+F)" onClick={() => set({ pickGames: !pickGames })}>
          <Plus size={20} />
        </button>
      </div>
      <div className="pu-rail-end">
        {update.available && (
          <button className="pu-update" title={`Update to ${update.available.version}`} onClick={() => openTab("settings")}>
            <Download size={18} />
          </button>
        )}
        <button className={active === "settings" ? "on" : ""} title="Settings" onClick={() => openTab("settings")}>
          <Settings size={19} />
        </button>
        <button title={auth?.gamertag} onClick={() => openTab("settings")}>
          <Avatar person={me} gamertag={auth?.gamertag} size={30} />
        </button>
      </div>
    </aside>
  );
}

/** The games list and store search, as a flyout next to the rail. */
export function GamesFlyout() {
  const { pickGames, active } = useApp();
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!pickGames) return;
    setTimeout(() => document.getElementById("game-search")?.focus(), 30);
    const down = (e: MouseEvent) => {
      const t = e.target as HTMLElement;
      if (!ref.current?.contains(t) && !t.closest(".pu-add")) set({ pickGames: false });
    };
    const key = (e: KeyboardEvent) => e.key === "Escape" && set({ pickGames: false });
    window.addEventListener("mousedown", down);
    window.addEventListener("keydown", key);
    return () => (window.removeEventListener("mousedown", down), window.removeEventListener("keydown", key));
  }, [pickGames]);
  // Picking a game closes the flyout.
  const last = useRef(active);
  useEffect(() => {
    if (active !== last.current && tabGame(active)) set({ pickGames: false });
    last.current = active;
  }, [active]);
  if (!pickGames) return null;
  return (
    <div className="pu-flyout" ref={ref}>
      <button className="icon-btn pu-flyout-x" onClick={() => set({ pickGames: false })} aria-label="Close">
        <X size={15} />
      </button>
      <SidePanel />
    </div>
  );
}

/** The side pane before you pick a post: what you're hosting, your party and unread chats. */
export function Glance({ titleId }: { titleId: string }) {
  const { party, inbox, people, mine, auth } = useApp();
  const hosting = (mine ?? []).find((m) => m.tracked.role === "host" && m.detail);
  const requests = hosting?.detail?.members.filter((m) => m.role === "applicant").length ?? 0;
  const unread = (inbox ?? []).filter((c) => c.unread && !c.muted).slice(0, 5);
  return (
    <div className="pu-glance">
      <div className="pu-label">Pick a group</div>
      <p>Click any post in the feed to see who's in it and ask to join.</p>

      {hosting && (
        <>
          <div className="pu-label">You're hosting</div>
          <button className="pu-live" onClick={() => openTab("mine")}>
            <span className="pu-live-dot" /> {hosting.detail?.post.titleName ?? "Your post"}
            <small>{requests ? `${requests} ${requests === 1 ? "request" : "requests"} waiting` : "No requests yet"}</small>
          </button>
        </>
      )}

      <div className="pu-label">Your party</div>
      {party ? (
        <div className="pu-mini">
          {party.members.map((m) => (
            <div key={m.xuid}>
              <Avatar person={people[m.xuid]} gamertag={m.gamertag} size={30} />
              <span className="pu-name">{m.xuid === auth?.xuid ? `${m.gamertag} (you)` : m.gamertag}</span>
              <Headphones size={13} />
            </div>
          ))}
        </div>
      ) : (
        <button className="pu-ghost-row" onClick={() => openTab("friends")}>
          <Headphones size={15} /> Not in a party. Invite friends
        </button>
      )}

      {unread.length > 0 && (
        <>
          <div className="pu-label">Unread</div>
          {unread.map((c) => (
            <button key={c.id} className="pu-unread" onClick={() => openChat(convRef(c))}>
              <Avatar person={people[c.otherXuid]} gamertag={c.title} size={30} />
              <span className="pu-name">
                <b>{c.kind === "group" ? c.title || "Group chat" : (people[c.otherXuid]?.gamertag ?? "Xbox player")}</b> {c.lastText}
              </span>
            </button>
          ))}
        </>
      )}

      <div className="pu-spacer" />
      <button className="pu-ghost-row" onClick={() => createFor(titleId)}>
        <Sparkles size={15} /> Can't find one? Host your own group
      </button>
    </div>
  );
}
