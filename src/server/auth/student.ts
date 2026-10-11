import "server-only";
import { createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { query, withTransaction } from "@/server/db";
import { getServerConfig } from "@/server/env";
import { ApiError, safeReturnTo } from "@/server/http";
import { inviteAttemptActor } from "@/server/policies/invite-attempts";
import { recordInviteAttempt } from "@/server/services/invites";
import { issueSession, type AppSession } from "./session";

const identifier = z.string().trim().pipe(z.email().max(254)).transform(value => value.toLowerCase());
const password = z.string().min(8).max(128).refine(value => value.trim().length > 0);
const returnTo = z.string().max(2000).optional();
export const studentIdInput = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("signup"), identifier, password, returnTo }),
  z.strictObject({ action: z.literal("login"), identifier, password, returnTo }),
]);
export type StudentIdInput = z.infer<typeof studentIdInput>;

const SCRYPT = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 } as const;
const dummySalt = randomBytes(32), dummyHash = randomBytes(32);
function derive(secret: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(secret, salt, 32, SCRYPT, (error, key) => error ? reject(error) : resolve(key));
  });
}
function credentialsInvalid() { return new ApiError(401, "STUDENT_CREDENTIALS_INVALID", "학생 아이디와 비밀번호를 확인해 주세요."); }

function failureBucket(request: NextRequest, value: string) {
  const actor = inviteAttemptActor(request.headers, process.env);
  if (actor === undefined) throw new ApiError(503, "STUDENT_LIMIT_NOT_CONFIGURED", "학생 로그인을 준비 중입니다.");
  return createHmac("sha256", getServerConfig().invitePepper).update(`student-id-credentials:${actor}:${value}`).digest();
}

export async function recordStudentIdAttempt(request: NextRequest, input: StudentIdInput) {
  // A school class shares one network; its total request budget is separate from failed credentials.
  await recordInviteAttempt(request, "student-id-auth");
  if (input.action === "login") {
    const rows = await query<{ attempts: number }>("SELECT attempts FROM app_private.invite_attempts WHERE actor_hash=$1 AND window_start>now()-interval '10 minutes'", [failureBucket(request, input.identifier)]);
    if ((rows[0]?.attempts ?? 0) >= 20) throw new ApiError(429, "STUDENT_RATE_LIMIT", "로그인 시도가 여러 번 실패했습니다. 잠시 후 다시 시도해 주세요.");
  }
}

export async function recordStudentIdFailure(request: NextRequest, input: StudentIdInput, error: unknown) {
  if (input.action !== "login" || !(error instanceof ApiError) || error.code !== "STUDENT_CREDENTIALS_INVALID") return;
  await query(`INSERT INTO app_private.invite_attempts(actor_hash,window_start,attempts) VALUES($1,now(),1)
    ON CONFLICT(actor_hash) DO UPDATE SET
    attempts=CASE WHEN app_private.invite_attempts.window_start<now()-interval '10 minutes' THEN 1 ELSE app_private.invite_attempts.attempts+1 END,
    window_start=CASE WHEN app_private.invite_attempts.window_start<now()-interval '10 minutes' THEN now() ELSE app_private.invite_attempts.window_start END`, [failureBucket(request, input.identifier)]);
}

type Credential = {
  principal_id: string; identifier: string; salt: Buffer; password_hash: Buffer;
  algorithm: string; scrypt_n: number; scrypt_r: number; scrypt_p: number;
  kind: string; auth_source: string; auth_user_id: string | null; account_role: string | null; status: string;
};
const credentialSelect = `SELECT c.principal_id,c.identifier,c.salt,c.password_hash,c.algorithm,c.scrypt_n,c.scrypt_r,c.scrypt_p,
  p.kind,p.auth_source,p.auth_user_id,p.account_role,p.status
  FROM app_private.student_credentials c JOIN app.principals p ON p.id=c.principal_id WHERE c.identifier=$1`;

function localStudent(row: Credential | undefined): row is Credential {
  return !!row && row.kind === "account" && row.auth_source === "student_id" && row.auth_user_id === null && row.account_role === "student"
    && row.algorithm === "scrypt-v1" && row.scrypt_n === SCRYPT.N && row.scrypt_r === SCRYPT.r && row.scrypt_p === SCRYPT.p
    && row.salt.length === 32 && row.password_hash.length === 32;
}

/** This identity is local and never looked up by, linked to, or sent to an email/Google provider. */
export async function studentIdAuth(input: StudentIdInput, old: AppSession | null) {
  const parsed = studentIdInput.parse(input), next = safeReturnTo(parsed.returnTo ?? null);
  if (parsed.action === "signup") {
    const salt = randomBytes(32), hash = await derive(parsed.password, salt);
    try {
      const issued = await withTransaction(async client => {
        const principal = await client.query<{ id: string }>(`INSERT INTO app.principals(kind,auth_source,account_role)
          VALUES('account','student_id','student') RETURNING id`);
        const id = principal.rows[0].id;
        await client.query(`INSERT INTO app_private.student_credentials(principal_id,identifier,salt,password_hash)
          VALUES($1,$2,$3,$4)`, [id, parsed.identifier, salt, hash]);
        const session = await issueSession(client, id);
        if (old) await client.query("UPDATE app_private.sessions SET revoked_at=now() WHERE id=$1 AND principal_id=$2", [old.id, old.principalId]);
        return session;
      });
      return { data: { needsConfirmation: false, returnTo: next }, issued };
    } catch (error) {
      const databaseError = error as { code?: string; constraint?: string };
      if (databaseError?.code === "23505" && databaseError.constraint === "student_credentials_identifier_key") throw new ApiError(409, "STUDENT_IDENTIFIER_TAKEN", "이미 사용 중인 학생 아이디입니다. 다른 아이디를 정하거나 로그인해 주세요.");
      throw error;
    }
  }
  const stored = (await query<Credential>(credentialSelect, [parsed.identifier]))[0];
  const candidate = await derive(parsed.password, localStudent(stored) ? stored.salt : dummySalt);
  const matches = timingSafeEqual(candidate, localStudent(stored) ? stored.password_hash : dummyHash);
  if (!localStudent(stored) || !matches) throw credentialsInvalid();
  const issued = await withTransaction(async client => {
    const locked = (await client.query<Credential>(`${credentialSelect} FOR UPDATE OF p,c`, [parsed.identifier])).rows[0];
    // Re-check identity and hash under lock before replacing a valid existing app session.
    if (!localStudent(locked) || locked.principal_id !== stored.principal_id || !timingSafeEqual(candidate, locked.password_hash)) throw credentialsInvalid();
    if (locked.status !== "active") throw new ApiError(403, "ACCOUNT_BLOCKED", "이 계정은 사용할 수 없습니다.");
    const session = await issueSession(client, locked.principal_id);
    if (old) await client.query("UPDATE app_private.sessions SET revoked_at=now() WHERE id=$1 AND principal_id=$2", [old.id, old.principalId]);
    return session;
  });
  return { data: { needsConfirmation: false, returnTo: next }, issued };
}
