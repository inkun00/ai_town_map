import "server-only";
import { createHmac, randomUUID } from "node:crypto";
import { createClient, type User } from "@supabase/supabase-js";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getServerConfig } from "@/server/env";
import { query, withTransaction } from "@/server/db";
import { ApiError, safeReturnTo } from "@/server/http";
import { issueSession, type AppSession } from "./session";
import { studentEmailPrincipal } from "@/server/services/accounts";
import { recordInviteAttempt } from "@/server/services/invites";
import { inviteAttemptActor } from "@/server/policies/invite-attempts";

const email = z.email().max(254).transform(value => value.toLowerCase());
const password = z.string().min(8).max(128);
const returnTo = z.string().max(2000).optional();
export const studentEmailInput = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("signup"), email: z.string().trim().pipe(email), password, returnTo }),
  z.strictObject({ action: z.literal("login"), email: z.string().trim().pipe(email), password, returnTo }),
  z.strictObject({ action: z.literal("resend"), email: z.string().trim().pipe(email), returnTo }),
]);
export type StudentEmailInput = z.infer<typeof studentEmailInput>;

function emailClient() {
  const config = getServerConfig(), storage: Record<string, string> = {};
  return createClient(config.supabaseUrl, config.supabaseAnonKey, {
    auth: { flowType: "pkce", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false, storageKey: `moa-email-${randomUUID()}`,
      storage: { getItem: key => storage[key] ?? null, setItem: (key, value) => { storage[key] = value; }, removeItem: key => { delete storage[key]; } } },
  });
}

function realEmailIdentity(user: User | null, expectedEmail: string): user is User {
  return !!user && z.uuid().safeParse(user.id).success && user.email?.toLowerCase() === expectedEmail
    && !!user.identities?.some(identity => identity.provider === "email" && identity.user_id === user.id);
}

