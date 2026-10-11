import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/server/db";
import { getServerConfig } from "@/server/env";
import { clearOAuthCookie, finishGoogleOAuth } from "@/server/auth/oauth";
import { getSession, issueSession, setSessionCookies } from "@/server/auth/session";
import { ApiError, safeReturnTo } from "@/server/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const origin = getServerConfig().appOrigin;
  if(request.nextUrl.searchParams.get("email_confirm")==="1"){
    const failed=request.nextUrl.searchParams.has("error")||request.nextUrl.searchParams.has("error_code");
    // The email link only confirms the Supabase email. Login requires password verification afterwards.
    // An explicit empty fragment prevents the browser from inheriting any provider tokens from the source URL.
    const response=NextResponse.redirect(new URL(`/account/login?${failed?"emailError=1":"confirmed=1"}#`,origin));
    response.headers.set("Cache-Control","no-store");
    response.headers.set("Referrer-Policy","no-referrer");
    return response;
  }
  try {
    const { authUserId, returnTo, registrationRole } = await finishGoogleOAuth(request);
    const old = await getSession(request);
    const issued = await withTransaction(async (client) => {
      // Only the signed OAuth state may select a new account's role. Existing roles remain immutable.
      const principal = await client.query<{ id: string; status: string; account_role:string|null }>(`INSERT INTO app.principals(kind,auth_user_id,account_role) VALUES('account',$1,$2)
        ON CONFLICT(auth_user_id) DO UPDATE SET account_role=coalesce(app.principals.account_role,EXCLUDED.account_role) RETURNING id,status,account_role`, [authUserId, registrationRole ?? null]);
      if (principal.rows[0].status !== "active") throw new ApiError(403, "ACCOUNT_BLOCKED", "이 계정은 사용할 수 없습니다.");
      if (old) await client.query("UPDATE app_private.sessions SET revoked_at=now() WHERE id=$1", [old.id]);
      return {...await issueSession(client, principal.rows[0].id), needsRegistration:!principal.rows[0].account_role};
    });
    const response = NextResponse.redirect(new URL(issued.needsRegistration?`/account/setup?returnTo=${encodeURIComponent(safeReturnTo(returnTo))}`:safeReturnTo(returnTo), origin));
    response.headers.set("Cache-Control", "no-store");
    clearOAuthCookie(response);
    setSessionCookies(response, issued);
    return response;
  } catch {
    const response = NextResponse.redirect(new URL("/?authError=1", origin));
    response.headers.set("Cache-Control", "no-store");
    clearOAuthCookie(response);
    return response;
  }
}
