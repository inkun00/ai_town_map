import { NextRequest, NextResponse } from "next/server";
import { withTransaction } from "@/server/db";
import { getServerConfig } from "@/server/env";
import { clearOAuthCookie, finishGoogleOAuth } from "@/server/auth/oauth";
import { getSession, issueSession, setSessionCookies } from "@/server/auth/session";
import { ApiError, safeReturnTo } from "@/server/http";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  const origin = getServerConfig().appOrigin;
  try {
    const { authUserId, returnTo } = await finishGoogleOAuth(request);
    const old = await getSession(request);
    const issued = await withTransaction(async (client) => {
      const principal = await client.query<{ id: string; status: string; account_role:string|null }>(`INSERT INTO app.principals(kind,auth_user_id) VALUES('account',$1)
        ON CONFLICT(auth_user_id) DO UPDATE SET auth_user_id=EXCLUDED.auth_user_id RETURNING id,status,account_role`, [authUserId]);
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
