import { Download, ExternalLink, LoaderCircle, LogOut, RefreshCw, Sparkles } from "lucide-react";
import { Avatar, Switch } from "../components/common";
import { loadGames, saveSettings, signOut } from "../lib/actions";
import { api } from "../lib/api";
import { LANGUAGES, xboxProfileUrl } from "../lib/format";
import { set, useApp } from "../lib/store";
import { DiscordIcon, TikTokIcon, useLinks, YouTubeIcon } from "./Welcome";
import { checkForUpdates, installUpdate, useUpdate } from "../lib/update";
import { ClipSettings } from "./ClipSettings";

const LAYOUTS = [
  { id: "classic", name: "Classic", blurb: "Tabs, a games panel and a status bar. Black and white." },
  { id: "pulse", name: "Pulse", blurb: "A game rail, the feed and a side pane that's always open. Violet glow." },
] as const;

export function SettingsView() {
  const { settings, auth, people, rta } = useApp();
  const me = auth ? people[auth.xuid] : null;
  const up = useUpdate();
  const links = useLinks();
  if (!settings) return null;
  return (
    <div className="view" style={{ gridTemplateRows: "1fr" }}>
      <div className="scroll">
        <div className="content narrow">
          <div className="page-head">
            <div>
              <h1>Settings</h1>
            </div>
          </div>

          <div className="group-title">Account</div>
          <div className="form-card">
            <div className="form-row">
              <Avatar person={me} gamertag={auth?.gamertag} size={40} />
              <div className="lbl">
                <b>{me?.gamertag ?? auth?.gamertag}</b>
                <span>Signed in with Xbox · {rta ? "connected" : "reconnecting"}</span>
              </div>
              <button className="btn-ghost" onClick={() => api.openUrl(xboxProfileUrl(auth?.gamertag ?? ""))}>
                <ExternalLink size={14} /> Profile
              </button>
              <button className="btn-ghost btn-danger" onClick={signOut}>
                <LogOut size={14} /> Sign out
              </button>
            </div>
          </div>

          <div className="group-title">Looking for Group</div>
          <div className="form-card">
            <div className="form-row">
              <div className="lbl">
                <b>Language</b>
                <span>Used for new posts and as the default filter when you open a game.</span>
              </div>
              <select className="field" value={settings.language} onChange={(e) => saveSettings({ language: e.target.value })}>
                {LANGUAGES.map((l) => (
                  <option key={l.code} value={l.code}>
                    {l.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <div className="lbl">
                <b>Sound</b>
                <span>Play a chime when someone asks to join your post or a host picks you.</span>
              </div>
              <Switch on={settings.sound} onClick={() => saveSettings({ sound: !settings.sound })} />
            </div>
            <div className="form-row">
              <div className="lbl">
                <b>Xbox versions only</b>
                <span>Show the Xbox console version of each game, where console players post. PC-only games still show when they have 15 or more open posts.</span>
              </div>
              <Switch on={settings.consoleOnly} onClick={() => saveSettings({ consoleOnly: !settings.consoleOnly }).then(() => loadGames())} />
            </div>
          </div>

          <div className="group-title">Background</div>
          <div className="form-card">
            <div className="form-row">
              <div className="lbl">
                <b>Keep running in the tray</b>
                <span>Closing the window hides Squadr next to the clock, so your posts, alerts and auto-repost keep working. Quit from the tray icon or File › Exit.</span>
              </div>
              <Switch on={settings.closeToTray} onClick={() => saveSettings({ closeToTray: !settings.closeToTray })} />
            </div>
            <div className="form-row">
              <div className="lbl">
                <b>Start with Windows</b>
                <span>Open Squadr quietly in the tray when you sign in to your PC.</span>
              </div>
              <Switch on={settings.startWithWindows} onClick={() => saveSettings({ startWithWindows: !settings.startWithWindows })} />
            </div>
            <div className="form-row">
              <div className="lbl">
                <b>Windows notifications</b>
                <span>When Squadr isn't in front: join requests, getting picked, new messages, alert matches and reposts.</span>
              </div>
              <Switch on={settings.notifications} onClick={() => saveSettings({ notifications: !settings.notifications })} />
            </div>
          </div>

          <div className="group-title">Interface</div>
          <div className="form-card">
            <div className="form-row col">
              <div className="lbl">
                <b>Layout</b>
                <span>How Squadr looks. You can switch back any time.</span>
              </div>
              <div className="layout-pick">
                {LAYOUTS.map((l) => (
                  <button key={l.id} className={`layout-opt ${settings.layout === l.id ? "on" : ""}`} onClick={() => saveSettings({ layout: l.id })}>
                    <span className={`layout-thumb ${l.id}`}>
                      <i />
                      <i />
                      <i />
                    </span>
                    <b>{l.name}</b>
                    <span>{l.blurb}</span>
                  </button>
                ))}
              </div>
            </div>
            <div className="form-row">
              <div className="lbl">
                <b>Liquid glass</b>
                <span>Frosted, see-through panels with a glossy edge. Works with Classic and Pulse.</span>
              </div>
              <Switch on={settings.glass} onClick={() => saveSettings({ glass: !settings.glass })} />
            </div>
            <div className="form-row">
              <div className="lbl">
                <b>Transparent background</b>
                <span>Let your desktop show through, blurred. Acrylic works on Windows 10 and 11; Mica is subtler and needs Windows 11.</span>
              </div>
              <select className="field" style={{ width: 150 }} value={settings.backdrop} onChange={(e) => saveSettings({ backdrop: e.target.value as typeof settings.backdrop })}>
                <option value="off">Off</option>
                <option value="acrylic">Acrylic</option>
                <option value="mica">Mica</option>
              </select>
            </div>
            {settings.layout !== "pulse" && (
              <div className="form-row">
                <div className="lbl">
                  <b>Games panel</b>
                  <span>Your games and store search on the left.</span>
                </div>
                <Switch on={settings.showSidePanel} onClick={() => saveSettings({ showSidePanel: !settings.showSidePanel })} />
              </div>
            )}
            <div className="form-row">
              <div className="lbl">
                <b>Status bar</b>
                <span>Connection and what you're hosting, along the bottom.</span>
              </div>
              <Switch on={settings.showStatusBar} onClick={() => saveSettings({ showStatusBar: !settings.showStatusBar })} />
            </div>
          </div>

          <ClipSettings />

          <div className="group-title">Community</div>
          <div className="form-card">
            <div className="form-row">
              <div className="lbl">
                <b>Follow Squadr</b>
                <span>Updates, tips and people to play with.</span>
              </div>
              {links.discord && (
                <button className="btn-ghost" onClick={() => api.openUrl(links.discord)}>
                  <DiscordIcon /> Discord
                </button>
              )}
              <button className="btn-ghost" onClick={() => api.openUrl(links.youtube)}>
                <YouTubeIcon /> YouTube
              </button>
              <button className="btn-ghost" onClick={() => api.openUrl(links.tiktok)}>
                <TikTokIcon /> TikTok
              </button>
            </div>
            <div className="form-row">
              <div className="lbl">
                <b>Start guide</b>
                <span>The welcome tour from your first sign-in.</span>
              </div>
              <button className="btn-ghost" onClick={() => set({ guide: true })}>
                <Sparkles size={14} /> Show again
              </button>
              <button className="btn-ghost" onClick={() => api.openUrl(links.github)} title="Source code and releases">
                <ExternalLink size={14} /> GitHub
              </button>
            </div>
          </div>

          <div className="group-title">Updates</div>
          <div className="form-card">
            <div className="form-row">
              <div className="lbl">
                <b>{up.available ? `Squadr ${up.available.version} is ready` : `Squadr ${up.current}`}</b>
                <span>
                  {up.installing
                    ? `Downloading${up.progress != null ? ` ${Math.round(up.progress * 100)}%` : "…"} Squadr restarts by itself when it's done.`
                    : up.available
                      ? "Installing restarts Squadr. Your LFG post comes down and your join requests are withdrawn first."
                      : up.error
                        ? `Couldn't check: ${up.error}`
                        : up.checkedAt
                          ? "You're on the latest version."
                          : "Squadr checks for updates when it starts and every few hours."}
                </span>
              </div>
              {up.available ? (
                <button className="btn-white" disabled={up.installing} onClick={installUpdate}>
                  {up.installing ? <LoaderCircle size={14} className="spin" /> : <Download size={14} />} Install and restart
                </button>
              ) : (
                <button className="btn-ghost" disabled={up.checking} onClick={() => checkForUpdates(true)}>
                  {up.checking ? <LoaderCircle size={14} className="spin" /> : <RefreshCw size={14} />} Check for updates
                </button>
              )}
            </div>
            {up.available?.notes && !up.installing && (
              <div className="form-row col">
                <div className="update-notes">{up.available.notes.replace(/\*\*/g, "").replace(/\r/g, "")}</div>
              </div>
            )}
          </div>

          <div className="group-title">How Squadr works</div>
          <div className="info-box" style={{ marginTop: 0 }}>
            <p>Squadr talks straight to Xbox Live's own Looking for Group service, so posts here are the same ones you see on console and in the Xbox app, and anything you post shows up there too.</p>
            <p>You sign in the same way the Xbox mobile app does. Your sign-in is stored encrypted on this PC and nothing is sent anywhere else.</p>
            <p>Xbox needs you online to keep you in a group. Squadr keeps a live connection while it's open; when you close it, your post is taken down and your requests are withdrawn.</p>
            <p className="warn-line">Squadr is an independent app. It isn't made by or affiliated with Microsoft or Xbox. Follow the Xbox Community Standards when you post.</p>
          </div>
          <div className="muted" style={{ marginTop: 18, fontSize: 12 }}>Squadr {up.current}</div>
        </div>
      </div>
    </div>
  );
}
