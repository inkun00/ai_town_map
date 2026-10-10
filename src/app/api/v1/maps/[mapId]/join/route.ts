import { NextRequest } from "next/server";
import { getSession, requireCsrf, setSessionCookies } from "@/server/auth/session";
import { failure, ok, readJson, requireSameOrigin, requireUuid } from "@/server/http";
import { recordFailedInviteAttempt, recordInviteAttempt } from "@/server/services/invites";
import { joinMap, joinMapSchema } from "@/server/services/map-joining";

export const runtime = "nodejs";

export async function POST(request: NextRequest, context: { params: Promise<{ mapId: string }> }) {
  let mapId: string | undefined;
  try {
    requireSameOrigin(request);
    mapId = requireUuid((await context.params).mapId);
    const session = await getSession(request);
    if (session) requireCsrf(request, session);
    await recordInviteAttempt(request, mapId);
    const input = joinMapSchema.parse(await readJson(request));
    const joined = await joinMap(mapId, input, session);
    const response = ok({ mapId: joined.mapId, repeated: joined.repeated });
    if (joined.session) setSessionCookies(response, joined.session);
    return response;
  } catch (error) {
    if (mapId) await recordFailedInviteAttempt(request, error, mapId).catch(() => {});
    return failure(error);
  }
}
