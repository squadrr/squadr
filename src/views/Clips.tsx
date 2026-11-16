import { Circle, Clapperboard, Download, ExternalLink, FolderOpen, LoaderCircle, Play, RefreshCw, Settings as Cog, Share2, Trash2, X } from "lucide-react";
import { ShareClip } from "./ShareClip";
import { useEffect, useState } from "react";
import { openTab, saveSettings } from "../lib/actions";
import { clipSrc, clipsApi, deleteClip, ENCODERS, fmtSize, installClipping, refreshClips, saveClipNow, type ClipFile } from "../lib/clips";
import { isTauri } from "../lib/api";
import { useApp } from "../lib/store";

/** Saved clips, plus the replay buffer's state and a Save button. */
export function Clips() {
  const { clips, clipStatus, clipInstall, clipDir, settings } = useApp();
  const [playing, setPlaying] = useState<ClipFile | null>(null);
  const [confirm, setConfirm] = useState<string | null>(null);
  const [sharing, setSharing] = useState<ClipFile | null>(null);
  useEffect(() => {
    refreshClips();
  }, []);
  if (!settings) return null;
  const on = settings.clipsEnabled;
  const live = !!clipStatus?.running;

  return (
    <div className="view">
      <div className="toolbar">
        <div className="tb-title">
          <b>Clips</b>
          {clips && <span className="muted">{clips.length} saved</span>}
        </div>
        <button className="tool" onClick={refreshClips}>
          <RefreshCw size={15} /> Refresh
        </button>
        <button className="tool" onClick={() => clipsApi.openFolder()}>
          <FolderOpen size={15} /> Open folder
        </button>
        <div className="grow" />
        {live && (
          <button className="btn-white" onClick={saveClipNow}>
            <Clapperboard size={14} /> Save clip
          </button>
        )}
      </div>
      <div className="scroll">
        <div className="content">
          <div className={`clip-banner ${live ? "live" : ""}`}>
            <span className="clip-dot">{live ? <Circle size={10} fill="currentColor" /> : <Clapperboard size={18} />}</span>
            <div className="lbl">
              {clipInstall != null ? (
                <>
                  <b>Setting up clipping… {Math.round(clipInstall * 100)}%</b>
                  <span>Downloading FFmpeg, the recording engine (about 80 MB, once).</span>
                </>
              ) : live ? (
                <>
                  <b>
                    Recording the last {settings.clipSeconds}s · press <kbd>{settings.clipHotkey || "your keybind"}</kbd> to save
                  </b>
                  <span>
                    {ENCODERS[clipStatus!.encoder] ?? clipStatus!.encoder} encoder · {settings.clipHeight ? `${settings.clipHeight}p` : "native"} {settings.clipFps}fps ·{" "}
                    {clipStatus!.audio ? "system audio on" : "no audio"} · saved to {clipDir}
                  </span>
                </>
              ) : on && clipStatus?.error ? (
                <>
                  <b>Clipping couldn't start</b>
                  <span>{clipStatus.error}</span>
                </>
              ) : on && clipStatus && !clipStatus.installed ? (
                <>
                  <b>One more step</b>
                  <span>Clipping needs FFmpeg, a free recording engine (about 80 MB, downloaded once from its official GitHub release).</span>
                </>
              ) : on ? (
                <>
                  <b>Starting…</b>
                  <span>Finding the best encoder for your graphics card.</span>
                </>
              ) : (
                <>
                  <b>Clip your best moments</b>
                  <span>Squadr keeps the last {settings.clipSeconds} seconds of your screen and game audio. Press a keybind to save it as a video.</span>
                </>
              )}
            </div>
            {clipInstall != null ? (
              <LoaderCircle size={18} className="spin" />
            ) : !on ? (
              <button className="btn-white" onClick={() => saveSettings({ clipsEnabled: true }).then(() => { if (!clipStatus?.installed && isTauri) installClipping(); })}>
                Turn on clipping
              </button>
            ) : clipStatus && !clipStatus.installed ? (
              <button className="btn-white" onClick={installClipping}>
                <Download size={14} /> Set up
              </button>
            ) : (
              <button className="btn-ghost" onClick={() => openTab("settings")}>
                <Cog size={14} /> Clip settings
              </button>
            )}
          </div>

          {clips === null && <div className="empty-note">Loading…</div>}
          {clips && clips.length === 0 && <div className="empty-note" style={{ padding: "30px 0", textAlign: "center" }}>No clips yet.{live ? ` Press ${settings.clipHotkey} after something good happens.` : ""}</div>}
          <div className="clip-grid">
            {clips?.map((c) => (
              <div key={c.path} className="clip-card">
                <button className="clip-thumb" onClick={() => setPlaying(c)} title="Play">
                  {isTauri ? <video src={`${clipSrc(c.path)}#t=0.5`} preload="metadata" muted /> : <div className="clip-fake" />}
                  <span className="clip-play">
                    <Play size={20} fill="currentColor" />
                  </span>
                </button>
                <div className="clip-meta">
                  <b title={c.name}>{c.name.replace(/\.mp4$/i, "")}</b>
                  <span>
                    {new Date(c.modified).toLocaleString([], { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {fmtSize(c.size)}
                  </span>
                </div>
                <div className="clip-actions">
                  <button className="icon-btn" title="Share with a friend or get a link" onClick={() => setSharing(c)}>
                    <Share2 size={15} />
                  </button>
                  <button className="icon-btn" title="Open in your video player" onClick={() => clipsApi.open(c.path)}>
                    <ExternalLink size={15} />
                  </button>
                  <button className="icon-btn" title="Show in folder" onClick={() => clipsApi.reveal(c.path)}>
                    <FolderOpen size={15} />
                  </button>
                  {confirm === c.path ? (
                    <button className="mini-btn danger" onClick={() => (setConfirm(null), deleteClip(c.path))}>
                      Delete?
                    </button>
                  ) : (
                    <button className="icon-btn" title="Delete" onClick={() => setConfirm(c.path)}>
                      <Trash2 size={15} />
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
      {sharing && <ShareClip clip={sharing} onClose={() => setSharing(null)} />}
      {playing && (
        <div className="clip-player" onMouseDown={(e) => e.target === e.currentTarget && setPlaying(null)}>
          <div className="clip-player-box">
            <div className="clip-player-head">
              <b>{playing.name}</b>
              <button className="icon-btn" onClick={() => setPlaying(null)} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <video src={clipSrc(playing.path)} controls autoPlay />
          </div>
        </div>
      )}
    </div>
  );
}
