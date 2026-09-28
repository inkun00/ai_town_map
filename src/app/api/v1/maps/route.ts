import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession, requireCsrf, requireSession } from "@/server/auth/session";
import { ApiError, failure, ok, readJson, requireUuid } from "@/server/http";
import { createMap, createMapSchema, listMaps } from "@/server/services/maps";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const params = request.nextUrl.searchParams;
    const scope = z.enum(["public", "mine","deleted"]).parse(params.get("scope") ?? "public");
    const limit = z.coerce.number().int().min(1).max(50).parse(params.get("limit") ?? 30);
    const q = params.get("q")?.slice(0, 100) || undefined;
    return ok(await listMaps(scope, await getSession(request), limit, params.get("cursor") ?? undefined, q, params.get("themeKey") ?? undefined));
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest) {
  try {
    const session = requireSession(await getSession(request));
    requireCsrf(request, session);
    if (session.kind !== "account") throw new ApiError(403, "ACCOUNT_REQUIRED", "지도 개설에는 Google 로그인이 필요합니다.");
    const key = request.headers.get("idempotency-key");
    if (!key) throw new ApiError(422, "IDEMPOTENCY_REQUIRED", "요청 키가 필요합니다.");
    requireUuid(key);
    const input = createMapSchema.parse(await readJson(request));
    const result = await createMap(input, session, key);
    return ok(result.map, result.repeated ? 200 : 201);
  } catch (error) { return failure(error); }
}
