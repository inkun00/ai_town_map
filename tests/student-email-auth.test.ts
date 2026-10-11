import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { AppSession } from "../src/server/auth/session";

const sdk = vi.hoisted(() => ({ signUp: vi.fn(), signInWithPassword: vi.fn(), getUser: vi.fn(), resend: vi.fn(), createClient: vi.fn(), finishGoogleOAuth: vi.fn(), clearOAuthCookie: vi.fn(), origin: "http://localhost:3001" }));
vi.mock("@supabase/supabase-js", () => ({ createClient: sdk.createClient }));
vi.mock("../src/server/auth/oauth", () => ({ finishGoogleOAuth: sdk.finishGoogleOAuth, clearOAuthCookie: sdk.clearOAuthCookie }));
vi.mock("../src/server/env", () => ({ getServerConfig: () => ({ appOrigin: sdk.origin, supabaseUrl: "https://auth.example.test", supabaseAnonKey: "test-public-key", invitePepper: "student-email-tests-not-real-secret" }) }));
let db: PGlite, queue: Promise<unknown> = Promise.resolve(), authId: string;
const execute = async (sql: string, values: unknown[] = []) => {
  const result = await db.query(sql, values);
  return { ...result, rowCount: result.rows.length || result.affectedRows || 0, rows: result.rows.map(row => Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, value instanceof Uint8Array ? Buffer.from(value) : value]))) };
};
vi.mock("../src/server/db", () => ({ query: async (sql: string, values: unknown[] = []) => (await execute(sql, values)).rows,
  withTransaction: (action: (client: unknown) => unknown) => {
    const next = queue.then(async () => { await db.exec("BEGIN"); try { const result = await action({ query: execute }); await db.exec("COMMIT"); return result; } catch (error) { await db.exec("ROLLBACK"); throw error; } });
    queue = next.catch(() => {}); return next;
  },
}));
import { studentEmailAuth, studentEmailError, studentEmailInput } from "../src/server/auth/email";
import { registerAccount } from "../src/server/services/accounts";
import { issueSession } from "../src/server/auth/session";
import { withTransaction } from "../src/server/db";
import { POST } from "../src/app/api/v1/auth/email/route";
import { GET } from "../src/app/api/v1/auth/callback/route";

