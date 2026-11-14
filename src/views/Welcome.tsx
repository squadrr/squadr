import { ArrowLeft, ArrowRight, Check, LoaderCircle, MessageSquare, Search, Users, Zap } from "lucide-react";
import { useEffect, useState } from "react";
import { GameArt, Logo } from "../components/common";
import { loadCounts, openGame, remember, saveSettings } from "../lib/actions";
import { api, type Links, type Title } from "../lib/api";
import { get, set, useApp } from "../lib/store";

const FALLBACK_LINKS: Links = {
  discord: "",
  youtube: "https://www.youtube.com/@squadr_official",
  tiktok: "https://www.tiktok.com/@squadr_offical",
  github: "https://github.com/zinn-games/squadr",
};
let linksCache: Links | null = null;
export function useLinks() {
  const [links, setLinks] = useState<Links>(linksCache ?? FALLBACK_LINKS);
  useEffect(() => {
    if (linksCache) return;
    api
      .links()
      .then((l) => setLinks((linksCache = { ...FALLBACK_LINKS, ...l })))
      .catch(() => {});
  }, []);
  return links;
}

/** First-run start guide: welcome, pick your games, then the Discord / YouTube / TikTok. */
export function Welcome({ onClose }: { onClose?: () => void }) {
  const { auth, games, settings } = useApp();
  const [step, setStep] = useState(0);
  const [picked, setPicked] = useState<string[]>(settings?.pinned ?? []);
  const [q, setQ] = useState("");
  const [found, setFound] = useState<Title[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [added, setAdded] = useState<Title[]>([]);
  const links = useLinks();

  useEffect(() => {
    if (q.trim().length < 2) return setFound(null);
    let live = true;
    setSearching(true);
    const t = setTimeout(() => {
      api
        .searchGames(q.trim())
        .then((r) => live && (remember(r), setFound(r)))
        .catch(() => live && setFound([]))
        .finally(() => live && setSearching(false));
    }, 400);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  const mine = [...(games ?? []), ...added.filter((a) => !(games ?? []).some((g) => g.titleId === a.titleId))];
  const shown = q.trim().length >= 2 ? (found ?? []) : mine.slice(0, 18);
  const toggle = (t: Title) => {
    if (!mine.some((g) => g.titleId === t.titleId)) setAdded((a) => [...a, t]);
    setPicked((p) => (p.includes(t.titleId) ? p.filter((x) => x !== t.titleId) : [...p, t.titleId]));
  };

  async function finish() {
    const s = get();
    const extra = added.filter((a) => picked.includes(a.titleId) && !(s.games ?? []).some((g) => g.titleId === a.titleId));
    await saveSettings({
      onboarded: true,
      pinned: picked,
      extraTitles: [...new Set([...(s.settings?.extraTitles ?? []), ...extra.map((t) => t.titleId)])],
    });
    if (extra.length) {
      const games = [...(get().games ?? []), ...extra];
      set({ games });
      loadCounts(games);
    }
    const first = mine.find((g) => g.titleId === picked[0]);
    onClose?.();
    if (first) openGame(first);
  }

  const socials = [
    { key: "discord", name: "Discord", blurb: "Find squads, get help, and hear about updates first.", url: links.discord, color: "#5865F2", icon: <DiscordIcon /> },
    { key: "youtube", name: "YouTube", blurb: "Tutorials, tips and what's new in Squadr.", url: links.youtube, color: "#FF0033", icon: <YouTubeIcon /> },
    { key: "tiktok", name: "TikTok", blurb: "Quick clips and features in under a minute.", url: links.tiktok, color: "#25F4EE", icon: <TikTokIcon /> },
  ];

  return (
    <div className="welcome-scrim">
      <div className="welcome-card" role="dialog" aria-label="Start guide">
        <div className="welcome-dots">
          {[0, 1, 2].map((i) => (
            <span key={i} className={i === step ? "on" : i < step ? "done" : ""} />
          ))}
        </div>

        {step === 0 && (
          <div className="welcome-step">
            <Logo size={64} />
            <h1>Welcome to Squadr{auth?.gamertag ? `, ${auth.gamertag}` : ""}</h1>
            <p className="lead">Real Xbox Looking for Group, right on your PC. You see the same posts console players see, and yours show up for them too.</p>
            <div className="welcome-feats">
              <div>
                <Search size={18} />
                <b>Browse</b>
                <span>Open groups for your games, live</span>
              </div>
              <div>
                <Zap size={18} />
                <b>Post &amp; pick</b>
                <span>Post a group, then accept who you want</span>
              </div>
              <div>
                <MessageSquare size={18} />
                <b>Chat</b>
                <span>Message players and your friends</span>
              </div>
              <div>
                <Users size={18} />
                <b>Party up</b>
                <span>Invite people to your Xbox party</span>
              </div>
            </div>
          </div>
        )}

        {step === 1 && (
          <div className="welcome-step left">
            <h1>Which games do you play?</h1>
            <p className="lead">Pick your favorites and they'll be pinned to the top. Squadr shows the Xbox version of each game, because that's where console players post.</p>
            <label className="search welcome-search">
              {searching ? <LoaderCircle size={15} className="spin" /> : <Search size={15} />}
              <input placeholder="Find another game" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} autoFocus />
            </label>
            <div className="welcome-games">
              {games === null && !q && <div className="empty-note">Loading your games…</div>}
              {shown.map((t) => (
                <button key={t.titleId} className={`welcome-game ${picked.includes(t.titleId) ? "on" : ""}`} onClick={() => toggle(t)} title={t.name}>
                  <GameArt title={t} size={44} radius={9} />
                  <span>{t.name}</span>
                  {picked.includes(t.titleId) && (
                    <i>
                      <Check size={12} strokeWidth={3} />
                    </i>
                  )}
                </button>
              ))}
              {found && !found.length && !searching && <div className="empty-note">No Xbox games match "{q}".</div>}
              {games && !games.length && !q && <div className="empty-note">No Xbox games in your history yet. Search above to add one.</div>}
            </div>
            <div className="welcome-count">{picked.length ? `${picked.length} picked` : "You can change these any time with right-click → Pin."}</div>
          </div>
        )}

        {step === 2 && (
          <div className="welcome-step left">
            <h1>Join the community</h1>
            <p className="lead">Follow Squadr for updates, tips and people to play with.</p>
            <div className="welcome-socials">
              {socials.map((s) => (
                <button key={s.key} className="social" disabled={!s.url} onClick={() => s.url && api.openUrl(s.url)} style={{ ["--brand" as string]: s.color }}>
                  <span className="social-icon">{s.icon}</span>
                  <span className="social-text">
                    <b>{s.name}</b>
                    <span>{s.url ? s.blurb : "Coming soon"}</span>
                  </span>
                  {s.url && <ArrowRight size={16} className="social-go" />}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="welcome-nav">
          {step > 0 ? (
            <button className="btn-ghost" onClick={() => setStep(step - 1)}>
              <ArrowLeft size={14} /> Back
            </button>
          ) : (
            <button className="btn-ghost" onClick={finish}>
              Skip
            </button>
          )}
          {step < 2 ? (
            <button className="btn-white" onClick={() => setStep(step + 1)}>
              {step === 0 ? "Get started" : "Next"} <ArrowRight size={14} />
            </button>
          ) : (
            <button className="btn-white" onClick={finish}>
              Let's go <ArrowRight size={14} />
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
      <path d="M20.3 4.4A19.8 19.8 0 0 0 15.4 3l-.6 1.3a18.4 18.4 0 0 0-5.5 0L8.6 3a19.7 19.7 0 0 0-4.9 1.5C.6 9.1-.3 13.6.1 18.1a19.9 19.9 0 0 0 6 3l1.3-2.1a12.9 12.9 0 0 1-2-1l.5-.4a14.2 14.2 0 0 0 12.2 0l.5.4c-.6.4-1.3.7-2 1l1.3 2.1a19.8 19.8 0 0 0 6-3c.5-5.2-.9-9.7-3.6-13.7ZM8 15.4c-1.2 0-2.2-1.1-2.2-2.4S6.8 10.6 8 10.6s2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Zm8 0c-1.2 0-2.2-1.1-2.2-2.4s1-2.4 2.2-2.4 2.2 1.1 2.2 2.4-1 2.4-2.2 2.4Z" />
    </svg>
  );
}
export function YouTubeIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
      <path d="M23.5 6.2a3 3 0 0 0-2.1-2.1C19.5 3.6 12 3.6 12 3.6s-7.5 0-9.4.5A3 3 0 0 0 .5 6.2 31.3 31.3 0 0 0 0 12a31.3 31.3 0 0 0 .5 5.8 3 3 0 0 0 2.1 2.1c1.9.5 9.4.5 9.4.5s7.5 0 9.4-.5a3 3 0 0 0 2.1-2.1A31.3 31.3 0 0 0 24 12a31.3 31.3 0 0 0-.5-5.8ZM9.6 15.6V8.4l6.3 3.6-6.3 3.6Z" />
    </svg>
  );
}
export function TikTokIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden>
      <path d="M16.6 2h-3.4v13.4a2.9 2.9 0 1 1-2.9-2.9c.3 0 .6 0 .9.1V9.1a6.4 6.4 0 1 0 5.4 6.3V8.6a8.2 8.2 0 0 0 4.8 1.5V6.7a4.8 4.8 0 0 1-4.8-4.7Z" />
    </svg>
  );
}
