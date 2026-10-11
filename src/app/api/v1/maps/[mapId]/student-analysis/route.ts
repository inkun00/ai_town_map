import { NextRequest } from "next/server";
import { studentAnalysisInputSchema } from "@/domain/ai-analysis";
import { getSession, requireCsrf, requireSession } from "@/server/auth/session";
import { failure, ok, readJson, requireUuid } from "@/server/http";
import { getStudentAnalysis, saveStudentAnalysis } from "@/server/services/student-analysis";

export const runtime = "nodejs";
type Context = { params: Promise<{ mapId: string }> };

export async function GET(request: NextRequest, { params }: Context) {
  try {
    const { mapId } = await params;
    return ok(await getStudentAnalysis(requireUuid(mapId), requireSession(await getSession(request))));
  } catch (error) { return failure(error); }
}

export async function PUT(request: NextRequest, { params }: Context) {
  try {
    const { mapId } = await params;
    const session = requireSession(await getSession(request));
    requireCsrf(request, session);
    return ok(await saveStudentAnalysis(requireUuid(mapId), session, studentAnalysisInputSchema.parse(await readJson(request))));
  } catch (error) { return failure(error); }
}
