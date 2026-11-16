import { Bookmark, BookmarkPlus, Info, LoaderCircle, Minus, Plus, Radio, X } from "lucide-react";
import { useState } from "react";
import { GameArt, Switch } from "../components/common";
import { createPost, deleteTemplate, fillFromTemplate, findTitle, postTemplate, saveTemplate } from "../lib/actions";
import { LANGUAGES, SYSTEM_TAGS, tagLabel } from "../lib/format";
import { set, useApp, type Draft } from "../lib/store";

const MAX_TAGS = 10;

export function Create() {
  const { draft, games, busy, mine, settings } = useApp();
  const [custom, setCustom] = useState("");
  const [naming, setNaming] = useState<string | null>(null);
  const templates = settings?.templates ?? [];
  const suggestName = () => `${t?.name ?? ""} · ${draft.description.trim().split(/\s+/).slice(0, 3).join(" ")}`.slice(0, 40);
  const t = findTitle(draft.titleId);
  const patch = (p: Partial<Draft>) => set((s) => ({ draft: { ...s.draft, ...p } }));
  const hosting = (mine ?? []).find((m) => m.tracked.role === "host" && m.detail);
  const hasTag = (tag: string) => draft.tags.some((x) => x.toLowerCase() === tag.toLowerCase());
  const toggle = (tag: string) => patch({ tags: hasTag(tag) ? draft.tags.filter((x) => x.toLowerCase() !== tag.toLowerCase()) : [...draft.tags, tag].slice(0, MAX_TAGS) });
  const addCustom = () => {
    const tag = custom.replace(/[^\p{L}\p{N}]/gu, "").slice(0, 40);
    if (/^\p{L}/u.test(tag) && !hasTag(tag)) patch({ tags: [...draft.tags, tag].slice(0, MAX_TAGS) });
    setCustom("");
  };
  const customTags = draft.tags.filter((x) => !SYSTEM_TAGS.some((g) => g.tags.includes(x.toLowerCase())));

  return (
    <div className="view">
      <div className="toolbar">
        <div className="tb-title">
          <b>New post</b>
        </div>
        <div className="grow" />
        {naming === null ? (
          <button className="tool" disabled={!t || !draft.description.trim()} onClick={() => setNaming(suggestName())} title="Save this post to put it up again in one click">
            <BookmarkPlus size={15} /> Save as template
          </button>
        ) : (
          <form
            className="tpl-name"
            onSubmit={(e) => {
              e.preventDefault();
              saveTemplate(naming);
              setNaming(null);
            }}
          >
            <input autoFocus className="field" value={naming} maxLength={40} onChange={(e) => setNaming(e.target.value)} onKeyDown={(e) => e.key === "Escape" && setNaming(null)} placeholder="Template name" />
            <button className="mini-btn good">Save</button>
            <button type="button" className="icon-btn" onClick={() => setNaming(null)} aria-label="Cancel">
              <X size={14} />
            </button>
          </form>
        )}
        <button className="btn-white" disabled={busy.create || !t || !draft.description.trim()} onClick={createPost}>
          {busy.create ? <LoaderCircle size={14} className="spin" /> : <Radio size={14} />} Post
        </button>
      </div>
      <div className="scroll">
        <div className="content narrow">
          <div className="page-head">
            <div>
              <h1>Find people to play with</h1>
              <p>Your post shows up in LFG for everyone on Xbox, PC and the Xbox app.</p>
            </div>
          </div>

          {templates.length > 0 && (
            <>
              <div className="group-title">Templates</div>
              <div className="tpl-list">
                {templates.map((tpl) => (
                  <div key={tpl.id} className="tpl">
                    <button className="tpl-main" onClick={() => fillFromTemplate(tpl)} title={`Fill in: ${tpl.description}`}>
                      <Bookmark size={14} />
                      <span className="txt">
                        <b>{tpl.name}</b>
                        <small>
                          {tpl.titleName} · needs {tpl.need}
                        </small>
                      </span>
                    </button>
                    <button className="mini-btn good" disabled={busy.create} onClick={() => postTemplate(tpl)} title="Post it now">
                      <Radio size={13} /> Post
                    </button>
                    <button className="icon-btn" onClick={() => deleteTemplate(tpl.id)} title="Delete template">
                      <X size={14} />
                    </button>
                  </div>
                ))}
              </div>
            </>
          )}

          {hosting && (
            <div className="banner">
              <Info size={16} style={{ flex: "none", color: "var(--warn)" }} />
              <span style={{ color: "var(--text-2)" }}>You're already hosting a {hosting.tracked.titleName} post. Posting again replaces it.</span>
            </div>
          )}

          <div className="form-card">
            <div className="form-row">
              <div className="lbl">
                <b>Game</b>
                <span>Pick from your games, or search for one in the panel on the left.</span>
              </div>
              <div className="game-pick">
                <GameArt title={t} size={30} />
                <select className="field" value={draft.titleId} onChange={(e) => patch({ titleId: e.target.value })}>
                  {!t && <option value="">Choose a game</option>}
                  {(games ?? []).map((g) => (
                    <option key={g.titleId} value={g.titleId}>
                      {g.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <div className="form-row col">
              <div className="lbl">
                <b>What are you looking for?</b>
                <span>Mode, rank, region, vibe. Keep it friendly; Xbox filters inappropriate posts.</span>
              </div>
              <textarea
                className="field area"
                rows={3}
                maxLength={256}
                placeholder="e.g. Ranked duos tonight, plat+, mic on, chill vibes"
                value={draft.description}
                onChange={(e) => patch({ description: e.target.value })}
              />
              <div className="counter">{draft.description.length}/256</div>
            </div>
            <div className="form-row">
              <div className="lbl">
                <b>Players needed</b>
                <span>Not counting you.</span>
              </div>
              <div className="stepper">
                <button onClick={() => patch({ need: Math.max(1, draft.need - 1) })} disabled={draft.need <= 1} aria-label="Fewer">
                  <Minus size={15} />
                </button>
                <b>{draft.need}</b>
                <button onClick={() => patch({ need: Math.min(15, draft.need + 1) })} disabled={draft.need >= 15} aria-label="More">
                  <Plus size={15} />
                </button>
              </div>
            </div>
            <div className="form-row">
              <div className="lbl">
                <b>Repost automatically</b>
                <span>If your post ends before it fills, Squadr puts it back up. Stops when it fills or you cancel it.</span>
              </div>
              <Switch on={draft.repost} onClick={() => patch({ repost: !draft.repost })} />
            </div>
            <div className="form-row">
              <div className="lbl">
                <b>Language</b>
                <span>Players can filter posts by language.</span>
              </div>
              <select className="field" value={draft.language} onChange={(e) => patch({ language: e.target.value })}>
                {LANGUAGES.filter((l) => l.code).map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="group-title">
            Tags <span className="muted" style={{ textTransform: "none", letterSpacing: 0, fontWeight: 500 }}>· {draft.tags.length}/{MAX_TAGS}</span>
          </div>
          <div className="form-card tags-card">
            {SYSTEM_TAGS.map((g) => (
              <div key={g.group} className="tag-group">
                <span className="tag-group-name">{g.group}</span>
                <div className="chips">
                  {g.tags.map((tag) => (
                    <button key={tag} className={`chip ${hasTag(tag) ? "on" : ""}`} onClick={() => toggle(tag)}>
                      {tagLabel(tag)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
            <div className="tag-group">
              <span className="tag-group-name">Your own</span>
              <div className="chips">
                {customTags.map((tag) => (
                  <button key={tag} className="chip on" onClick={() => toggle(tag)}>
                    {tag} <X size={12} />
                  </button>
                ))}
                <form
                  className="tag-input"
                  onSubmit={(e) => {
                    e.preventDefault();
                    addCustom();
                  }}
                >
                  <input placeholder="Add a tag, e.g. ZeroBuild" value={custom} maxLength={40} onChange={(e) => setCustom(e.target.value)} spellCheck={false} />
                  <button disabled={!custom.trim()} aria-label="Add tag">
                    <Plus size={14} />
                  </button>
                </form>
              </div>
            </div>
          </div>

          <div className="info-box">
            <b>Good to know</b>
            <p>Your post stays up while Squadr is open. Xbox drops it a few minutes after you close the app. People who ask to join show up in My LFG, where you pick who's in. Then invite them to a party from your Xbox or the Xbox app.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
