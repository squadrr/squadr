import { Download, FolderOpen, Keyboard, LoaderCircle } from "lucide-react";
import { useEffect, useState } from "react";
import { Switch } from "../components/common";
import { saveSettings } from "../lib/actions";
import { isTauri } from "../lib/api";
import { clipsApi, ENCODERS, hotkeyFrom, installClipping, refreshClips } from "../lib/clips";
import { useApp } from "../lib/store";

/** The Clips group in Settings. */
export function ClipSettings() {
  const { settings, clipStatus, clipInstall, clipDir } = useApp();
  useEffect(() => {
    refreshClips();
  }, []);
  if (!settings) return null;
  const s = settings;
  const enable = async () => {
    await saveSettings({ clipsEnabled: !s.clipsEnabled });
    if (!s.clipsEnabled && isTauri && !(await clipsApi.status()).installed) installClipping();
  };
  const sel = (value: string | number, options: [string | number, string][], onChange: (v: string) => void) => (
    <select className="field" style={{ width: 170 }} value={value} onChange={(e) => onChange(e.target.value)} disabled={!s.clipsEnabled}>
      {options.map(([v, l]) => (
        <option key={v} value={v}>
          {l}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <div className="group-title">Clips</div>
      <div className="form-card">
        <div className="form-row">
          <div className="lbl">
            <b>Clipping</b>
            <span>
              {clipInstall != null
                ? `Downloading FFmpeg, the recording engine… ${Math.round(clipInstall * 100)}%`
                : !s.clipsEnabled
                  ? "Keep the last moments of your screen and game audio, and save them with a keybind."
                  : clipStatus?.running
                    ? `On · ${ENCODERS[clipStatus.encoder] ?? clipStatus.encoder} encoder${clipStatus.audio ? " · system audio" : ""}`
                    : clipStatus?.error
                      ? clipStatus.error
                      : clipStatus && !clipStatus.installed
                        ? "Needs FFmpeg (about 80 MB, downloaded once from its official GitHub release)."
                        : "Starting…"}
            </span>
          </div>
          {clipInstall != null ? (
            <LoaderCircle size={18} className="spin" />
          ) : s.clipsEnabled && clipStatus && !clipStatus.installed ? (
            <button className="btn-white" onClick={installClipping}>
              <Download size={14} /> Set up
            </button>
          ) : null}
          <Switch on={s.clipsEnabled} onClick={enable} />
        </div>
        <div className="form-row">
          <div className="lbl">
            <b>Save clip keybind</b>
            <span>Works while you're in a game. Click, then press the keys you want.</span>
          </div>
          <HotkeyInput value={s.clipHotkey} onChange={(v) => saveSettings({ clipHotkey: v })} />
        </div>
        <div className="form-row">
          <div className="lbl">
            <b>Clip length</b>
            <span>How much is saved when you press the keybind.</span>
          </div>
          {sel(s.clipSeconds, [[15, "15 seconds"], [30, "30 seconds"], [60, "1 minute"], [90, "1.5 minutes"], [120, "2 minutes"], [180, "3 minutes"]], (v) => saveSettings({ clipSeconds: Number(v) }))}
        </div>
        <div className="form-row">
          <div className="lbl">
            <b>Quality</b>
            <span>High looks sharper; Medium makes smaller files.</span>
          </div>
          {sel(s.clipQuality, [["high", "High"], ["medium", "Medium"]], (v) => saveSettings({ clipQuality: v as "high" | "medium" }))}
        </div>
        <div className="form-row">
          <div className="lbl">
            <b>Resolution</b>
            <span>Native keeps your screen's resolution. Changing recording settings restarts the buffer.</span>
          </div>
          {sel(s.clipHeight, [[0, "Native"], [1080, "1080p"], [720, "720p"]], (v) => saveSettings({ clipHeight: Number(v) }))}
        </div>
        <div className="form-row">
          <div className="lbl">
            <b>Frame rate</b>
            <span>60 fps is smoother; 30 fps uses less of your PC.</span>
          </div>
          {sel(s.clipFps, [[60, "60 fps"], [30, "30 fps"]], (v) => saveSettings({ clipFps: Number(v) }))}
        </div>
        <div className="form-row">
          <div className="lbl">
            <b>Screen</b>
            <span>Which monitor to record if you have more than one.</span>
          </div>
          {sel(s.clipMonitor, [[0, "Screen 1"], [1, "Screen 2"], [2, "Screen 3"], [3, "Screen 4"]], (v) => saveSettings({ clipMonitor: Number(v) }))}
        </div>
        <div className="form-row">
          <div className="lbl">
            <b>System audio</b>
            <span>Record what you hear: game sound and party chat.</span>
          </div>
          <Switch on={s.clipAudio} onClick={() => saveSettings({ clipAudio: !s.clipAudio })} disabled={!s.clipsEnabled} />
        </div>
        <div className="form-row">
          <div className="lbl">
            <b>Clips folder</b>
            <span className="path">{clipDir || "Videos\\Squadr Clips"}</span>
          </div>
          <button
            className="btn-ghost"
            onClick={async () => {
              const dir = await clipsApi.pickFolder();
              if (dir) {
                await saveSettings({ clipDir: dir });
                refreshClips();
              }
            }}
          >
            Change
          </button>
          {s.clipDir && (
            <button className="btn-ghost" onClick={() => saveSettings({ clipDir: "" }).then(refreshClips)}>
              Reset
            </button>
          )}
          <button className="btn-ghost" onClick={() => clipsApi.openFolder()}>
            <FolderOpen size={14} /> Open
          </button>
        </div>
      </div>
    </>
  );
}

/** Click to record a key combination like Alt+F10. Esc cancels, Backspace clears. */
function HotkeyInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [listening, setListening] = useState(false);
  const [hint, setHint] = useState("");
  useEffect(() => {
    if (!listening) return;
    const down = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === "Escape") return setListening(false);
      if (e.key === "Backspace" && !e.ctrlKey && !e.altKey) {
        onChange("");
        return setListening(false);
      }
      const hk = hotkeyFrom(e);
      if (hk) {
        onChange(hk);
        setListening(false);
      } else setHint([e.ctrlKey && "Ctrl", e.altKey && "Alt", e.shiftKey && "Shift"].filter(Boolean).join("+") + (e.ctrlKey || e.altKey || e.shiftKey ? "+…" : "Use a modifier or an F-key"));
    };
    window.addEventListener("keydown", down, true);
    return () => window.removeEventListener("keydown", down, true);
  }, [listening]);
  return (
    <button className={`hotkey ${listening ? "listening" : ""}`} onClick={() => (setHint(""), setListening(!listening))} onBlur={() => setListening(false)}>
      <Keyboard size={14} />
      {listening ? hint || "Press keys…" : value || "Not set"}
    </button>
  );
}
