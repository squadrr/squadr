import { BellPlus, BellRing, ChevronRight, LoaderCircle, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { Avatar, GameArt, PlayerBadge, Slots, Switch } from "../components/common";
import { findTitle, openGame } from "../lib/actions";
import { addAlert, checkAlerts, openMatch, removeAlert, updateAlert } from "../lib/alerts";
import type { Alert, Title } from "../lib/api";
import { ago, LANGUAGES, SYSTEM_TAGS, tagLabel } from "../lib/format";
import { get, set, useApp } from "../lib/store";

const MAX_TAGS = 3;

/** LFG alerts: get told when a post you'd join goes up. */
export function Alerts() {
  const { settings, alertMatches, alertsChecked } = useApp();
  const [adding, setAdding] = useState(false);
  const [checking, setChecking] = useState(false);
  const alerts = settings?.alerts ?? [];

  // the badge counts new matches since you last looked
  useEffect(() => () => set({ alertNew: [] }), []);

  const refresh = async () => {
    setChecking(true);
    await checkAlerts();
    setChecking(false);
  };

  return (
    <div className="view">
      <div className="toolbar">
        <div className="tb-title">
          <b>Alerts</b>
          {alertsChecked > 0 && <span className="muted">checked {ago(new Date(alertsChecked).toISOString())}</span>}
        </div>
        <button className="tool" onClick={refresh} disabled={checking || !alerts.length}>
          <RefreshCw size={15} className={checking ? "spin" : undefined} /> Check now
        </button>
        <div className="grow" />
        <button className="btn-white" onClick={() => setAdding(!adding)}>
          {adding ? <X size={14} /> : <BellPlus size={14} />} {adding ? "Close" : "New alert"}
        </button>
      </div>
      <div className="scroll">
        <div className="content narrow">
          <div className="page-head">
            <div>
              <h1>LFG alerts</h1>
              <p>Squadr checks every 90 seconds, even from the tray, and pings you when a group you'd join goes up.</p>
            </div>
          </div>

          {(adding || !alerts.length) && <NewAlert onDone={() => setAdding(false)} />}

          {alerts.map((a) => (
            <AlertCard key={a.id} a={a} matches={alertMatches[a.id]} />
          ))}
        </div>
      </div>
    </div>
  );
}

function NewAlert({ onDone }: { onDone: () => void }) {
  const { games, settings, active } = useApp();
  const fromTab = active?.startsWith("game:") ? active.slice(5) : "";
  const [titleId, setTitleId] = useState(fromTab || games?.[0]?.titleId || "");
  const [keywords, setKeywords] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [minNeeds, setMinNeeds] = useState(1);
  const [language, setLanguage] = useState(settings?.language ?? "");
  const t = findTitle(titleId) ?? games?.find((g) => g.titleId === titleId) ?? null;
  const toggle = (tag: string) => setTags(tags.includes(tag) ? tags.filter((x) => x !== tag) : [...tags, tag].slice(-MAX_TAGS));

  const create = () => {
    if (!t) return;
    addAlert({ titleId: t.titleId, titleName: t.name, scid: t.scid, keywords: keywords.trim(), tags, minNeeds, language });
    onDone();
  };

  return (
    <div className="form-card alert-form">
      <div className="form-row">
        <div className="lbl">
          <b>Game</b>
          <span>Any game from your list. Search in the games panel to add more.</span>
        </div>
        <div className="game-pick">
          <GameArt title={t} size={30} />
          <select className="field" value={titleId} onChange={(e) => setTitleId(e.target.value)}>
            {!t && <option value="">Choose a game</option>}
            {(games ?? []).map((g) => (
              <option key={g.titleId} value={g.titleId}>
                {g.name}
              </option>
            ))}
          </select>
        </div>
      </div>
      <div className="form-row">
        <div className="lbl">
          <b>Words to look for</b>
          <span>Every word has to be in the post. Leave empty for any post.</span>
        </div>
        <input className="field" placeholder="e.g. ranked plat" value={keywords} maxLength={60} onChange={(e) => setKeywords(e.target.value)} spellCheck={false} />
      </div>
      <div className="form-row">
        <div className="lbl">
          <b>Group size</b>
          <span>Only groups with at least this many open spots.</span>
        </div>
        <select className="field" value={minNeeds} onChange={(e) => setMinNeeds(Number(e.target.value))}>
          {[1, 2, 3, 4].map((n) => (
            <option key={n} value={n}>
              {n === 1 ? "Any size" : `Needs ${n}+`}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row">
        <div className="lbl">
          <b>Language</b>
        </div>
        <select className="field" value={language} onChange={(e) => setLanguage(e.target.value)}>
          {LANGUAGES.map((l) => (
            <option key={l.code} value={l.code}>
              {l.name}
            </option>
          ))}
        </select>
      </div>
      <div className="form-row col">
        <div className="lbl">
          <b>Tags</b>
          <span>Up to {MAX_TAGS}. Posts need all of them.</span>
        </div>
        <div className="alert-tags">
          {SYSTEM_TAGS.map((g) => (
            <div key={g.group} className="chips">
              {g.tags.map((tag) => (
                <button key={tag} className={`chip ${tags.includes(tag) ? "on" : ""}`} onClick={() => toggle(tag)}>
                  {tagLabel(tag)}
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
      <div className="form-row" style={{ justifyContent: "flex-end" }}>
        <button className="btn-white" disabled={!t} onClick={create}>
          <BellRing size={14} /> Turn on alert
        </button>
      </div>
    </div>
  );
}

function AlertCard({ a, matches }: { a: Alert; matches: import("../lib/api").Post[] | undefined }) {
  const { people, alertNew } = useApp();
  const title: Title = findTitle(a.titleId) ?? { titleId: a.titleId, name: a.titleName, scid: a.scid, image: "", lastPlayed: null, devices: [] };
  const lang = LANGUAGES.find((l) => l.code === a.language)?.name;
  const bits = [a.keywords && `"${a.keywords}"`, a.minNeeds > 1 && `needs ${a.minNeeds}+`, ...a.tags.map(tagLabel), a.language && lang].filter(Boolean);
  const shown = (matches ?? []).slice(0, 5);
  return (
    <div className={`alert-card ${a.enabled ? "" : "off"}`}>
      <div className="alert-head">
        <GameArt title={title} size={34} />
        <div className="lbl">
          <b>{a.titleName}</b>
          <span>{bits.length ? bits.join(" · ") : "Any new post"}</span>
        </div>
        <Switch on={a.enabled} onClick={() => updateAlert(a.id, { enabled: !a.enabled })} />
        <button className="icon-btn" title="Delete alert" onClick={() => removeAlert(a.id)}>
          <Trash2 size={15} />
        </button>
      </div>
      {a.enabled && (
        <div className="alert-matches">
          {matches === undefined && (
            <div className="empty-note">
              <LoaderCircle size={13} className="spin" style={{ verticalAlign: -2 }} /> Checking…
            </div>
          )}
          {matches && !matches.length && <div className="empty-note">Nothing open right now. You'll get a ping when something shows up.</div>}
          {shown.map((p) => {
            const host = people[p.hostXuid];
            return (
              <button key={p.handleId} className="alert-match" onClick={() => openMatch(a, p)}>
                <Avatar person={host} gamertag={host?.gamertag} size={28} />
                <div className="main-col">
                  <div className="name">
                    {host?.gamertag ?? "Xbox player"} <PlayerBadge xuid={p.hostXuid} />
                    {alertNew.includes(p.handleId) && <span className="badge good">New</span>}
                    <span className="when">{ago(p.posted)}</span>
                  </div>
                  <div className="sub">{p.description || "No description"}</div>
                </div>
                <span className="need">
                  <Slots confirmed={p.confirmed} target={p.target} /> Needs {p.needs}
                </span>
                <ChevronRight size={15} className="muted" />
              </button>
            );
          })}
          {matches && matches.length > shown.length && (
            <button className="alert-more" onClick={() => openGame(title)}>
              <Plus size={13} /> {matches.length - shown.length} more in {a.titleName}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/** "Alert me" from a game's current filters (Browse toolbar). */
export function alertFromBrowse(titleId: string) {
  const s = get();
  const t = findTitle(titleId);
  if (!t) return;
  const f = s.browse[titleId]?.filters;
  addAlert({ titleId, titleName: t.name, scid: t.scid, keywords: "", tags: f?.tags ?? [], minNeeds: f?.minNeeds ?? 1, language: f?.language ?? s.settings?.language ?? "" });
}
