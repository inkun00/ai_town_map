// Rebuild the bundled Unicode catalog. Runtime selection works without network requests.
import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";

const sources = {
  emoji: "https://www.unicode.org/Public/17.0.0/emoji/emoji-test.txt",
  annotations: "https://raw.githubusercontent.com/unicode-org/cldr/release-48/common/annotations/ko.xml",
  derived: "https://raw.githubusercontent.com/unicode-org/cldr/release-48/common/annotationsDerived/ko.xml",
  license: "https://www.unicode.org/license.txt",
};
async function download(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status}: ${url}`);
  return response.text();
}
const [emojiText, annotations, derived, license] = await Promise.all(Object.values(sources).map(download));
const normalize = value => value.replace(/\uFE0F/g, "");
const decode = value => value.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
const names = new Map(), keywords = new Map();
for (const xml of [annotations, derived]) {
  for (const match of xml.matchAll(/<annotation cp="([^"]+)"([^>]*)>([^<]*)<\/annotation>/g)) {
    const glyph = normalize(decode(match[1]));
    if (match[2].includes('type="tts"')) names.set(glyph, decode(match[3]));
    else keywords.set(glyph, decode(match[3]).replace(/\s*\|\s*/g, " "));
  }
}
const groupNames = {
  "Smileys & Emotion": "표정·감정", "People & Body": "사람·몸",
  "Animals & Nature": "동물·자연", "Food & Drink": "음식·음료",
  "Travel & Places": "교통·장소", "Activities": "활동·놀이",
  "Objects": "생활·사물", "Symbols": "기호", "Flags": "깃발",
};
let group;
const groups = Object.keys(groupNames);
const entries = [];
for (const line of emojiText.split(/\r?\n/)) {
  if (line.startsWith("# group: ")) group = line.slice(9);
  const match = line.match(/^([A-F0-9 ]+)\s*; fully-qualified\s*# (\S+) E[\d.]+ (.+)$/);
  if (!match || !groupNames[group]) continue;
  const glyph = match[2], normalized = normalize(glyph);
  const key = `emoji-${createHash("sha256").update(normalized).digest("hex").slice(0, 20)}`;
  const label = names.get(normalized) || match[3];
  entries.push([key, glyph, label, groups.indexOf(group), `${keywords.get(normalized) || ""} ${match[3]}`.trim()]);
}
if (entries.length < 3900 || new Set(entries.map(e => e[0])).size !== entries.length) throw new Error("Incomplete or duplicate catalog");
await writeFile("src/lib/emoji-catalog-data.json", JSON.stringify({version:"17.0",cldrVersion:"48",groups:Object.values(groupNames),entries}) + "\n");
await writeFile("docs/UNICODE-LICENSE.txt", license);
await writeFile("docs/emoji-catalog-sources.json", JSON.stringify(sources, null, 2) + "\n");
console.log(`Bundled ${entries.length} emojis, ${entries.filter(e=>/^[\x00-\x7F]+$/.test(e[2])).length} English fallback labels.`);
