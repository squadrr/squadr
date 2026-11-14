import { Check, Clock, ExternalLink, Headphones, LoaderCircle, LogOut, MessageSquare, Send, Trash2, UserMinus, Users, X } from "lucide-react";
import { inviteToParty, messagePerson } from "../lib/social";
import { useEffect, useState } from "react";
import { Avatar, RepBadge, Slots } from "../components/common";
import { applyTo, cancelPost, confirmMember, declineMember, loadDetail, withdraw } from "../lib/actions";
import { api, type Detail, type Member, type Post } from "../lib/api";
import { ago, tagLabel, when, xboxProfileUrl } from "../lib/format";
import { get, useApp } from "../lib/store";

/** The right-hand pane: one post, its people, and what you can do with it. */
export function PostDetail({ handleId, fallback, known, onClose }: { handleId: string; fallback?: Post; known?: Detail | null; onClose?: () => void }) {
  const { details, people, busy, applied, auth, party } = useApp();
  const st = details[handleId];
  const d = st?.detail ?? known ?? null;
  const post = d?.post ?? fallback;
  const [msg, setMsg] = useState("");

  useEffect(() => {
    if (!get().details[handleId]) loadDetail(handleId);
  }, [handleId]);

  if (!post) {
    return (
      <div className="detail">
        {st?.error ? <div className="empty-note" style={{ padding: 20 }}>{st.error}</div> : <div className="empty-note" style={{ padding: 20 }}>Loading…</div>}
      </div>
    );
  }

  const host = people[post.hostXuid];
  const hostName = host?.gamertag ?? d?.members.find((m) => m.role === "host")?.gamertag ?? (post.hostXuid === auth?.xuid ? auth.gamertag : "Host");
  const isHost = d?.myRole === "host" || post.hostXuid === auth?.xuid;
  const myRole = d?.myRole ?? (applied[post.handleId] ? "applicant" : null);
  const confirmed = d?.members.filter((m) => m.role === "confirmed") ?? [];
  const applicants = d?.members.filter((m) => m.role === "applicant") ?? [];
  const full = post.needs <= 0;

  return (
    <div className="detail">
      <div className="detail-head">
        <Avatar person={host} gamertag={hostName} size={46} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="detail-name">
            {hostName} <RepBadge rep={host?.rep} />
            {host?.isFriend && <span className="badge good">Friend</span>}
          </div>
          <div className="sub">{host?.presence || post.titleName}</div>
        </div>
        {onClose && (
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        )}
      </div>

      <div className="detail-body scroll">
        <p className="desc">{post.description || <i style={{ color: "var(--faint)" }}>No description</i>}</p>
        {post.tags.length > 0 && (
          <div className="chips" style={{ marginTop: 12 }}>
            {post.tags.map((t) => (
              <span key={t} className="chip">{tagLabel(t)}</span>
            ))}
          </div>
        )}

        <div className="facts">
          <div>
            <span>Looking for</span>
            <b>{post.target} {post.target === 1 ? "player" : "players"}</b>
          </div>
          <div>
            <span>Confirmed</span>
            <b>
              <Slots confirmed={post.confirmed} target={post.target} /> {post.confirmed}/{post.target}
            </b>
          </div>
          <div>
            <span>{post.scheduled ? "Starts" : "Posted"}</span>
            <b>{post.scheduled ? when(post.scheduled) : ago(post.posted)}</b>
          </div>
        </div>

        {d && (
          <>
            <Group title="Host" people={d.members.filter((m) => m.role === "host")} />
            <Group title={`Confirmed · ${confirmed.length}`} people={confirmed} empty="Nobody yet" post={post} canManage={isHost} kind="confirmed" />
            {isHost ? (
              <Group title={`Requests · ${applicants.length}`} people={applicants} empty="No requests yet. They'll show up here as soon as someone asks." post={post} canManage kind="applicant" />
            ) : (
              <div className="group-title" style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <Users size={12} /> {applicants.length} {applicants.length === 1 ? "person has" : "people have"} asked to join
              </div>
            )}
          </>
        )}
        {st?.loading && !d && (
          <div className="empty-note">
            <LoaderCircle size={14} className="spin" style={{ verticalAlign: -2 }} /> Loading members…
          </div>
        )}
        {st?.error && <div className="empty-note" style={{ color: "var(--bad)" }}>{st.error}</div>}
      </div>

      <div className="detail-foot">
        {isHost ? (
          <>
            {confirmed.length > 0 &&
              (party ? (
                <button className="btn-white" disabled={busy[`invite:${confirmed.map((m) => m.xuid).join(",")}`]} onClick={() => inviteToParty(confirmed.map((m) => m.xuid))}>
                  <Headphones size={14} /> Invite {confirmed.length === 1 ? confirmed[0].gamertag : `all ${confirmed.length}`} to your party
                </button>
              ) : (
                <div className="hint-line">
                  <Headphones size={14} /> Start a party on Xbox, the Xbox app or Game Bar, and you can invite everyone you accepted from here.
                </div>
              ))}
            <button className="btn-ghost btn-danger" disabled={busy[`cancel:${post.sessionName}`]} onClick={() => cancelPost(post)}>
              <Trash2 size={14} /> Cancel post
            </button>
          </>
        ) : myRole === "confirmed" ? (
          <>
            <div className="you-in">
              <Check size={15} /> You're in. Watch for {hostName}'s party invite.
            </div>
            <div className="row-btns">
              <button className="btn-ghost" onClick={() => messagePerson(post.hostXuid)}>
                <MessageSquare size={14} /> Message {hostName}
              </button>
              <button className="btn-ghost btn-danger" disabled={busy[`leave:${post.sessionName}`]} onClick={() => withdraw(post)}>
                <LogOut size={14} /> Leave
              </button>
            </div>
          </>
        ) : myRole === "applicant" ? (
          <>
            <div className="you-wait">
              <Clock size={15} /> Request sent. Waiting for {hostName} to pick players.
            </div>
            <button className="btn-ghost" disabled={busy[`leave:${post.sessionName}`]} onClick={() => withdraw(post)}>
              <UserMinus size={14} /> Withdraw request
            </button>
          </>
        ) : (
          <>
            <textarea className="field msg" placeholder={`Say something to ${hostName} (optional)`} maxLength={256} value={msg} onChange={(e) => setMsg(e.target.value)} rows={2} />
            <button
              className="btn-white"
              disabled={busy[`apply:${post.handleId}`] || full}
              onClick={async () => {
                if (await applyTo(post, msg)) setMsg("");
              }}
            >
              {busy[`apply:${post.handleId}`] ? <LoaderCircle size={15} className="spin" /> : <Send size={14} />} {full ? "This group is full" : "Ask to join"}
            </button>
          </>
        )}
        <button className="link refresh-link" onClick={() => loadDetail(post.handleId)}>
          {st?.loading ? "Refreshing…" : "Refresh"}
        </button>
      </div>
    </div>
  );
}

