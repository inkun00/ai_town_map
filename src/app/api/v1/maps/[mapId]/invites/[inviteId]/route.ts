import { NextRequest } from "next/server";
import { getSession, requireCsrf, requireSession } from "@/server/auth/session";
import { failure, noContent, requireUuid } from "@/server/http";
import { revokeInvite } from "@/server/services/invites";

export const runtime = "nodejs";

export async function DELETE(request: NextRequest, context: { params: Promise<{ mapId: string; inviteId: string }> }) {
  try {
    const session = requireSession(await getSession(request));
    requireCsrf(request, session);
    const { mapId, inviteId } = await context.params;
    await revokeInvite(requireUuid(mapId), requireUuid(inviteId), session);
    return noContent();
  } catch (error) { return failure(error); }
}
