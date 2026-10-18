import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import type { AppSession } from "../src/server/auth/session";
import type { Theme } from "../src/lib/demo-data";

let db: PGlite, queue: Promise<unknown> = Promise.resolve();
const templates = new Map<string, Theme>();
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
vi.mock("../src/server/env", () => ({ getServerConfig: () => ({ appOrigin: "http://localhost:3001", invitePepper: "specialty-test-only-pepper" }) }));

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
      templates.set(theme.key, theme);
    }
  }
}, 30000);
afterAll(async () => db.close());

async function actor(role: "teacher" | "student" = "teacher"): Promise<AppSession> {
  const principalId = randomUUID();
  await execute("INSERT INTO app.principals(id,kind,auth_user_id,account_role) VALUES($1,'account',$2,$3)", [principalId, randomUUID(), role]);
  return { id: randomUUID(), principalId, kind: "account", csrfHash: Buffer.alloc(32), expiresAt: new Date(Date.now() + 86400000) };
}
async function fixture(key: string) {
  const teacher = await actor(), theme = templates.get(key)!, title = `${theme.label} ${randomUUID()}`;
  const created = await createMap(createMapSchema.parse({ themeKey: key, themeVersion: theme.version, title,
    locationLabel: "가상 조사 지역", visibility: "public", center: null }), teacher, randomUUID());
  return { teacher, title, theme, map: created.map };
}
function point(theme: Theme, index = 0, withAnswers = false) {
  const category = theme.categories[index];
  return observationSchema.parse({ configRevision: 1, title: `${theme.label} 관찰 ${index + 1}`, body: "안내 자료와 현장의 모습을 비교하며 지역의 특징을 기록했어요.",
    locationLabel: "가상 조사 장소", locationSource: index % 2 ? "search" : "manual", location: { lat: 37.5 + index / 1000, lng: 127 },
    categoryKey: category.key, emojiKey: category.emojiOptions.at(-1)!.key, ratingKey: null,
    answers: withAnswers ? Object.fromEntries(theme.questions.map(question => [question.key, ["직접 관찰하고 출처를 확인한 내용입니다."]])) : {},
    link: "https://example.com/specialty-source" });
}

describe.each(["heritage", "weather_data"])("%s shared map workflow", key => {
  it("lets teachers create the preset and retains every emoji and optional question without rating requirements", async () => {
    const f = await fixture(key), configuration = await getMapConfiguration(f.map.id, null), theme = configuration.theme!;
    expect(f.map).toMatchObject({ themeKey: key, center: null, capabilities: { canManageMap: true, canCreateObservation: true } });
    expect(theme).toMatchObject({ key, version: 1, pin: { mode: "category" }, rating: null, features: { ratingEnabled: false } });
    expect(theme.categories.map(category => ({ ...category, emojiOptions: category.emojiOptions.map(({ active: _active, ...emoji }) => emoji) }))).toEqual(f.theme.categories);
    expect(theme.questions).toEqual(f.theme.questions);
    expect(theme.questions.every(question => !question.required)).toBe(true);
    expect(new Set(theme.categories.map(category => category.key)).size).toBe(theme.categories.length);
    expect(theme.categories.reduce((sum, category) => sum + category.emojiOptions.length, 0)).toBeGreaterThanOrEqual(100);
    for (const category of theme.categories) {
      expect(category.emojiOptions.some(emoji => emoji.key === category.defaultEmojiKey)).toBe(true);
      expect(new Set(category.emojiOptions.map(emoji => emoji.key)).size).toBe(category.emojiOptions.length);
      expect(category.emojiOptions.every(emoji => emoji.glyph.length <= 16)).toBe(true);
    }
    const student = await actor("student");
    await expect(createMap(createMapSchema.parse({ themeKey: key, themeVersion: 1, title: "학생 개설 차단", locationLabel: "동네", visibility: "public" }), student, randomUUID())).rejects.toMatchObject({ code: "TEACHER_REQUIRED" });
  });

  it("registers manual and searched points without a GPS fix, then filters and analyzes those shared records", async () => {
    const f = await fixture(key), student = await actor("student");
    await joinMap(f.map.id, { nickname: "지역 탐험가" }, student);
    const ids: string[] = [];
    for (const index of f.theme.categories.keys()) {
      const requestKey = randomUUID(), input = point(f.theme, index, index === 0), saved = await createObservation(f.map.id, student, requestKey, input);
      ids.push(saved.observation.id);
      expect(saved.observation).toMatchObject({ locationSource: input.locationSource, location: input.location, status: "published", answers: input.answers, link: input.link });
      expect((await createObservation(f.map.id, student, requestKey, input)).observation.id).toBe(saved.observation.id);
    }
    expect((await listObservations(f.map.id, null)).items.map(record => record.id).sort()).toEqual(ids.sort());
    expect((await listMaps("public", null, 50, undefined, f.title, key)).items.map(map => map.id)).toEqual([f.map.id]);
    const all = await getAnalysis(f.map.id, null, {});
    expect(all.stats).toMatchObject({ total: f.theme.categories.length, byRating: null });
    expect(all.stats.byCategory.every(category => category.count === 1)).toBe(true);
    expect((await getAnalysis(f.map.id, null, { category: f.theme.categories[0].key })).stats.total).toBe(1);
    const csv = await exportCsv(f.map.id, f.teacher, {}, false, false);
    expect(csv).toContain(f.theme.categories[0].label);
    expect(csv).toContain(f.theme.questions[0].label);
    await expect(createObservation(f.map.id, student, randomUUID(), { ...point(f.theme), ratingKey: "improve" })).rejects.toMatchObject({ code: "RATING_NOT_ALLOWED" });
  });

  it("merges points without mutating the new preset or its source map", async () => {
    const f = await fixture(key), saved = await createObservation(f.map.id, f.teacher, randomUUID(), point(f.theme, 0, true));
    const other = await createMap(createMapSchema.parse({ themeKey: "ecology", themeVersion: 2, title: "다른 원본 지도", locationLabel: "가상 지역", visibility: "public" }), f.teacher, randomUUID());
    const original = await getMapConfiguration(f.map.id, f.teacher), preview = await previewMapMerge({ mapIds: [f.map.id, other.map.id] }, f.teacher);
    expect(preview.sources.find(source => source.id === f.map.id)).toMatchObject({ themeKey: key, pointCount: 1 });
    const merged = await createMergedMap(createMergedMapSchema.parse({ mapIds: preview.sources.map(source => source.id), title: "합친 지역 탐험 지도", locationLabel: "가상 지역", visibility: "public", pointIds: [saved.observation.id],
      sourceVersions: Object.fromEntries(preview.sources.map(source => [source.id, source.version])), pointVersions: { [saved.observation.id]: saved.observation.version } }), f.teacher, randomUUID());
    expect(merged).toMatchObject({ copiedPoints: 1, map: { themeKey: "custom" } });
    expect((await listObservations(merged.map.id, null)).items[0]).toMatchObject({ body: saved.observation.body, link: saved.observation.link });
    expect(await getMapConfiguration(f.map.id, f.teacher)).toEqual(original);
    expect((await execute("SELECT definition FROM app.theme_templates WHERE theme_key=$1 AND version=1", [key])).rows[0].definition).toEqual(f.theme);
  });
});
