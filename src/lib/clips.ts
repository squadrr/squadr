// Clipping: replay buffer status, saving, and the clips folder. The recorder itself runs in Rust.
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { chime, toast } from "./actions";
import { errText, isTauri, on } from "./api";
import { mockCall } from "./mock";
import { get, set } from "./store";

export type ClipStatus = { installed: boolean; running: boolean; encoder: string; error: string | null; audio: boolean };
export type ClipFile = { name: string; path: string; size: number; modified: number };

const call = <T>(cmd: string, args?: Record<string, unknown>) => (isTauri ? invoke<T>(cmd, args) : mockCall<T>(cmd, args));

export const clipsApi = {
  status: () => call<ClipStatus>("clips_status"),
  install: () => call<void>("clips_install"),
  save: () => call<string>("clips_save"),
  dir: () => call<string>("clips_dir"),
  list: () => call<ClipFile[]>("clips_list"),
  open: (path: string) => call<void>("clips_open", { path }),
  reveal: (path: string) => call<void>("clips_reveal", { path }),
  remove: (path: string) => call<void>("clips_delete", { path }),
  openFolder: () => call<void>("clips_open_folder"),
  pickFolder: () => call<string | null>("clips_pick_folder"),
};

/** A URL the webview can play a clip from. */
export const clipSrc = (path: string) => (isTauri ? convertFileSrc(path) : "");

export const ENCODERS: Record<string, string> = { h264_nvenc: "NVIDIA", h264_amf: "AMD", h264_qsv: "Intel", h264_mf: "Windows" };

export async function refreshClips() {
  try {
    const [status, clips, clipDir] = await Promise.all([clipsApi.status(), clipsApi.list(), clipsApi.dir()]);
    set({ clipStatus: status, clips, clipDir });
  } catch (e) {
    set({ clips: get().clips ?? [] });
    console.warn(errText(e));
  }
}

export async function saveClipNow() {
  try {
    await clipsApi.save(); // the "clip" event shows the toast and refreshes the list
  } catch (e) {
    if (!isTauri) toast("error", "Couldn't save a clip", errText(e));
  }
}

export async function installClipping() {
  set({ clipInstall: 0 });
  try {
    await clipsApi.install();
    toast("good", "Clipping is ready", "Press your keybind any time to save the last moments.");
  } catch (e) {
    toast("error", "Couldn't set up clipping", errText(e));
  } finally {
    set({ clipInstall: null });
    refreshClips();
  }
}

export async function deleteClip(path: string) {
  try {
    await clipsApi.remove(path);
    set((s) => ({ clips: (s.clips ?? []).filter((c) => c.path !== path) }));
  } catch (e) {
    toast("error", "Couldn't delete the clip", errText(e));
  }
}

/** Listen for the recorder's events (call once). */
export function startClipEvents() {
  const offs = [
    on<{ ok: boolean; path?: string; error?: string }>("clip", (r) => {
      if (r.ok) {
        toast("good", "Clip saved", r.path?.split(/[\\/]/).pop());
        if (get().settings?.sound) chime();
      } else toast("error", "Couldn't save a clip", r.error);
      refreshClips();
    }),
    on<ClipStatus>("clips-status", (s) => set({ clipStatus: s })),
    on<number>("clips-install", (p) => set({ clipInstall: p })),
  ];
  refreshClips();
  return () => offs.forEach((f) => f());
}

/** "Alt+F10" from a keydown event, or null while only modifiers are held. */
export function hotkeyFrom(e: KeyboardEvent): string | null {
  const mods = [e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift", e.metaKey && "Super"].filter(Boolean) as string[];
  const c = e.code;
  let key: string | null = null;
  if (/^F\d{1,2}$/.test(c)) key = c;
  else if (/^Key[A-Z]$/.test(c)) key = c.slice(3);
  else if (/^Digit\d$/.test(c)) key = c.slice(5);
  else if (/^Numpad\d$/.test(c)) key = c;
  else if (["Home", "End", "PageUp", "PageDown", "Insert", "Delete", "PrintScreen", "Pause", "ScrollLock"].includes(c)) key = c;
  if (!key) return null;
  // a bare letter or digit would fire while typing in games and chat
  if (!mods.length && !/^(F\d+|Home|End|PageUp|PageDown|Insert|Delete|PrintScreen|Pause|ScrollLock|Numpad\d)$/.test(key)) return null;
  return [...mods, key].join("+");
}

export const fmtSize = (n: number) => (n >= 1 << 30 ? `${(n / (1 << 30)).toFixed(1)} GB` : `${Math.max(0.1, n / (1 << 20)).toFixed(1)} MB`);
