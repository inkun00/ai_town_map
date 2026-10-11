import "server-only";
import { createHmac } from "node:crypto";
import type { PoolClient } from "pg";
import { aiSectionKeys, aiSuggestionInputSchema, type AiAvailability, type AiSuggestionInput, type AiSuggestions } from "@/domain/ai-analysis";
import type { Theme } from "@/lib/demo-data";
import type { AppSession } from "@/server/auth/session";
import { query, withTransaction } from "@/server/db";
import { getServerConfig } from "@/server/env";
import { ApiError } from "@/server/http";
import { aiAvailability, geminiConfig, generateGeminiSuggestions } from "@/server/ai/gemini";
import { readDataset } from "./analysis";
import { communityMap, requireMember, type CommunityMap } from "./community-access";

function requireActiveMember(map: CommunityMap) {
  requireMember(map);
  if (map.status !== "active") throw new ApiError(403, "MAP_ARCHIVED", "활동 중인 지도에서 AI 참고 제안을 만들 수 있어요.");
}

export async function getAiAvailability(mapId: string, session: AppSession): Promise<AiAvailability> {
  await withTransaction(async client => requireActiveMember(await communityMap(client, mapId, session)));
  return aiAvailability();
}

/** Independent HMAC scopes share the existing durable attempt table, never invite counters. */
export async function reserveAiAttempt(mapId: string, session: AppSession) {
  const pepper = getServerConfig().invitePepper;
  for (const [scope, limit] of [[`principal:${session.principalId}`, 3], [`map:${mapId}`, 60]] as const) {
    const hash = createHmac("sha256", pepper).update(`ai-suggestions:${scope}`).digest();
    const rows = await query<{ attempts: number }>(`INSERT INTO app_private.invite_attempts(actor_hash,window_start,attempts)
      VALUES($1,now(),1) ON CONFLICT(actor_hash) DO UPDATE SET
      attempts=CASE WHEN app_private.invite_attempts.window_start <= now()-interval '10 minutes' THEN 1 ELSE app_private.invite_attempts.attempts+1 END,
      window_start=CASE WHEN app_private.invite_attempts.window_start <= now()-interval '10 minutes' THEN now() ELSE app_private.invite_attempts.window_start END
      RETURNING attempts`, [hash]);
    if ((rows[0]?.attempts ?? limit + 1) > limit) throw new ApiError(429, "AI_RATE_LIMIT", "AI 제안을 여러 번 요청했어요. 최대 10분 후 다시 시도해 주세요.");
  }
}

const themeGuidance: Record<Theme["key"], string> = {
  ecology: "사용자가 작성한 생물과 환경 관찰 내용을 바탕으로 관계, 서로 비교할 장소, 더 조사할 생태 질문을 제안해요. 기록만으로 생물 종이나 개체 수를 확정하지 않아요.",
  safety: "반복될 수 있는 불편과 재확인할 환경, 학생의 안전한 실천과 어른에게 요청할 개선을 제안해요. 안전 판정이나 위험 순위를 만들지 않아요.",
  universal_design: "이동, 정보 안내, 소리 안내, 휴식, 안전에서 여러 사람이 느낄 편의와 불편을 생각해 보고 현장 확인 질문을 제안해요. 법적 기준 충족을 판정하지 않아요.",
  weather_life: "기록된 그늘, 물고임, 바람 등 생활 흔적을 비교하고 현장에서 확인할 질문을 제안해요. 기온, 기후 변화 원인이나 미래 날씨를 추정하지 않아요.",
  custom: "교사가 만든 분류와 조사 질문을 기준으로 공통점, 차이, 여러 사람의 관점과 다음 조사 질문을 제안해요.",
};

function safeText(value: string): string {
  // Direct contact details and URLs in free text are not useful evidence for a map suggestion.
  return value.replace(/https?:\/\/[^\s<>]+/gi, "[링크 제외]")
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[이메일 제외]")
    .replace(/\b(?:01[016789]|0[2-6][1-5]?)[- .]?\d{3,4}[- .]?\d{4}\b/g, "[전화번호 제외]");
}

function safeFacts<T>(value: T): T {
  if (typeof value === "string") return safeText(value) as T;
  if (Array.isArray(value)) return value.map(safeFacts) as T;
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, safeFacts(item)])) as T;
  return value;
}

