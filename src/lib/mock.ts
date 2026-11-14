// Fake backend for previewing the UI in a normal browser (npx vite). Never used inside the app.
// URL flags: ?signin=1 shows the sign-in screen, ?view=mine|create|settings|game opens a tab.
import type { Detail, MineItem, Person, Post, Settings, Title } from "./api";

const params = typeof location !== "undefined" ? new URLSearchParams(location.search) : new URLSearchParams();
let signedIn = !params.has("signin");
const listeners: Record<string, ((p: unknown) => void)[]> = {};

const games: Title[] = [
  { titleId: "267695549", name: "Fortnite", scid: "s1", image: "", lastPlayed: "2026-11-13T20:00:00Z", devices: ["PC", "XboxSeries"] },
  { titleId: "558797228", name: "Rocket League®", scid: "s2", image: "", lastPlayed: "2026-11-12T20:00:00Z", devices: ["PC", "XboxSeries"] },
  { titleId: "926771636", name: "Tom Clancy's Rainbow Six Siege", scid: "s3", image: "", lastPlayed: "2026-11-10T20:00:00Z", devices: ["XboxSeries"] },
  { titleId: "1828326430", name: "Minecraft", scid: "s4", image: "", lastPlayed: "2026-11-02T20:00:00Z", devices: ["PC"] },
  { titleId: "1970218801", name: "Dead by Daylight", scid: "s5", image: "", lastPlayed: "2026-10-20T20:00:00Z", devices: ["PC"] },
  { titleId: "94618376", name: "Overwatch® 2", scid: "s6", image: "", lastPlayed: "2026-10-02T20:00:00Z", devices: ["XboxSeries"] },
];
const names = ["NovaRift", "quietstorm77", "Pixel Bandit", "LagLord", "MossyBoots", "Kairo", "TidalWave 22", "zeroBuildZed", "GhostPepper", "Lumen"];
const people: Person[] = names.map((g, i) => ({
  xuid: String(2535400000000000 + i), gamertag: g, gamerpic: "", presence: i % 3 === 0 ? "Online" : i % 3 === 1 ? "Fortnite - In a match" : "Last seen 2h ago",
  rep: i === 3 ? "NeedsWork" : "GoodPlayer", gamerscore: String(1200 + i * 3311), isFriend: i === 1,
}));
const descs = [
  "Zero build squads, just chill and get some wins. Need 2 more, mics on please.",
  "Grinding the new pirate tokens tonight. Anyone welcome, don't leave after one game.",
  "Ranked duos, gold+ only. Comms required.",
  "New to the game, looking for patient people to learn with.",
  "Creative maps and box fights, 1v1s after.",
  "Late night trios, EU servers, english please.",
];
const tagSets = [["micrequired", "chill", "ZeroBuild"], ["everyoneiswelcome", "dontleaveafter1loss"], ["competitive", "micrequired", "RANKED"], ["willhelpnewplayers", "casual"], ["BoxFights"], ["micrequired", "englishonly", "EU"]];
const now = Date.now();
const ME = "2535499999999999";
function makePosts(scid: string, title: Title): Post[] {
  return descs.map((d, i) => ({
    handleId: `${scid}-h${i}`, scid, sessionName: `${scid}-n${i}`, titleId: title.titleId, titleName: title.name, hostXuid: people[i].xuid,
    description: d, locale: "en", tags: tagSets[i], target: [2, 3, 1, 3, 1, 2][i], confirmed: [0, 1, 0, 2, 0, 1][i], max: 15,
    needs: [2, 2, 1, 1, 1, 1][i], membersCount: 1 + i, posted: new Date(now - (i * 7 + 1) * 60000).toISOString(), scheduled: i === 4 ? new Date(now + 3 * 3600000).toISOString() : null,
    confirmedXuids: [], closed: false,
  }));
}

const myPost: Post = { ...makePosts("s2", games[1])[0], handleId: "mine-h", sessionName: "mine-n", hostXuid: "2535499999999999", description: "2v2 ranked, plat+, mic on. Chill vibes.", tags: ["micrequired", "competitive"], target: 1, confirmed: 0, needs: 1 };
function detailFor(p: Post): Detail {
  const host = { index: 0, xuid: p.hostXuid, gamertag: people.find((x) => x.xuid === p.hostXuid)?.gamertag ?? "NovaPilot", role: "host" as const, message: "", joinTime: p.posted };
  const others = people.slice(5, 5 + Math.min(4, p.membersCount + 1)).map((x, i) => ({
    index: i + 1, xuid: x.xuid, gamertag: x.gamertag, role: (i < p.confirmed ? "confirmed" : "applicant") as "confirmed" | "applicant",
    message: ["yo i'm down", "", "plat 2, have mic", "inv"][i] ?? "", joinTime: p.posted,
  }));
  return { post: p, members: [host, ...others], myRole: p.handleId === "mine-h" ? "host" : null };
}

let settings: Settings = { showSidePanel: true, showStatusBar: true, language: "en", pinned: ["267695549"], extraTitles: [], sound: true };

const wait = (ms = 250) => new Promise((r) => setTimeout(r, ms));

