import { ApiError, failure, ok } from "@/server/http";
import { themeByKey, type ThemeKey } from "@/lib/demo-data";

export async function GET(_request: Request, context: { params: Promise<{ key: string; version: string }> }) {
  try {
    const { key, version } = await context.params;
    const theme = themeByKey[key as ThemeKey];
    if (!theme || String(theme.version) !== version) throw new ApiError(404, "NOT_FOUND", "주제를 찾을 수 없습니다.");
    return ok(theme);
  } catch (error) { return failure(error); }
}
