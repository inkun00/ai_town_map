import { NextRequest } from "next/server";
import { getSession, requireCsrf, setSessionCookies } from "@/server/auth/session";
import { recordStudentIdAttempt, recordStudentIdFailure, studentIdAuth, studentIdInput, type StudentIdInput } from "@/server/auth/student";
import { failure, ok, readJson, requireSameOrigin } from "@/server/http";

export const runtime = "nodejs";

export async function POST(request: NextRequest) {
  let input: StudentIdInput | undefined;
  try {
    requireSameOrigin(request);
    const old = await getSession(request);
    if (old) requireCsrf(request, old);
    input = studentIdInput.parse(await readJson(request));
    await recordStudentIdAttempt(request, input);
    const result = await studentIdAuth(input, old);
    const response = ok(result.data);
    setSessionCookies(response, result.issued);
    return response;
  } catch (error) {
    if (input) await recordStudentIdFailure(request, input, error).catch(() => {});
    return failure(error);
  }
}
