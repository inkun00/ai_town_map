import { NextRequest, NextResponse } from "next/server";
import { beginGoogleOAuth, setOAuthCookie } from "@/server/auth/oauth";
import { ApiError, failure, safeReturnTo } from "@/server/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const roles = request.nextUrl.searchParams.getAll("role");
    if (roles.length > 1 || (roles.length === 1 && roles[0] !== "teacher" && roles[0] !== "student")) throw new ApiError(422, "REGISTRATION_ROLE_INVALID", "교사 또는 학생을 선택해 주세요.");
    const registrationRole = roles[0] as "teacher" | "student" | undefined;
    const { url, cookie } = await beginGoogleOAuth(safeReturnTo(request.nextUrl.searchParams.get("returnTo")), registrationRole);
    const response = NextResponse.redirect(url);
    response.headers.set("Cache-Control", "no-store");
    setOAuthCookie(response, cookie);
    return response;
  } catch (error) { return failure(error); }
}