const email = "student@example.net", password = "explorer-pass-123";
function user(confirmed = true, id = authId) {
  return { id, email, email_confirmed_at: confirmed ? "2026-10-11T00:00:00Z" : null, identities: [{ provider: "email", user_id: id, id: randomUUID(), identity_id: randomUUID() }], user_metadata: { account_role: "teacher" }, app_metadata: { provider: "email" }, aud: "authenticated", created_at: "2026-10-11T00:00:00Z" };
}
const signup = () => studentEmailInput.parse({ action: "signup", email, password });
const login = () => studentEmailInput.parse({ action: "login", email, password });
function request(body: unknown, origin = sdk.origin, cookie?: string, csrf?: string) {
  return new NextRequest(`${sdk.origin}/api/v1/auth/email`, { method: "POST", headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(csrf ? { "x-csrf-token": csrf } : {}) }, body: JSON.stringify(body) });
}
const count = async (table: string) => (await execute(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count as number;

beforeAll(async () => {
  db = new PGlite(); await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  for (const name of ["001_core.sql", "002_observations.sql", "003_community_moderation.sql", "004_analysis_proposals.sql", "005_retention.sql", "006_exploration_games.sql", "007_account_roles_game_deletion.sql", "008_map_participation_passwords.sql"]) await db.exec(await readFile(`db/migrations/${name}`, "utf8"));
}, 30000);
afterAll(async () => db.close());
beforeEach(() => {
  vi.clearAllMocks(); sdk.origin = "http://localhost:3001"; authId = randomUUID();
  sdk.createClient.mockReturnValue({ auth: { signUp: sdk.signUp, signInWithPassword: sdk.signInWithPassword, getUser: sdk.getUser, resend: sdk.resend } });
  sdk.signUp.mockResolvedValue({ data: { user: user(false), session: null }, error: null });
  sdk.signInWithPassword.mockResolvedValue({ data: { user: user(), session: { access_token: "supabase-secret-access", refresh_token: "supabase-secret-refresh" } }, error: null });
  sdk.getUser.mockResolvedValue({ data: { user: user() }, error: null });
  sdk.resend.mockResolvedValue({ data: { user: null, session: null }, error: null });
});

describe("student-only email registration and server authentication", () => {
  it("normalizes emails, rejects role injection and requires a bounded password without trimming it", () => {
    expect(studentEmailInput.parse({ action: "signup", email: "  Student@Example.Net ", password: " 12345678 " })).toMatchObject({ email, password: " 12345678 " });
    for (const input of [{ ...signup(), role: "teacher" }, { ...signup(), accountRole: "teacher" }, { ...signup(), email: "invalid" }, { ...signup(), password: "1234567" }, { ...signup(), password: "x".repeat(129) }, { action: "resend", email, password }]) expect(studentEmailInput.safeParse(input).success).toBe(false);
  });

  it("reserves the real student role at signup without issuing cookies or sessions and blocks later teacher selection", async () => {
    const sessionsBefore = await count("app_private.sessions"), response = await POST(request(signup()));
    expect(response.status).toBe(200); expect((await response.json()).data.needsConfirmation).toBe(true);
    expect(response.headers.get("set-cookie")).toBeNull(); expect(await count("app_private.sessions")).toBe(sessionsBefore);
    const principal = (await execute("SELECT id,account_role FROM app.principals WHERE auth_user_id=$1", [authId])).rows[0];
    expect(principal.account_role).toBe("student");
    const attempted: AppSession = { id: randomUUID(), principalId: principal.id as string, kind: "account", csrfHash: Buffer.alloc(32), expiresAt: new Date(Date.now() + 10000) };
    await expect(registerAccount(attempted, "teacher")).rejects.toMatchObject({ code: "ROLE_ALREADY_SET" });
    expect(sdk.signUp).toHaveBeenCalledWith({ email, password, options: { emailRedirectTo: `${sdk.origin}/api/v1/auth/callback?email_confirm=1` } });
    expect(sdk.createClient.mock.calls[0][2].auth).toMatchObject({ flowType: "pkce", persistSession: false, autoRefreshToken: false, detectSessionInUrl: false });
  });

  it("does not create phantom principals for duplicate signup fake users or for disabled email confirmation", async () => {
    const principalsBefore = await count("app.principals"), sessionsBefore = await count("app_private.sessions");
    sdk.signUp.mockResolvedValueOnce({ data: { user: { ...user(), identities: [] }, session: null }, error: null });
    expect((await studentEmailAuth(signup(), null)).data.needsConfirmation).toBe(true);
    expect(await count("app.principals")).toBe(principalsBefore);
    sdk.signUp.mockResolvedValueOnce({ data: { user: user(), session: { access_token: "unexpected-secret" } }, error: null });
    await expect(studentEmailAuth(signup(), null)).rejects.toMatchObject({ code: "EMAIL_CONFIRMATION_REQUIRED", status: 503 });
    expect(await count("app.principals")).toBe(principalsBefore); expect(await count("app_private.sessions")).toBe(sessionsBefore);
  });

  it("verifies the access token server-side, assigns only student and returns only app session cookies", async () => {
    sdk.origin = "https://ai-town-map.vercel.app";
    const response = await POST(request({ ...login(), returnTo: "https://outside.example/path" })), body = await response.json();
    expect(response.status).toBe(200); expect(body.data).toEqual({ needsConfirmation: false, returnTo: "/" });
    expect(JSON.stringify(body)).not.toMatch(/supabase-secret|access_token|refresh_token|explorer-pass/);
    expect(sdk.getUser).toHaveBeenCalledWith("supabase-secret-access");
    for (const name of ["__Host-moa_session", "__Host-moa_csrf"]) expect(response.cookies.get(name)).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/" });
    expect((await execute("SELECT account_role FROM app.principals WHERE auth_user_id=$1", [authId])).rows[0].account_role).toBe("student");
  });

  it("never issues a session for unconfirmed, mismatched or fake verified identities", async () => {
    const sessionsBefore = await count("app_private.sessions"), principalsBefore = await count("app.principals");
    for (const [verifiedUser, errorCode] of [[user(false), "EMAIL_NOT_CONFIRMED"], [{ ...user(), email: "another@example.net" }, "EMAIL_CREDENTIALS_INVALID"], [{ ...user(), identities: [] }, "EMAIL_CREDENTIALS_INVALID"], [{ ...user(), identities: [{ ...user().identities[0], user_id: randomUUID() }] }, "EMAIL_CREDENTIALS_INVALID"], [user(true, randomUUID()), "EMAIL_CREDENTIALS_INVALID"]] as const) {
      sdk.getUser.mockResolvedValueOnce({ data: { user: verifiedUser }, error: null });
      await expect(studentEmailAuth(login(), null)).rejects.toMatchObject({ code: errorCode });
    }
    sdk.getUser.mockResolvedValueOnce({ data: { user: null }, error: { code: "bad_jwt" } });
    await expect(studentEmailAuth(login(), null)).rejects.toMatchObject({ code: "EMAIL_CREDENTIALS_INVALID" });
    expect(await count("app_private.sessions")).toBe(sessionsBefore); expect(await count("app.principals")).toBe(principalsBefore);
  });

  it("preserves teacher/member/blocked accounts and their previous sessions when student-only login is denied", async () => {
    for (const [role, status, errorCode] of [["teacher", "active", "STUDENT_EMAIL_ONLY"], ["member", "active", "STUDENT_EMAIL_ONLY"], ["student", "blocked", "ACCOUNT_BLOCKED"]] as const) {
      const id = randomUUID(), linkedId = randomUUID();
      await execute("INSERT INTO app.principals(id,kind,auth_user_id,account_role,status) VALUES($1,'account',$2,$3,$4)", [id, linkedId, role, status]);
      const issued = await withTransaction(client => issueSession(client, id));
      const prior = (await execute("SELECT id,csrf_hash,expires_at FROM app_private.sessions WHERE principal_id=$1", [id])).rows[0];
      const old: AppSession = { id: prior.id as string, principalId: id, kind: "account", accountRole: role, csrfHash: prior.csrf_hash as Buffer, expiresAt: prior.expires_at as Date };
      void issued;
      sdk.signInWithPassword.mockResolvedValueOnce({ data: { user: user(true, linkedId), session: { access_token: "verified-token" } }, error: null });
      sdk.getUser.mockResolvedValueOnce({ data: { user: user(true, linkedId) }, error: null });
      await expect(studentEmailAuth(login(), old)).rejects.toMatchObject({ code: errorCode });
      expect((await execute("SELECT account_role,status FROM app.principals WHERE id=$1", [id])).rows[0]).toEqual({ account_role: role, status });
      expect((await execute("SELECT revoked_at FROM app_private.sessions WHERE id=$1", [old.id])).rows[0]).toEqual({ revoked_at: null });
      expect((await execute("SELECT id FROM app_private.sessions WHERE principal_id=$1", [id])).rows).toHaveLength(1);
    }
  });

  it("sets an existing unset-role account to student before replacing its app session", async () => {
    const id = randomUUID(); await execute("INSERT INTO app.principals(id,kind,auth_user_id) VALUES($1,'account',$2)", [id, authId]);
    const token = await withTransaction(client => issueSession(client, id));
    const cookie = `moa_dev_session=${token.sessionToken}; moa_dev_csrf=${token.csrfToken}`;
    expect((await POST(request(login(), sdk.origin, cookie))).status).toBe(403);
    expect(sdk.signInWithPassword).not.toHaveBeenCalled();
    const response = await POST(request(login(), sdk.origin, cookie, token.csrfToken));
    expect(response.status).toBe(200);
    expect((await execute("SELECT account_role FROM app.principals WHERE id=$1", [id])).rows[0].account_role).toBe("student");
    const rows = (await execute("SELECT revoked_at FROM app_private.sessions WHERE principal_id=$1 ORDER BY expires_at", [id])).rows;
    expect(rows).toHaveLength(2); expect(rows.filter(row => row.revoked_at === null)).toHaveLength(1);
  });

  it("keeps confirmation/resend separate from Google authentication and strips provider tokens from redirects", async () => {
    const sessionsBefore = await count("app_private.sessions");
    const result = await studentEmailAuth(studentEmailInput.parse({ action: "resend", email }), null);
    expect(result).toMatchObject({ data: { needsConfirmation: true }, issued: null });
    expect(sdk.resend).toHaveBeenCalledWith({ type: "signup", email, options: { emailRedirectTo: `${sdk.origin}/api/v1/auth/callback?email_confirm=1` } });
    const response = await GET(new NextRequest(`${sdk.origin}/api/v1/auth/callback?email_confirm=1&code=secret-provider-code&access_token=unsafe#refresh_token=unsafe`));
    expect(response.headers.get("location")).toBe(`${sdk.origin}/account/login?confirmed=1#`); expect(response.headers.get("set-cookie")).toBeNull();
    const expired = await GET(new NextRequest(`${sdk.origin}/api/v1/auth/callback?email_confirm=1&error=access_denied&error_description=secret`));
    expect(expired.headers.get("location")).toBe(`${sdk.origin}/account/login?emailError=1#`);
    expect(sdk.finishGoogleOAuth).not.toHaveBeenCalled(); expect(sdk.clearOAuthCookie).not.toHaveBeenCalled(); expect(await count("app_private.sessions")).toBe(sessionsBefore);
  });

  it("keeps normal Google callback working and honors the reserved student role", async () => {
    await studentEmailAuth(signup(), null);
    sdk.finishGoogleOAuth.mockResolvedValueOnce({ authUserId: authId, returnTo: "/?map=example" });
    const response = await GET(new NextRequest(`${sdk.origin}/api/v1/auth/callback?request=google&code=google-code`));
    expect(response.headers.get("location")).toBe(`${sdk.origin}/?map=example`); expect(response.cookies.get("moa_dev_session")?.httpOnly).toBe(true);
    expect(sdk.finishGoogleOAuth).toHaveBeenCalledOnce(); expect(sdk.clearOAuthCookie).toHaveBeenCalledOnce();
    expect((await execute("SELECT account_role FROM app.principals WHERE auth_user_id=$1", [authId])).rows[0].account_role).toBe("student");
  });

  it("maps SMTP, rate, invalid credential and confirmation errors to safe Korean errors", async () => {
    const errors = [{ code: "email_address_not_authorized", status: 400 }, { code: "unexpected_failure", status: 500 }, { code: "over_email_send_rate_limit", status: 429 }, { code: "invalid_credentials", status: 400 }, { code: "email_not_confirmed", status: 400 }];
    expect(errors.map(error => studentEmailError({ ...error, message: "private@example.net secret-pass private token" }, "login").code)).toEqual(["EMAIL_AUTH_UNAVAILABLE", "EMAIL_AUTH_UNAVAILABLE", "EMAIL_RATE_LIMIT", "EMAIL_CREDENTIALS_INVALID", "EMAIL_NOT_CONFIRMED"]);
    expect(errors.every(error => !studentEmailError(error, "login").message.includes("private"))).toBe(true);
    sdk.signUp.mockResolvedValueOnce({ data: { user: null, session: null }, error: errors[0] });
    const response = await POST(request(signup())); expect(response.status).toBe(503); expect(response.headers.get("set-cookie")).toBeNull();
    expect((await response.json()).error.code).toBe("EMAIL_AUTH_UNAVAILABLE");
  });

  it("rejects foreign origins, non-JSON and forged roles before calling the identity provider", async () => {
    expect((await POST(request(signup(), "https://outside.example"))).status).toBe(403);
    expect((await POST(new NextRequest(`${sdk.origin}/api/v1/auth/email`, { method: "POST", headers: { origin: sdk.origin, "content-type": "text/plain" }, body: "unsafe" }))).status).toBe(415);
    expect((await POST(request({ ...signup(), role: "teacher" }))).status).toBe(422); expect(sdk.createClient).not.toHaveBeenCalled();
  });

  it("blocks repeated failed passwords without blocking an unrelated student's successful login", async () => {
    sdk.signInWithPassword.mockResolvedValue({ data: { user: null, session: null }, error: { code: "invalid_credentials", status: 400 } });
    for (let index = 0; index < 20; index++) expect((await POST(request(login()))).status).toBe(401);
    const rejected = await POST(request(login())); expect(rejected.status).toBe(429); expect(sdk.signInWithPassword).toHaveBeenCalledTimes(20);
    expect((await rejected.json()).error.code).toBe("EMAIL_RATE_LIMIT");
    const otherEmail = "classmate@example.net", otherId = randomUUID(), other = { ...user(true, otherId), email: otherEmail };
    sdk.signInWithPassword.mockResolvedValueOnce({ data: { user: other, session: { access_token: "classmate-token" } }, error: null }); sdk.getUser.mockResolvedValueOnce({ data: { user: other }, error: null });
    expect((await POST(request({ action: "login", email: otherEmail, password }))).status).toBe(200);
  });
});
