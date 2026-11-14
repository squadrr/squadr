// Posts "Squadr vX is out" with the release notes to the Discord webhook in DISCORD_WEBHOOK.
// Run by the release workflow after the installer is published. Does nothing without the secret.
import { readFileSync } from "node:fs";

const hook = process.env.DISCORD_WEBHOOK;
const tag = process.env.TAG ?? "";
const repo = process.env.REPO ?? "zinn-games/squadr";
if (!hook) {
  console.log("DISCORD_WEBHOOK not set, skipping the Discord post.");
  process.exit(0);
}

// The release notes, minus the install instructions and footer (the embed links to the download instead).
const notes = readFileSync("RELEASE_NOTES.md", "utf8").replace(/\r/g, "").split(/\n(?=Download \*\*)/)[0].trim();
const url = `https://github.com/${repo}/releases/tag/${tag}`;

const body = {
  username: "Squadr",
  allowed_mentions: { parse: [] },
  embeds: [
    {
      title: `Squadr ${tag} is out`,
      url,
      description: `${notes.slice(0, 3800)}\n\nAlready have Squadr? It updates itself: look for **Update** in the status bar or in Settings.\nNew here? [Download the installer](${url}).`,
      color: 0xb46bff,
      footer: { text: "Squadr is an independent app, not affiliated with Microsoft or Xbox." },
      timestamp: new Date().toISOString(),
    },
  ],
};

const res = await fetch(hook, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
if (!res.ok) {
  // Don't fail the release over a Discord hiccup, but make it visible in the log.
  console.log(`::warning::Discord post failed: ${res.status} ${await res.text()}`);
} else console.log("Posted the release to Discord.");
