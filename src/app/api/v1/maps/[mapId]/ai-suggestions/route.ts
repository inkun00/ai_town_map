import { NextRequest } from "next/server";
import { aiSuggestionInputSchema } from "@/domain/ai-analysis";
import { getSession, requireCsrf, requireSession } from "@/server/auth/session";
import { failure, ok, readJson, requireUuid } from "@/server/http";
import { createAiSuggestions, getAiAvailability } from "@/server/services/ai-suggestions";

export const runtime = "nodejs";
export const maxDuration = 60;
type Context = { params: Promise<{ mapId: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const { mapId } = await params;
    return ok(await getAiAvailability(requireUuid(mapId), requireSession(await getSession(request))));
  } catch (error) { return failure(error); }
}

export async function POST(request: NextRequest, { params }: Context) {
  try {
    const { mapId } = await params;
    const session = requireSession(await getSession(request));
    requireCsrf(request, session);
    return ok(await createAiSuggestions(requireUuid(mapId), session, aiSuggestionInputSchema.parse(await readJson(request)), request.signal));
  } catch (error) { return failure(error); }
}