export function studentEmailError(error: unknown, action: StudentEmailInput["action"]): ApiError {
  const upstream = error && typeof error === "object" ? error as { code?: string; status?: number } : {};
  if (upstream.status === 429 || ["over_request_rate_limit", "over_email_send_rate_limit"].includes(upstream.code ?? "")) return new ApiError(429, "EMAIL_RATE_LIMIT", "요청이 많습니다. 잠시 후 다시 시도해 주세요.");
  if (upstream.code === "email_not_confirmed") return new ApiError(403, "EMAIL_NOT_CONFIRMED", "받은 확인 메일의 링크를 누른 뒤 로그인해 주세요.");
  if (upstream.code === "user_banned") return new ApiError(403, "ACCOUNT_BLOCKED", "이 계정은 사용할 수 없습니다.");
  if (upstream.code === "weak_password") return new ApiError(422, "EMAIL_PASSWORD_WEAK", "비밀번호를 8자 이상으로 더 안전하게 정해 주세요.");
  if (["email_address_invalid", "validation_failed"].includes(upstream.code ?? "")) return new ApiError(422, "EMAIL_INVALID", "이메일 주소를 확인해 주세요.");
  if (["email_address_not_authorized", "email_provider_disabled", "signup_disabled", "unexpected_failure"].includes(upstream.code ?? "") || (upstream.status ?? 0) >= 500) return new ApiError(503, "EMAIL_AUTH_UNAVAILABLE", "이메일 가입을 준비 중이거나 확인 메일을 보내지 못했습니다. 선생님에게 알려 주세요.");
  return action === "login" ? new ApiError(401, "EMAIL_CREDENTIALS_INVALID", "이메일과 비밀번호를 확인해 주세요.") : new ApiError(503, "EMAIL_AUTH_UNAVAILABLE", "확인 메일을 보내지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

function failureBucket(request: NextRequest, address: string) {
  const actor = inviteAttemptActor(request.headers, process.env);
  if (actor === undefined) throw new ApiError(503, "EMAIL_LIMIT_NOT_CONFIGURED", "이메일 로그인을 준비 중입니다.");
  return createHmac("sha256", getServerConfig().invitePepper).update(`email-credentials:${actor}:${address}`).digest();
}

export async function recordStudentEmailAttempt(request: NextRequest, input: StudentEmailInput) {
  // Existing trusted-IP limiter permits a school class to register from one Wi-Fi connection.
  await recordInviteAttempt(request, "student-email-auth");
  if (input.action === "login") {
    const failures = await query<{ attempts: number }>("SELECT attempts FROM app_private.invite_attempts WHERE actor_hash=$1 AND window_start>now()-interval '10 minutes'", [failureBucket(request, input.email)]);
    if ((failures[0]?.attempts ?? 0) >= 20) throw new ApiError(429, "EMAIL_RATE_LIMIT", "로그인 시도가 여러 번 실패했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

export async function recordStudentEmailFailure(request: NextRequest, input: StudentEmailInput, error: unknown) {
  if (input.action !== "login" || !(error instanceof ApiError) || !["EMAIL_CREDENTIALS_INVALID", "EMAIL_NOT_CONFIRMED"].includes(error.code)) return;
  await query(`INSERT INTO app_private.invite_attempts(actor_hash,window_start,attempts) VALUES($1,now(),1)
    ON CONFLICT(actor_hash) DO UPDATE SET
    attempts=CASE WHEN app_private.invite_attempts.window_start<now()-interval '10 minutes' THEN 1 ELSE app_private.invite_attempts.attempts+1 END,
    window_start=CASE WHEN app_private.invite_attempts.window_start<now()-interval '10 minutes' THEN now() ELSE app_private.invite_attempts.window_start END`, [failureBucket(request, input.email)]);
}

export async function studentEmailAuth(input: StudentEmailInput, old: AppSession | null) {
  const parsed = studentEmailInput.parse(input), supabase = emailClient();
  const callback = `${getServerConfig().appOrigin}/api/v1/auth/callback?email_confirm=1`;
  const next = safeReturnTo(parsed.returnTo ?? null);
  if (parsed.action === "signup") {
    const { data, error } = await supabase.auth.signUp({ email: parsed.email, password: parsed.password, options: { emailRedirectTo: callback } });
    if (error) throw studentEmailError(error, parsed.action);
    if (!data.user) throw new ApiError(503, "EMAIL_AUTH_UNAVAILABLE", "확인 메일을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    if (data.session) throw new ApiError(503, "EMAIL_CONFIRMATION_REQUIRED", "학생 회원가입의 이메일 확인 설정이 필요합니다. 선생님에게 알려 주세요.");
    // Supabase intentionally returns a fake user with no identities for duplicate confirmed signups.
    // Reserving that fake UUID would create phantom accounts; only genuine email identities are reserved.
    if (realEmailIdentity(data.user, parsed.email)) await withTransaction(client => studentEmailPrincipal(client, data.user!.id));
    return { data: { needsConfirmation: true, returnTo: next, message: "받은 확인 메일의 링크를 누른 뒤 이메일과 비밀번호로 로그인해 주세요. 이미 가입했다면 로그인해 주세요." }, issued: null };
  }
  if (parsed.action === "resend") {
    const { error } = await supabase.auth.resend({ type: "signup", email: parsed.email, options: { emailRedirectTo: callback } });
    if (error) throw studentEmailError(error, parsed.action);
    return { data: { needsConfirmation: true, returnTo: next, message: "가입한 이메일이라면 확인 메일을 다시 받을 수 있어요. 받은 편지함과 스팸함을 확인해 주세요." }, issued: null };
  }
  const { data, error } = await supabase.auth.signInWithPassword({ email: parsed.email, password: parsed.password });
  if (error) throw studentEmailError(error, parsed.action);
  if (!data.session?.access_token) throw new ApiError(401, "EMAIL_CREDENTIALS_INVALID", "이메일과 비밀번호를 확인해 주세요.");
  const verified = await supabase.auth.getUser(data.session.access_token);
  if (verified.error || !realEmailIdentity(verified.data.user, parsed.email) || data.user?.id !== verified.data.user.id) throw new ApiError(401, "EMAIL_CREDENTIALS_INVALID", "이메일과 비밀번호를 확인해 주세요.");
  if (!verified.data.user.email_confirmed_at) throw new ApiError(403, "EMAIL_NOT_CONFIRMED", "받은 확인 메일의 링크를 누른 뒤 로그인해 주세요.");
  const issued = await withTransaction(async client => {
    const principal = await studentEmailPrincipal(client, verified.data.user!.id);
    if (old) await client.query("UPDATE app_private.sessions SET revoked_at=now() WHERE id=$1", [old.id]);
    return issueSession(client, principal.id);
  });
  return { data: { needsConfirmation: false, returnTo: next }, issued };
}
