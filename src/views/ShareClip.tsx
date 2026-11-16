import { invoke } from "@tauri-apps/api/core";
import { Check, Copy, LoaderCircle, Search, Send, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Avatar } from "../components/common";
import { toast } from "../lib/actions";
import { errText, isTauri, on, type ThreadRef } from "../lib/api";
import type { ClipFile } from "../lib/clips";
import { mockCall } from "../lib/mock";
import { convRef, dmRef, loadFriends, sendMessage } from "../lib/social";
import { threadKey, useApp } from "../lib/store";

/** Links of clips already uploaded this session, so sharing again doesn't upload again. */
const links = new Map<string, string>();

const upload = (path: string, temporary: boolean) => (isTauri ? invoke<string>("clips_upload", { path, temporary }) : mockCall<string>("clips_upload", { path, temporary }));

type Target = { key: string; ref: ThreadRef; name: string; xuid: string; sub: string };

/** Upload a clip and send its link to a friend or chat. */
export function ShareClip({ clip, onClose }: { clip: ClipFile; onClose: () => void }) {
  const { inbox, friends, people } = useApp();
  const [temporary, setTemporary] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [link, setLink] = useState(links.get(clip.path) ?? "");
  const [q, setQ] = useState("");
  const [to, setTo] = useState<Target | null>(null);
  const [text, setText] = useState("Check out this clip");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (friends === null) loadFriends();
    return on<{ path: string; sent: number; total: number }>("clip-upload", (e) => e.path === clip.path && setProgress(e.total ? e.sent / e.total : 0));
  }, []);

  const targets = useMemo(() => {
    const out = new Map<string, Target>();
    for (const c of (inbox ?? []).slice(0, 8)) {
      const ref = convRef(c);
      const name = c.kind === "group" ? c.title || "Group chat" : people[c.otherXuid]?.gamertag ?? "Xbox player";
      out.set(threadKey(ref), { key: threadKey(ref), ref, name, xuid: c.kind === "dm" ? c.otherXuid : "", sub: c.kind === "group" ? "Group chat" : "Recent chat" });
    }
    for (const f of friends ?? []) {
      const ref = dmRef(f.person.xuid);
      if (!out.has(threadKey(ref))) out.set(threadKey(ref), { key: threadKey(ref), ref, name: f.person.gamertag, xuid: f.person.xuid, sub: f.state === "Online" ? "Online" : "Friend" });
    }
    const needle = q.trim().toLowerCase();
    return [...out.values()].filter((t) => !needle || t.name.toLowerCase().includes(needle)).slice(0, 40);
  }, [inbox, friends, people, q]);

  const getLink = async () => {
    if (link) return link;
    setProgress(0);
    try {
      const url = await upload(clip.path, temporary);
      links.set(clip.path, url);
      setLink(url);
      return url;
    } catch (e) {
      toast("error", "Couldn't upload the clip", errText(e));
      return "";
    } finally {
      setProgress(null);
    }
  };

  const copy = async () => {
    const url = await getLink();
    if (!url) return;
    await navigator.clipboard.writeText(url).catch(() => {});
    toast("good", "Link copied", url);
  };

  const send = async () => {
    if (!to) return;
    setSending(true);
    const url = await getLink();
    if (url && (await sendMessage(to.ref, `${text.trim()} ${url}`.trim()))) {
      toast("good", `Clip sent to ${to.name}`);
      onClose();
    }
    setSending(false);
  };

  const busy = progress != null || sending;
  return (
    <div className="clip-player" onMouseDown={(e) => e.target === e.currentTarget && !busy && onClose()}>
      <div className="share-box">
        <div className="clip-player-head">
          <b>Share {clip.name.replace(/\.mp4$/i, "")}</b>
          <button className="icon-btn" onClick={onClose} disabled={busy} aria-label="Close">
            <X size={16} />
          </button>
        </div>

        <div className="share-body">
          {!link && (
            <div className="seg" style={{ margin: 0 }}>
              <button className={!temporary ? "on" : ""} onClick={() => setTemporary(false)} disabled={busy}>
                Permanent link
              </button>
              <button className={temporary ? "on" : ""} onClick={() => setTemporary(true)} disabled={busy}>
                Expires in 3 days
              </button>
            </div>
          )}
          <p className="share-note">
            {link ? (
              <>
                Uploaded: <span className="mono">{link}</span>
              </>
            ) : (
              <>
                The clip is uploaded to {temporary ? "Litterbox" : "Catbox"} (catbox.moe), a free file host. Anyone with the link can watch it{temporary ? " for 3 days" : ""}.
              </>
            )}
          </p>

          <label className="search">
            <Search size={14} />
            <input placeholder="Send to a friend or chat" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
          </label>
          <div className="share-targets">
            {friends === null && !targets.length && (
              <div className="empty-note">
                <LoaderCircle size={13} className="spin" style={{ verticalAlign: -2 }} /> Loading friends…
              </div>
            )}
            {targets.map((t) => (
              <button key={t.key} className={`share-target ${to?.key === t.key ? "on" : ""}`} onClick={() => setTo(to?.key === t.key ? null : t)} disabled={busy}>
                <Avatar person={t.xuid ? people[t.xuid] : null} gamertag={t.name} size={26} />
                <span className="txt">{t.name}</span>
                <span className="muted">{t.sub}</span>
                {to?.key === t.key && <Check size={15} />}
              </button>
            ))}
          </div>
          {to && <input className="field" value={text} maxLength={200} onChange={(e) => setText(e.target.value)} placeholder="Add a message" />}
        </div>

        <div className="share-foot">
          {progress != null && (
            <div className="share-progress">
              <i style={{ width: `${Math.round(progress * 100)}%` }} />
            </div>
          )}
          <span className="grow muted">{progress != null ? `Uploading… ${Math.round(progress * 100)}%` : ""}</span>
          <button className="btn-ghost" onClick={copy} disabled={busy}>
            <Copy size={14} /> {link ? "Copy link" : "Upload & copy link"}
          </button>
          <button className="btn-white" onClick={send} disabled={!to || busy}>
            {sending ? <LoaderCircle size={14} className="spin" /> : <Send size={14} />} Send{to ? ` to ${to.name}` : ""}
          </button>
        </div>
      </div>
    </div>
  );
}
