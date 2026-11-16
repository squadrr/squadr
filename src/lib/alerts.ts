// LFG alerts: Squadr checks each alert's game every 90 seconds (also while it's in the tray) and
// tells you about new posts that match, with a Windows notification when you're not looking.
import { alertUser, findTitle, mergePeople, openGame, remember, saveSettings, selectPost, toast } from "./actions";
import { api, type Alert, type Post } from "./api";
import { fold, isSpam } from "./spam";
import { get, set } from "./store";

const EVERY = 90_000;
const MAX_ALERTS = 8;
/** Handle ids each alert has already seen, so only new posts make noise. */
const seen = new Map<string, Set<string>>();
let running = false;
let soon: ReturnType<typeof setTimeout> | undefined;

const words = (keywords: string) =>
  keywords
    .split(/[,\s]+/)
    .map(fold)
    .filter(Boolean);

export function matches(a: Alert, p: Post): boolean {
  const kw = words(a.keywords);
  if (!kw.length) return true;
  const text = fold(`${p.description} ${p.tags.join(" ")}`);
  return kw.every((w) => text.includes(w));
}

async function checkOne(a: Alert) {
  const s = get();
  const me = s.auth?.xuid;
  const res = await api.query(a.scid, { language: a.language, tags: a.tags, minNeeds: a.minNeeds });
  mergePeople(res.people);
  const gt = (x: string) => res.people.find((p) => p.xuid === x)?.gamertag;
  const found = res.posts.filter(
    (p) =>
      !p.closed &&
      p.needs > 0 &&
      p.hostXuid !== me &&
      get().players[p.hostXuid]?.rating !== -1 && // you rated them down
      !isSpam(p.description, p.tags.join(" "), gt(p.hostXuid)) &&
      matches(a, p),
  );
  const known = seen.get(a.id);
  const fresh = known ? found.filter((p) => !known.has(p.handleId)) : []; // the first check only learns what's already up
  seen.set(a.id, new Set([...(known ?? []), ...found.map((p) => p.handleId)]));
  set((x) => ({ alertMatches: { ...x.alertMatches, [a.id]: found } }));
  if (!fresh.length) return;
  set((x) => ({ alertNew: [...new Set([...x.alertNew, ...fresh.map((p) => p.handleId)])].slice(-100) }));
  const p = fresh[0];
  const host = gt(p.hostXuid) ?? get().people[p.hostXuid]?.gamertag ?? "Someone";
  if (fresh.length === 1) alertUser("info", `${a.titleName}: ${host} needs ${p.needs}`, p.description || "New LFG post matching your alert");
  else alertUser("info", `${fresh.length} new ${a.titleName} groups`, `${host}: ${p.description || "matches your alert"}`);
}

export async function checkAlerts() {
  if (running || !get().auth?.signedIn) return;
  running = true;
  try {
    const list = (get().settings?.alerts ?? []).filter((a) => a.enabled).slice(0, MAX_ALERTS);
    for (const a of list) {
      try {
        await checkOne(a);
      } catch {
        /* try again next round */
      }
      await new Promise((r) => setTimeout(r, 1500)); // stay under Xbox's rate limits
    }
    set({ alertsChecked: Date.now() });
  } finally {
    running = false;
  }
}

/** Check again in a moment (after alerts change). */
export function checkAlertsSoon() {
  clearTimeout(soon);
  soon = setTimeout(checkAlerts, 800);
}

/** Start the background checks (call once, after sign-in). */
export function startAlerts() {
  const first = setTimeout(checkAlerts, 6000);
  const id = setInterval(checkAlerts, EVERY);
  return () => (clearTimeout(first), clearInterval(id));
}

export function addAlert(a: Omit<Alert, "id" | "created" | "enabled">) {
  const list = get().settings?.alerts ?? [];
  if (list.length >= MAX_ALERTS) return toast("error", `You can have up to ${MAX_ALERTS} alerts`, "Delete one first.");
  const alert: Alert = { ...a, id: crypto.randomUUID(), created: Date.now(), enabled: true };
  saveSettings({ alerts: [...list, alert] }).then(checkAlertsSoon);
  toast("good", "Alert on", `You'll hear about new ${a.titleName} groups${a.keywords ? ` mentioning "${a.keywords}"` : ""}, even with Squadr in the tray.`);
}

export function updateAlert(id: string, patch: Partial<Alert>) {
  saveSettings({ alerts: (get().settings?.alerts ?? []).map((a) => (a.id === id ? { ...a, ...patch } : a)) }).then(() => {
    seen.delete(id);
    checkAlertsSoon();
  });
}

export function removeAlert(id: string) {
  seen.delete(id);
  set((s) => {
    const alertMatches = { ...s.alertMatches };
    delete alertMatches[id];
    return { alertMatches };
  });
  saveSettings({ alerts: (get().settings?.alerts ?? []).filter((a) => a.id !== id) });
}

/** Open a matched post in its game tab. */
export function openMatch(a: Alert, p: Post) {
  const t = findTitle(a.titleId) ?? { titleId: a.titleId, name: a.titleName, scid: a.scid, image: "", lastPlayed: null, devices: [] };
  remember([t]);
  openGame(t);
  selectPost(a.titleId, p.handleId);
  set((s) => ({ alertNew: s.alertNew.filter((h) => h !== p.handleId) }));
}
