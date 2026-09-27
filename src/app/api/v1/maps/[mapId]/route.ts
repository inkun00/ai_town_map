import { NextRequest } from "next/server";
import { getSession } from "@/server/auth/session";
import { failure, ok, requireUuid } from "@/server/http";
import { getMap } from "@/server/services/maps";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ mapId: string }> }) {
  try {
    const { mapId } = await context.params;
    return ok(await getMap(requireUuid(mapId), await getSession(request)));
  } catch (error) { return failure(error); }
}
