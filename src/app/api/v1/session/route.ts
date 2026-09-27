import { NextRequest } from "next/server";
import { csrfTokenFromCookie, getSession, requireCsrf, requireSession, revokeSession, clearSessionCookies } from "@/server/auth/session";
import { failure, noContent, ok } from "@/server/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const session = await getSession(request);
    return ok(session ? { kind: session.kind, expiresAt: session.expiresAt, csrfToken: csrfTokenFromCookie(request, session) } : null);
  } catch (error) { return failure(error); }
}

export async function DELETE(request: NextRequest) {
  try {
    const session = requireSession(await getSession(request));
    requireCsrf(request, session);
    await revokeSession(session.id);
    const response = noContent();
    clearSessionCookies(response);
    return response;
  } catch (error) { return failure(error); }
}
