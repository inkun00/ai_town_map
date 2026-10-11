import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { AppSession } from "../src/server/auth/session";

const configuration = vi.hoisted(() => ({ origin: "http://localhost:3001", createClient: vi.fn() }));
vi.mock("@supabase/supabase-js", () => ({ createClient: configuration.createClient }));
vi.mock("../src/server/env", () => ({ getServerConfig: () => ({ appOrigin: configuration.origin, invitePepper: "student-id-tests-not-a-real-secret" }) }));
let db: PGlite, queue: Promise<unknown> = Promise.resolve(), identifier: string;
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
import { recordStudentIdAttempt, studentIdAuth, studentIdInput } from "../src/server/auth/student";
import { requireTeacher, registerAccount } from "../src/server/services/accounts";
import { getSession, issueSession } from "../src/server/auth/session";
import { withTransaction } from "../src/server/db";
import { POST } from "../src/app/api/v1/auth/student/route";

const password = "explorer-password-123";
const signup = () => studentIdInput.parse({ action: "signup", identifier, password });
const login = () => studentIdInput.parse({ action: "login", identifier, password });
function request(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`${configuration.origin}/api/v1/auth/student`, { method: "POST", headers: { origin: configuration.origin, "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
}
function cookies(issued: { sessionToken: string; csrfToken: string }) { return `moa_dev_session=${issued.sessionToken}; moa_dev_csrf=${issued.csrfToken}`; }
const count = async (table: string) => (await execute(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count as number;
async function stored() { return (await execute("SELECT c.*,p.auth_user_id,p.auth_source,p.account_role,p.status FROM app_private.student_credentials c JOIN app.principals p ON p.id=c.principal_id WHERE c.identifier=$1", [identifier])).rows[0]; }
async function priorSession(): Promise<{ old: AppSession; issued: Awaited<ReturnType<typeof issueSession>> }> {
  const principalId = randomUUID(); await execute("INSERT INTO app.principals(id,kind) VALUES($1,'guest')", [principalId]);
  const issued = await withTransaction(client => issueSession(client, principalId));
  const row = (await execute("SELECT id,csrf_hash,expires_at FROM app_private.sessions WHERE principal_id=$1", [principalId])).rows[0];
  return { issued, old: { id: row.id as string, principalId, kind: "guest", csrfHash: row.csrf_hash as Buffer, expiresAt: row.expires_at as Date } };
}

beforeAll(async () => {
  db = new PGlite(); await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  for (const name of ["001_core.sql", "002_observations.sql", "003_community_moderation.sql", "004_analysis_proposals.sql", "005_retention.sql", "006_exploration_games.sql", "007_account_roles_game_deletion.sql", "008_map_participation_passwords.sql", "009_student_identifiers.sql"]) await db.exec(await readFile(`db/migrations/${name}`, "utf8"));
}, 30000);
afterAll(async () => db.close());
beforeEach(async () => {
  vi.clearAllMocks(); identifier = `student-${randomUUID()}@school.example`; configuration.origin = "http://localhost:3001";
  await execute("DELETE FROM app_private.invite_attempts");
});
afterEach(() => vi.unstubAllEnvs());

describe("independent email-shaped student identifiers", () => {
  it("requires email syntax without mailbox verification, normalizes identifiers and refuses account authority injection", () => {
    expect(studentIdInput.parse({ action: "signup", identifier: "  Explorer@Imaginary.School ", password: " 12345678 " })).toMatchObject({ identifier: "explorer@imaginary.school", password: " 12345678 " });
    for (const input of [{ ...signup(), role: "teacher" }, { ...signup(), accountRole: "teacher" }, { ...signup(), provider: "google" }, { ...signup(), identifier: "invalid" }, { ...signup(), identifier: `a@${"a".repeat(250)}.school` }, { ...signup(), password: "1234567" }, { ...signup(), password: "x".repeat(129) }, { ...signup(), password: "        " }, { action: "resend", identifier }]) expect(studentIdInput.safeParse(input).success).toBe(false);
  });

  it("registers an imaginary identifier as a local student and issues only the app's HttpOnly cookies immediately", async () => {
    const response = await POST(request({ ...signup(), identifier: ` ${identifier.toUpperCase()} `, returnTo: "/?map=example" }));
    expect(response.status).toBe(200); expect((await response.json()).data).toEqual({ needsConfirmation: false, returnTo: "/?map=example" });
    const sessionCookie = response.cookies.get("moa_dev_session"), csrfCookie = response.cookies.get("moa_dev_csrf");
    expect(sessionCookie).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" }); expect(csrfCookie?.httpOnly).toBe(true);
    const row = await stored(); expect(row).toMatchObject({ identifier, auth_source: "student_id", auth_user_id: null, account_role: "student", algorithm: "scrypt-v1", scrypt_n: 32768, scrypt_r: 8, scrypt_p: 3 });
    expect(row.salt).toBeInstanceOf(Buffer); expect((row.salt as Buffer).length).toBe(32); expect((row.password_hash as Buffer).length).toBe(32);
    expect((row.password_hash as Buffer).includes(Buffer.from(password))).toBe(false); expect(Object.keys(row)).not.toContain("password");
    const current = await getSession(new NextRequest(`${configuration.origin}/api/v1/session`, { headers: { cookie: `moa_dev_session=${sessionCookie!.value}` } }));
    expect(current).toMatchObject({ principalId: row.principal_id, kind: "account", accountRole: "student" });
    expect(configuration.createClient).not.toHaveBeenCalled();
  });

  it("uses different salts and hashes for the same password and returns safe internal redirects", async () => {
    const first = await studentIdAuth(signup(), null), row = await stored();
    const another = `other-${randomUUID()}@school.example`;
    const second = await studentIdAuth({ ...signup(), identifier: another, returnTo: "https://outside.example" }, null);
    const other = (await execute("SELECT salt,password_hash FROM app_private.student_credentials WHERE identifier=$1", [another])).rows[0];
    expect(row.salt).not.toEqual(other.salt); expect(row.password_hash).not.toEqual(other.password_hash);
    expect(first.data.needsConfirmation).toBe(false); expect(second.data.returnTo).toBe("/");
  });

  it("never connects an identifier matching a Google teacher's email to that teacher principal", async () => {
    const googlePrincipal = randomUUID(), googleAuthId = randomUUID();
    await execute("INSERT INTO app.principals(id,kind,auth_user_id,account_role) VALUES($1,'account',$2,'teacher')", [googlePrincipal, googleAuthId]);
    identifier = "teacher@school.example";
    const result = await studentIdAuth(signup(), null), row = await stored();
    expect(result.issued).toBeTruthy(); expect(row.principal_id).not.toBe(googlePrincipal); expect(row.auth_user_id).toBeNull(); expect(row.account_role).toBe("student");
    expect((await execute("SELECT auth_user_id,auth_source,account_role FROM app.principals WHERE id=$1", [googlePrincipal])).rows[0]).toEqual({ auth_user_id: googleAuthId, auth_source: "supabase", account_role: "teacher" });
    expect(configuration.createClient).not.toHaveBeenCalled();
  });

  it("rejects duplicate and simultaneous registrations without orphan principals or sessions", async () => {
    const beforePrincipals = await count("app.principals"), beforeSessions = await count("app_private.sessions");
    const results = await Promise.allSettled([studentIdAuth(signup(), null), studentIdAuth(signup(), null)]);
    expect(results.filter(result => result.status === "fulfilled")).toHaveLength(1);
    expect(results.find(result => result.status === "rejected")).toMatchObject({ reason: { code: "STUDENT_IDENTIFIER_TAKEN" } });
    expect(await count("app.principals")).toBe(beforePrincipals + 1); expect(await count("app_private.sessions")).toBe(beforeSessions + 1);
    const { old } = await priorSession(); await expect(studentIdAuth(signup(), old)).rejects.toMatchObject({ code: "STUDENT_IDENTIFIER_TAKEN" });
    expect((await execute("SELECT revoked_at FROM app_private.sessions WHERE id=$1", [old.id])).rows[0]).toEqual({ revoked_at: null });
  });

  it("logs in the correct student and replaces an existing session only on success", async () => {
    await studentIdAuth(signup(), null); const row = await stored(), { old, issued } = await priorSession();
    const beforeSessions = await count("app_private.sessions"), result = await studentIdAuth(login(), old);
    expect(result.data).toEqual({ needsConfirmation: false, returnTo: "/" }); expect(await count("app_private.sessions")).toBe(beforeSessions + 1);
    expect((await execute("SELECT revoked_at FROM app_private.sessions WHERE id=$1", [old.id])).rows[0].revoked_at).toBeInstanceOf(Date);
    const current = await getSession(new NextRequest(`${configuration.origin}/`, { headers: { cookie: cookies(result.issued) } })); expect(current?.principalId).toBe(row.principal_id);
    expect(await getSession(new NextRequest(`${configuration.origin}/`, { headers: { cookie: cookies(issued) } }))).toBeNull();
  });

  it("gives the same wrong-credential error for absent and incorrect-password accounts while preserving the old session", async () => {
    await studentIdAuth(signup(), null); const { old } = await priorSession(), beforeSessions = await count("app_private.sessions");
    for (const input of [{ ...login(), password: "wrong-password" }, { ...login(), identifier: "absent@imaginary.school" }]) await expect(studentIdAuth(input, old)).rejects.toMatchObject({ status: 401, code: "STUDENT_CREDENTIALS_INVALID", message: "학생 아이디와 비밀번호를 확인해 주세요." });
    expect(await count("app_private.sessions")).toBe(beforeSessions); expect((await execute("SELECT revoked_at FROM app_private.sessions WHERE id=$1", [old.id])).rows[0].revoked_at).toBeNull();
  });

  it.each(["blocked", "deleted"])("refuses %s students without invalidating a valid unrelated session", async status => {
    await studentIdAuth(signup(), null); const row = await stored(), { old } = await priorSession();
    await execute("UPDATE app.principals SET status=$2 WHERE id=$1", [row.principal_id, status]);
    await expect(studentIdAuth(login(), old)).rejects.toMatchObject({ code: "ACCOUNT_BLOCKED" });
    expect((await execute("SELECT revoked_at FROM app_private.sessions WHERE id=$1", [old.id])).rows[0].revoked_at).toBeNull();
  });

  it("enforces student-only authority at both the service and database boundary", async () => {
    const result = await studentIdAuth(signup(), null), row = await stored();
    const session = await getSession(new NextRequest(`${configuration.origin}/`, { headers: { cookie: cookies(result.issued) } }));
    await expect(registerAccount(session!, "teacher")).rejects.toMatchObject({ code: "ROLE_ALREADY_SET" });
    await expect(withTransaction(client => requireTeacher(client, { ...session!, accountRole: "teacher" }))).rejects.toMatchObject({ code: "TEACHER_REQUIRED" });
    for (const assignment of ["account_role='teacher'", "account_role=NULL", "kind='guest'", "auth_source='supabase'", "auth_user_id=gen_random_uuid()"])
      await expect(execute(`UPDATE app.principals SET ${assignment} WHERE id=$1`, [row.principal_id])).rejects.toMatchObject({ code: "23514" });
    expect((await stored()).account_role).toBe("student");
    await expect(execute("INSERT INTO app.principals(kind) VALUES('account')")).rejects.toMatchObject({ code: "23514" });
    await expect(execute("INSERT INTO app.principals(kind,auth_user_id) VALUES('guest',$1)", [randomUUID()])).rejects.toMatchObject({ code: "23514" });
  });

  it("does not trust a credential record pointing at a Supabase/Google teacher", async () => {
    await studentIdAuth(signup(), null); const row = await stored(), teacher = randomUUID();
    await execute("INSERT INTO app.principals(id,kind,auth_user_id,account_role) VALUES($1,'account',$2,'teacher')", [teacher, randomUUID()]);
    await execute("UPDATE app_private.student_credentials SET principal_id=$2 WHERE principal_id=$1", [row.principal_id, teacher]);
    await expect(studentIdAuth(login(), null)).rejects.toMatchObject({ code: "STUDENT_CREDENTIALS_INVALID" });
  });

  it("keeps credentials private under RLS and exposes no browser or Supabase token", async () => {
    const permissions = (await execute("SELECT has_table_privilege('anon','app_private.student_credentials','SELECT') anon_read,has_table_privilege('authenticated','app_private.student_credentials','SELECT') user_read,has_table_privilege('app_backend','app_private.student_credentials','SELECT') backend_read")).rows[0];
    expect(permissions).toEqual({ anon_read: false, user_read: false, backend_read: true });
    expect((await execute("SELECT relrowsecurity FROM pg_class WHERE oid='app_private.student_credentials'::regclass")).rows[0].relrowsecurity).toBe(true);
    const response = await POST(request(signup())); const body = JSON.stringify(await response.json());
    for (const secret of [password, identifier, "password_hash", "salt", "sessionToken", "access_token", "refresh_token"]) expect(body).not.toContain(secret);
    expect(response.headers.get("cache-control")).toContain("no-store");
  });

  it("rejects invalid origins, non-JSON, authority injection and missing CSRF before account creation", async () => {
    const before = await count("app_private.student_credentials");
    expect((await POST(request(signup(), { origin: "https://outside.example" }))).status).toBe(403);
    expect((await POST(request(signup(), { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(request({ ...signup(), role: "teacher" }))).status).toBe(422);
    const { issued } = await priorSession(); const cookie = cookies(issued);
    expect((await POST(request(signup(), { cookie }))).status).toBe(403); expect(await count("app_private.student_credentials")).toBe(before);
    expect((await POST(request(signup(), { cookie, "x-csrf-token": issued.csrfToken }))).status).toBe(200);
  });

  it("sets secure Host cookies in production while retaining a fixed student identity", async () => {
    configuration.origin = "https://app.example.test"; const response = await POST(request(signup()));
    expect(response.status).toBe(200); expect(response.cookies.get("__Host-moa_session")).toMatchObject({ httpOnly: true, secure: true, path: "/", sameSite: "lax" });
    expect(response.cookies.get("__Host-moa_csrf")?.secure).toBe(true); expect(response.cookies.get("moa_dev_session")).toBeUndefined();
  });

  it("limits failed logins for one student while allowing classmates on the same Wi-Fi", async () => {
    await studentIdAuth(signup(), null);
    for (let index = 0; index < 20; index++) expect((await POST(request({ ...login(), password: "wrong-password" }))).status).toBe(401);
    const response = await POST(request(login())); expect(response.status).toBe(429); expect((await response.json()).error.code).toBe("STUDENT_RATE_LIMIT");
    const other = { ...signup(), identifier: `classmate-${randomUUID()}@school.example` }; await studentIdAuth(other, null);
    expect((await POST(request({ ...other, action: "login" }))).status).toBe(200);
    const values = (await execute("SELECT actor_hash FROM app_private.invite_attempts")).rows;
    expect(values.every(row => row.actor_hash instanceof Buffer && (row.actor_hash as Buffer).length === 32)).toBe(true);
  }, 15000);

  it("keeps the shared class request budget and refuses an untrusted production rate-limit configuration", async () => {
    for (let index = 0; index < 180; index++) await recordStudentIdAttempt(request(signup()), signup());
    await expect(recordStudentIdAttempt(request(signup()), signup())).rejects.toMatchObject({ code: "INVITE_RATE_LIMIT" });
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("VERCEL", ""); vi.stubEnv("TRUSTED_CLIENT_IP_HEADER", "");
    await expect(recordStudentIdAttempt(request(signup(), { "x-forwarded-for": "192.0.2.3" }), signup())).rejects.toMatchObject({ code: "INVITE_LIMIT_NOT_CONFIGURED" });
  });
});
