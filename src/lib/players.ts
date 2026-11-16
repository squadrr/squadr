// Recent players: everyone you've actually grouped with through Squadr (you hosted and accepted them,
// or a host accepted you), with your own thumbs up/down and notes. Kept locally in players.json.
import { desktop, type MineItem } from "./api";
import { get, set } from "./store";

export type Rating = -1 | 0 | 1;
export type Player = {
  xuid: string;
  gamertag: string;
  gamerpic: string;
  lastSeen: number;
  lastGame: string;
  games: string[];
  /** Number of different posts you've been in together. */
  times: number;
  lastSession: string;
  rating: Rating;
  note: string;
};

let loaded = false;
let timer: ReturnType<typeof setTimeout> | undefined;

export async function loadPlayers() {
  try {
    const data = await desktop.dataGet<Record<string, Player>>("players");
    set({ players: data && typeof data === "object" ? data : {} });
  } catch {
    set({ players: {} });
  }
  loaded = true;
}

function persist() {
  clearTimeout(timer);
  timer = setTimeout(() => desktop.dataSet("players", get().players).catch(() => {}), 600);
}

function patch(xuid: string, p: Partial<Player>) {
  const cur = get().players[xuid];
  if (!cur) return;
  set((s) => ({ players: { ...s.players, [xuid]: { ...cur, ...p } } }));
  persist();
}

/** Remember the people in groups you're part of (called with every My LFG refresh). */
export function recordGroups(items: MineItem[]) {
  if (!loaded) return;
  const s = get();
  const me = s.auth?.xuid;
  const players = { ...s.players };
  let changed = false;
  for (const it of items) {
    const d = it.detail;
    if (!d || (d.myRole !== "host" && d.myRole !== "confirmed")) continue;
    for (const m of d.members) {
      if (m.xuid === me || (m.role !== "host" && m.role !== "confirmed")) continue;
      const person = s.people[m.xuid];
      const old = players[m.xuid];
      if (old?.lastSession === it.tracked.sessionName) continue;
      const game = it.tracked.titleName || d.post.titleName;
      players[m.xuid] = {
        xuid: m.xuid,
        gamertag: person?.gamertag ?? m.gamertag ?? old?.gamertag ?? "Xbox player",
        gamerpic: person?.gamerpic ?? old?.gamerpic ?? "",
        lastSeen: Date.now(),
        lastGame: game,
        games: [game, ...(old?.games ?? []).filter((g) => g !== game)].filter(Boolean).slice(0, 6),
        times: (old?.times ?? 0) + 1,
        lastSession: it.tracked.sessionName,
        rating: old?.rating ?? 0,
        note: old?.note ?? "",
      };
      changed = true;
    }
  }
  if (changed) {
    set({ players });
    persist();
  }
}

export const ratePlayer = (xuid: string, rating: Rating) => patch(xuid, { rating: get().players[xuid]?.rating === rating ? 0 : rating });
export const notePlayer = (xuid: string, note: string) => patch(xuid, { note: note.slice(0, 200) });

export function forgetPlayer(xuid: string) {
  set((s) => {
    const players = { ...s.players };
    delete players[xuid];
    return { players };
  });
  persist();
}
