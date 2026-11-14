import { api, errText, type AuthStatus, type MineItem, type Person, type Post, type Settings, type Title } from "./api";
import { defaultFilters, gameTab, get, reset, set, tabGame, type BrowseState, type TabId } from "./store";

let toastId = 0;
export function toast(kind: "info" | "good" | "error", title: string, body?: string) {
  const id = ++toastId;
  set((s) => ({ toasts: [...s.toasts.slice(-3), { id, kind, title, body }] }));
  setTimeout(() => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), kind === "error" ? 7000 : 4500);
}

const busy = (key: string, on: boolean) => set((s) => ({ busy: { ...s.busy, [key]: on } }));

async function guarded<T>(key: string, fn: () => Promise<T>, errTitle: string): Promise<T | undefined> {
  if (get().busy[key]) return;
  busy(key, true);
  try {
    return await fn();
  } catch (e) {
    toast("error", errTitle, errText(e));
  } finally {
    busy(key, false);
  }
}

export function mergePeople(list: Person[]) {
  if (!list.length) return;
  set((s) => {
    const people = { ...s.people };
    for (const p of list) people[p.xuid] = p;
    return { people };
  });
}

// ---------------------------------------------------------------- titles

const known = new Map<string, Title>();
export function remember(list: Title[]) {
  for (const t of list) known.set(t.titleId, t);
}
export const findTitle = (titleId: string | null | undefined) => (titleId ? known.get(titleId) ?? null : null);

// ---------------------------------------------------------------- sign-in / session

export async function enterApp(status: AuthStatus) {
  reset({ auth: status, rta: await api.rtaStatus().catch(() => false) });
  const settings = await api.settings();
  set({ settings, draft: { ...get().draft, language: settings.language || "en" } });
  api.people([status.xuid]).then(mergePeople).catch(() => {});
  loadGames();
  refreshMine(false);
  import("./social").then((m) => (m.loadInbox(false), m.loadParty()));
}

export async function startSignIn() {
  set({ signIn: { code: null, error: null, busy: true, startedAt: Date.now() } });
  try {
    const code = await api.authBegin();
    set({ signIn: { code, error: null, busy: false, startedAt: Date.now() } });
    api.openUrl(code.verificationUri).catch(() => {});
  } catch (e) {
    set({ signIn: { code: null, error: errText(e), busy: false, startedAt: 0 } });
  }
}

export function cancelSignIn() {
  api.authCancel();
  set({ signIn: { code: null, error: null, busy: false, startedAt: 0 } });
}

export async function signOut() {
  await api.signOut().catch(() => {});
  reset({ auth: { signedIn: false, xuid: "", gamertag: "" } });
}

export async function saveSettings(patch: Partial<Settings>) {
  const cur = get().settings;
  if (!cur) return;
  const next = { ...cur, ...patch };
  set({ settings: next });
  try {
    set({ settings: await api.saveSettings(next) });
  } catch (e) {
    toast("error", "Couldn't save settings", errText(e));
  }
}

// ---------------------------------------------------------------- tabs

export function openTab(id: TabId) {
  set((s) => ({ tabs: s.tabs.includes(id) ? s.tabs : [...s.tabs, id], active: id }));
  const g = tabGame(id);
  if (g && !get().browse[g]) refreshBrowse(g);
  if (id === "mine") refreshMine(false);
  if (id === "create" && !get().draft.titleId) {
    const t = get().games?.[0];
    if (t) set((s) => ({ draft: { ...s.draft, titleId: t.titleId } }));
  }
}

export function closeTab(id: TabId) {
  set((s) => {
    const i = s.tabs.indexOf(id);
    const tabs = s.tabs.filter((t) => t !== id);
    const active = s.active === id ? (tabs[Math.min(i, tabs.length - 1)] ?? null) : s.active;
    return { tabs, active };
  });
}

export function openGame(t: Title) {
  remember([t]);
  openTab(gameTab(t.titleId));
}

export function createFor(titleId: string | null) {
  if (titleId) set((s) => ({ draft: { ...s.draft, titleId } }));
  openTab("create");
}

// ---------------------------------------------------------------- games

let gamesRun = 0;
/** Your games, fast from what's known, then again after matching new PC games to their Xbox versions. */
export async function loadGames() {
  const run = ++gamesRun;
  set({ gamesError: null });
  try {
    const games = await api.games(false);
    if (run !== gamesRun) return;
    remember(games);
    set({ games });
    loadCounts(games);
    const full = await api.games(true);
    if (run !== gamesRun) return;
    const ids = (l: Title[]) => l.map((t) => t.titleId).join();
    if (ids(full) !== ids(games)) {
      remember(full);
      set({ games: full });
      loadCounts(full);
    }
  } catch (e) {
    if (run === gamesRun) set({ gamesError: errText(e), games: get().games ?? [] });
  }
}

