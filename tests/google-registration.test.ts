import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { createHmac, randomUUID } from "node:crypto";
import { NextRequest, type NextResponse } from "next/server";

const sdk = vi.hoisted(() => ({ createClient: vi.fn(), signInWithOAuth: vi.fn(), exchangeCodeForSession: vi.fn(), getUser: vi.fn(), origin: "http://localhost:3001", pepper: "google-registration-tests-not-a-real-secret" }));
vi.mock("@supabase/supabase-js", () => ({ createClient: sdk.createClient }));
vi.mock("../src/server/env", () => ({ getServerConfig: () => ({ appOrigin: sdk.origin, invitePepper: sdk.pepper, supabaseUrl: "https://auth.example.test", supabaseAnonKey: "public-test-key" }) }));
let db: PGlite, authUserId: string, queue: Promise<unknown> = Promise.resolve();
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
import { beginGoogleOAuth, finishGoogleOAuth, type GoogleRegistrationRole } from "../src/server/auth/oauth";
import { getSession, issueSession, requireCsrf } from "../src/server/auth/session";
import { withTransaction } from "../src/server/db";
import { requireTeacher, registerAccount } from "../src/server/services/accounts";
import { GET as start } from "../src/app/api/v1/auth/google/route";
import { GET as callback } from "../src/app/api/v1/auth/callback/route";

const destination = "/?map=verified-map";
function cookieName() { return sdk.origin.startsWith("https:") ? "__Host-moa_oauth" : "moa_dev_oauth"; }
function stateFrom(cookie: string) { return JSON.parse(Buffer.from(cookie.split(".")[0], "base64url").toString("utf8")); }
function callbackRequest(cookie: string, extra = "", sessionCookie = "") {
  return new NextRequest(`${sdk.origin}/api/v1/auth/callback?request=${stateFrom(cookie).requestId}&code=provider-code${extra}`, { headers: { cookie: `${cookieName()}=${cookie}${sessionCookie ? `; ${sessionCookie}` : ""}` } });
}
async function complete(role?: GoogleRegistrationRole, extra = "", sessionCookie = "") {
  const begun = await beginGoogleOAuth(destination, role);
  return callback(callbackRequest(begun.cookie, extra, sessionCookie));
}
async function account(role: "teacher" | "student" | "member" | null, status = "active") {
  const id = randomUUID(); await execute("INSERT INTO app.principals(id,kind,auth_user_id,account_role,status) VALUES($1,'account',$2,$3,$4)", [id, authUserId, role, status]); return id;
}
function responseCookies(response: NextResponse) { return response.cookies.getAll().map(cookie => `${cookie.name}=${cookie.value}`).join("; "); }
async function sessionFrom(response: NextResponse) {
  return getSession(new NextRequest(`${sdk.origin}/api/v1/session`, { headers: { cookie: responseCookies(response) } }));
}

beforeAll(async () => {
  db = new PGlite(); await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  for (const name of ["001_core.sql", "002_observations.sql", "003_community_moderation.sql", "004_analysis_proposals.sql", "005_retention.sql", "006_exploration_games.sql", "007_account_roles_game_deletion.sql", "008_map_participation_passwords.sql"]) await db.exec(await readFile(`db/migrations/${name}`, "utf8"));
}, 30000);
afterAll(async () => db.close());
beforeEach(() => {
  vi.clearAllMocks(); authUserId = randomUUID(); sdk.origin = "http://localhost:3001";
  sdk.createClient.mockImplementation((_url, _key, options) => {
    options.auth.storage.setItem("moa-oauth-code-verifier", "test-pkce-verifier");
    return { auth: { signInWithOAuth: sdk.signInWithOAuth, exchangeCodeForSession: sdk.exchangeCodeForSession, getUser: sdk.getUser } };
  });
  sdk.signInWithOAuth.mockResolvedValue({ data: { url: "https://auth.example.test/authorize?provider=google" }, error: null });
  sdk.exchangeCodeForSession.mockResolvedValue({ data: { session: { access_token: "secret-provider-access-token", user: { id: randomUUID(), user_metadata: { role: "teacher" } } } }, error: null });
  sdk.getUser.mockResolvedValue({ data: { user: { id: authUserId, user_metadata: { role: "teacher" } } }, error: null });
});

