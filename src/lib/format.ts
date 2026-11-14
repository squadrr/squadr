export function ago(iso: string | null | undefined): string {
  if (!iso) return "";
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return "";
  const s = Math.max(0, (Date.now() - t) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return `${Math.round(s / 86400)}d ago`;
}

export function when(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const today = new Date();
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  if (d.toDateString() === today.toDateString()) return `Today at ${time}`;
  const tomorrow = new Date(today.getTime() + 86400000);
  if (d.toDateString() === tomorrow.toDateString()) return `Tomorrow at ${time}`;
  return `${d.toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" })} at ${time}`;
}

/** micrequired -> "Mic required" for the built-in tags, otherwise the tag as written. */
export function tagLabel(tag: string): string {
  return SYSTEM_TAG_LABELS[tag.toLowerCase()] ?? tag;
}

export const SYSTEM_TAGS: { group: string; tags: string[] }[] = [
  { group: "Comms", tags: ["micrequired", "micoptional", "nomic", "textchatrequired"] },
  { group: "Play style", tags: ["casual", "competitive", "cooperative", "achievementhunting", "tournament", "chill", "tryhard"] },
  { group: "People", tags: ["everyoneiswelcome", "willhelpnewplayers", "newplayerswelcome", "noswearing", "notrashtalking", "trashtalkingok", "adultsonly", "allages"] },
];

const SYSTEM_TAG_LABELS: Record<string, string> = {
  micrequired: "Mic required",
  micoptional: "Mic optional",
  nomic: "No mic",
  textchatrequired: "Text chat",
  casual: "Casual",
  competitive: "Competitive",
  cooperative: "Co-op",
  achievementhunting: "Achievement hunting",
  tournament: "Tournament",
  chill: "Chill",
  tryhard: "Tryhard",
  everyoneiswelcome: "Everyone welcome",
  willhelpnewplayers: "Will help new players",
  newplayerswelcome: "New players welcome",
  noswearing: "No swearing",
  notrashtalking: "No trash talk",
  trashtalkingok: "Trash talk OK",
  adultsonly: "Adults only",
  allages: "All ages",
};

export const LANGUAGES: { code: string; name: string }[] = [
  { code: "", name: "Any language" },
  { code: "en", name: "English" },
  { code: "es", name: "Español" },
  { code: "fr", name: "Français" },
  { code: "de", name: "Deutsch" },
  { code: "pt", name: "Português" },
  { code: "it", name: "Italiano" },
  { code: "nl", name: "Nederlands" },
  { code: "pl", name: "Polski" },
  { code: "ru", name: "Русский" },
  { code: "tr", name: "Türkçe" },
  { code: "ar", name: "العربية" },
  { code: "ja", name: "日本語" },
  { code: "ko", name: "한국어" },
  { code: "zh", name: "中文" },
];

export function xboxProfileUrl(gamertag: string) {
  return `https://www.xbox.com/en-US/play/user/${encodeURIComponent(gamertag)}`;
}