let countRun = 0;
/** LFG counts for the side panel, a few at a time so we stay under Xbox's rate limits. */
export async function loadCounts(games: Title[]) {
  const run = ++countRun;
  const pinned = get().settings?.pinned ?? [];
  const order = [...games].sort((a, b) => Number(pinned.includes(b.titleId)) - Number(pinned.includes(a.titleId))).slice(0, 16);
  const lang = get().settings?.language ?? "";
  for (const t of order) {
    if (run !== countRun || !get().auth?.signedIn) return;
    try {
      const n = await api.count(t.scid, defaultFilters(lang));
      set((s) => ({ counts: { ...s.counts, [t.titleId]: n } }));
    } catch {
      /* counts are a nice-to-have */
    }
    await new Promise((r) => setTimeout(r, 350));
  }
}

let searchSeq = 0;
export async function searchStore(q: string) {
  const seq = ++searchSeq;
  if (q.trim().length < 2) return set({ storeResults: null, storeSearching: false });
  set({ storeSearching: true });
  try {
    const res = await api.searchGames(q);
    remember(res);
    if (seq === searchSeq) set({ storeResults: res, storeSearching: false });
  } catch (e) {
    if (seq === searchSeq) set({ storeResults: [], storeSearching: false });
    toast("error", "Game search failed", errText(e));
  }
}

export function addGame(t: Title) {
  remember([t]);
  const s = get();
  if (!s.games?.some((g) => g.titleId === t.titleId)) set({ games: [...(s.games ?? []), t] });
  if (!s.settings?.extraTitles.includes(t.titleId)) saveSettings({ extraTitles: [...(s.settings?.extraTitles ?? []), t.titleId] });
  api.count(t.scid, defaultFilters(s.settings?.language ?? "")).then((n) => set((x) => ({ counts: { ...x.counts, [t.titleId]: n } }))).catch(() => {});
  openGame(t);
}

export function togglePin(titleId: string) {
  const pinned = get().settings?.pinned ?? [];
  saveSettings({ pinned: pinned.includes(titleId) ? pinned.filter((p) => p !== titleId) : [...pinned, titleId] });
}

export function removeGame(titleId: string) {
  const s = get();
  saveSettings({ extraTitles: (s.settings?.extraTitles ?? []).filter((x) => x !== titleId), pinned: (s.settings?.pinned ?? []).filter((x) => x !== titleId) });
  set({ games: (s.games ?? []).filter((g) => g.titleId !== titleId || g.lastPlayed) });
  closeTab(gameTab(titleId));
}

// ---------------------------------------------------------------- browse

function patchBrowse(titleId: string, patch: Partial<BrowseState>) {
  set((s) => {
    const cur = s.browse[titleId] ?? { posts: null, loading: false, error: null, filters: defaultFilters(s.settings?.language ?? ""), at: 0, selected: null };
    return { browse: { ...s.browse, [titleId]: { ...cur, ...patch } } };
  });
}

export async function refreshBrowse(titleId: string) {
  const t = findTitle(titleId);
  if (!t) return patchBrowse(titleId, { error: "Unknown game", loading: false });
  patchBrowse(titleId, { loading: true, error: null });
  const filters = get().browse[titleId].filters;
  try {
    const { posts, people } = await api.query(t.scid, filters);
    mergePeople(people);
    patchBrowse(titleId, { posts, loading: false, at: Date.now() });
    if (!filters.tags.length && filters.minNeeds <= 1) set((s) => ({ counts: { ...s.counts, [titleId]: Math.max(posts.length, s.counts[titleId] ?? 0) } }));
  } catch (e) {
    patchBrowse(titleId, { loading: false, error: errText(e) });
  }
}

export function setFilters(titleId: string, patch: Partial<BrowseState["filters"]>) {
  const cur = get().browse[titleId]?.filters ?? defaultFilters(get().settings?.language ?? "");
  patchBrowse(titleId, { filters: { ...cur, ...patch }, selected: null });
  refreshBrowse(titleId);
}

export function toggleTagFilter(titleId: string, tag: string) {
  const tags = get().browse[titleId]?.filters.tags ?? [];
  const has = tags.some((t) => t.toLowerCase() === tag.toLowerCase());
  setFilters(titleId, { tags: has ? tags.filter((t) => t.toLowerCase() !== tag.toLowerCase()) : [...tags, tag].slice(-3) });
}

export function selectPost(titleId: string, handleId: string | null) {
  patchBrowse(titleId, { selected: handleId });
  if (handleId) loadDetail(handleId);
}

export async function loadDetail(handleId: string) {
  set((s) => ({ details: { ...s.details, [handleId]: { detail: s.details[handleId]?.detail ?? null, loading: true, error: null } } }));
  try {
    const { detail, people } = await api.detail(handleId);
    mergePeople(people);
    set((s) => ({ details: { ...s.details, [handleId]: { detail, loading: false, error: null } } }));
  } catch (e) {
    set((s) => ({ details: { ...s.details, [handleId]: { detail: null, loading: false, error: errText(e) } } }));
  }
}

// ---------------------------------------------------------------- actions on posts

export async function applyTo(p: Post, message: string) {
  const ok = await guarded(
    `apply:${p.handleId}`,
    async () => {
      await api.apply(p, message);
      return true;
    },
    "Couldn't send your request",
  );
  if (!ok) return false;
  set((s) => ({ applied: { ...s.applied, [p.handleId]: true } }));
  toast("good", "Request sent", `${hostName(p)} will see it. You'll get a heads-up here if they pick you.`);
  loadDetail(p.handleId);
  refreshMine(false);
  return true;
}

