import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import sharp from "sharp";
import type { AppSession } from "../src/server/auth/session";
import { aiSectionKeys, type AiSuggestionSections } from "../src/domain/ai-analysis";

let db: PGlite, queue: Promise<unknown> = Promise.resolve(), transactionOpen = false;
const execute = async (sql: string, values: unknown[] = []) => {
  const result = await db.query(sql, values);
  return { ...result, rowCount: result.rows.length || result.affectedRows || 0, rows: result.rows.map(row => Object.fromEntries(Object.entries(row as Record<string, unknown>).map(([key, value]) => [key, value instanceof Uint8Array ? Buffer.from(value) : ["version", "data_revision"].includes(key) ? String(value) : value]))) };
};
vi.mock("../src/server/db", () => ({
  query: async (sql: string, values: unknown[] = []) => (await execute(sql, values)).rows,
  withTransaction: (action: (client: unknown) => unknown) => {
    const next = queue.then(async () => {
      await db.exec("BEGIN"); transactionOpen = true;
      try { const result = await action({ query: execute }); await db.exec("COMMIT"); return result; }
      catch (error) { await db.exec("ROLLBACK"); throw error; }
      finally { transactionOpen = false; }
    });
    queue = next.catch(() => {}); return next;
  },
}));
vi.mock("../src/server/env", () => ({ getServerConfig: () => ({ appOrigin: "http://localhost:3001", invitePepper: "ai-tests-independent-limit-scope-not-a-real-secret" }) }));

import { createMap, createMapSchema } from "../src/server/services/maps";
import { createObservation, observationSchema, savePhoto } from "../src/server/services/observations";
import { issueSession } from "../src/server/auth/session";
import { withTransaction } from "../src/server/db";
import { createAiSuggestions, getAiAvailability, reserveAiAttempt } from "../src/server/services/ai-suggestions";
import { aiAvailability, generateGeminiSuggestions } from "../src/server/ai/gemini";
import { GET, POST } from "../src/app/api/v1/maps/[mapId]/ai-suggestions/route";

