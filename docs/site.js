// Point every download button at the newest installer, and fill community links from links.json.
(async () => {
  try {
    const r = await fetch("https://api.github.com/repos/squadrr/squadr/releases/latest", { headers: { Accept: "application/vnd.github+json" } });
    if (!r.ok) return;
    const rel = await r.json();
    const exe = (rel.assets || []).find((a) => /_x64-setup\.exe$/i.test(a.name));
    if (!exe) return;
    const mb = (exe.size / 1048576).toFixed(1);
    document.querySelectorAll("a.dl").forEach((a) => (a.href = exe.browser_download_url));
    document.querySelectorAll(".dl-meta").forEach((s) => (s.textContent = `Version ${rel.tag_name.replace(/^v/, "")} · ${mb} MB`));
  } catch {}
})();

(async () => {
  try {
    const r = await fetch("https://raw.githubusercontent.com/squadrr/squadr/main/links.json", { cache: "no-store" });
    if (!r.ok) return;
    const l = await r.json();
    const set = (id, url) => { const a = document.getElementById(id); if (a && url) { a.href = url; a.hidden = false; } };
    set("l-tiktok", l.tiktok);
    set("l-youtube", l.youtube);
    set("l-discord", l.discord);
    set("l-github", l.github);
  } catch {}
})();
