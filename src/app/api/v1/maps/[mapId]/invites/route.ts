import { NextRequest } from "next/server";
import { getSession, requireCsrf, requireSession } from "@/server/auth/session";
import { failure, ok, readJson, requireUuid } from "@/server/http";
import { createInvite, createInviteSchema, listInvites } from "@/server/services/invites";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ mapId: string }> }) {
  try {
    const { mapId } = await context.params;
    return ok(await listInvites(requireUuid(mapId), requireSession(await getSession(request))));
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest, context: { params: Promise<{ mapId: string }> }) {
  try {
    const session = requireSession(await getSession(request));
    requireCsrf(request, session);
    const { mapId } = await context.params;
    const input = createInviteSchema.parse(await readJson(request));
    return ok(await createInvite(requireUuid(mapId), session, input), 201);
  } catch (error) { return failure(error); }
}