export async function mockCall<T>(cmd: string, args: Record<string, unknown> = {}): Promise<T> {
  await wait();
  const r = (v: unknown) => v as T;
  switch (cmd) {
    case "auth_status":
      return r({ signedIn, xuid: signedIn ? "2535499999999999" : "", gamertag: signedIn ? "NovaPilot" : "" });
    case "auth_begin":
      setTimeout(() => {
        if (params.get("signin") === "auto") {
          signedIn = true;
          listeners.auth?.forEach((f) => f({ ok: true, status: { signedIn: true, xuid: "2535499999999999", gamertag: "NovaPilot" } }));
        }
      }, 4000);
      return r({ userCode: "5WNJKZV4", verificationUri: "https://www.microsoft.com/link", expiresIn: 900 });
    case "rta_status":
      return r(true);
    case "settings_get":
      return r(settings);
    case "settings_set":
      settings = args.settings as Settings;
      return r(settings);
    case "games_list":
      return r(games);
    case "games_search":
      return r([{ titleId: "2043073184", name: "Halo Infinite", scid: "s9", image: "", lastPlayed: null, devices: ["PC", "XboxSeries"] }]);
    case "lfg_count":
      return r({ s1: 1398, s2: 412, s3: 233, s4: 96, s5: 57, s6: 140 }[args.scid as string] ?? 3);
    case "lfg_query": {
      const t = games.find((g) => g.scid === args.scid) ?? games[0];
      return r({ posts: makePosts(t.scid, t), people });
    }
    case "lfg_detail": {
      const id = args.handleId as string;
      const t = games.find((g) => id.startsWith(g.scid)) ?? games[0];
      const p = id === "mine-h" ? myPost : makePosts(t.scid, t).find((x) => x.handleId === id) ?? makePosts(t.scid, t)[0];
      return r({ detail: detailFor(p), people });
    }
    case "people_get":
      return r(people);
    case "lfg_mine": {
      const items: MineItem[] = [
        { tracked: { scid: "s2", sessionName: "mine-n", handleId: "mine-h", titleId: "558797228", titleName: "Rocket League®", role: "host", since: now }, detail: detailFor(myPost), gone: null },
        { tracked: { scid: "s1", sessionName: "s1-n1", handleId: "s1-h1", titleId: "267695549", titleName: "Fortnite", role: "applicant", since: now }, detail: { ...detailFor(makePosts("s1", games[0])[1]), myRole: "applicant" }, gone: null },
      ];
      return r({ items, people });
    }
    case "msg_inbox": {
      const conv = (i: number, text: string, mins: number, unread = false) => ({
        kind: "dm", id: `c${i}`, folder: "primary", title: "", participants: [ME, people[i].xuid], otherXuid: people[i].xuid, groupId: "", channelId: "",
        lastText: text, lastSender: unread ? people[i].xuid : i % 2 ? ME : people[i].xuid, lastTime: new Date(now - mins * 60000).toISOString(), lastMessageId: `m${i}`, unread, muted: false,
      });
      return r({
        conversations: [
          conv(1, "you on? need one more for ranked", 3, true),
          { kind: "group", id: "g1", folder: "primary", title: "Late night squad", participants: [ME, ...people.slice(2, 6).map((p) => p.xuid)], otherXuid: "", groupId: "g1", channelId: "0", lastText: "gg that last round was crazy", lastSender: people[3].xuid, lastTime: new Date(now - 42 * 60000).toISOString(), lastMessageId: "gm1", unread: false, muted: false },
          conv(5, "bet, send me an inv", 95),
          conv(7, "lol", 60 * 26),
          conv(2, "thanks for the carry", 60 * 72),
        ],
        requests: [conv(9, "hey saw your lfg post, still need someone?", 20, true)],
        people,
      });
    }
    case "msg_thread": {
      const t = args.r as { kind: string; xuid: string };
      const other = t.kind === "group" ? people[3].xuid : t.xuid;
      const lines: [boolean, string, number][] = [[false, "yo", 300], [true, "whats up", 298], [false, "you playing tonight?", 297], [true, "yeah after dinner, like 8", 290], [false, "bet", 289], [false, "need one more for ranked, you down?", 4], [false, "you on? need one more for ranked", 3]];
      return r({ thread: { conversationId: "c1", more: null, messages: lines.map(([mine, text, mins], i) => ({ id: `t${i}`, sender: mine ? ME : i % 2 && t.kind === "group" ? people[4].xuid : other, text, time: new Date(now - mins * 60000).toISOString(), kind: "text", deleted: false })) }, people });
    }
    case "friends_list":
      return r(people.map((p, i) => ({ person: p, state: i < 6 ? "Online" : "Offline", favorite: i === 1, inParty: i === 1 || i === 4, partyJoinable: i === 1, joinableGames: i === 2 ? ["267695549"] : [], device: i % 2 ? "Xbox Series X|S" : "PC" })));
    case "party_mine":
      return r(params.has("noparty") ? null : { scid: "p", name: "party1", joinRestriction: "followed", titleId: "", members: [{ xuid: ME, gamertag: "NovaPilot", index: 0 }, { xuid: people[1].xuid, gamertag: people[1].gamertag, index: 1 }] });
    case "party_invite":
      return r((args.xuids as string[]).length);
    default:
      return r(undefined);
  }
}

export function mockListen(event: string, cb: (p: unknown) => void) {
  (listeners[event] ??= []).push(cb);
  return () => {
    listeners[event] = listeners[event].filter((f) => f !== cb);
  };
}