function Group({ title, people: list, empty, post, canManage, kind }: { title: string; people: Member[]; empty?: string; post?: Post; canManage?: boolean; kind?: "confirmed" | "applicant" }) {
  const { people, busy, auth, party } = useApp();
  return (
    <>
      <div className="group-title">{title}</div>
      {list.length === 0 && empty && <div className="empty-note">{empty}</div>}
      {list.length > 0 && (
        <div className="list">
          {list.map((m) => {
            const p = people[m.xuid];
            const key = post ? `member:${post.sessionName}:${m.index}` : "";
            return (
              <div className="item person" key={m.xuid}>
                <Avatar person={p} gamertag={m.gamertag} size={32} />
                <div className="main-col">
                  <div className="name">
                    {p?.gamertag ?? m.gamertag} <RepBadge rep={p?.rep} />
                  </div>
                  <div className="sub">{m.message ? `"${m.message}"` : p?.presence || (p?.gamerscore ? `${Number(p.gamerscore).toLocaleString()} G` : "")}</div>
                </div>
                {canManage && post && kind === "applicant" && (
                  <div className="row-btns">
                    <button className="mini-btn good" disabled={busy[key]} onClick={() => confirmMember(post, m.index, p?.gamertag ?? m.gamertag)} title="Accept">
                      <Check size={15} /> Accept
                    </button>
                    <button className="mini-btn" disabled={busy[key]} onClick={() => declineMember(post, m.index)} title="Decline">
                      <X size={15} />
                    </button>
                  </div>
                )}
                {canManage && post && kind === "confirmed" && (
                  <button className="mini-btn" disabled={busy[key]} onClick={() => declineMember(post, m.index)} title="Remove from group">
                    <UserMinus size={14} />
                  </button>
                )}
                {m.xuid !== auth?.xuid && (
                  <>
                    {party && kind !== "applicant" && !party.members.some((x) => x.xuid === m.xuid) && (
                      <button className="icon-btn" title="Invite to your party" disabled={busy[`invite:${m.xuid}`]} onClick={() => inviteToParty([m.xuid], p?.gamertag ?? m.gamertag)}>
                        <Headphones size={14} />
                      </button>
                    )}
                    <button className="icon-btn" title="Message" onClick={() => messagePerson(m.xuid)}>
                      <MessageSquare size={14} />
                    </button>
                    {!canManage && (
                      <button className="icon-btn" title="Xbox profile" onClick={() => api.openUrl(xboxProfileUrl(p?.gamertag ?? m.gamertag))}>
                        <ExternalLink size={14} />
                      </button>
                    )}
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </>
  );
}
