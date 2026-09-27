import { ok } from "@/server/http";
import { themes } from "@/lib/demo-data";

export function GET() {
  return ok(themes.map((theme) => ({ key: theme.key, version: theme.version, label: theme.label, features: theme.features, pin: theme.pin, emojiExamples: theme.categories.slice(0, 3).map((category) => category.emojiOptions[0].glyph) })));
}
