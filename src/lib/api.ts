import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { mockCall, mockListen } from "./mock";

export type AuthStatus = { signedIn: boolean; xuid: string; gamertag: string };
export type DeviceCode = { userCode: string; verificationUri: string; expiresIn: number };
export type Settings = {
  showSidePanel: boolean; showStatusBar: boolean; language: string; pinned: string[]; extraTitles: string[]; sound: boolean;
  consoleOnly: boolean; onboarded: boolean; layout: "classic" | "pulse";
};
export type Links = { discord: string; youtube: string; tiktok: string; github: string };
export type Title = { titleId: string; name: string; scid: string; image: string; lastPlayed: string | null; devices: string[] };
export type Post = {
  handleId: string; scid: string; sessionName: string; titleId: string; titleName: string; hostXuid: string; description: string; locale: string;
  tags: string[]; target: number; confirmed: number; max: number; needs: number; membersCount: number; posted: string; scheduled: string | null;
  confirmedXuids: string[]; closed: boolean;
};
export type Person = { xuid: string; gamertag: string; gamerpic: string; presence: string; rep: string; gamerscore: string; isFriend: boolean };
export type Member = { index: number; xuid: string; gamertag: string; role: "host" | "confirmed" | "applicant"; message: string; joinTime: string };
export type Detail = { post: Post; members: Member[]; myRole: Member["role"] | null };
export type Filters = { language: string; tags: string[]; minNeeds: number };
export type NewPost = { scid: string; titleId: string; description: string; language: string; need: number; tags: string[] };
export type Tracked = { scid: string; sessionName: string; handleId: string; titleId: string; titleName: string; role: "host" | "applicant"; since: number };
export type MineItem = { tracked: Tracked; detail: Detail | null; gone: string | null };

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

function call<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  return isTauri ? invoke<T>(cmd, args) : mockCall<T>(cmd, args);
}

export function errText(e: unknown): string {
  if (typeof e === "string") return e;
  if (e instanceof Error) return e.message;
  return String(e);
}

const postRef = (p: Post) => ({ handleId: p.handleId, scid: p.scid, sessionName: p.sessionName, titleId: p.titleId, titleName: p.titleName });

export const api = {
  authStatus: () => call<AuthStatus>("auth_status"),
  authBegin: () => call<DeviceCode>("auth_begin"),
  authCancel: () => call<void>("auth_cancel"),
  signOut: () => call<void>("auth_sign_out"),
  openUrl: (url: string) => call<void>("open_url", { url }),
  rtaStatus: () => call<boolean>("rta_status"),
  settings: () => call<Settings>("settings_get"),
  saveSettings: (settings: Settings) => call<Settings>("settings_set", { settings }),
  games: (resolve = false) => call<Title[]>("games_list", { resolve }),
  links: () => call<Links>("links_get"),
  searchGames: (query: string) => call<Title[]>("games_search", { query }),
  query: (scid: string, filters: Filters) => call<{ posts: Post[]; people: Person[] }>("lfg_query", { scid, filters }),
  count: (scid: string, filters: Filters) => call<number>("lfg_count", { scid, filters }),
  detail: (handleId: string) => call<{ detail: Detail; people: Person[] }>("lfg_detail", { handleId }),
  people: (xuids: string[]) => call<Person[]>("people_get", { xuids }),
  mine: () => call<{ items: MineItem[]; people: Person[] }>("lfg_mine"),
  create: (post: NewPost, titleName: string) => call<Post>("lfg_create", { post, titleName }),
  apply: (p: Post, message: string) => call<void>("lfg_apply", { post: postRef(p), message }),
  leave: (scid: string, sessionName: string) => call<void>("lfg_leave", { scid, sessionName }),
  cancel: (p: { scid: string; sessionName: string; handleId: string }) => call<void>("lfg_cancel", { scid: p.scid, sessionName: p.sessionName, handleId: p.handleId }),
  confirm: (p: Post, index: number, confirmed: boolean) => call<void>("lfg_confirm", { scid: p.scid, sessionName: p.sessionName, index, confirmed }),
  decline: (p: Post, index: number) => call<void>("lfg_decline", { scid: p.scid, sessionName: p.sessionName, index }),
};

export function on<T>(event: "auth" | "rta" | "tap" | "update-progress", cb: (payload: T) => void): () => void {
  if (!isTauri) return mockListen(event, cb as (p: unknown) => void);
  const un = listen<T>(event, (e) => cb(e.payload));
  return () => void un.then((f) => f());
}

// ---------------------------------------------------------------- messages / friends / party
export type Conversation = {
  kind: "dm" | "group"; id: string; folder: string; title: string; participants: string[]; otherXuid: string; groupId: string; channelId: string;
  lastText: string; lastSender: string; lastTime: string; lastMessageId: string; unread: boolean; muted: boolean;
};
export type Message = { id: string; sender: string; text: string; time: string; kind: "text" | "image" | "other"; deleted: boolean };
export type Thread = { conversationId: string; messages: Message[]; more: string | null };
export type ThreadRef = { kind: "dm" | "group"; xuid: string; groupId: string; channelId: string };
export type Friend = { person: Person; state: string; favorite: boolean; inParty: boolean; partyJoinable: boolean; joinableGames: string[]; device: string };
export type Party = { scid: string; name: string; joinRestriction: string; members: { xuid: string; gamertag: string; index: number }[]; titleId: string };

export const social = {
  inbox: () => call<{ conversations: Conversation[]; requests: Conversation[]; people: Person[] }>("msg_inbox"),
  thread: (r: ThreadRef, before?: string) => call<{ thread: Thread; people: Person[] }>("msg_thread", { r, before: before ?? null }),
  send: (r: ThreadRef, text: string) => call<void>("msg_send", { r, text }),
  read: (conversationId: string, messageId: string) => call<void>("msg_read", { conversationId, messageId }),
  friends: () => call<Friend[]>("friends_list"),
  party: () => call<Party | null>("party_mine"),
  invite: (xuids: string[]) => call<number>("party_invite", { xuids }),
  openXbox: (target: "profile" | "social" | "gamebar", xuid?: string) => call<void>("open_xbox", { target, xuid: xuid ?? null }),
};

// ---------------------------------------------------------------- updates
export type UpdateInfo = { version: string; current: string; notes: string; date: string | null };
export const updates = {
  check: () => call<UpdateInfo | null | undefined>("update_check"),
  install: () => call<void>("update_install"),
};
