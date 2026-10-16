import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { AppSession } from "../src/server/auth/session";
import type { Theme } from "../src/lib/demo-data";

let db: PGlite, queue: Promise<unknown> = Promise.resolve(), tourism: Theme;
const execute = async (sql: string, values: unknown[] = []) => {
  const result = await db.query(sql, values);
  return { ...result, rowCount: result.rows.length || result.affectedRows || 0,
    rows: result.rows.map(row => Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) =>
      [key, value instanceof Uint8Array ? Buffer.from(value) : ["version", "data_revision"].includes(key) ? String(value) : value]))) };
};
vi.mock("../src/server/db", () => ({
  query: async (sql: string, values: unknown[] = []) => (await execute(sql, values)).rows,
  withTransaction: (action: (client: unknown) => unknown) => {
    const next = queue.then(async () => {
      await db.exec("BEGIN");
      try { const result = await action({ query: execute }); await db.exec("COMMIT"); return result; }
      catch (error) { await db.exec("ROLLBACK"); throw error; }
    });
    queue = next.catch(() => {}); return next;
  },
}));
vi.mock("../src/server/env", () => ({ getServerConfig: () => ({ appOrigin: "http://localhost:3001", invitePepper: "tourism-test-only-pepper" }) }));

import { createMap, createMapSchema, getMapConfiguration, listMaps } from "../src/server/services/maps";
import { createObservation, listObservations, observationSchema } from "../src/server/services/observations";
import { getAnalysis, exportCsv } from "../src/server/services/analysis";
import { joinMap } from "../src/server/services/map-joining";
import { previewMapMerge, createMergedMap, createMergedMapSchema } from "../src/server/services/map-merge";

beforeAll(async () => {
  db = new PGlite(); await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  for (const name of ["001_core.sql", "002_observations.sql", "003_community_moderation.sql", "004_analysis_proposals.sql", "005_retention.sql", "006_exploration_games.sql", "007_account_roles_game_deletion.sql", "008_map_participation_passwords.sql", "009_student_identifiers.sql", "010_student_analysis.sql"])
    await db.exec(await readFile(`db/migrations/${name}`, "utf8"));
  for (const path of ["docs/contracts/theme-presets-v1.json", "docs/contracts/theme-presets.json"]) {
    const source = JSON.parse(await readFile(path, "utf8"));
    for (const theme of source.templates as Theme[]) {
      await execute("INSERT INTO app.theme_templates(theme_key,version,definition) VALUES($1,$2,$3) ON CONFLICT DO NOTHING", [theme.key, theme.version, JSON.stringify(theme)]);
      if (theme.key === "tourism") tourism = theme;
    }
  }
}, 30000);
afterAll(async () => db.close());

async function actor(role: "teacher" | "student" = "teacher"): Promise<AppSession> {
  const principalId = randomUUID();
  await execute("INSERT INTO app.principals(id,kind,auth_user_id,account_role) VALUES($1,'account',$2,$3)", [principalId, randomUUID(), role]);
  return { id: randomUUID(), principalId, kind: "account", csrfHash: Buffer.alloc(32), expiresAt: new Date(Date.now() + 86400000) };
}
async function fixture() {
  const teacher = await actor(), title = `관광 조사 ${randomUUID()}`;
  const created = await createMap(createMapSchema.parse({ themeKey: "tourism", themeVersion: tourism.version, title,
    locationLabel: "가상 관광 지역", visibility: "public" }), teacher, randomUUID());
  return { teacher, title, map: created.map };
}
function point(category = tourism.categories[0], index = 0) {
  const answers = Object.fromEntries(tourism.questions.map(question => [question.key,
    question.type === "text" ? ["현장 안내판을 읽고 방문 특징을 기록했어요."] : question.type === "boolean" ? ["yes"] : [question.options![0].key]]));
  return observationSchema.parse({ configRevision: 1, title: `관광 장소 ${index + 1}`, body: "직접 둘러보며 장소의 특징과 방문객을 위한 안내를 기록했어요.",
    locationLabel: "가상 관광 장소", locationSource: "manual", location: { lat: 37.5 + index / 1000, lng: 127 },
    categoryKey: category.key, emojiKey: category.emojiOptions.at(-1)!.key, ratingKey: null, answers, link: "https://example.com/tourism" });
}

