import { ExternalLink, Headphones, LoaderCircle, MessageSquare, RefreshCw, Search, Send, Users } from "lucide-react";
import { Fragment, useEffect, useLayoutEffect, useRef, useState } from "react";
import { Avatar } from "../components/common";
import type { Conversation, ThreadRef } from "../lib/api";
import { ago, xboxProfileUrl } from "../lib/format";
import { api } from "../lib/api";
import { convRef, inviteToParty, loadInbox, loadOlder, loadThread, sendMessage } from "../lib/social";
import { set, threadKey, useApp } from "../lib/store";
import { openChat } from "../lib/social";

/** Xbox messages: conversation list on the left, the open chat on the right. */
export function Messages() {
  const { inbox, requests, inboxError, msgFolder, chat, people } = useApp();
  const [q, setQ] = useState("");
  const list = (msgFolder === "requests" ? requests : inbox) ?? [];
  const name = (c: Conversation) => (c.kind === "group" ? c.title || groupName(c, people) : people[c.otherXuid]?.gamertag ?? "Xbox player");
  const shown = list.filter((c) => !q || name(c).toLowerCase().includes(q.toLowerCase()));
  const openKey = chat ? threadKey(chat) : null;

  return (
    <div className="view">
      <div className="toolbar">
        <div className="tb-title">
          <b>Messages</b>
        </div>
        <button className="tool" onClick={() => loadInbox(false)}>
          <RefreshCw size={15} /> Refresh
        </button>
        <div className="grow" />
        <button className="tool" onClick={() => api.openUrl("https://www.xbox.com/en-US/play")} title="Images, voice messages and more live in the Xbox app">
          <ExternalLink size={14} /> Xbox app
        </button>
      </div>
      <div className="chat-split">
        <div className="conv-col">
          <div className="seg">
            <button className={msgFolder === "chats" ? "on" : ""} onClick={() => set({ msgFolder: "chats" })}>
              Chats
            </button>
            <button className={msgFolder === "requests" ? "on" : ""} onClick={() => set({ msgFolder: "requests" })}>
              Requests{requests.length ? ` · ${requests.length}` : ""}
            </button>
          </div>
          <label className="search" style={{ margin: "0 12px 8px" }}>
            <Search size={14} />
            <input placeholder="Search chats" value={q} onChange={(e) => setQ(e.target.value)} spellCheck={false} />
          </label>
          <div className="scroll conv-list">
            {inbox === null && (
              <div className="empty-note" style={{ padding: 16 }}>
                <LoaderCircle size={14} className="spin" style={{ verticalAlign: -2 }} /> Loading chats…
              </div>
            )}
            {inboxError && <div className="empty-note" style={{ padding: 16, color: "var(--bad)" }}>{inboxError}</div>}
            {inbox && !shown.length && (
              <div className="empty-note" style={{ padding: 16 }}>
                {msgFolder === "requests" ? "No message requests. Messages from people you don't follow land here." : q ? "No chats match." : "No chats yet."}
              </div>
            )}
            {shown.map((c) => {
              const r = convRef(c);
              const k = threadKey(r);
              return (
                <button key={c.id || k} className={`conv ${openKey === k ? "active" : ""} ${c.unread ? "unread" : ""}`} onClick={() => openChat(r)}>
                  {c.kind === "group" ? (
                    <span className="pfp group-pfp" style={{ width: 38, height: 38 }}>
                      <Users size={17} />
                    </span>
                  ) : (
                    <Avatar person={people[c.otherXuid]} size={38} />
                  )}
                  <div className="conv-main">
                    <div className="conv-top">
                      <b>{name(c)}</b>
                      <span className="when">{ago(c.lastTime)}</span>
                    </div>
                    <div className="conv-last">
                      {c.kind === "group" && c.lastSender && <span>{people[c.lastSender]?.gamertag ?? "Someone"}: </span>}
                      {c.lastText || <i>No messages</i>}
                    </div>
                  </div>
                  {c.unread && <span className="unread-dot" />}
                </button>
              );
            })}
          </div>
        </div>
        {chat ? (
          <ChatPane key={openKey!} r={chat} conv={[...(inbox ?? []), ...requests].find((c) => threadKey(convRef(c)) === openKey) ?? null} />
        ) : (
          <div className="empty">
            <MessageSquare size={56} strokeWidth={1.4} />
            <div>Pick a chat, or message someone from their LFG post or your friends list.</div>
          </div>
        )}
      </div>
    </div>
  );
}

function groupName(c: Conversation, people: Record<string, { gamertag: string }>) {
  const names = c.participants.slice(0, 3).map((x) => people[x]?.gamertag).filter(Boolean);
  return names.length ? names.join(", ") + (c.participants.length > 3 ? ` +${c.participants.length - 3}` : "") : `Group of ${c.participants.length}`;
}

