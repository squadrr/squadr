// App updates from GitHub Releases. Kept outside the main store so signing out doesn't forget them.
import { useSyncExternalStore } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { toast } from "./actions";
import { errText, isTauri, on, updates, type UpdateInfo } from "./api";
import { get as getApp } from "./store";

type UpdateState = {
  current: string;
  available: UpdateInfo | null;
  checking: boolean;
  installing: boolean;
  progress: number | null;
  error: string | null;
  checkedAt: number;
};
let state: UpdateState = { current: "", available: null, checking: false, installing: false, progress: null, error: null, checkedAt: 0 };
const subs = new Set<() => void>();
const set = (p: Partial<UpdateState>) => {
  state = { ...state, ...p };
  subs.forEach((f) => f());
};
const subscribe = (f: () => void) => {
  subs.add(f);
  return () => {
    subs.delete(f);
  };
};
export const useUpdate = () => useSyncExternalStore(subscribe, () => state);

export async function checkForUpdates(manual = false) {
  if (state.checking || state.installing) return;
  set({ checking: true, error: null });
  try {
    const found = (await updates.check()) ?? null;
    const isNew = !!found && found.version !== state.available?.version;
    set({ available: found, checking: false, checkedAt: Date.now() });
    if (found && (isNew || manual)) toast("info", `Squadr ${found.version} is available`, "Install it from Settings, or from the status bar.");
    else if (!found && manual) toast("good", "You're up to date", `Squadr ${state.current} is the latest version.`);
  } catch (e) {
    set({ checking: false, error: errText(e), checkedAt: Date.now() });
    if (manual) toast("error", "Couldn't check for updates", errText(e));
  }
}

export async function installUpdate() {
  if (!state.available || state.installing) return;
  const live = (getApp().mine ?? []).filter((m) => m.detail);
  if (live.length && !window.confirm("Updating restarts Squadr. Your LFG post comes down and your join requests are withdrawn first. Update now?")) return;
  set({ installing: true, progress: 0, error: null });
  try {
    await updates.install(); // on success Squadr restarts and this never returns
  } catch (e) {
    set({ installing: false, progress: null, error: errText(e) });
    toast("error", "Update failed", errText(e));
  }
}

let started = false;
export function startUpdateChecks() {
  if (started) return;
  started = true;
  if (!isTauri) {
    set({ current: "dev" });
    return;
  }
  getVersion()
    .then((v) => set({ current: v }))
    .catch(() => {});
  on<{ got: number; total: number | null }>("update-progress", (p) => set({ progress: p.total ? Math.min(1, p.got / p.total) : null }));
  setTimeout(() => checkForUpdates(false), 8000);
  setInterval(() => checkForUpdates(false), 6 * 3600_000);
}
