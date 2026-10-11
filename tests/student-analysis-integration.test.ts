import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import type { AppSession } from "../src/server/auth/session";
import type { StudentAnalysisInput } from "../src/domain/ai-analysis";

let db: PGlite;
let queue: Promise<unknown> = Promise.resolve();
const execute = async (sql: string, values: unknown[] = []) => {
  const result = await db.query(sql, values);
  return {
    ...result,
    rows: result.rows.map(row => Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, value instanceof Uint8Array ? Buffer.from(value) : value]))),
    rowCount: result.rows.length || result.affectedRows || 0,
  };
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
vi.mock("../src/server/env", () => ({ getServerConfig: () => ({ appOrigin: "http://localhost:3001" }) }));

import { getStudentAnalysis, saveStudentAnalysis } from "../src/server/services/student-analysis";
import { studentAnalysisInputSchema } from "../src/domain/ai-analysis";
import { GET, PUT } from "../src/app/api/v1/maps/[mapId]/student-analysis/route";

let templateId: string;
beforeAll(async () => {
  db = new PGlite();
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  for (const name of ["001_core.sql", "002_observations.sql", "003_community_moderation.sql", "004_analysis_proposals.sql", "005_retention.sql", "006_exploration_games.sql", "007_account_roles_game_deletion.sql", "008_map_participation_passwords.sql", "009_student_identifiers.sql", "010_student_analysis.sql"]) await db.exec(await readFile(`db/migrations/${name}`, "utf8"));
  templateId = randomUUID();
  await execute("INSERT INTO app.theme_templates(id,theme_key,version,definition) VALUES($1,'ecology',1,'{}')", [templateId]);
}, 30000);
afterAll(async () => db.close());

async function principal(kind: AppSession["kind"] = "account") {
  const principalId = randomUUID(), id = randomUUID(), sessionToken = randomBytes(32).toString("base64url"), csrfToken = randomBytes(32).toString("base64url");
  const csrfHash = createHash("sha256").update(csrfToken).digest(), expiresAt = new Date(Date.now() + 86400000);
  await execute("INSERT INTO app.principals(id,kind,auth_user_id,account_role) VALUES($1,$2,$3,$4)", [principalId, kind, kind === "account" ? randomUUID() : null, kind === "account" ? "student" : null]);
  await execute("INSERT INTO app_private.sessions(id,principal_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,$4,$5)", [id, principalId, createHash("sha256").update(sessionToken).digest(), csrfHash, expiresAt]);
  const session: AppSession = { id, principalId, kind, csrfHash, expiresAt };
  return { session, sessionToken, csrfToken };
}
async function map(owner: AppSession) {
  const id = randomUUID();
  await execute("INSERT INTO app.maps(id,owner_principal_id,template_id,theme_key,title,location_label,activity_context,visibility,pin_mode,single_color,rating_enabled,ideas_enabled,proposals_enabled,comments_enabled,data_revision) VALUES($1,$2,$3,'ecology','학생 분석 시험','학교','school','public','single','#338855',false,false,false,true,7)", [id, owner.principalId, templateId]);
  await member(id, owner);
  return id;
}
async function member(mapId: string, session: AppSession) {
  const id = randomUUID();
  await execute("INSERT INTO app.map_members(id,map_id,principal_id,nickname) VALUES($1,$2,$3,'탐험 학생')", [id, mapId, session.principalId]);
  return id;
}
async function observation(mapId: string, session: AppSession, status = "published") {
  const memberId = (await execute("SELECT id FROM app.map_members WHERE map_id=$1 AND principal_id=$2", [mapId, session.principalId])).rows[0].id;
  const categoryId = randomUUID(), emojiId = randomUUID(), id = randomUUID();
  await execute("INSERT INTO app.categories(id,map_id,key,label,sort_order) VALUES($1,$2,$3,'나무',1)", [categoryId, mapId, randomUUID()]);
  await execute("INSERT INTO app.emoji_options(id,map_id,category_id,key,glyph,label,sort_order) VALUES($1,$2,$3,'tree','🌳','나무',1)", [emojiId, mapId, categoryId]);
  await execute("INSERT INTO app.observations(id,map_id,author_member_id,title,body,location_label,location_source,lat,lng,category_id,emoji_option_id,status,config_revision) VALUES($1,$2,$3,'학교 나무','학교 앞에 있는 나무를 관찰했습니다.','학교','manual',37,127,$4,$5,$6,1)", [id, mapId, memberId, categoryId, emojiId, status]);
  return id;
}
const input = (evidenceIds: string[] = [], override: Partial<StudentAnalysisInput> = {}): StudentAnalysisInput => ({ expectedVersion: 0, title: "내가 판단한 결과", analysis: "  나무 그늘이 적다는 기록이 반복됐어요.\n직접 확인했어요. ", proposal: "나무를 심고 그늘에서 쉴 수 있는 공간을 만들면 좋겠어요.", reasoning: "AI의 제안 중 근거 기록과 맞는 내용을 참고해 스스로 판단했어요.", followUp: "여름에 다시 확인할 계획이에요.", evidenceIds, status: "draft", ...override });

