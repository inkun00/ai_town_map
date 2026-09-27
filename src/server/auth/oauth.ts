import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { NextRequest, NextResponse } from "next/server";
import { getServerConfig } from "../env";
import { ApiError } from "../http";

type OAuthState = { requestId: string; returnTo: string; storage: Record<string, string> };

function cookieName() { return getServerConfig().appOrigin.startsWith("https://") ? "__Host-moa_oauth" : "moa_dev_oauth"; }
function signature(payload: string) { return createHmac("sha256", getServerConfig().invitePepper).update(payload).digest(); }

function seal(value: OAuthState): string {
  const payload = Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${payload}.${signature(payload).toString("base64url")}`;
}

function unseal(raw: string | undefined): OAuthState | null {
  if (!raw) return null;
  const [payload, mac] = raw.split(".");
  if (!payload || !mac) return null;
  const actual = Buffer.from(mac, "base64url");
  const expected = signature(payload);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  try {
    const parsed = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as OAuthState;
    return typeof parsed.requestId === "string" && typeof parsed.returnTo === "string" && parsed.storage && typeof parsed.storage === "object" ? parsed : null;
  } catch { return null; }
}

function oauthClient(storage: Record<string, string>) {
  const config = getServerConfig();
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: {
      flowType: "pkce",
      storageKey: "moa-oauth",
      persistSession: true,
      autoRefreshToken: false,
      detectSessionInUrl: false,
      storage: {
        getItem: (key) => storage[key] ?? null,
        setItem: (key, value) => { storage[key] = value; },
        removeItem: (key) => { delete storage[key]; },
      },
    },
  });
}

export async function beginGoogleOAuth(returnTo: string) {
  const config = getServerConfig();
  const requestId = randomBytes(24).toString("base64url");
  const storage: Record<string, string> = {};
  const supabase = oauthClient(storage);
  const redirectTo = `${config.appOrigin}/api/v1/auth/callback?request=${requestId}`;
  const { data, error } = await supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo, skipBrowserRedirect: true } });
  if (error || !data.url) throw new ApiError(503, "OAUTH_UNAVAILABLE", "Google 로그인을 시작할 수 없습니다.");
  return { url: data.url, cookie: seal({ requestId, returnTo, storage }) };
}

export async function finishGoogleOAuth(request: NextRequest) {
  const state = unseal(request.cookies.get(cookieName())?.value);
  const requestId = request.nextUrl.searchParams.get("request");
  const code = request.nextUrl.searchParams.get("code");
  const flowId = request.nextUrl.searchParams.get("sb_flow_id");
  if (!state || !requestId || requestId !== state.requestId || !code) throw new ApiError(400, "OAUTH_STATE_INVALID", "로그인을 다시 시작해 주세요.");
  const supabase = oauthClient({ ...state.storage });
  const { data, error } = await supabase.auth.exchangeCodeForSession(code, flowId ? { flowId } : undefined);
  if (error || !data.session?.access_token) throw new ApiError(400, "OAUTH_EXCHANGE_FAILED", "Google 로그인을 다시 시도해 주세요.");
  const verified = await supabase.auth.getUser(data.session.access_token);
  if (verified.error || !verified.data.user?.id) throw new ApiError(400, "OAUTH_USER_INVALID", "계정을 확인할 수 없습니다.");
  return { authUserId: verified.data.user.id, returnTo: state.returnTo };
}

export function setOAuthCookie(response: NextResponse, value: string) {
  const secure = getServerConfig().appOrigin.startsWith("https://");
  response.cookies.set(cookieName(), value, { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 600 });
}

export function clearOAuthCookie(response: NextResponse) {
  const secure = getServerConfig().appOrigin.startsWith("https://");
  response.cookies.set(cookieName(), "", { httpOnly: true, secure, sameSite: "lax", path: "/", maxAge: 0 });
}
