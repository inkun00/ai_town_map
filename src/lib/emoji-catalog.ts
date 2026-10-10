import data from "./emoji-catalog-data.json";
import type { EmojiOption } from "./demo-data";

export type CatalogEmoji = EmojiOption & { searchTerms?: string; groupKey: string; groupLabel: string };
export const normalizeEmoji = (glyph: string) => glyph.replace(/\uFE0F/g, "");
export const emojiCatalog: CatalogEmoji[] = data.entries.map(([key, glyph, label, group, terms]) => ({
  key: String(key), glyph: String(glyph), label: String(label),
  groupKey: String(group), groupLabel: data.groups[Number(group)], searchTerms: String(terms),
}));
const byKey = new Map(emojiCatalog.map(emoji => [emoji.key, emoji]));
const byGlyph = new Map(emojiCatalog.map(emoji => [normalizeEmoji(emoji.glyph), emoji]));
export const findCatalogEmoji = (key: string) => byKey.get(key);

// Keep map keys and labels. Disabled icons cannot reappear under a catalog key.
export function recordEmojiOptions(options: EmojiOption[], retainedKey?: string): CatalogEmoji[] {
  const existing = new Map(options.map(emoji => [normalizeEmoji(emoji.glyph), emoji]));
  const registered = options.filter(emoji => emoji.active !== false || emoji.key === retainedKey).map(emoji => {
    const catalog = byGlyph.get(normalizeEmoji(emoji.glyph));
    return { ...emoji, groupKey: "map", groupLabel: "이 지도 추천", searchTerms: `${catalog?.label ?? ""} ${catalog?.searchTerms ?? ""}` };
  });
  return [...registered, ...emojiCatalog.filter(emoji => !existing.has(normalizeEmoji(emoji.glyph)))];
}

export function filterCatalog<T extends EmojiOption & { searchTerms?: string; groupKey?: string }>(options: T[], search: string, group = "all"): T[] {
  const normalize = (text: string) => text.toLocaleLowerCase().replace(/\s/g, "");
  const term = normalize(search);
  return options.filter(emoji => (group === "all" || emoji.groupKey === group) && normalize(`${emoji.glyph} ${emoji.label} ${emoji.searchTerms ?? ""}`).includes(term));
}
