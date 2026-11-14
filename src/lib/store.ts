import { useSyncExternalStore } from "react";
import type { AuthStatus, Conversation, Detail, DeviceCode, Filters, Friend, Message, MineItem, Party, Person, Post, Settings, ThreadRef, Title } from "./api";

export type ThreadState = { messages: Message[]; loading: boolean; error: string | null; more: string | null; conversationId: string; loaded: boolean };
export const threadKey = (r: ThreadRef) => (r.kind === "group" ? `group:${r.groupId}:${r.channelId}` : `dm:${r.xuid}`);

/** "home" | "mine" | "create" | "settings" | `game:<titleId>` */
export type TabId = string;
export type Toast = { id: number; kind: "info" | "good" | "error"; title: string; body?: string };

export type BrowseState = { posts: Post[] | null; loading: boolean; error: string | null; filters: Filters; at: number; selected: string | null };
export type DetailState = { detail: Detail | null; loading: boolean; error: string | null };
export type Draft = { titleId: string; description: string; need: number; tags: string[]; language: string };

export type State = {
  auth: AuthStatus | null;
  /** Start guide opened again from Settings. */
  guide: boolean;
  signIn: { code: DeviceCode | null; error: string | null; busy: boolean; startedAt: number };
  settings: Settings | null;
  tabs: TabId[];
  active: TabId | null;
  search: string;
  games: Title[] | null;
  gamesError: string | null;
  storeResults: Title[] | null;
  storeSearching: boolean;
  counts: Record<string, number>;
  people: Record<string, Person>;
  browse: Record<string, BrowseState>;
  details: Record<string, DetailState>;
  mine: MineItem[] | null;
  mineLoading: boolean;
  mineError: string | null;
  applied: Record<string, true>;
  busy: Record<string, boolean>;
  rta: boolean;
  draft: Draft;
  toasts: Toast[];

  inbox: Conversation[] | null;
  requests: Conversation[];
  inboxError: string | null;
  msgFolder: "chats" | "requests";
  chat: ThreadRef | null;
  threads: Record<string, ThreadState>;
  friends: Friend[] | null;
  friendsError: string | null;
  party: Party | null;
  partyChecked: boolean;
};

export const defaultFilters = (language = ""): Filters => ({ language, tags: [], minNeeds: 1 });

const initial: State = {
  auth: null,
  guide: false,
  signIn: { code: null, error: null, busy: false, startedAt: 0 },
  settings: null,
  tabs: ["home"],
  active: "home",
  search: "",
  games: null,
  gamesError: null,
  storeResults: null,
  storeSearching: false,
  counts: {},
  people: {},
  browse: {},
  details: {},
  mine: null,
  mineLoading: false,
  mineError: null,
  applied: {},
  busy: {},
  rta: false,
  draft: { titleId: "", description: "", need: 1, tags: [], language: "en" },
  toasts: [],
  inbox: null,
  requests: [],
  inboxError: null,
  msgFolder: "chats",
  chat: null,
  threads: {},
  friends: null,
  friendsError: null,
  party: null,
  partyChecked: false,
};

let state = initial;
const subs = new Set<() => void>();

export const get = () => state;
export function set(patch: Partial<State> | ((s: State) => Partial<State>)) {
  state = { ...state, ...(typeof patch === "function" ? patch(state) : patch) };
  subs.forEach((f) => f());
}
export function reset(keep: Partial<State> = {}) {
  state = { ...initial, ...keep };
  subs.forEach((f) => f());
}
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => subs.delete(f);
};

export function useApp(): State {
  return useSyncExternalStore(subscribe, get);
}

export const gameTab = (titleId: string) => `game:${titleId}`;
export const tabGame = (tab: TabId | null) => (tab?.startsWith("game:") ? tab.slice(5) : null);