describe("private student-authored final analysis", () => {
  it("supports guests and themes with shared proposals disabled while preserving manually written text", async () => {
    const { session: owner } = await principal(), { session: student } = await principal("guest"), mapId = await map(owner);
    await member(mapId, student);
    const pointId = await observation(mapId, owner), body = input([pointId], { status: "final" });
    const saved = await saveStudentAnalysis(mapId, student, body);
    const { expectedVersion, ...written } = body;
    void expectedVersion;
    expect(saved).toMatchObject({ ...written, version: 1, dataRevision: "7" });
    expect(saved.analysis).toBe(body.analysis);
    expect(saved.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(await getStudentAnalysis(mapId, student)).toEqual(saved);
    expect(await getStudentAnalysis(mapId, owner)).toBeNull();
    expect((await execute("SELECT data_revision::text,proposals_enabled FROM app.maps WHERE id=$1", [mapId])).rows[0]).toEqual({ data_revision: "7", proposals_enabled: false });
    expect((await execute("SELECT count(*)::int AS count FROM app.proposals WHERE map_id=$1", [mapId])).rows[0].count).toBe(0);
  });

  it("rejects unauthenticated, nonmember, blocked and left principals for both reading and writing", async () => {
    const { session: owner } = await principal(), { session: outsider } = await principal(), mapId = await map(owner);
    await expect(getStudentAnalysis(mapId, null)).rejects.toMatchObject({ status: 401 });
    await expect(saveStudentAnalysis(mapId, null, input())).rejects.toMatchObject({ status: 401 });
    await expect(getStudentAnalysis(mapId, outsider)).rejects.toMatchObject({ status: 403 });
    await expect(saveStudentAnalysis(mapId, outsider, input())).rejects.toMatchObject({ status: 403 });
    await member(mapId, outsider);
    await saveStudentAnalysis(mapId, outsider, input());
    for (const status of ["blocked", "left"]) {
      await execute("UPDATE app.map_members SET status=$3 WHERE map_id=$1 AND principal_id=$2", [mapId, outsider.principalId, status]);
      await expect(getStudentAnalysis(mapId, outsider)).rejects.toMatchObject({ status: 403 });
      await expect(saveStudentAnalysis(mapId, outsider, input())).rejects.toMatchObject({ status: 403 });
    }
  });

  it("allows archived own-report reading but denies changes and deleted-map access", async () => {
    const { session: owner } = await principal(), mapId = await map(owner);
    const report = await saveStudentAnalysis(mapId, owner, input());
    await execute("UPDATE app.maps SET status='archived' WHERE id=$1", [mapId]);
    expect(await getStudentAnalysis(mapId, owner)).toEqual(report);
    await expect(saveStudentAnalysis(mapId, owner, input([], { expectedVersion: 1 }))).rejects.toMatchObject({ status: 403, code: "MAP_ARCHIVED" });
    await execute("UPDATE app.maps SET status='deleted',deleted_at=now() WHERE id=$1", [mapId]);
    await expect(getStudentAnalysis(mapId, owner)).rejects.toMatchObject({ status: 404 });
  });

  it("validates same-map published evidence and final completeness before saving", async () => {
    const { session: owner } = await principal(), mapId = await map(owner), otherMap = await map(owner);
    const hidden = await observation(mapId, owner, "hidden"), pending = await observation(mapId, owner, "pending"), deleted = await observation(mapId, owner, "deleted"), foreign = await observation(otherMap, owner);
    for (const id of [hidden, pending, deleted, foreign, randomUUID()]) await expect(saveStudentAnalysis(mapId, owner, input([id]))).rejects.toMatchObject({ status: 409, code: "EVIDENCE_UNAVAILABLE" });
    const pointId = await observation(mapId, owner);
    await expect(saveStudentAnalysis(mapId, owner, input([pointId, pointId]))).rejects.toMatchObject({ status: 422, code: "DUPLICATE_EVIDENCE" });
    expect(studentAnalysisInputSchema.safeParse(input([], { status: "final" })).success).toBe(false);
    expect(studentAnalysisInputSchema.safeParse(input([pointId], { status: "final", analysis: "   " })).success).toBe(false);
    expect(studentAnalysisInputSchema.safeParse(input(Array.from({ length: 31 }, () => randomUUID()))).success).toBe(false);
    expect(await getStudentAnalysis(mapId, owner)).toBeNull();
    const draft = await saveStudentAnalysis(mapId, owner, input([], { title: "", analysis: "", proposal: "", reasoning: "" }));
    expect(draft.status).toBe("draft");
  });

  it("keeps independent reports and rejects lost updates, including first-save races", async () => {
    const { session: owner } = await principal(), { session: other } = await principal(), mapId = await map(owner);
    await member(mapId, other);
    const firstSaves = await Promise.allSettled([saveStudentAnalysis(mapId, owner, input()), saveStudentAnalysis(mapId, owner, input([], { title: "다른 창" }))]);
    expect(firstSaves.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(firstSaves.find(item => item.status === "rejected")).toMatchObject({ reason: { status: 409, code: "VERSION_CHANGED" } });
    const previous = (await getStudentAnalysis(mapId, owner))!;
    const updated = await saveStudentAnalysis(mapId, owner, input([], { expectedVersion: previous.version, title: "내 수정 글" }));
    expect(updated.version).toBe(2);
    await expect(saveStudentAnalysis(mapId, owner, input([], { expectedVersion: 1, title: "이전 화면" }))).rejects.toMatchObject({ status: 409, code: "VERSION_CHANGED" });
    const otherReport = await saveStudentAnalysis(mapId, other, input([], { title: "다른 학생 글" }));
    expect(otherReport.version).toBe(1);
    expect((await getStudentAnalysis(mapId, owner))!.title).toBe("내 수정 글");
    expect((await getStudentAnalysis(mapId, other))!.title).toBe("다른 학생 글");
  });

  it("uses backend-only RLS and permanently removes own reports with the deleted map", async () => {
    const { session: owner } = await principal(), mapId = await map(owner);
    const report = await saveStudentAnalysis(mapId, owner, input());
    const permissions = (await execute("SELECT has_table_privilege('anon','app.student_analysis_reports','SELECT') AS anon_read,has_table_privilege('authenticated','app.student_analysis_reports','SELECT') AS account_read,has_table_privilege('app_backend','app.student_analysis_reports','SELECT') AS backend_read,(SELECT relrowsecurity FROM pg_class WHERE oid='app.student_analysis_reports'::regclass) AS rls")).rows[0];
    expect(permissions).toEqual({ anon_read: false, account_read: false, backend_read: true, rls: true });
    await execute("DELETE FROM app.map_members WHERE map_id=$1", [mapId]);
    await execute("DELETE FROM app.maps WHERE id=$1", [mapId]);
    expect((await execute("SELECT id FROM app.student_analysis_reports WHERE id=$1", [report.id])).rows).toEqual([]);
  });

  it("guards HTTP writes with session, same-origin CSRF and sends private no-store responses", async () => {
    const credentials = await principal(), mapId = await map(credentials.session), context = { params: Promise.resolve({ mapId }) };
    expect((await GET(new NextRequest(`http://localhost:3001/api/v1/maps/${mapId}/student-analysis`), context)).status).toBe(401);
    const cookies = `moa_dev_session=${credentials.sessionToken}; moa_dev_csrf=${credentials.csrfToken}`;
    const makeRequest = (origin: string, csrf: string) => new NextRequest(`http://localhost:3001/api/v1/maps/${mapId}/student-analysis`, { method: "PUT", headers: { "Content-Type": "application/json", cookie: cookies, origin, "x-csrf-token": csrf }, body: JSON.stringify(input()) });
    expect((await PUT(makeRequest("https://other.example", credentials.csrfToken), context)).status).toBe(403);
    expect((await PUT(makeRequest("http://localhost:3001", "invalid"), context)).status).toBe(403);
    const response = await PUT(makeRequest("http://localhost:3001", credentials.csrfToken), context);
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect((await response.json()).data).toMatchObject({ version: 1, title: "내가 판단한 결과" });
    const read = await GET(new NextRequest(`http://localhost:3001/api/v1/maps/${mapId}/student-analysis`, { headers: { cookie: cookies } }), context);
    expect((await read.json()).data.analysis).toBe(input().analysis);
  });
});
