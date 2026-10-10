import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { AppSession } from "../src/server/auth/session";

let db: PGlite;
let queue: Promise<unknown> = Promise.resolve();
const execute = async (sql: string, values: unknown[] = []) => {
  const result = await db.query(sql, values);
  return { ...result, rows: result.rows.map(row => Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, value instanceof Uint8Array ? Buffer.from(value) : key === "version" ? String(value) : value]))), rowCount: result.rows.length || result.affectedRows || 0 };
};
vi.mock("../src/server/db", () => ({
  query: async (sql: string, values: unknown[] = []) => (await execute(sql, values)).rows,
  withTransaction: (action: (client: unknown) => unknown) => {
    const next = queue.then(async () => {
      await db.exec("BEGIN");
      try { const result = await action({ query: execute }); await db.exec("COMMIT"); return result; }
      catch (error) { await db.exec("ROLLBACK"); throw error; }
    });
    queue = next.catch(() => {});
    return next;
  },
}));
vi.mock("../src/server/env", () => ({ getServerConfig: () => ({ appOrigin: "http://localhost:3001", invitePepper: "test-map-sharing-pepper-not-for-production" }) }));
import { createMap, createMapSchema, getMap, getMapConfiguration, listMaps } from "../src/server/services/maps";
import { joinMap, joinMapSchema } from "../src/server/services/map-joining";
import { changeMapSettings, mapSettingsInput } from "../src/server/services/operations";
import { createInvite, createInviteSchema, redeemInvite } from "../src/server/services/invites";
import { createObservation, listObservations, observationSchema } from "../src/server/services/observations";
import { createMergedMap, createMergedMapSchema, previewMapMerge } from "../src/server/services/map-merge";
import { POST } from "../src/app/api/v1/maps/[mapId]/join/route";
import { mapCreationRequestHash } from "../src/server/services/map-passwords";

const session = (id: string, kind: AppSession["kind"] = "account"): AppSession => ({ id: randomUUID(), principalId: id, kind, csrfHash: Buffer.alloc(32), expiresAt: new Date(Date.now() + 86400000) });
beforeAll(async () => {
  db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  for (const name of ["001_core.sql", "002_observations.sql", "003_community_moderation.sql", "004_analysis_proposals.sql", "005_retention.sql", "006_exploration_games.sql", "007_account_roles_game_deletion.sql", "008_map_participation_passwords.sql"]) await db.exec(await readFile(`db/migrations/${name}`, "utf8"));
  for (const source of ["docs/contracts/theme-presets-v1.json", "docs/contracts/theme-presets.json"]) {
    const themes = JSON.parse(await readFile(source, "utf8")), theme = themes.templates.find((item: { key: string }) => item.key === "custom");
    await execute("INSERT INTO app.theme_templates(theme_key,version,definition) VALUES($1,$2,$3)", [theme.key, theme.version, JSON.stringify(theme)]);
  }
}, 30000);
afterAll(async () => db.close());

async function teacher() {
  const id = randomUUID();
  await execute("INSERT INTO app.principals(id,kind,auth_user_id,account_role) VALUES($1,'account',$2,'teacher')", [id, randomUUID()]);
  return session(id);
}
async function map(owner: AppSession, visibility: "public" | "invite_only", password?: string, title = `공유 시험 ${randomUUID()}`) {
  const input = createMapSchema.parse({ themeKey: "custom", themeVersion: 2, title, locationLabel: "가상 동네", visibility, ...(password ? { participationPassword: password } : {}), custom: { pinMode: "single", categories: [{ key: "nature", label: "나무", color: "#338855", defaultEmojiKey: "tree", emojiOptions: [{ key: "tree", glyph: "🌳", label: "나무" }] }] } });
  return (await createMap(input, owner, randomUUID())).map;
}
async function guest(issued: { sessionToken: string }) {
  const row = (await execute("SELECT principal_id,id,csrf_hash,expires_at FROM app_private.sessions WHERE token_hash=$1", [createHash("sha256").update(issued.sessionToken).digest()])).rows[0];
  return { ...session(row.principal_id as string, "guest"), id: row.id as string, csrfHash: row.csrf_hash as Buffer, expiresAt: row.expires_at as Date };
}
const point = () => observationSchema.parse({ configRevision: 1, title: "학교 나무", body: "학교 앞에서 발견한 큰 나무입니다.", locationLabel: "학교 앞", locationSource: "manual", location: { lat: 37, lng: 127 }, categoryKey: "nature", emojiKey: "tree", ratingKey: null, answers: {} });

