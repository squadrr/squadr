// Messages, friends and party actions.
import { chime, mergePeople, openTab, toast } from "./actions";
import { errText, social, type Conversation, type Message, type ThreadRef } from "./api";
import { get, set, threadKey, type ThreadState } from "./store";

export const dmRef = (xuid: string): ThreadRef => ({ kind: "dm", xuid, groupId: "", channelId: "" });
export const convRef = (c: Conversation): ThreadRef =>
  c.kind === "group" ? { kind: "group", xuid: "", groupId: c.groupId, channelId: c.channelId } : dmRef(c.otherXuid);

export const unreadCount = () => (get().inbox ?? []).filter((c) => c.unread && !c.muted).length;

// ---------------------------------------------------------------- inbox

let lastSeen = new Map<string, string>();
let inboxSeq = 0;

export async function loadInbox(notify = true) {
  const seq = ++inboxSeq;
  try {
    const { conversations, requests, people } = await social.inbox();
    if (seq !== inboxSeq) return;
    mergePeople(people);
    const s = get();
    const me = s.auth?.xuid;
    const openKey = s.chat && s.active === "messages" ? threadKey(s.chat) : null;
    if (notify && lastSeen.size) {
      for (const c of [...conversations, ...requests]) {
        const prev = lastSeen.get(c.id);
        if (prev === c.lastMessageId || !c.lastMessageId || c.lastSender === me || c.muted) continue;
        const key = threadKey(convRef(c));
        if (key === openKey) continue; // you're looking at it; the thread refresh shows it
        const who = s.people[c.lastSender]?.gamertag ?? people.find((p) => p.xuid === c.lastSender)?.gamertag ?? "New message";
        toast("info", c.kind === "group" ? `${who} in ${c.title || "a group"}` : who, c.lastText.slice(0, 140));
        chime();
      }
    }
    lastSeen = new Map([...conversations, ...requests].map((c) => [c.id, c.lastMessageId]));
    set({ inbox: conversations, requests, inboxError: null });
    // keep the open thread fresh when its preview changed
    if (openKey) {
      const c = [...conversations, ...requests].find((x) => threadKey(convRef(x)) === openKey);
      const t = get().threads[openKey];
      if (c && t && t.messages[t.messages.length - 1]?.id !== c.lastMessageId) loadThread(get().chat!);
    }
  } catch (e) {
    if (seq === inboxSeq) set({ inboxError: errText(e), inbox: get().inbox ?? [] });
  }
}

// ---------------------------------------------------------------- threads

function patchThread(key: string, patch: Partial<ThreadState>) {
  set((s) => {
    const cur: ThreadState = s.threads[key] ?? { messages: [], loading: false, error: null, more: null, conversationId: "", loaded: false };
    return { threads: { ...s.threads, [key]: { ...cur, ...patch } } };
  });
}

export function openChat(r: ThreadRef) {
  set({ chat: r });
  openTab("messages");
  loadThread(r);
}

export function messagePerson(xuid: string) {
  if (!xuid) return;
  set({ msgFolder: "chats" });
  openChat(dmRef(xuid));
}

export async function loadThread(r: ThreadRef) {
  const key = threadKey(r);
  patchThread(key, { loading: true, error: null });
  try {
    const { thread, people } = await social.thread(r);
    mergePeople(people);
    const cur = get().threads[key];
    // keep older pages already loaded
    const older = (cur?.messages ?? []).filter((m) => thread.messages.length && m.time < thread.messages[0].time && !m.id.startsWith("local-"));
    // Xbox can take a moment to show a message you just sent; keep it (greyed) until it arrives.
    const me = get().auth?.xuid;
    const pending = (cur?.messages ?? []).filter(
      (m) => m.id.startsWith("local-") && Date.now() - Date.parse(m.time) < 60_000 && !thread.messages.some((x) => x.sender === me && x.text.trim() === m.text.trim() && Date.parse(x.time) >= Date.parse(m.time) - 30_000),
    );
    patchThread(key, { messages: [...older, ...thread.messages, ...pending], loading: false, more: older.length ? cur.more : thread.more, conversationId: thread.conversationId, loaded: true });
    markRead(r, thread.conversationId, thread.messages[thread.messages.length - 1]);
  } catch (e) {
    patchThread(key, { loading: false, error: errText(e), loaded: true });
  }
}

