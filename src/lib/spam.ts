// Hides known spam ads ("WWW.X6RR.COM", "Xbox Followers", "gamertags", "LFG spammer") from LFG posts and
// message requests. Spammers write these in look-alike letters (Cyrillic, Armenian, Gujarati, math bold),
// so text is folded to plain ASCII before matching.

// Look-alike letters that Unicode normalization doesn't turn into Latin ones.
const LOOKALIKE: Record<string, string> = {
  // Cyrillic
  а: "a", в: "b", с: "c", ԁ: "d", е: "e", є: "e", ғ: "f", һ: "h", і: "i", ӏ: "l", Ӏ: "l", ј: "j", к: "k", м: "m", н: "h", о: "o", р: "p", ԛ: "q", ѕ: "s", т: "t", ц: "u", ѵ: "v", ԝ: "w", х: "x", ӿ: "x", Ӿ: "x", у: "y", ʏ: "y", ӡ: "z", Ғ: "f",
  // Armenian
  ա: "w", ց: "g", հ: "h", յ: "j", ո: "n", ս: "u", ք: "p", օ: "o", զ: "q",
  // Latin extensions / IPA
  ɑ: "a", ɐ: "a", ʙ: "b", ɓ: "b", ɕ: "c", ɗ: "d", ɛ: "e", ɠ: "g", ɢ: "g", ɦ: "h", ɪ: "i", ʝ: "j", ʟ: "l", ɱ: "m", ɴ: "n", ɵ: "o", ʀ: "r", ɾ: "r", ʂ: "s", ŧ: "t", ʋ: "v", ʍ: "w", ʐ: "z", ł: "l", ø: "o", đ: "d", ħ: "h",
  // digits that look like letters
  "૦": "o", "०": "o", "০": "o", "੦": "o",
};

/** Lowercase ASCII version of `text` (look-alike letters and styled fonts folded), punctuation kept. */
function loose(text: string): string {
  let s = text.normalize("NFKC");
  s = [...s].map((c) => LOOKALIKE[c] ?? LOOKALIKE[c.toLowerCase()] ?? c).join("");
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase(); // strip accents/dots (ṃ -> m)
}

/** Plain lowercase a-z0-9 version of `text`, with look-alike letters and styled fonts folded to ASCII. */
export function fold(text: string): string {
  return loose(text).replace(/[^a-z0-9]/g, "");
}

const PATTERNS = [
  "x6rr", // the spam site
  "xboxfollower",
  "lfgspammer",
  "gamertagswww",
  "buygamertag",
  "cheapgamertag",
  "ogtags",
];

// "www.something.com", also written "WWW, X6RR, COM" or "W W W . SHOP . COM"
const LINK = /(^|[^a-z0-9])w ?w ?w *[.,] *[a-z0-9-]{2,24} *[.,] *c ?o ?m([^a-z0-9]|$)/;

/** True for the follower/gamertag-selling spam ads. */
export function isSpam(...parts: (string | undefined | null)[]): boolean {
  const text = parts.filter(Boolean).join(" ");
  const s = fold(text);
  if (!s) return false;
  return PATTERNS.some((p) => s.includes(p)) || LINK.test(loose(text));
}