describe("public map reading and contribution sharing", () => {
  it("lists both sharing settings publicly, exposes only passwordEnabled and keeps published observations readable", async () => {
    const owner = await teacher(), title = `공개 목록 ${randomUUID()}`;
    const open = await map(owner, "public", undefined, `${title} A`), partial = await map(owner, "invite_only", "학교비밀번호", `${title} B`);
    const record = await createObservation(partial.id, owner, randomUUID(), point());
    const directory = await listMaps("public", null, 50, undefined, title);
    expect(directory.items.map(item => item.id).sort()).toEqual([open.id, partial.id].sort());
    expect(await getMap(partial.id, null)).toMatchObject({ passwordEnabled: true, visibility: "invite_only", capabilities: { canRead: true, canCreateObservation: false, canComment: false } });
    expect((await getMapConfiguration(partial.id, null)).theme?.key).toBe("custom");
    expect((await listObservations(partial.id, null)).items.map(item => item.id)).toEqual([record.observation.id]);
    expect(JSON.stringify(directory)).not.toContain("학교비밀번호");
    expect(JSON.stringify(directory)).not.toContain("password_hash");
    const permissions = (await execute("SELECT has_table_privilege('anon','app_private.map_participation_passwords','SELECT') AS anon_read,has_table_privilege('authenticated','app_private.map_participation_passwords','SELECT') AS account_read,has_table_privilege('app_backend','app_private.map_participation_passwords','SELECT') AS backend_read")).rows[0];
    expect(permissions).toEqual({ anon_read: false, account_read: false, backend_read: true });
  });

  it("joins an open map without credentials, creates a guest author session and keeps membership idempotent", async () => {
    const owner = await teacher(), open = await map(owner, "public");
    const joined = await joinMap(open.id, { nickname: "탐험 학생" }, null);
    expect(joined.session?.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    const participant = await guest(joined.session!);
    expect(await getMap(open.id, participant)).toMatchObject({ isMine: true, capabilities: { canCreateObservation: true } });
    expect((await createObservation(open.id, participant, randomUUID(), point())).observation.author).toBe("탐험 학생");
    expect(await joinMap(open.id, { nickname: "다른 이름" }, participant)).toMatchObject({ repeated: true, session: null });
    expect((await execute("SELECT nickname FROM app.map_members WHERE map_id=$1 AND principal_id=$2", [open.id, participant.principalId])).rows).toEqual([{ nickname: "탐험 학생" }]);
    const account = await teacher();
    expect(await joinMap(open.id, { nickname: "다른 교사" }, account)).toMatchObject({ repeated: false, session: null });
  });

  it("requires the partial map password, salts each map independently and never creates a guest for a bad password", async () => {
    const owner = await teacher(), first = await map(owner, "invite_only", "동네1234"), second = await map(owner, "invite_only", "동네1234");
    const before = (await execute("SELECT count(*)::int AS count FROM app.principals")).rows[0].count;
    await expect(joinMap(first.id, { nickname: "탐험 학생" }, null)).rejects.toMatchObject({ code: "PARTICIPATION_AUTH_REQUIRED" });
    await expect(joinMap(first.id, { nickname: "탐험 학생", password: "틀린1234" }, null)).rejects.toMatchObject({ code: "PARTICIPATION_PASSWORD_INVALID" });
    expect((await execute("SELECT count(*)::int AS count FROM app.principals")).rows[0].count).toBe(before);
    const joined = await joinMap(first.id, { nickname: "탐험 학생", password: "동네1234" }, null), participant = await guest(joined.session!);
    expect(await getMap(first.id, participant)).toMatchObject({ capabilities: { canCreateObservation: true } });
    expect(await joinMap(first.id, { nickname: "탐험 학생" }, participant)).toMatchObject({ repeated: true });
    const hashes = (await execute("SELECT salt,password_hash FROM app_private.map_participation_passwords WHERE map_id=ANY($1::uuid[]) ORDER BY map_id", [[first.id, second.id]])).rows;
    expect(hashes[0].salt).not.toEqual(hashes[1].salt);
    expect(hashes[0].password_hash).not.toEqual(hashes[1].password_hash);
    expect((hashes[0].password_hash as Buffer).toString()).not.toBe("동네1234");
  });

  it("accepts teacher codes with or without a password, rejects a different map code and preserves its usage count", async () => {
    const owner = await teacher(), partial = await map(owner, "invite_only"), other = await map(owner, "invite_only", "암호1234");
    const invite = await createInvite(partial.id, owner, createInviteSchema.parse({ maxUses: 1 }));
    const wrong = await createInvite(other.id, owner, createInviteSchema.parse({ maxUses: 1 }));
    await expect(joinMap(partial.id, { nickname: "학생 하늘", code: wrong.code }, null)).rejects.toMatchObject({ code: "INVITE_INVALID" });
    expect((await execute("SELECT uses FROM app_private.invites WHERE id=$1", [wrong.id])).rows[0].uses).toBe(0);
    const joined = await joinMap(partial.id, { nickname: "학생 하늘", code: invite.code }, null);
    expect((await getMap(partial.id, await guest(joined.session!))).capabilities.canCreateObservation).toBe(true);
    await expect(joinMap(partial.id, { nickname: "학생 바다", code: invite.code }, null)).rejects.toMatchObject({ code: "INVITE_EXHAUSTED" });
    const joinedOther = await joinMap(other.id, { nickname: "학생 바다", code: wrong.code }, null);
    expect(joinedOther.repeated).toBe(false);
    // Existing global invite links retain the same code-based membership behavior.
    expect(await redeemInvite({ nickname: "학생 바다", code: wrong.code }, await guest(joinedOther.session!))).toMatchObject({ mapId: other.id, repeated: true });
  });

  it("rejects revoked or expired teacher codes and keeps blocked/left members read-only", async () => {
    const owner = await teacher(), open = await map(owner, "public"), partial = await map(owner, "invite_only", "학교1234");
    const invite = await createInvite(partial.id, owner, createInviteSchema.parse({}));
    await execute("UPDATE app_private.invites SET revoked_at=now() WHERE id=$1", [invite.id]);
    await expect(joinMap(partial.id, { nickname: "학생 하늘", code: invite.code }, null)).rejects.toMatchObject({ code: "INVITE_REVOKED" });
    await execute("UPDATE app_private.invites SET revoked_at=NULL,expires_at=now()-interval '1 minute' WHERE id=$1", [invite.id]);
    await expect(joinMap(partial.id, { nickname: "학생 하늘", code: invite.code }, null)).rejects.toMatchObject({ code: "INVITE_EXPIRED" });
    const joined = await joinMap(open.id, { nickname: "학생 하늘" }, null), participant = await guest(joined.session!);
    for (const status of ["blocked", "left"]) {
      await execute("UPDATE app.map_members SET status=$3 WHERE map_id=$1 AND principal_id=$2", [open.id, participant.principalId, status]);
      await expect(joinMap(open.id, { nickname: "학생 하늘" }, participant)).rejects.toMatchObject({ code: "MEMBERSHIP_BLOCKED" });
      await expect(createObservation(open.id, participant, randomUUID(), point())).rejects.toMatchObject({ code: "WRITE_FORBIDDEN" });
      expect(await getMap(open.id, participant)).toMatchObject({ capabilities: { canRead: true, canCreateObservation: false } });
    }
  });

  it("retains closed, admin-only, archive and deletion gates despite public sharing", async () => {
    const owner = await teacher(), open = await map(owner, "public");
    const joined = await joinMap(open.id, { nickname: "학생 하늘" }, null), participant = await guest(joined.session!);
    for (const participation of ["closed", "admin_only"]) {
      await execute("UPDATE app.maps SET participation=$2 WHERE id=$1", [open.id, participation]);
      await expect(joinMap(open.id, { nickname: "새 학생" }, null)).rejects.toMatchObject({ code: "WRITE_FORBIDDEN" });
      await expect(createObservation(open.id, participant, randomUUID(), point())).rejects.toMatchObject({ code: "WRITE_FORBIDDEN" });
    }
    expect((await createObservation(open.id, owner, randomUUID(), point())).observation.status).toBe("published");
    await execute("UPDATE app.maps SET status='archived' WHERE id=$1", [open.id]);
    expect(await getMap(open.id, null)).toMatchObject({ status: "archived", capabilities: { canRead: true } });
    await expect(joinMap(open.id, { nickname: "학생 하늘" }, participant)).rejects.toMatchObject({ code: "MAP_CLOSED" });
    await expect(createObservation(open.id, owner, randomUUID(), point())).rejects.toMatchObject({ code: "WRITE_FORBIDDEN" });
    await execute("UPDATE app.maps SET status='deleted' WHERE id=$1", [open.id]);
    await expect(getMap(open.id, null)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(joinMap(open.id, { nickname: "학생 하늘" }, null)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("restricts password settings to the owner, redacts audit logs, rotates/clears passwords and clears public-mode secrets", async () => {
    const owner = await teacher(), partial = await map(owner, "invite_only", "이전1234"), admin = await teacher();
    await execute("INSERT INTO app.map_members(map_id,principal_id,nickname,role) VALUES($1,$2,'도우미 교사','admin')", [partial.id, admin.principalId]);
    await expect(changeMapSettings(partial.id, admin, partial.version, { participationPassword: "새암호1234" })).rejects.toMatchObject({ code: "OWNER_REQUIRED" });
    await changeMapSettings(partial.id, owner, partial.version, mapSettingsInput.parse({ participationPassword: "새암호1234" }));
    const audit = (await execute("SELECT reason FROM app.audit_events WHERE map_id=$1 AND action='map.settings'", [partial.id])).rows;
    expect(audit).toEqual([{ reason: '{"participationPassword":"changed"}' }]);
    await expect(joinMap(partial.id, { nickname: "학생 하늘", password: "이전1234" }, null)).rejects.toMatchObject({ code: "PARTICIPATION_PASSWORD_INVALID" });
    expect((await joinMap(partial.id, { nickname: "학생 하늘", password: "새암호1234" }, null)).repeated).toBe(false);
    let current = await getMap(partial.id, owner);
    await changeMapSettings(partial.id, owner, current.version, { participationPassword: null });
    expect(await getMap(partial.id, null)).toMatchObject({ passwordEnabled: false });
    current = await getMap(partial.id, owner);
    await changeMapSettings(partial.id, owner, current.version, { participationPassword: "비공개1234" });
    current = await getMap(partial.id, owner);
    await changeMapSettings(partial.id, owner, current.version, { visibility: "public" });
    expect(await getMap(partial.id, null)).toMatchObject({ passwordEnabled: false, visibility: "public" });
    expect((await joinMap(partial.id, { nickname: "새 학생" }, null)).repeated).toBe(false);
    expect((await execute("SELECT map_id FROM app_private.map_participation_passwords WHERE map_id=$1", [partial.id])).rows).toHaveLength(0);
    current = await getMap(partial.id, owner);
    await expect(changeMapSettings(partial.id, owner, current.version, { participationPassword: "잘못1234" })).rejects.toMatchObject({ code: "PASSWORD_NOT_ALLOWED" });
  });

  it("applies the chosen sharing setting to merged maps and validates final-step passwords in both creation flows", async () => {
    const owner = await teacher(), first = await map(owner, "public"), second = await map(owner, "invite_only");
    await createObservation(first.id, owner, randomUUID(), point());
    const preview = await previewMapMerge({ mapIds: [first.id, second.id] }, owner);
    const input = createMergedMapSchema.parse({ mapIds: preview.sources.map(item => item.id), title: "일부공개 합친 지도", locationLabel: "가상 동네", pointIds: preview.points.map(item => item.id), sourceVersions: Object.fromEntries(preview.sources.map(item => [item.id, item.version])), pointVersions: Object.fromEntries(preview.points.map(item => [item.id, item.version])), visibility: "invite_only", participationPassword: "탐험1234" });
    const merged = await createMergedMap(input, owner, randomUUID());
    expect(await getMap(merged.map.id, null)).toMatchObject({ visibility: "invite_only", passwordEnabled: true, capabilities: { canRead: true } });
    expect((await joinMap(merged.map.id, { nickname: "학생 하늘", password: "탐험1234" }, null)).repeated).toBe(false);
    expect(createMergedMapSchema.safeParse({ ...input, visibility: "public" }).success).toBe(false);
    expect(createMapSchema.safeParse({ themeKey: "ecology", themeVersion: 2, title: "비밀번호 검증", locationLabel: "동네", visibility: "public", participationPassword: "암호1234" }).success).toBe(false);
    expect(joinMapSchema.safeParse({ nickname: "학생 하늘", password: "암호1234", code: "123456789012" }).success).toBe(false);
    expect(mapCreationRequestHash(input)).not.toEqual(createHash("sha256").update(JSON.stringify(input)).digest());
    const { participationPassword, ...withoutPassword } = input;
    void participationPassword;
    expect(mapCreationRequestHash(withoutPassword)).toEqual(createHash("sha256").update(JSON.stringify(withoutPassword)).digest());
  });

  it("protects the join endpoint with origin, CSRF and rate limits, and issues HttpOnly cookies instead of response tokens", async () => {
    const owner = await teacher(), open = await map(owner, "public");
    const request = (origin = "http://localhost:3001", cookie?: string, csrf?: string) => new NextRequest(`http://localhost:3001/api/v1/maps/${open.id}/join`, { method: "POST", headers: { origin, "content-type": "application/json", ...(cookie ? { cookie } : {}), ...(csrf ? { "x-csrf-token": csrf } : {}) }, body: JSON.stringify({ nickname: "학생 하늘" }) });
    const context = { params: Promise.resolve({ mapId: open.id }) };
    expect((await POST(request("https://another.example"), context)).status).toBe(403);
    const response = await POST(request(), context), body = await response.json();
    expect(response.status).toBe(200);
    expect(body.data).toEqual({ mapId: open.id, repeated: false });
    expect(response.cookies.get("moa_dev_session")?.httpOnly).toBe(true);
    expect(response.cookies.get("moa_dev_csrf")?.httpOnly).toBe(true);
    const sessionToken = response.cookies.get("moa_dev_session")!.value, csrfToken = response.cookies.get("moa_dev_csrf")!.value;
    const cookie = `moa_dev_session=${sessionToken}; moa_dev_csrf=${csrfToken}`;
    expect((await POST(request(undefined, cookie), context)).status).toBe(403);
    expect((await POST(request(undefined, cookie, csrfToken), context)).status).toBe(200);
    for (let index = 0; index < 30; index++) expect((await POST(request(), context)).status).toBe(200);
    await execute("UPDATE app_private.invite_attempts SET attempts=180,window_start=now()");
    const limited = await POST(request(), context);
    expect(limited.status).toBe(429);
    expect(limited.headers.get("Retry-After")).toBe("600");
  });

  it("limits failed passwords separately per map while allowing another class to join successfully", async () => {
    const owner = await teacher(), partial = await map(owner, "invite_only", "탐험1234"), other = await map(owner, "public");
    const request = (mapId: string, password?: string) => new NextRequest(`http://localhost:3001/api/v1/maps/${mapId}/join`, { method: "POST", headers: { origin: "http://localhost:3001", "content-type": "application/json" }, body: JSON.stringify({ nickname: "학생 하늘", ...(password ? { password } : {}) }) });
    for (let index = 0; index < 20; index++) {
      const response = await POST(request(partial.id, "틀린1234"), { params: Promise.resolve({ mapId: partial.id }) });
      expect(response.status).toBe(403);
    }
    expect((await POST(request(partial.id, "탐험1234"), { params: Promise.resolve({ mapId: partial.id }) })).status).toBe(429);
    expect((await POST(request(other.id), { params: Promise.resolve({ mapId: other.id }) })).status).toBe(200);
  });
});
