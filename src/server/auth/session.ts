import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import type { PoolClient } from "pg";
import { query } from "../db";
import { getServerConfig } from "../env";
import { ApiError, requireSameOrigin } from "../http";

const SESSION_SECONDS = 7 * 24 * 60 * 60;

function cookieNames() {
  const secure = getServerConfig().appOrigin.startsWith("https://");
  return { secure, session: secure ? "__Host-moa_session" : "moa_dev_session", csrf: secure ? "__Host-moa_csrf" : "moa_dev_csrf" };
}

function token() { return randomBytes(32).toString("base64url"); }
function hash(value: string) { return createHash("sha256").update(value).digest(); }

export type AppSession = {
  id: string;
  principalId: string;
  kind: "account" | "guest";
  accountRole?: import("@/domain/account").AccountRole | null;
  csrfHash: Buffer;
  expiresAt: Date;
};

export async function getSession(request: NextRequest): Promise<AppSession | null> {
  const raw = request.cookies.get(cookieNames().session)?.value;
  if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  const rows = await query<{ id: string; principal_id: string; kind: "account" | "guest"; account_role: import("@/domain/account").AccountRole|null; csrf_hash: Buffer; expires_at: Date }>(
    `SELECT s.id, s.principal_id, p.kind, p.account_role, s.csrf_hash, s.expires_at
       FROM app_private.sessions s JOIN app.principals p ON p.id = s.principal_id
      WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND p.status = 'active'`, [hash(raw)]);
  const row = rows[0];
  return row ? { id: row.id, principalId: row.principal_id, kind: row.kind, accountRole:row.account_role, csrfHash: row.csrf_hash, expiresAt: row.expires_at } : null;
}

export function requireSession(session: AppSession | null): AppSession {
  if (!session) throw new ApiError(401, "LOGIN_REQUIRED", "로그인이 필요합니다.");
  return session;
}

export function csrfTokenFromCookie(request: NextRequest, session: AppSession): string | null {
  const raw = request.cookies.get(cookieNames().csrf)?.value;
  if (!raw || !/^[A-Za-z0-9_-]{43}$/.test(raw)) return null;
  const digest = hash(raw);
  return timingSafeEqual(digest, session.csrfHash) ? raw : null;
}

export function requireCsrf(request: NextRequest, session: AppSession): void {
  requireSameOrigin(request);
  const cookieToken = csrfTokenFromCookie(request, session);
  const headerToken = request.headers.get("x-csrf-token");
  if (!cookieToken || !headerToken || headerToken !== cookieToken) throw new ApiError(403, "CSRF_INVALID", "요청을 다시 시작해 주세요.");
}

export async function issueSession(client: PoolClient, principalId: string) {
  const sessionToken = token();
  const csrfToken = token();
  const rows = await client.query<{ id: string; expires_at: Date }>(
    `INSERT INTO app_private.sessions(principal_id, token_hash, csrf_hash, expires_at)
     VALUES($1,$2,$3,now() + interval '7 days') RETURNING id, expires_at`,
    [principalId, hash(sessionToken), hash(csrfToken)]);
  return { sessionToken, csrfToken, expiresAt: rows.rows[0].expires_at };
}

export function setSessionCookies(response: NextResponse, issued: { sessionToken: string; csrfToken: string }) {
  const names = cookieNames();
  const options = { httpOnly: true, secure: names.secure, sameSite: "lax" as const, path: "/", maxAge: SESSION_SECONDS };
  response.cookies.set(names.session, issued.sessionToken, options);
  response.cookies.set(names.csrf, issued.csrfToken, options);
}

export function clearSessionCookies(response: NextResponse) {
  const names = cookieNames();
  for (const name of [names.session, names.csrf]) response.cookies.set(name, "", { httpOnly: true, secure: names.secure, sameSite: "lax", path: "/", maxAge: 0 });
}

export async function revokeSession(id: string) {
  await query("UPDATE app_private.sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [id]);
}