type Prompt = { records: { id: string; answers: { question: string; answers: string[] }[] }[]; analyzedRecords: number; totalRecords: number };
let owner: AppSession, mapId: string, pointId: string, issued: Awaited<ReturnType<typeof issueSession>>;
const provider = vi.fn<typeof fetch>();
const input = () => ({ filter: {}, photoIds: [], photosConfirmed: false });
function sections(id: string, photoId?: string): AiSuggestionSections {
  return Object.fromEntries(aiSectionKeys.map(key => [key, key === "photoClues" ? (photoId ? [{ title: "사진 단서", suggestion: "사진 속 계단을 다시 확인해 볼까요?", evidenceIds: [photoId], photoId, checkQuestion: "계단 옆 다른 입구도 있나요?" }] : []) : [{ title: "살펴볼 제안", suggestion: "근거를 확인하고 생각을 정리해 볼 수 있어요.", evidenceIds: [id], checkQuestion: "현장에서 무엇을 더 확인할까요?" }]])) as AiSuggestionSections;
}
function response(data: unknown, finishReason = "STOP") {
  return new Response(JSON.stringify({ candidates: [{ finishReason, content: { parts: [{ text: JSON.stringify(data) }] } }] }), { headers: { "content-type": "application/json" } });
}
function promptFrom(call = 0): Prompt { return JSON.parse(JSON.parse(String(provider.mock.calls[call][1]?.body)).contents[0].parts[0].text); }
function request(body?: unknown, headers: Record<string, string> = {}) {
  return new NextRequest(`http://localhost:3001/api/v1/maps/${mapId}/ai-suggestions`, {
    method: body === undefined ? "GET" : "POST", headers: { origin: "http://localhost:3001", "content-type": "application/json", cookie: `moa_dev_session=${issued.sessionToken}; moa_dev_csrf=${issued.csrfToken}`, "x-csrf-token": issued.csrfToken, ...headers },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}
const context = () => ({ params: Promise.resolve({ mapId }) });

beforeAll(async () => {
  db = new PGlite(); await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  for (const file of ["001_core.sql", "002_observations.sql", "003_community_moderation.sql", "004_analysis_proposals.sql", "005_retention.sql", "006_exploration_games.sql", "007_account_roles_game_deletion.sql", "008_map_participation_passwords.sql", "009_student_identifiers.sql"]) await db.exec(await readFile(`db/migrations/${file}`, "utf8"));
  const preset = JSON.parse(await readFile("docs/contracts/theme-presets.json", "utf8")).templates.find((theme: { key: string }) => theme.key === "custom");
  await execute("INSERT INTO app.theme_templates(theme_key,version,definition) VALUES($1,$2,$3)", [preset.key, preset.version, JSON.stringify(preset)]);
}, 30000);
afterAll(async () => db.close());
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubEnv("GEMINI_STUDENT_USE_APPROVED", "true"); vi.stubEnv("GEMINI_API_KEY", "fake-provider-key"); vi.stubEnv("GEMINI_MODEL", "gemini-test-model");
  vi.stubGlobal("fetch", provider);
  provider.mockImplementation(async (_url, options) => {
    expect(transactionOpen).toBe(false);
    const body = JSON.parse(String(options?.body)), prompt: Prompt = JSON.parse(body.contents[0].parts[0].text);
    return response(sections(prompt.records[0].id));
  });
  await execute("DELETE FROM app_private.invite_attempts");
  const principalId = randomUUID();
  await execute("INSERT INTO app.principals(id,kind,auth_user_id,account_role) VALUES($1,'account',$2,'teacher')", [principalId, randomUUID()]);
  issued = await withTransaction(client => issueSession(client, principalId));
  owner = { id: randomUUID(), principalId, kind: "account", accountRole: "teacher", csrfHash: Buffer.alloc(32), expiresAt: new Date(Date.now() + 86400000) };
  const map = await createMap(createMapSchema.parse({ themeKey: "custom", themeVersion: 2, title: "AI 가상 조사 지도", locationLabel: "정밀 주소는 보내지 않음", visibility: "public", custom: { pinMode: "single", categories: [{ key: "nature", label: "나무", color: "#338855", defaultEmojiKey: "tree", emojiOptions: [{ key: "tree", glyph: "🌳", label: "나무" }] }] } }), owner, randomUUID());
  mapId = map.map.id;
  const point = await createObservation(mapId, owner, randomUUID(), observationSchema.parse({ configRevision: 1, title: "공원 입구 관찰", body: "출입구 계단을 기록했어요. 연락처 student@example.test 010-1234-5678 https://private.example.test", locationLabel: "노출하면 안 되는 상세 위치", locationSource: "manual", location: { lat: 37.123456, lng: 127.654321 }, categoryKey: "nature", emojiKey: "tree", ratingKey: null, answers: {}, link: "https://not-to-be-fetched.example.test" }));
  pointId = point.observation.id;
  await execute("UPDATE app.map_members SET nickname='PRIVATE_AUTHOR' WHERE map_id=$1", [mapId]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Gemini configuration and request access", () => {
  it("requires a configured model, key and explicit approved-use switch without leaking keys", () => {
    expect(aiAvailability()).toMatchObject({ ready: true, model: "gemini-test-model" });
    vi.stubEnv("GEMINI_STUDENT_USE_APPROVED", "false"); expect(aiAvailability()).toMatchObject({ ready: false, model: null });
    vi.stubEnv("GEMINI_STUDENT_USE_APPROVED", "true"); vi.stubEnv("GEMINI_API_KEY", ""); expect(aiAvailability().ready).toBe(false);
    vi.stubEnv("GEMINI_API_KEY", "fake-provider-key"); vi.stubEnv("GEMINI_MODEL", ""); expect(aiAvailability().ready).toBe(false);
    vi.stubEnv("GEMINI_MODEL", "gemini-test?key=bad"); expect(aiAvailability()).toMatchObject({ ready: false, model: null });
    expect(JSON.stringify(aiAvailability())).not.toContain("fake-provider-key"); expect(provider).not.toHaveBeenCalled();
  });

  it("requires a valid session, active membership and same-origin CSRF before sending records", async () => {
    expect((await GET(request(undefined, { cookie: "" }), context())).status).toBe(401);
    expect((await POST(request(input(), { cookie: "" }), context())).status).toBe(401);
    expect((await POST(request(input(), { origin: "https://outside.example" }), context())).status).toBe(403);
    expect((await POST(request(input(), { "x-csrf-token": "wrong" }), context())).status).toBe(403);
    const outsider = { ...owner, principalId: randomUUID() };
    await expect(getAiAvailability(mapId, outsider)).rejects.toMatchObject({ code: "MEMBERSHIP_REQUIRED" });
    await execute("UPDATE app.map_members SET status='blocked' WHERE map_id=$1", [mapId]);
    await expect(createAiSuggestions(mapId, owner, input())).rejects.toMatchObject({ code: "MEMBERSHIP_REQUIRED" });
    expect(provider).not.toHaveBeenCalled();
  });

  it("returns availability to an active participant and rejects archived maps and unavailable provider setup", async () => {
    expect((await (await GET(request(), context())).json()).data).toMatchObject({ ready: true, model: "gemini-test-model" });
    vi.stubEnv("GEMINI_MODEL", "");
    await expect(createAiSuggestions(mapId, owner, input())).rejects.toMatchObject({ code: "AI_NOT_CONFIGURED" });
    await execute("UPDATE app.maps SET status='archived' WHERE id=$1", [mapId]);
    await expect(getAiAvailability(mapId, owner)).rejects.toMatchObject({ code: "MAP_ARCHIVED" });
    expect(provider).not.toHaveBeenCalled();
  });
});

describe("bounded source evidence and privacy", () => {
  it("sends only validated, published evidence and authoritative counts; excludes authors, precise locations, URLs and contact details", async () => {
    const definition = (await execute("SELECT definition FROM app.map_config_revisions WHERE map_id=$1 AND revision=1", [mapId])).rows[0].definition as { categories: { label: string }[] };
    definition.categories[0].label = "나무 class@example.test";
    await execute("UPDATE app.map_config_revisions SET definition=$2 WHERE map_id=$1 AND revision=1", [mapId, JSON.stringify(definition)]);
    const result = await POST(request(input()), context());
    expect(result.status).toBe(200);
    const data = (await result.json()).data;
    expect(data).toMatchObject({ totalRecords: 1, analyzedRecords: 1, model: "gemini-test-model", photoIds: [] });
    expect(Object.keys(data.sections)).toEqual([...aiSectionKeys]);
    const [url, options] = provider.mock.calls[0];
    expect(url).toBe("https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent");
    expect(url).not.toContain("fake-provider-key"); expect(options?.headers).toMatchObject({ "x-goog-api-key": "fake-provider-key" });
    expect(options?.redirect).toBe("error"); expect(options?.signal).toBeInstanceOf(AbortSignal);
    const body = JSON.parse(String(options?.body));
    expect(body.generationConfig).toMatchObject({ responseFormat: { text: { mimeType: "APPLICATION_JSON" } }, maxOutputTokens: 8192 });
    const schema = body.generationConfig.responseFormat.text.schema;
    expect(schema.required).toEqual([...aiSectionKeys]);
    expect(body.generationConfig.responseJsonSchema).toBeUndefined();
    expect(body.generationConfig.responseMimeType).toBeUndefined();
    expect(schema.properties.discoveries).not.toHaveProperty("minItems");
    expect(schema.properties.discoveries).not.toHaveProperty("maxItems");
    for (const property of Object.values(schema.properties.discoveries.items.properties)) {
      expect(property).not.toHaveProperty("minLength");
      expect(property).not.toHaveProperty("maxLength");
    }
    const submitted = JSON.stringify(promptFrom());
    for (const privateValue of ["PRIVATE_AUTHOR", "37.123456", "127.654321", "노출하면 안 되는 상세 위치", "student@example.test", "class@example.test", "010-1234-5678", "private.example.test", "not-to-be-fetched"]) expect(submitted).not.toContain(privateValue);
    expect(submitted).toContain("[이메일 제외]"); expect(provider).toHaveBeenCalledTimes(1);
  });

  it("labels answers with their original configuration revision instead of the current question meaning", async () => {
    const old = (await execute("SELECT definition FROM app.map_config_revisions WHERE map_id=$1 AND revision=1", [mapId])).rows[0].definition as { questions: unknown[] };
    old.questions = [{ key: "rest", label: "옛 질문: 벤치가 있나요?", type: "boolean", required: false, allowUnknown: true, allowNotApplicable: true }];
    await execute("UPDATE app.map_config_revisions SET definition=$2 WHERE map_id=$1 AND revision=1", [mapId, JSON.stringify(old)]);
    const current = { ...old, questions: [{ key: "rest", label: "새 질문: 안내판이 있나요?", type: "boolean", required: false, allowUnknown: true, allowNotApplicable: true }] };
    await execute("INSERT INTO app.map_config_revisions(map_id,revision,definition,created_by) VALUES($1,2,$2,$3)", [mapId, JSON.stringify(current), owner.principalId]);
    await execute("UPDATE app.maps SET config_revision=2 WHERE id=$1", [mapId]);
    await execute("UPDATE app.observations SET answers=$2 WHERE id=$1", [pointId, JSON.stringify({ rest: ["yes"] })]);
    await createAiSuggestions(mapId, owner, input());
    expect(promptFrom().records[0].answers).toEqual([{ question: "옛 질문: 벤치가 있나요?", answers: ["있음"] }]);
  });

  it("limits content to the latest 50 records while keeping the full filtered count", async () => {
    await execute(`INSERT INTO app.observations(map_id,author_member_id,title,body,location_label,location_source,lat,lng,category_id,emoji_option_id,rating_option_id,answers,status,config_revision)
      SELECT map_id,author_member_id,title,body,location_label,location_source,lat,lng,category_id,emoji_option_id,rating_option_id,answers,status,config_revision FROM app.observations CROSS JOIN generate_series(1,50) WHERE id=$1`, [pointId]);
    const result = await createAiSuggestions(mapId, owner, input());
    expect(result.totalRecords).toBe(51); expect(result.analyzedRecords).toBe(50); expect(promptFrom().records).toHaveLength(50);
  });

  it("rejects missing or duplicate photo consent and does not transmit an unsolicited photo", async () => {
    expect((await POST(request({ ...input(), photoIds: [pointId] }), context())).status).toBe(422);
    await expect(createAiSuggestions(mapId, owner, { ...input(), photoIds: [pointId, pointId], photosConfirmed: true })).rejects.toMatchObject({ code: "AI_PHOTO_DUPLICATE" });
    await expect(createAiSuggestions(mapId, owner, { ...input(), photoIds: [randomUUID()], photosConfirmed: true })).rejects.toMatchObject({ code: "AI_PHOTO_UNAVAILABLE" });
    expect(provider).not.toHaveBeenCalled();
  });

  it("resizes only a selected published photograph, strips metadata and binds photo clues to its observation", async () => {
    const bytes = await sharp({ create: { width: 1500, height: 1000, channels: 3, background: "green" } }).jpeg().toBuffer();
    await savePhoto(mapId, pointId, owner, bytes);
    provider.mockImplementation(async (_url, options) => {
      expect(transactionOpen).toBe(false);
      const body = JSON.parse(String(options?.body)), parts = body.contents[0].parts;
      expect(parts).toHaveLength(3); expect(parts[1].text).toContain(pointId);
      expect(parts[2].inlineData.mimeType).toBe("image/webp");
      const sent = Buffer.from(parts[2].inlineData.data, "base64"), metadata = await sharp(sent).metadata();
      expect(metadata.width).toBeLessThanOrEqual(768); expect(metadata.height).toBeLessThanOrEqual(768); expect(metadata.exif).toBeUndefined(); expect(sent.length).toBeLessThanOrEqual(250 * 1024);
      return response(sections(pointId, pointId));
    });
    const result = await createAiSuggestions(mapId, owner, { ...input(), photoIds: [pointId], photosConfirmed: true });
    expect(result.photoIds).toEqual([pointId]); expect(result.sections.photoClues[0].photoId).toBe(pointId);
  });

  it("does not analyze hidden records even for the map owner", async () => {
    await execute("UPDATE app.observations SET status='hidden' WHERE id=$1", [pointId]);
    await expect(createAiSuggestions(mapId, owner, input())).rejects.toMatchObject({ code: "AI_NO_RECORDS" });
    expect(provider).not.toHaveBeenCalled();
  });

  it("requires a photo clue when a consented photo was included", async () => {
    const bytes = await sharp({ create: { width: 12, height: 12, channels: 3, background: "green" } }).webp().toBuffer();
    await savePhoto(mapId, pointId, owner, bytes);
    await expect(createAiSuggestions(mapId, owner, { ...input(), photoIds: [pointId], photosConfirmed: true })).rejects.toMatchObject({ code: "AI_RESPONSE_INCOMPLETE" });
  });

  it("rejects photos older than the latest 50 rather than claiming to analyze records it did not send", async () => {
    const bytes = await sharp({ create: { width: 12, height: 12, channels: 3, background: "green" } }).webp().toBuffer();
    await savePhoto(mapId, pointId, owner, bytes);
    await execute("UPDATE app.observations SET created_at='2020-01-01' WHERE id=$1", [pointId]);
    await execute(`INSERT INTO app.observations(map_id,author_member_id,title,body,location_label,location_source,lat,lng,category_id,emoji_option_id,rating_option_id,answers,status,config_revision)
      SELECT map_id,author_member_id,title,body,location_label,location_source,lat,lng,category_id,emoji_option_id,rating_option_id,answers,status,config_revision FROM app.observations CROSS JOIN generate_series(1,50) WHERE id=$1`, [pointId]);
    await expect(createAiSuggestions(mapId, owner, { ...input(), photoIds: [pointId], photosConfirmed: true })).rejects.toMatchObject({ code: "AI_PHOTO_UNAVAILABLE" });
    expect(provider).not.toHaveBeenCalled();
  });
});

describe("provider evidence validation and stale results", () => {
  it.each(["unknown-id", "duplicate-evidence", "unselected-photo", "extra-metadata", "missing-section", "empty-section", "oversized-section", "oversized-text"])("rejects an invalid provider result: %s", async kind => {
    const data: Record<string, unknown> = sections(pointId);
    if (kind === "unknown-id") (data.discoveries as { evidenceIds: string[] }[])[0].evidenceIds = [randomUUID()];
    if (kind === "duplicate-evidence") (data.discoveries as { evidenceIds: string[] }[])[0].evidenceIds = [pointId, pointId];
    if (kind === "unselected-photo") data.photoClues = sections(pointId, pointId).photoClues;
    if (kind === "extra-metadata") data.totalRecords = 99999;
    if (kind === "missing-section") delete data.improvements;
    if (kind === "empty-section") data.groups = [];
    if (kind === "oversized-section") data.groups = Array.from({ length: 7 }, () => sections(pointId).groups[0]);
    if (kind === "oversized-text") data.groups = [{ ...sections(pointId).groups[0], suggestion: "가".repeat(1801) }];
    provider.mockResolvedValue(response(data));
    await expect(createAiSuggestions(mapId, owner, input())).rejects.toMatchObject({ status: 502 });
  });

  it.each(["MAX_TOKENS", "SAFETY", "RECITATION"])("does not accept incomplete or blocked %s responses", async finishReason => {
    provider.mockResolvedValue(response(sections(pointId), finishReason));
    await expect(createAiSuggestions(mapId, owner, input())).rejects.toMatchObject({ code: "AI_RESPONSE_INCOMPLETE" });
  });

  it("does not return an earlier report after source revisions change during the provider request", async () => {
    provider.mockImplementation(async () => { await execute("UPDATE app.maps SET data_revision=data_revision+1 WHERE id=$1", [mapId]); return response(sections(pointId)); });
    await expect(createAiSuggestions(mapId, owner, input())).rejects.toMatchObject({ code: "AI_SOURCE_CHANGED", status: 409 });
  });

  it("detects a changed evidence version even if a writer forgot to increment the aggregate revision", async () => {
    provider.mockImplementation(async () => { await execute("UPDATE app.observations SET version=version+1 WHERE id=$1", [pointId]); return response(sections(pointId)); });
    await expect(createAiSuggestions(mapId, owner, input())).rejects.toMatchObject({ code: "AI_SOURCE_CHANGED" });
  });

  it("detects a new question configuration even if record counts did not change", async () => {
    provider.mockImplementation(async () => {
      await execute("INSERT INTO app.map_config_revisions(map_id,revision,definition,created_by) SELECT map_id,2,definition,created_by FROM app.map_config_revisions WHERE map_id=$1 AND revision=1", [mapId]);
      await execute("UPDATE app.maps SET config_revision=2 WHERE id=$1", [mapId]);
      return response(sections(pointId));
    });
    await expect(createAiSuggestions(mapId, owner, input())).rejects.toMatchObject({ code: "AI_SOURCE_CHANGED" });
  });

  it("rechecks membership and visibility after a provider response", async () => {
    provider.mockImplementation(async () => { await execute("UPDATE app.map_members SET status='blocked' WHERE map_id=$1", [mapId]); return response(sections(pointId)); });
    await expect(createAiSuggestions(mapId, owner, input())).rejects.toMatchObject({ code: "MEMBERSHIP_REQUIRED" });
  });

  it("rejects a result when the source map is deleted during generation", async () => {
    provider.mockImplementation(async () => { await execute("UPDATE app.maps SET status='deleted',deleted_at=now() WHERE id=$1", [mapId]); return response(sections(pointId)); });
    await expect(createAiSuggestions(mapId, owner, input())).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("maps provider errors without exposing the upstream error or retrying paid requests", async () => {
    provider.mockResolvedValue(new Response("private-key-and-provider-diagnostics", { status: 403 }));
    await expect(createAiSuggestions(mapId, owner, input())).rejects.toMatchObject({ code: "AI_PROVIDER_UNAVAILABLE", status: 502 });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("rejects oversized provider bodies and malformed JSON", async () => {
    provider.mockResolvedValue(new Response("x".repeat(257 * 1024)));
    await expect(createAiSuggestions(mapId, owner, input())).rejects.toMatchObject({ code: "AI_RESPONSE_INVALID" });
    provider.mockResolvedValue(new Response("not-json"));
    await expect(createAiSuggestions(mapId, owner, input())).rejects.toMatchObject({ code: "AI_RESPONSE_INVALID" });
  });

  it("does not send an already cancelled request", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(createAiSuggestions(mapId, owner, input(), controller.signal)).rejects.toMatchObject({ code: "AI_REQUEST_CANCELLED" });
    expect(provider).not.toHaveBeenCalled();
  });

  it("cancels provider work when the caller leaves, without a second request", async () => {
    provider.mockImplementation(async (_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true })));
    const controller = new AbortController(), pending = generateGeminiSuggestions({ key: "fake", model: "gemini-test-model" }, {}, [], controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ code: "AI_REQUEST_CANCELLED", status: 499 });
    expect(provider).toHaveBeenCalledTimes(1);
  });

  it("bounds a stalled provider request to 45 seconds", async () => {
    vi.useFakeTimers();
    try {
      provider.mockImplementation(async (_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new DOMException("timeout", "AbortError")), { once: true })));
      const pending = generateGeminiSuggestions({ key: "fake", model: "gemini-test-model" }, {}, []);
      const checked = expect(pending).rejects.toMatchObject({ code: "AI_REQUEST_CANCELLED", status: 504 });
      await vi.advanceTimersByTimeAsync(45_000); await checked;
      expect(provider).toHaveBeenCalledTimes(1);
    } finally { vi.useRealTimers(); }
  });
});

describe("durable independent provider request budget", () => {
  it("persists the user limit across repeated requests and permits retry after its time window", async () => {
    for (let index = 0; index < 3; index++) await createAiSuggestions(mapId, owner, input());
    await expect(createAiSuggestions(mapId, owner, input())).rejects.toMatchObject({ code: "AI_RATE_LIMIT", status: 429 });
    expect(provider).toHaveBeenCalledTimes(3);
    const counters = (await execute("SELECT attempts FROM app_private.invite_attempts")).rows.map(row => row.attempts);
    expect(counters.sort()).toEqual([3, 4]);
    await execute("UPDATE app_private.invite_attempts SET window_start=now()-interval '11 minutes'");
    await createAiSuggestions(mapId, owner, input()); expect(provider).toHaveBeenCalledTimes(4);
  });

  it("also enforces a map budget across different principals without touching invite scopes", async () => {
    await reserveAiAttempt(mapId, owner);
    await execute("UPDATE app_private.invite_attempts SET attempts=60 WHERE attempts=1");
    await expect(reserveAiAttempt(mapId, { ...owner, principalId: randomUUID() })).rejects.toMatchObject({ code: "AI_RATE_LIMIT" });
    expect(provider).not.toHaveBeenCalled();
  });
});