export async function loadOlder(r: ThreadRef) {
  const key = threadKey(r);
  const t = get().threads[key];
  if (!t?.more || t.loading) return;
  patchThread(key, { loading: true });
  try {
    const { thread, people } = await social.thread(r, t.more);
    mergePeople(people);
    const ids = new Set(t.messages.map((m) => m.id));
    patchThread(key, { messages: [...thread.messages.filter((m) => !ids.has(m.id)), ...t.messages], more: thread.more, loading: false });
  } catch (e) {
    patchThread(key, { loading: false, error: errText(e) });
  }
}

function markRead(r: ThreadRef, conversationId: string, last: Message | undefined) {
  if (r.kind !== "dm" || !conversationId || !last) return;
  const c = get().inbox?.find((x) => x.id === conversationId) ?? get().requests.find((x) => x.id === conversationId);
  if (!c?.unread) return;
  social.read(conversationId, last.id).catch(() => {});
  set((s) => ({
    inbox: s.inbox?.map((x) => (x.id === conversationId ? { ...x, unread: false } : x)) ?? null,
    requests: s.requests.map((x) => (x.id === conversationId ? { ...x, unread: false } : x)),
  }));
}

export async function sendMessage(r: ThreadRef, text: string) {
  const body = text.trim();
  if (!body) return false;
  const key = threadKey(r);
  const local: Message = { id: `local-${Date.now()}`, sender: get().auth?.xuid ?? "", text: body, time: new Date().toISOString(), kind: "text", deleted: false };
  patchThread(key, { messages: [...(get().threads[key]?.messages ?? []), local] });
  try {
    await social.send(r, body);
    await loadThread(r);
    loadInbox(false);
    return true;
  } catch (e) {
    patchThread(key, { messages: (get().threads[key]?.messages ?? []).filter((m) => m.id !== local.id) });
    toast("error", "Message not sent", errText(e));
    return false;
  }
}

// ---------------------------------------------------------------- friends + party

export async function loadFriends() {
  try {
    const friends = await social.friends();
    mergePeople(friends.map((f) => f.person));
    set({ friends, friendsError: null });
  } catch (e) {
    set({ friendsError: errText(e), friends: get().friends ?? [] });
  }
}

export async function loadParty() {
  try {
    set({ party: await social.party(), partyChecked: true });
  } catch {
    set({ partyChecked: true });
  }
}

export async function inviteToParty(xuids: string[], label?: string) {
  const key = `invite:${xuids.join(",")}`;
  if (get().busy[key]) return;
  set((s) => ({ busy: { ...s.busy, [key]: true } }));
  try {
    const n = await social.invite(xuids);
    toast("good", n === 1 ? `Party invite sent${label ? ` to ${label}` : ""}` : `Sent ${n} party invites`, "They'll get the invite on their Xbox, the Xbox app or Game Bar.");
  } catch (e) {
    toast("error", "Couldn't send the party invite", errText(e));
    loadParty();
  } finally {
    set((s) => ({ busy: { ...s.busy, [key]: false } }));
  }
}

/** Voice parties run in the Xbox app; this opens their profile there, where "Join party" is. */
export function joinPartyInXbox(xuid: string, gamertag: string) {
  social.openXbox("profile", xuid).catch((e) => toast("error", "Couldn't open the Xbox app", errText(e)));
  toast("info", `Opening ${gamertag} in the Xbox app`, "Press Join party there. Voice runs in the Xbox app, so keep it open while you chat.");
}
