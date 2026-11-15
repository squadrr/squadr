import { useEffect } from "react";
import { ActivityBar, StatusBar, Tabs, Toasts } from "./components/Chrome";
import { Logo } from "./components/common";
import { SidePanel } from "./components/SidePanel";
import { GamesFlyout, PulseRail } from "./components/Pulse";
import { refreshCurrent, TitleBar } from "./components/TitleBar";
import { closeTab, createFor, enterApp, findTitle, onTap, openGame, openTab, refreshMine, toast } from "./lib/actions";
import { api, isTauri, on, type AuthStatus } from "./lib/api";
import { get, set, tabGame, useApp } from "./lib/store";
import { Browse } from "./views/Browse";
import { Create } from "./views/Create";
import { Home } from "./views/Home";
import { Mine } from "./views/Mine";
import { Messages } from "./views/Messages";
import { Friends } from "./views/Friends";
import { Clips } from "./views/Clips";
import { startClipEvents } from "./lib/clips";
import { dmRef, loadInbox, loadParty, openChat } from "./lib/social";
import { SettingsView } from "./views/Settings";
import { SignIn } from "./views/SignIn";
import { Welcome } from "./views/Welcome";
import { startUpdateChecks } from "./lib/update";

export default function App() {
  const { auth } = useApp();

  useEffect(() => {
    startUpdateChecks();
    api.authStatus().then((s) => (s.signedIn ? enterApp(s) : set({ auth: s })));
    const offAuth = on<{ ok: boolean; status?: AuthStatus; error?: string }>("auth", (r) => {
      if (r.ok && r.status) {
        enterApp(r.status);
        toast("good", `Signed in as ${r.status.gamertag}`);
      } else set((s) => ({ signIn: { ...s.signIn, code: null, busy: false, error: r.error ?? "Sign-in failed" } }));
    });
    const offRta = on<{ connected: boolean }>("rta", (r) => set({ rta: r.connected }));
    const offTap = on<string>("tap", onTap);
    const noMenu = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("input, textarea")) e.preventDefault();
    };
    window.addEventListener("contextmenu", noMenu);
    return () => {
      offAuth();
      offRta();
      offTap();
      window.removeEventListener("contextmenu", noMenu);
    };
  }, []);

  if (!auth) return <div className="app" style={{ background: "var(--bg)" }} />;
  if (!auth.signedIn) return <SignIn />;
  return <Shell />;
}

function Shell() {
  const { settings, active, toasts, mine, guide } = useApp();

  // Browser preview only: ?view=mine|create|settings|game opens a tab.
  useEffect(() => {
    if (isTauri) return;
    const v = new URLSearchParams(location.search).get("view");
    if (!v) return;
    const t = setTimeout(() => {
      if (v === "game" || v === "detail") {
        const g = get().games?.[0];
        if (g) {
          openGame(g);
          if (v === "detail") setTimeout(() => set((s) => ({ browse: { ...s.browse, [g.titleId]: { ...s.browse[g.titleId], selected: `${g.scid}-h1` } } })), 600);
        }
      } else if (v === "chat") openChat(dmRef("2535400000000001"));
      else openTab(v);
    }, 700);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => startClipEvents(), []);

  // New messages: check the inbox every 15s (Xbox's chat push isn't used), your party every minute.
  useEffect(() => {
    const a = setInterval(() => loadInbox(true), 15_000);
    const b = setInterval(loadParty, 60_000);
    return () => (clearInterval(a), clearInterval(b));
  }, []);

  // Backup for missed real-time taps: re-check your own posts every minute while you have any.
  const hasMine = (mine ?? []).some((m) => m.detail);
  useEffect(() => {
    if (!hasMine) return;
    const id = setInterval(() => refreshMine(true), 60_000);
    return () => clearInterval(id);
  }, [hasMine]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F5") {
        e.preventDefault();
        return refreshCurrent();
      }
      if (!e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      const map: Record<string, () => void> = {
        n: () => createFor(tabGame(get().active)),
        m: () => openTab("mine"),
        j: () => openTab("messages"),
        p: () => openTab("friends"),
        k: () => openTab("clips"),
        f: () => (get().settings?.layout === "pulse" ? set({ pickGames: true }) : document.getElementById("game-search")?.focus()),
        ",": () => openTab("settings"),
        r: refreshCurrent,
        w: () => {
          const a = get().active;
          if (a) closeTab(a);
        },
      };
      if (map[k]) {
        e.preventDefault();
        map[k]();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const pulse = settings?.layout === "pulse";
  const glass = !!settings?.glass;
  const seeThrough = !!settings?.backdrop && settings.backdrop !== "off";
  // The page itself must be transparent for the Windows backdrop to show through.
  useEffect(() => {
    document.documentElement.classList.toggle("see-through", seeThrough);
  }, [seeThrough]);
  const showSide = !pulse && (settings?.showSidePanel ?? true);
  const showStatus = settings?.showStatusBar ?? true;
  const game = tabGame(active);

  return (
    <div className={`app ${pulse ? "pulse" : ""} ${glass ? "glass" : ""} ${seeThrough ? "see-through" : ""}`} style={{ gridTemplateRows: showStatus ? "36px 1fr auto" : "36px 1fr" }}>
      <TitleBar />
      <div className="body" style={{ gridTemplateColumns: pulse ? "84px 1fr" : showSide ? "52px auto 1fr" : "52px 1fr" }}>
        {pulse ? <PulseRail /> : <ActivityBar />}
        {showSide && <SidePanel />}
        {pulse && <GamesFlyout />}
        <main className="main">
          {!pulse && <Tabs />}
          {active === "home" && <Home />}
          {active === "mine" && <Mine />}
          {active === "create" && <Create />}
          {active === "messages" && <Messages />}
          {active === "friends" && <Friends />}
          {active === "clips" && <Clips />}
          {active === "settings" && <SettingsView />}
          {game && (findTitle(game) ? <Browse key={game} titleId={game} /> : <div className="empty">Loading game…</div>)}
          {!active && (
            <div className="empty">
              <Logo size={90} />
              <div>{pulse ? "Pick a game on the rail, or press + to find one." : "Pick a game on the left to find a group."}</div>
            </div>
          )}
        </main>
      </div>
      {showStatus && <StatusBar />}
      {(settings && !settings.onboarded) || guide ? <Welcome onClose={() => set({ guide: false })} /> : null}
      {toasts.length > 0 && <Toasts />}
    </div>
  );
}