function ChatPane({ r, conv }: { r: ThreadRef; conv: Conversation | null }) {
  const { threads, people, auth, party, busy } = useApp();
  const key = threadKey(r);
  const t = threads[key];
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const other = r.kind === "dm" ? people[r.xuid] : null;
  const title = r.kind === "group" ? conv?.title || (conv ? groupName(conv, people) : "Group chat") : other?.gamertag ?? "Xbox player";

  useEffect(() => {
    if (!t) loadThread(r);
    const id = setInterval(() => loadThread(r), 6000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const count = t?.messages.length ?? 0;
  useLayoutEffect(() => {
    const el = scroller.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [count, key]);

  async function send() {
    if (!text.trim() || sending) return;
    setSending(true);
    stick.current = true;
    const ok = await sendMessage(r, text);
    if (ok) setText("");
    setSending(false);
  }

  let lastDay = "";
  return (
    <div className="chat">
      <div className="chat-head">
        {r.kind === "group" ? (
          <span className="pfp group-pfp" style={{ width: 34, height: 34 }}>
            <Users size={16} />
          </span>
        ) : (
          <Avatar person={other} size={34} />
        )}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="detail-name" style={{ fontSize: 15 }}>{title}</div>
          <div className="sub">{r.kind === "group" ? `${conv?.participants.length ?? ""} people` : other?.presence}</div>
        </div>
        {r.kind === "dm" && party && (
          <button className="btn-ghost" disabled={busy[`invite:${r.xuid}`]} onClick={() => inviteToParty([r.xuid], other?.gamertag)}>
            <Headphones size={14} /> Invite to party
          </button>
        )}
        {r.kind === "dm" && other && (
          <button className="icon-btn" title="Xbox profile" onClick={() => api.openUrl(xboxProfileUrl(other.gamertag))}>
            <ExternalLink size={15} />
          </button>
        )}
      </div>
      <div
        className="scroll chat-body"
        ref={scroller}
        onScroll={(e) => {
          const el = e.currentTarget;
          stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 60;
          if (el.scrollTop < 40 && t?.more && !t.loading) loadOlder(r);
        }}
      >
        {t?.more && <div className="empty-note" style={{ textAlign: "center" }}>{t.loading ? "Loading older messages…" : "Scroll up for older messages"}</div>}
        {!t?.loaded && (
          <div className="empty-note" style={{ textAlign: "center", padding: 30 }}>
            <LoaderCircle size={14} className="spin" style={{ verticalAlign: -2 }} /> Loading…
          </div>
        )}
        {t?.loaded && !t.messages.length && !t.error && <div className="empty-note" style={{ textAlign: "center", padding: 30 }}>Say hi to {title}.</div>}
        {t?.error && <div className="empty-note" style={{ color: "var(--bad)", textAlign: "center" }}>{t.error}</div>}
        {t?.messages.map((m, i) => {
          const mine = m.sender === auth?.xuid;
          const prev = t.messages[i - 1];
          const day = new Date(m.time).toDateString();
          const showDay = day !== lastDay;
          lastDay = day;
          const grouped = prev && prev.sender === m.sender && !showDay && Date.parse(m.time) - Date.parse(prev.time) < 5 * 60_000;
          const who = people[m.sender];
          return (
            <Fragment key={m.id}>
              {showDay && <div className="day-sep">{dayLabel(m.time)}</div>}
              <div className={`msg-row ${mine ? "mine" : ""} ${grouped ? "grouped" : ""}`}>
                {!mine && r.kind === "group" && (grouped ? <span style={{ width: 28, flex: "none" }} /> : <Avatar person={who} size={28} />)}
                <div className="bubble-wrap">
                  {!mine && r.kind === "group" && !grouped && <div className="bubble-name">{who?.gamertag ?? "Xbox player"}</div>}
                  <div className={`bubble ${m.id.startsWith("local-") ? "pending" : ""} ${m.kind !== "text" ? "special" : ""}`} title={new Date(m.time).toLocaleString()}>
                    {m.text}
                  </div>
                </div>
              </div>
            </Fragment>
          );
        })}
      </div>
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
      >
        <textarea
          className="field"
          rows={1}
          placeholder={`Message ${title}`}
          value={text}
          maxLength={1000}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
        />
        <button className="btn-white" disabled={!text.trim() || sending} aria-label="Send">
          {sending ? <LoaderCircle size={15} className="spin" /> : <Send size={15} />}
        </button>
      </form>
    </div>
  );
}

function dayLabel(iso: string) {
  const d = new Date(iso);
  const today = new Date();
  if (d.toDateString() === today.toDateString()) return "Today";
  if (d.toDateString() === new Date(today.getTime() - 86400000).toDateString()) return "Yesterday";
  return d.toLocaleDateString([], { weekday: "long", month: "short", day: "numeric", year: d.getFullYear() === today.getFullYear() ? undefined : "numeric" });
}