type Dataset = Awaited<ReturnType<typeof readDataset>>;
function promptDataset(dataset: Dataset, themes: Map<number, Theme>) {
  const records = dataset.items.slice(0, 50).map(item => {
    const theme = themes.get(item.configRevision);
    if (!theme) throw new ApiError(409, "AI_SOURCE_CHANGED", "기록의 조사 설정을 확인하지 못했어요. 다시 불러와 주세요.");
    return {
      id: item.id, title: safeText(item.title), observation: safeText(item.body),
      category: safeText(theme.categories.find(category => category.key === item.categoryKey)?.label ?? item.categoryKey),
      rating: safeText(theme.rating?.options.find(option => option.key === item.ratingKey)?.label ?? "") || null,
      registeredAt: item.createdAt, idea: item.improvementIdea ? safeText(item.improvementIdea) : null,
      answers: theme.questions.map(question => ({ question: safeText(question.label), answers: (item.answers[question.key] ?? []).map(value =>
        safeText(value === "unknown" ? "확인 못함" : value === "na" ? "해당 없음" : question.type === "boolean" ? (value === "yes" ? "있음" : value === "no" ? "없음" : "해석할 수 없는 응답") : question.type === "text" ? value : question.options?.find(option => option.key === value)?.label ?? "해석할 수 없는 응답")) })),
    };
  });
  const data = {
    theme: { key: dataset.theme.key, label: safeText(dataset.theme.label), guidance: themeGuidance[dataset.theme.key] },
    facts: safeFacts(dataset.stats), totalRecords: dataset.stats.total, analyzedRecords: records.length,
    sourceScope: records.length < dataset.stats.total ? "이 조건의 최신 기록 50건만 내용 분석. 서버 집계는 조건에 맞는 전체 게시 기록 기준." : "이 조건에 맞는 게시 기록 내용과 서버 집계.",
    records,
  };
  if (Buffer.byteLength(JSON.stringify(data), "utf8") > 220 * 1024) throw new ApiError(422, "NARROW_FILTER", "AI가 참고할 기록이 많아요. 기간이나 유형을 좁혀 주세요.");
  return data;
}

async function loadSources(client: PoolClient, mapId: string, session: AppSession, input: AiSuggestionInput) {
  await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
  const dataset = await readDataset(client, mapId, session, input.filter);
  requireActiveMember(dataset.map);
  if (!dataset.items.length) throw new ApiError(422, "AI_NO_RECORDS", "게시된 기록이 있어야 AI가 참고 제안을 만들 수 있어요.");
  const revisions = await client.query<{ revision: number; definition: Theme }>("SELECT revision,definition FROM app.map_config_revisions WHERE map_id=$1", [mapId]);
  const prompt = promptDataset(dataset, new Map(revisions.rows.map(row => [row.revision, row.definition])));
  return { dataset, prompt };
}

export async function createAiSuggestions(mapId: string, session: AppSession, source: AiSuggestionInput, signal?: AbortSignal): Promise<AiSuggestions> {
  const input = aiSuggestionInputSchema.parse(source);
  const sources = await withTransaction(client => loadSources(client, mapId, session, input));
  const config = geminiConfig();
  if (signal?.aborted) throw new ApiError(499, "AI_REQUEST_CANCELLED", "AI 제안 요청을 취소했어요.");
  await reserveAiAttempt(mapId, session);
  const sections = await generateGeminiSuggestions(config, sources.prompt, signal);
  if (signal?.aborted) throw new ApiError(499, "AI_REQUEST_CANCELLED", "AI 제안 요청을 취소했어요.");
  const allowed = new Set(sources.prompt.records.map(item => item.id));
  for (const key of aiSectionKeys) for (const card of sections[key]) {
    if (new Set(card.evidenceIds).size !== card.evidenceIds.length || card.evidenceIds.some(id => !allowed.has(id))) {
      throw new ApiError(502, "AI_EVIDENCE_INVALID", "AI 제안의 근거를 확인하지 못했어요. 다시 시도해 주세요.");
    }
  }
  // Release the source transaction before any provider call, then recheck current access and revisions.
  await withTransaction(async client => {
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    const current = await readDataset(client, mapId, session, input.filter);
    requireActiveMember(current.map);
    if (current.dataRevision !== sources.dataset.dataRevision || current.meta.config_revision !== sources.dataset.meta.config_revision || current.filterFingerprint !== sources.dataset.filterFingerprint) throw new ApiError(409, "AI_SOURCE_CHANGED", "AI가 제안을 만드는 동안 기록이나 설정이 바뀌었어요. 새 기록으로 다시 요청해 주세요.");
    const latest = new Map(current.items.map(item => [item.id, item]));
    if (sources.dataset.items.slice(0, 50).some(item => latest.get(item.id)?.version !== item.version)) throw new ApiError(409, "AI_SOURCE_CHANGED", "근거 기록이 바뀌었어요. 새 기록으로 다시 요청해 주세요.");
  });
  if (signal?.aborted) throw new ApiError(499, "AI_REQUEST_CANCELLED", "AI 제안 요청을 취소했어요.");
  return { sections, dataRevision: sources.dataset.dataRevision, generatedAt: new Date().toISOString(), totalRecords: sources.dataset.stats.total, analyzedRecords: sources.prompt.records.length, filterFingerprint: sources.dataset.filterFingerprint, model: config.model };
}
