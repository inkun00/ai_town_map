import { NextRequest } from "next/server";
import { getSession, requireCsrf, setSessionCookies } from "@/server/auth/session";
import { failure, ok, readJson, requireSameOrigin } from "@/server/http";
import { recordInviteAttempt, redeemInvite, redeemSchema } from "@/server/services/invites";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  try {
    requireSameOrigin(request);
    await recordInviteAttempt(request);
    const session = await getSession(request);
    if (session) requireCsrf(request, session);
    const input = redeemSchema.parse(await readJson(request));
    const joined = await redeemInvite(input, session);
    const response = ok({ mapId: joined.mapId, repeated: joined.repeated });
    if (joined.session) setSessionCookies(response, joined.session);
    return response;
  } catch (error) { return failure(error); }
}