export async function withdraw(p: { scid: string; sessionName: string; handleId: string }) {
  await guarded(`leave:${p.sessionName}`, () => api.leave(p.scid, p.sessionName), "Couldn't withdraw");
  set((s) => {
    const applied = { ...s.applied };
    delete applied[p.handleId];
    return { applied };
  });
  loadDetail(p.handleId);
  refreshMine(false);
}

export async function cancelPost(p: { scid: string; sessionName: string; handleId: string }) {
  await guarded(`cancel:${p.sessionName}`, () => api.cancel(p), "Couldn't cancel the post");
  toast("info", "Post cancelled");
  refreshMine(false);
}

export async function confirmMember(p: Post, index: number, gamertag: string, confirmed = true) {
  await guarded(`member:${p.sessionName}:${index}`, () => api.confirm(p, index, confirmed), confirmed ? "Couldn't accept" : "Couldn't undo");
  if (confirmed) toast("good", `${gamertag} is in`, "Invite them to a party from your Xbox or the Xbox app.");
  loadDetail(p.handleId);
  refreshMine(false);
}

export async function declineMember(p: Post, index: number) {
  await guarded(`member:${p.sessionName}:${index}`, () => api.decline(p, index), "Couldn't remove them");
  loadDetail(p.handleId);
  refreshMine(false);
}

export async function createPost() {
  const d = get().draft;
  const t = findTitle(d.titleId);
  if (!t) return toast("error", "Pick a game first");
  const post = await guarded(
    "create",
    () => api.create({ scid: t.scid, titleId: t.titleId, description: d.description, language: d.language, need: d.need, tags: d.tags }, t.name),
    "Couldn't post",
  );
  if (!post) return;
  toast("good", "You're live", `Your ${t.name} post is up. Requests show up under My LFG.`);
  set((s) => ({ draft: { ...s.draft, description: "" } }));
  await refreshMine(false);
  openTab("mine");
  refreshBrowse(t.titleId);
}

const hostName = (p: Post) => get().people[p.hostXuid]?.gamertag ?? "The host";

// ---------------------------------------------------------------- my LFG

let lastMine = new Map<string, MineItem>();
let mineSeq = 0;

export async function refreshMine(notify = true) {
  const seq = ++mineSeq;
  set({ mineLoading: true, mineError: null });
  try {
    const { items, people } = await api.mine();
    if (seq !== mineSeq) return;
    mergePeople(people);
    if (notify) announce(items);
    lastMine = new Map(items.map((i) => [i.tracked.sessionName, i]));
    const applied: Record<string, true> = {};
    for (const i of items) if (i.detail && i.tracked.role === "applicant") applied[i.tracked.handleId] = true;
    set({ mine: items.filter((i) => i.detail || i.gone), mineLoading: false, applied });
  } catch (e) {
    if (seq === mineSeq) set({ mineLoading: false, mineError: errText(e) });
  }
}

/** Toasts (and a chime) for what changed since last time: new requests on your post, or you got picked. */
function announce(items: MineItem[]) {
  for (const it of items) {
    const before = lastMine.get(it.tracked.sessionName);
    if (!before?.detail) continue;
    if (it.tracked.role === "host" && it.detail) {
      const old = new Set(before.detail.members.map((m) => m.xuid));
      for (const m of it.detail.members.filter((m) => m.role === "applicant" && !old.has(m.xuid))) {
        toast("info", `${m.gamertag} wants to join`, m.message || `Your ${it.tracked.titleName} post`);
        chime();
      }
    }
    if (it.tracked.role === "applicant") {
      if (it.detail?.myRole === "confirmed" && before.detail.myRole !== "confirmed") {
        toast("good", "You're in!", `The host picked you for ${it.tracked.titleName}. Watch for their party invite.`);
        chime();
      } else if (it.gone) toast("info", it.tracked.titleName, it.gone);
    }
  }
}

export function chime() {
  if (!get().settings?.sound) return;
  try {
    const ctx = new AudioContext();
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(880, ctx.currentTime);
    o.frequency.setValueAtTime(1320, ctx.currentTime + 0.09);
    g.gain.setValueAtTime(0.0001, ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.12, ctx.currentTime + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
    o.connect(g).connect(ctx.destination);
    o.start();
    o.stop(ctx.currentTime + 0.4);
    setTimeout(() => ctx.close(), 600);
  } catch {
    /* no audio device */
  }
}

/** Something changed on Xbox's side (RTA shoulder tap). */
export function onTap(resource: string) {
  const s = get();
  const mine = s.mine ?? [];
  const hit = resource === "*" || mine.some((m) => resource.toLowerCase().includes(m.tracked.sessionName.toLowerCase()));
  if (!hit) return;
  refreshMine(true);
  for (const m of mine) {
    if (resource === "*" || resource.toLowerCase().includes(m.tracked.sessionName.toLowerCase())) {
      if (s.details[m.tracked.handleId]) loadDetail(m.tracked.handleId);
    }
  }
}
