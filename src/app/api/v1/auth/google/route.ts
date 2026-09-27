import { NextRequest, NextResponse } from "next/server";
import { beginGoogleOAuth, setOAuthCookie } from "@/server/auth/oauth";
import { failure, safeReturnTo } from "@/server/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const { url, cookie } = await beginGoogleOAuth(safeReturnTo(request.nextUrl.searchParams.get("returnTo")));
    const response = NextResponse.redirect(url);
    response.headers.set("Cache-Control", "no-store");
    setOAuthCookie(response, cookie);
    return response;
  } catch (error) { return failure(error); }
}