describe("Google teacher/student signup with trusted OAuth state", () => {
  it.each(["teacher", "student"] as const)("reserves a new %s role and enforces the matching database permission", async role => {
    const response = await complete(role);
    expect(response.headers.get("location")).toBe(`${sdk.origin}${destination}`);
    const session = await sessionFrom(response); expect(session?.accountRole).toBe(role); expect(session?.kind).toBe("account");
    expect((await execute("SELECT auth_user_id,account_role FROM app.principals WHERE id=$1", [session!.principalId])).rows[0]).toEqual({ auth_user_id: authUserId, account_role: role });
    expect(sdk.getUser).toHaveBeenCalledWith("secret-provider-access-token");
    if (role === "teacher") await expect(withTransaction(client => requireTeacher(client, session!))).resolves.toBeUndefined();
    else await expect(withTransaction(client => requireTeacher(client, { ...session!, accountRole: "teacher" }))).rejects.toMatchObject({ code: "TEACHER_REQUIRED" });
    expect(response.headers.get("set-cookie")).not.toContain("secret-provider");
  });

  it.each(["teacher", "student"] as const)("sets %s for an authenticated account that has not yet selected a role", async role => {
    const id = await account(null), response = await complete(role);
    expect((await execute("SELECT account_role FROM app.principals WHERE id=$1", [id])).rows[0].account_role).toBe(role);
    expect(response.headers.get("location")).toBe(`${sdk.origin}${destination}`);
  });

  it.each(["teacher", "student", "member"] as const)("preserves an existing %s even if signup requests a different role", async role => {
    const id = await account(role), response = await complete(role === "teacher" ? "student" : "teacher");
    expect((await execute("SELECT account_role FROM app.principals WHERE id=$1", [id])).rows[0].account_role).toBe(role);
    expect((await sessionFrom(response))?.accountRole).toBe(role);
    expect(response.headers.get("location")).toBe(`${sdk.origin}${destination}`);
  });

  it("keeps the old setup flow for a new Google login without a signup role", async () => {
    const response = await complete();
    expect(response.headers.get("location")).toBe(`${sdk.origin}/account/setup?returnTo=${encodeURIComponent(destination)}`);
    expect((await sessionFrom(response))?.accountRole).toBeNull();
  });

  it("ignores role and returnTo injection into the callback URL and provider user metadata", async () => {
    const response = await complete("student", "&role=teacher&registrationRole=teacher&returnTo=https://outside.example");
    const session = await sessionFrom(response); expect(session?.accountRole).toBe("student");
    expect(response.headers.get("location")).toBe(`${sdk.origin}${destination}`);
    await expect(registerAccount(session!, "teacher")).rejects.toMatchObject({ code: "ROLE_ALREADY_SET" });
  });

  it("rejects altered signed role state before exchanging the provider code", async () => {
    const begun = await beginGoogleOAuth(destination, "student"), state = stateFrom(begun.cookie);
    const tampered = `${Buffer.from(JSON.stringify({ ...state, registrationRole: "teacher" })).toString("base64url")}.${begun.cookie.split(".")[1]}`;
    await expect(finishGoogleOAuth(callbackRequest(tampered))).rejects.toMatchObject({ code: "OAUTH_STATE_INVALID" });
    expect(sdk.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("validates role types even in correctly signed malformed state", async () => {
    const begun = await beginGoogleOAuth(destination), state = stateFrom(begun.cookie);
    for (const registrationRole of ["member", "admin", "", null, ["teacher"]]) {
      const payload = Buffer.from(JSON.stringify({ ...state, registrationRole })).toString("base64url");
      const signed = `${payload}.${createHmac("sha256", sdk.pepper).update(payload).digest("base64url")}`;
      await expect(finishGoogleOAuth(callbackRequest(signed))).rejects.toMatchObject({ code: "OAUTH_STATE_INVALID" });
    }
    expect(sdk.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("rejects missing state, missing/mismatched request IDs, missing codes and extra cookie fragments", async () => {
    const begun = await beginGoogleOAuth(destination, "teacher"), id = stateFrom(begun.cookie).requestId;
    for (const [query, cookie] of [[`?request=${id}&code=provider-code`, ""], ["?code=provider-code", begun.cookie], ["?request=wrong&code=provider-code", begun.cookie], [`?request=${id}`, begun.cookie], [`?request=${id}&code=provider-code`, `${begun.cookie}.extra`]]) {
      const request = new NextRequest(`${sdk.origin}/api/v1/auth/callback${query}`, { headers: { cookie: `${cookieName()}=${cookie}` } });
      await expect(finishGoogleOAuth(request)).rejects.toMatchObject({ code: "OAUTH_STATE_INVALID" });
    }
    expect(sdk.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("rejects invalid and repeated role query parameters before starting OAuth", async () => {
    for (const query of ["role=", "role=member", "role=admin", "role=Teacher", "role=teacher&role=student", "role=student&role=student"]) {
      const response = await start(new NextRequest(`${sdk.origin}/api/v1/auth/google?${query}`));
      expect(response.status).toBe(422); expect((await response.json()).error.code).toBe("REGISTRATION_ROLE_INVALID");
    }
    expect(sdk.createClient).not.toHaveBeenCalled();
  });

  it("keeps the selected role private in the signed secure cookie and sanitizes external return destinations", async () => {
    sdk.origin = "https://map.example.test";
    const response = await start(new NextRequest(`${sdk.origin}/api/v1/auth/google?role=teacher&returnTo=${encodeURIComponent("https://outside.example")}`));
    expect(response.status).toBe(307); expect(response.headers.get("cache-control")).toBe("no-store");
    const cookie = response.cookies.get("__Host-moa_oauth")!;
    expect(cookie).toMatchObject({ httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 });
    expect(stateFrom(cookie.value)).toMatchObject({ returnTo: "/", registrationRole: "teacher" });
    const providerOptions = sdk.signInWithOAuth.mock.calls[0][0]; expect(providerOptions.provider).toBe("google");
    const providerRedirect = new URL(providerOptions.options.redirectTo); expect(providerRedirect.searchParams.has("role")).toBe(false);
    expect(providerRedirect.searchParams.has("registrationRole")).toBe(false);
  });

  it("rolls back role changes and retains the previous app session for a blocked account", async () => {
    const blockedId = await account(null, "blocked"), guestId = randomUUID();
    await execute("INSERT INTO app.principals(id,kind) VALUES($1,'guest')", [guestId]);
    const issued = await withTransaction(client => issueSession(client, guestId));
    const response = await complete("teacher", "", `moa_dev_session=${issued.sessionToken}; moa_dev_csrf=${issued.csrfToken}`);
    expect(response.headers.get("location")).toBe(`${sdk.origin}/?authError=1`);
    expect((await execute("SELECT account_role,status FROM app.principals WHERE id=$1", [blockedId])).rows[0]).toEqual({ account_role: null, status: "blocked" });
    expect((await execute("SELECT revoked_at FROM app_private.sessions WHERE principal_id=$1", [guestId])).rows).toEqual([{ revoked_at: null }]);
    expect((await execute("SELECT id FROM app_private.sessions WHERE principal_id=$1", [blockedId])).rows).toHaveLength(0);
    expect(response.cookies.get("moa_dev_session")).toBeUndefined();
  });

  it("creates no principal or app session when provider exchange or identity verification fails", async () => {
    sdk.exchangeCodeForSession.mockResolvedValueOnce({ data: { session: null }, error: { message: "provider-secret-error" } });
    expect((await complete("teacher")).headers.get("location")).toBe(`${sdk.origin}/?authError=1`);
    sdk.getUser.mockResolvedValueOnce({ data: { user: { id: authUserId } }, error: { message: "provider-private" } });
    expect((await complete("student")).headers.get("location")).toBe(`${sdk.origin}/?authError=1`);
    expect((await execute("SELECT id FROM app.principals WHERE auth_user_id=$1", [authUserId])).rows).toHaveLength(0);
  });

  it("replaces an old session only after successful registration and issues CSRF-protected cookies", async () => {
    const guestId = randomUUID(); await execute("INSERT INTO app.principals(id,kind) VALUES($1,'guest')", [guestId]);
    const previous = await withTransaction(client => issueSession(client, guestId));
    const response = await complete("student", "", `moa_dev_session=${previous.sessionToken}; moa_dev_csrf=${previous.csrfToken}`);
    expect((await execute("SELECT revoked_at FROM app_private.sessions WHERE principal_id=$1", [guestId])).rows[0].revoked_at).toBeInstanceOf(Date);
    const session = (await sessionFrom(response))!; const csrf = response.cookies.get("moa_dev_csrf")!.value;
    expect(response.cookies.get("moa_dev_session")).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
    const headers = { cookie: responseCookies(response), origin: sdk.origin, "x-csrf-token": csrf };
    expect(() => requireCsrf(new NextRequest(`${sdk.origin}/api/v1/account`, { method: "POST", headers }), session)).not.toThrow();
    expect(() => requireCsrf(new NextRequest(`${sdk.origin}/api/v1/account`, { method: "POST", headers: { ...headers, "x-csrf-token": "forged" } }), session)).toThrow();
    expect(() => requireCsrf(new NextRequest(`${sdk.origin}/api/v1/account`, { method: "POST", headers: { ...headers, origin: "https://outside.example" } }), session)).toThrow();
  });

  it("preserves the separate email-confirmation redirect without creating a Google account", async () => {
    const response = await callback(new NextRequest(`${sdk.origin}/api/v1/auth/callback?email_confirm=1&role=teacher&code=private#access_token=unsafe`));
    expect(response.headers.get("location")).toBe(`${sdk.origin}/account/login?confirmed=1#`); expect(response.headers.get("set-cookie")).toBeNull();
    expect(sdk.createClient).not.toHaveBeenCalled(); expect((await execute("SELECT id FROM app.principals WHERE auth_user_id=$1", [authUserId])).rows).toHaveLength(0);
  });
});
