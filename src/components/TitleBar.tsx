import { getCurrentWindow } from "@tauri-apps/api/window";
import { CirclePlus, Minus, PanelBottom, PanelLeft, Square, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createFor, loadGames, openTab, refreshBrowse, refreshMine, saveSettings, signOut } from "../lib/actions";
import { api, isTauri } from "../lib/api";
import { get, tabGame, useApp } from "../lib/store";
import { Logo } from "./common";

type MenuItem = { label: string; kbd?: string; run: () => void } | "sep";

const win = () => (isTauri ? getCurrentWindow() : null);

export function WindowButtons() {
  return (
    <div className="win-btns">
      <button className="win-btn" aria-label="Minimize" onClick={() => win()?.minimize()}>
        <Minus size={16} />
      </button>
      <button className="win-btn" aria-label="Maximize" onClick={() => win()?.toggleMaximize()}>
        <Square size={12} />
      </button>
      <button className="win-btn close" aria-label="Close" onClick={() => win()?.close()}>
        <X size={17} />
      </button>
    </div>
  );
}

export function refreshCurrent() {
  const s = get();
  const g = tabGame(s.active);
  if (g) refreshBrowse(g);
  else if (s.active === "mine") refreshMine(false);
  else loadGames();
}

export function TitleBar({ minimal }: { minimal?: boolean }) {
  const { settings, active } = useApp();
  const [open, setOpen] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(null);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, []);

  const menus: Record<string, MenuItem[]> = {
    File: [
      { label: "New post", kbd: "Ctrl+N", run: () => createFor(tabGame(active)) },
      { label: "Refresh", kbd: "F5", run: refreshCurrent },
      "sep",
      { label: "Sign out", run: signOut },
      { label: "Exit", run: () => win()?.close() },
    ],
    View: [
      { label: "Home", run: () => openTab("home") },
      { label: "My LFG", kbd: "Ctrl+M", run: () => openTab("mine") },
      { label: "Settings", kbd: "Ctrl+,", run: () => openTab("settings") },
      "sep",
      { label: settings?.showSidePanel ? "Hide games panel" : "Show games panel", run: () => saveSettings({ showSidePanel: !settings?.showSidePanel }) },
      { label: settings?.showStatusBar ? "Hide status bar" : "Show status bar", run: () => saveSettings({ showStatusBar: !settings?.showStatusBar }) },
    ],
    Help: [
      { label: "How Squadr works", run: () => openTab("settings") },
      { label: "Xbox community standards", run: () => api.openUrl("https://www.xbox.com/en-US/legal/community-standards") },
    ],
  };

  return (
    <div className="titlebar" ref={ref}>
      <div className="logo-btn" data-tauri-drag-region>
        <Logo size={20} />
      </div>
      {!minimal && (
        <div className="menus">
          {Object.entries(menus).map(([name, items]) => (
            <div className="menu-root" key={name}>
              <button className={`menu-btn ${open === name ? "open" : ""}`} onClick={() => setOpen(open === name ? null : name)} onMouseEnter={() => open && setOpen(name)}>
                {name}
              </button>
              {open === name && (
                <div className="menu-pop">
                  {items.map((it, i) =>
                    it === "sep" ? (
                      <div className="menu-sep" key={i} />
                    ) : (
                      <button
                        key={it.label}
                        className="menu-item"
                        onClick={() => {
                          setOpen(null);
                          it.run();
                        }}
                      >
                        {it.label}
                        {it.kbd && <span className="kbd">{it.kbd}</span>}
                      </button>
                    ),
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      <div className="drag" data-tauri-drag-region />
      {!minimal && settings && (
        <div className="tb-icons">
          <button className="icon-btn" title="New post (Ctrl+N)" onClick={() => createFor(tabGame(active))}>
            <CirclePlus size={16} />
          </button>
          <button className={`icon-btn ${settings.showSidePanel ? "on" : ""}`} title="Toggle games panel" onClick={() => saveSettings({ showSidePanel: !settings.showSidePanel })}>
            <PanelLeft size={16} />
          </button>
          <button className={`icon-btn ${settings.showStatusBar ? "on" : ""}`} title="Toggle status bar" onClick={() => saveSettings({ showStatusBar: !settings.showStatusBar })}>
            <PanelBottom size={16} />
          </button>
        </div>
      )}
      <WindowButtons />
    </div>
  );
}