describe("tourism preset with the shared map workflow", () => {
  it("creates a teacher-owned public map and installs every category, emoji and question without adding rating rules", async () => {
    const f = await fixture(), config = await getMapConfiguration(f.map.id, null), theme = config.theme!;
    expect(f.map).toMatchObject({ themeKey: "tourism", visibility: "public", capabilities: { canManageMap: true, canCreateObservation: true } });
    expect(theme).toMatchObject({ key: "tourism", version: tourism.version, pin: { mode: "category" }, rating: null, features: { ratingEnabled: false } });
    expect(theme.categories.map(category => category.key)).toEqual(tourism.categories.map(category => category.key));
    expect(theme.questions).toEqual(tourism.questions);
    const stored = (await execute(`SELECT (SELECT count(*)::int FROM app.categories WHERE map_id=$1) AS categories,
      (SELECT count(*)::int FROM app.emoji_options WHERE map_id=$1) AS emojis,
      (SELECT count(*)::int FROM app.questions q JOIN app.question_versions v ON v.id=q.current_version_id AND v.map_id=q.map_id WHERE q.map_id=$1) AS questions,
      (SELECT count(*)::int FROM app.rating_options WHERE map_id=$1) AS ratings`, [f.map.id])).rows[0];
    expect(stored).toEqual({ categories: tourism.categories.length, emojis: tourism.categories.reduce((sum, category) => sum + category.emojiOptions.length, 0), questions: tourism.questions.length, ratings: 0 });
    const student = await actor("student");
    await expect(createMap(createMapSchema.parse({ themeKey: "tourism", themeVersion: tourism.version, title: "학생 개설 차단", locationLabel: "동네", visibility: "public" }), student, randomUUID())).rejects.toMatchObject({ code: "TEACHER_REQUIRED" });
  });

  it("lets participating students register all tourism categories and use shared filters, counts, answers and CSV export", async () => {
    const f = await fixture(), student = await actor("student");
    await joinMap(f.map.id, { nickname: "관광 탐험가" }, student);
    const ids: string[] = [];
    for (const [index, category] of tourism.categories.entries()) {
      const key = randomUUID(), input = point(category, index), saved = await createObservation(f.map.id, student, key, input);
      ids.push(saved.observation.id);
      expect(saved.observation).toMatchObject({ categoryKey: category.key, emojiKey: category.emojiOptions.at(-1)!.key,
        status: "published", author: "관광 탐험가", link: input.link, answers: input.answers });
      expect((await createObservation(f.map.id, student, key, input)).observation.id).toBe(saved.observation.id);
    }
    const ecology = await createMap(createMapSchema.parse({ themeKey: "ecology", themeVersion: 2, title: f.title, locationLabel: "가상 관광 지역", visibility: "public" }), f.teacher, randomUUID());
    const directory = await listMaps("public", null, 50, undefined, f.title, "tourism");
    expect(directory.items.map(map => map.id)).toEqual([f.map.id]);
    expect(directory.items.map(map => map.id)).not.toContain(ecology.map.id);
    expect((await listObservations(f.map.id, null)).items.map(item => item.id).sort()).toEqual(ids.sort());
    const all = await getAnalysis(f.map.id, null, {});
    expect(all.stats).toMatchObject({ total: tourism.categories.length, byRating: null });
    expect(all.stats.byCategory.every(category => category.count === 1)).toBe(true);
    const category = tourism.categories[0], filtered = await getAnalysis(f.map.id, null, { category: category.key });
    expect(filtered.stats.total).toBe(1);
    expect(filtered.items[0].categoryKey).toBe(category.key);
    const question = tourism.questions.find(question => question.type !== "text");
    if (question) {
      const answer = question.type === "boolean" ? "yes" : question.options![0].key;
      expect((await getAnalysis(f.map.id, student, { question: question.key, answer })).stats.total).toBe(tourism.categories.length);
    }
    const csv = await exportCsv(f.map.id, f.teacher, {}, false, false);
    expect(csv).toContain(category.label);
    expect(csv).toContain(category.emojiOptions.at(-1)!.glyph);
    expect(csv).toContain(tourism.questions[0].label);
    const before = (await listObservations(f.map.id, student)).items.length;
    await expect(createObservation(f.map.id, student, randomUUID(), { ...point(), ratingKey: "improve" })).rejects.toMatchObject({ code: "RATING_NOT_ALLOWED" });
    await expect(createObservation(f.map.id, student, randomUUID(), { ...point(), categoryKey: "unrelated-category" })).rejects.toMatchObject({ code: "INVALID_EMOJI" });
    expect((await listObservations(f.map.id, student)).items).toHaveLength(before);
  });

  it("previews and merges tourism records without changing the source map or template", async () => {
    const f = await fixture(), saved = await createObservation(f.map.id, f.teacher, randomUUID(), point());
    const other = await createMap(createMapSchema.parse({ themeKey: "ecology", themeVersion: 2, title: "다른 주제 원본", locationLabel: "가상 지역", visibility: "public" }), f.teacher, randomUUID());
    const source = await getMapConfiguration(f.map.id, f.teacher);
    const preview = await previewMapMerge({ mapIds: [f.map.id, other.map.id] }, f.teacher);
    expect(preview.sources.find(item => item.id === f.map.id)).toMatchObject({ themeKey: "tourism", pointCount: 1 });
    expect(preview.points).toHaveLength(1);
    expect(preview.points[0]).toMatchObject({ id: saved.observation.id, categoryKey: tourism.categories[0].key,
      emoji: { glyph: tourism.categories[0].emojiOptions.at(-1)!.glyph }, ratingKey: null });
    const merged = await createMergedMap(createMergedMapSchema.parse({ mapIds: preview.sources.map(item => item.id),
      title: "관광 기록을 담은 합친 지도", locationLabel: "가상 지역", visibility: "public", pointIds: [saved.observation.id],
      sourceVersions: Object.fromEntries(preview.sources.map(item => [item.id, item.version])),
      pointVersions: { [saved.observation.id]: saved.observation.version } }), f.teacher, randomUUID());
    expect(merged).toMatchObject({ copiedPoints: 1, map: { themeKey: "custom" } });
    expect((await listObservations(merged.map.id, null)).items[0]).toMatchObject({ body: saved.observation.body, link: saved.observation.link });
    expect(await getMapConfiguration(f.map.id, f.teacher)).toEqual(source);
    const published = (await execute("SELECT definition FROM app.theme_templates WHERE theme_key='tourism' AND version=$1", [tourism.version])).rows[0].definition;
    expect(published).toEqual(tourism);
  });
});
