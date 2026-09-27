import type { Category, Theme } from "@/lib/demo-data";

export const customRating: NonNullable<Theme["rating"]> = { key: "community", label: "장소 평가", options: [
  { key: "positive", label: "좋아요", color: "#16803D", symbol: "✓" },
  { key: "caution", label: "조금 불편", color: "#B85C00", symbol: "!" },
  { key: "improve", label: "개선 필요", color: "#C62828", symbol: "×" },
] };

export function validCustomCategories(categories: Category[]): boolean {
  const keys = new Set<string>();
  for (const category of categories) {
    if (keys.has(category.key)) return false;
    keys.add(category.key);
    const emojiKeys = new Set(category.emojiOptions.map((emoji) => emoji.key));
    if (emojiKeys.size !== category.emojiOptions.length || !emojiKeys.has(category.defaultEmojiKey)) return false;
  }
  return true;
}

export function buildMapTheme(base: Theme, custom?: { categories: Category[]; pinMode: Theme["pin"]["mode"] }, proposalsEnabled?: boolean): Theme {
  return {
    ...base,
    categories: custom?.categories ?? base.categories,
    pin: { mode: custom?.pinMode ?? base.pin.mode },
    rating: custom?.pinMode === "rating" ? customRating : base.rating,
    features: { ...base.features, ratingEnabled: custom ? custom.pinMode === "rating" : base.features.ratingEnabled, proposalsEnabled: proposalsEnabled ?? base.features.proposalsEnabled },
  };
}
