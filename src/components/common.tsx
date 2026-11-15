import { Check, CirclePlus, Clapperboard, Gamepad2, Headphones, House, MessageSquare, Settings, Users, type LucideIcon } from "lucide-react";
import { useState } from "react";
import type { Person, Title } from "../lib/api";
import { findTitle } from "../lib/actions";
import { tabGame, type TabId } from "../lib/store";

export const VIEWS: Record<string, { label: string; icon: LucideIcon; kbd?: string }> = {
  home: { label: "Home", icon: House },
  mine: { label: "My LFG", icon: Users, kbd: "Ctrl+M" },
  create: { label: "New post", icon: CirclePlus, kbd: "Ctrl+N" },
  messages: { label: "Messages", icon: MessageSquare, kbd: "Ctrl+J" },
  friends: { label: "Friends & party", icon: Headphones, kbd: "Ctrl+P" },
  clips: { label: "Clips", icon: Clapperboard, kbd: "Ctrl+K" },
  settings: { label: "Settings", icon: Settings, kbd: "Ctrl+," },
};

export function tabInfo(id: TabId): { label: string; icon: LucideIcon } {
  const g = tabGame(id);
  if (g) return { label: findTitle(g)?.name ?? "Game", icon: Gamepad2 };
  return VIEWS[id] ?? { label: id, icon: House };
}

/** Chunky rounded "S" monogram. */
export function Logo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 100 100" fill="none" stroke="currentColor" strokeWidth={14} strokeLinecap="round" strokeLinejoin="round" aria-label="Squadr">
      <path d="M71 24 C64 15 31 14 31 33 C31 49 70 45 70 63 C70 82 37 83 28 72" />
    </svg>
  );
}

const initials = (s: string) => (s.trim()[0] ?? "?").toUpperCase();

export function Avatar({ person, gamertag, size = 34 }: { person?: Person | null; gamertag?: string; size?: number }) {
  const [broken, setBroken] = useState(false);
  const name = person?.gamertag ?? gamertag ?? "?";
  const src = person?.gamerpic ? `${person.gamerpic}${person.gamerpic.includes("?") ? "&" : "?"}w=${size * 2}&h=${size * 2}` : "";
  return (
    <span className="pfp" style={{ width: size, height: size, fontSize: size * 0.4 }}>
      {src && !broken ? <img src={src} alt="" onError={() => setBroken(true)} /> : initials(name)}
    </span>
  );
}

export function GameArt({ title, size = 28, radius = 7 }: { title: Title | null; size?: number; radius?: number }) {
  const [broken, setBroken] = useState(false);
  const src = title?.image ? `${title.image}${title.image.includes("?") ? "&" : "?"}w=${size * 2}&h=${size * 2}` : "";
  return (
    <span className="game-art" style={{ width: size, height: size, borderRadius: radius, fontSize: size * 0.42 }}>
      {src && !broken ? <img src={src} alt="" onError={() => setBroken(true)} /> : initials(title?.name ?? "?")}
    </span>
  );
}

export function Checkbox({ on, onClick }: { on: boolean; onClick?: () => void }) {
  if (!onClick) return <span className={`check ${on ? "on" : ""}`}>{on && <Check size={13} strokeWidth={3.2} />}</span>;
  return (
    <button className={`check ${on ? "on" : ""}`} onClick={onClick} role="checkbox" aria-checked={on}>
      {on && <Check size={13} strokeWidth={3.2} />}
    </button>
  );
}

export function Switch({ on, onClick, disabled }: { on: boolean; onClick?: () => void; disabled?: boolean }) {
  return <button className={`switch ${on ? "on" : ""}`} onClick={onClick} disabled={disabled} role="switch" aria-checked={on} />;
}

/** "Needs 2 more" pips: filled = confirmed, hollow = open slots. */
export function Slots({ confirmed, target }: { confirmed: number; target: number }) {
  const n = Math.min(Math.max(target, 1), 8);
  return (
    <span className="slots" title={`${confirmed} of ${target} confirmed`}>
      {Array.from({ length: n }, (_, i) => (
        <i key={i} className={i < confirmed ? "on" : ""} />
      ))}
      {target > 8 && <small>+{target - 8}</small>}
    </span>
  );
}

export function RepBadge({ rep }: { rep?: string }) {
  if (!rep || rep === "GoodPlayer") return null;
  return <span className="badge warn">{rep === "AvoidMe" ? "Avoid me" : "Needs work"}</span>;
}
