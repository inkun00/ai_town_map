import { NextRequest } from "next/server";
import { getSession, requireCsrf, setSessionCookies } from "@/server/auth/session";
import { recordStudentEmailAttempt, recordStudentEmailFailure, studentEmailAuth, studentEmailInput, type StudentEmailInput } from "@/server/auth/email";
import { failure, ok, readJson, requireSameOrigin } from "@/server/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let input: StudentEmailInput | undefined;
  try {
    requireSameOrigin(request);
    const old = await getSession(request);
    if (old) requireCsrf(request, old);
    input = studentEmailInput.parse(await readJson(request));
    await recordStudentEmailAttempt(request, input);
    const result = await studentEmailAuth(input, old);
    const response = ok(result.data);
    if (result.issued) setSessionCookies(response, result.issued);
    return response;
  } catch (error) {
    if (input) await recordStudentEmailFailure(request, input, error).catch(() => {});
    return failure(error);
  }
}
