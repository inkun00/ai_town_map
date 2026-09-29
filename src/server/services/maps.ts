import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { z } from "zod";
import { type Theme, type ThemeKey } from "@/lib/demo-data";
import { buildMapTheme, validCustomCategories } from "@/domain/map-theme";
import { query, withTransaction } from "../db";
import { ApiError } from "../http";
import type { AppSession } from "../auth/session";
import { canManageMap, canReadMap, type MapPolicyInput, type MemberPolicyInput } from "../policies/maps";

const emojiSchema = z.strictObject({ key: z.string().min(1).max(60), glyph: z.string().min(1).max(16), label: z.string().min(1).max(60) });
const categorySchema = z.strictObject({ key: z.string().min(1).max(60), label: z.string().min(1).max(40), color: z.string().regex(/^#[0-9a-fA-F]{6}$/), defaultEmojiKey: z.string(), emojiOptions: z.array(emojiSchema).min(1).max(8) });
export const createMapSchema = z.strictObject({
  themeKey: z.enum(["universal_design", "safety", "ecology", "weather_life", "custom"]),
  themeVersion: z.literal(1),
  title: z.string().trim().min(2).max(60),
  description: z.string().trim().max(300).default(""),
  locationLabel: z.string().trim().min(1).max(120),
  activityContext: z.enum(["school", "community"]).default("community"),
  visibility: z.enum(["public", "invite_only"]),
  participation: z.enum(["invited", "admin_only", "closed"]).default("invited"),
  moderation: z.enum(["immediate", "approval"]).default("immediate"),
  center: z.strictObject({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }).nullable().default(null),
  initialZoom: z.number().int().min(1).max(14).default(5),
  proposalsEnabled: z.boolean().optional(),
  commentsEnabled:z.boolean().optional(),
  custom: z.strictObject({ categories: z.array(categorySchema).min(1).max(12), pinMode: z.enum(["single", "category", "rating"]) }).optional(),
});
export type CreateMapInput = z.infer<typeof createMapSchema>;

type MapRow = QueryResultRow & {
  id: string; owner_principal_id: string; theme_key: ThemeKey; title: string; description: string;
  location_label: string; activity_context: "school" | "community"; visibility: "public" | "invite_only";
  participation: "invited" | "admin_only" | "closed";
  status: MapPolicyInput["status"]; pin_mode: Theme["pin"]["mode"]; rating_enabled: boolean;
  ideas_enabled: boolean; proposals_enabled: boolean; comments_enabled: boolean; config_revision: number;
  version: string; created_at: Date; member_role?: "admin" | "participant" | null; member_status?: "active" | "blocked" | "left" | null;
  center_lat: number | null; center_lng: number | null; initial_zoom: number;deleted_at:Date|null;
};

function mapDto(row: MapRow, principalId: string | null) {
  const member = row.member_status ? { status: row.member_status, role: row.member_role! } : null;
  return {
    id: row.id, title: row.title, description: row.description, themeKey: row.theme_key,
    location: row.location_label, center: row.center_lat === null ? null : { lat: row.center_lat, lng: row.center_lng }, initialZoom: row.initial_zoom, activityContext: row.activity_context, visibility: row.visibility,
    status: row.status, participation:row.participation, moderation:row.moderation, commentsEnabled:row.comments_enabled, isMine: member?.status === "active", isOwner: principalId === row.owner_principal_id,
    capabilities: { canRead: canReadMap(principalId, { visibility: row.visibility, status: row.status, ownerPrincipalId: row.owner_principal_id }, member), canManageMap: canManageMap(principalId, { visibility: row.visibility, status: row.status, ownerPrincipalId: row.owner_principal_id }, member), canModerate:canManageMap(principalId,{visibility:row.visibility,status:row.status,ownerPrincipalId:row.owner_principal_id},member),canComment:member?.status==="active"&&row.status==="active"&&row.comments_enabled, canCreateObservation: member?.status === "active" && row.status === "active" && (row.participation === "invited" || (row.participation === "admin_only" && (principalId === row.owner_principal_id || member.role === "admin"))) },
    configRevision: row.config_revision, version: row.version, createdAt: row.created_at,deletedAt:row.deleted_at,
  };
}

async function readMap(client: PoolClient, mapId: string, principalId: string | null): Promise<MapRow | null> {
  const result = await client.query<MapRow>(
    `SELECT m.*, mm.role AS member_role, mm.status AS member_status
       FROM app.maps m LEFT JOIN app.map_members mm ON mm.map_id = m.id AND mm.principal_id = $2
      WHERE m.id = $1`, [mapId, principalId]);
  return result.rows[0] ?? null;
}

export async function getMap(mapId: string, session: AppSession | null) {
  return withTransaction(async (client) => {
    const row = await readMap(client, mapId, session?.principalId ?? null);
    if (!row || !canReadMap(session?.principalId ?? null, { visibility: row.visibility, status: row.status, ownerPrincipalId: row.owner_principal_id }, row.member_status ? { status: row.member_status, role: row.member_role! } : null)) throw new ApiError(404, "NOT_FOUND", "지도를 찾을 수 없습니다.");
    return mapDto(row, session?.principalId ?? null);
  });
}

export async function listMaps(scope: "public" | "mine"|"deleted", session: AppSession | null, limit: number, cursor?: string, q?: string, themeKey?: string) {
  if (scope !== "public" && !session) throw new ApiError(401, "LOGIN_REQUIRED", "로그인이 필요합니다.");
  let after: { createdAt: string; id: string } | null = null;
  if (cursor) {
    if (cursor.length > 512) throw new ApiError(422, "INVALID_CURSOR", "목록을 다시 열어 주세요.");
    try { after = JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")); }
    catch { throw new ApiError(422, "INVALID_CURSOR", "목록을 다시 열어 주세요."); }
    if (!after || !Number.isFinite(Date.parse(after.createdAt)) || !/^[0-9a-f-]{36}$/i.test(after.id)) throw new ApiError(422, "INVALID_CURSOR", "목록을 다시 열어 주세요.");
  }
  const rows = await query<MapRow>(
    `SELECT m.*, mm.role AS member_role, mm.status AS member_status
       FROM app.maps m LEFT JOIN app.map_members mm ON mm.map_id = m.id AND mm.principal_id = $1
      WHERE (($2 = 'public' AND m.visibility = 'public' AND m.status='active') OR ($2 = 'mine' AND mm.status = 'active' AND m.status IN ('active','archived')) OR ($2='deleted' AND m.owner_principal_id=$1 AND m.status='deleted' AND m.deleted_at>now()-interval '30 days'))
        AND ($3::text IS NULL OR m.title ILIKE '%' || $3 || '%' OR m.location_label ILIKE '%' || $3 || '%')
        AND ($4::text IS NULL OR m.theme_key = $4)
        AND ($5::timestamptz IS NULL OR (m.created_at, m.id) < ($5, $6::uuid))
      ORDER BY m.created_at DESC, m.id DESC LIMIT $7`,
    [session?.principalId ?? null, scope, q ?? null, themeKey ?? null, after?.createdAt ?? null, after?.id ?? null, limit + 1]);
  const items = rows.slice(0, limit).map((row) => mapDto(row, session?.principalId ?? null));
  const last = rows[limit - 1];
  const nextCursor = rows.length > limit && last ? Buffer.from(JSON.stringify({ createdAt: last.created_at, id: last.id })).toString("base64url") : null;
  return { items, nextCursor };
}

export async function getMapConfiguration(mapId: string, session: AppSession | null) {
  return withTransaction(async (client) => {
    const row = await readMap(client, mapId, session?.principalId ?? null);
    if (!row || !canReadMap(session?.principalId ?? null, { visibility: row.visibility, status: row.status, ownerPrincipalId: row.owner_principal_id }, row.member_status ? { status: row.member_status, role: row.member_role! } : null)) throw new ApiError(404, "NOT_FOUND", "지도를 찾을 수 없습니다.");
    const revision = await client.query<{ definition: Theme }>("SELECT definition FROM app.map_config_revisions WHERE map_id = $1 AND revision = $2", [mapId, row.config_revision]);
    const theme=revision.rows[0]?.definition;
    if(!theme)return {mapId,configRevision:row.config_revision,theme:null};
    const options=(await client.query<{category_key:string;key:string;active:boolean}>("SELECT c.key AS category_key,e.key,e.active FROM app.emoji_options e JOIN app.categories c ON c.id=e.category_id WHERE e.map_id=$1",[mapId])).rows;
    const categories=theme.categories.map(category=>{
      const emojiOptions=category.emojiOptions.map(emoji=>({...emoji,active:options.find(option=>option.category_key===category.key&&option.key===emoji.key)?.active??false}));
      const defaultEmojiKey=emojiOptions.find(emoji=>emoji.key===category.defaultEmojiKey&&emoji.active)?.key??emojiOptions.find(emoji=>emoji.active)?.key??category.defaultEmojiKey;
      return {...category,emojiOptions,defaultEmojiKey};
    });
    return {mapId,configRevision:row.config_revision,theme:{...theme,categories,features:{...theme.features,proposalsEnabled:row.proposals_enabled,commentsEnabled:row.comments_enabled}}};
  });
}

export async function createMap(input: CreateMapInput, session: AppSession, key: string) {
  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest();
  return withTransaction(async (client) => {
    const actor = await client.query<{ kind: string }>("SELECT kind FROM app.principals WHERE id = $1 AND status = 'active' FOR UPDATE", [session.principalId]);
    if (actor.rows[0]?.kind !== "account") throw new ApiError(403, "ACCOUNT_REQUIRED", "지도 개설에는 Google 로그인이 필요합니다.");
    await client.query("DELETE FROM app_private.idempotency_keys WHERE principal_id=$1 AND route_scope='create_map' AND key=$2 AND expires_at < now()", [session.principalId, key]);
    await client.query(`INSERT INTO app_private.idempotency_keys(principal_id, route_scope, key, request_hash)
      VALUES($1,'create_map',$2,$3) ON CONFLICT DO NOTHING`, [session.principalId, key, requestHash]);
    const idem = await client.query<{ request_hash: Buffer; resource_id: string | null }>(`SELECT request_hash, resource_id FROM app_private.idempotency_keys WHERE principal_id=$1 AND route_scope='create_map' AND key=$2 FOR UPDATE`, [session.principalId, key]);
    if (!idem.rows[0]?.request_hash.equals(requestHash)) throw new ApiError(409, "IDEMPOTENCY_CONFLICT", "같은 요청 키에 다른 내용이 사용됐습니다.");
    if (idem.rows[0].resource_id) {
      const prior = await readMap(client, idem.rows[0].resource_id, session.principalId);
      if (!prior || !canReadMap(session.principalId, { visibility: prior.visibility, status: prior.status, ownerPrincipalId: prior.owner_principal_id }, prior.member_status ? { status: prior.member_status, role: prior.member_role! } : null)) throw new ApiError(404, "NOT_FOUND", "지도를 찾을 수 없습니다.");
      return { map: mapDto(prior, session.principalId), repeated: true };
    }
    const template = await client.query<{ id: string; definition: Theme }>("SELECT id, definition FROM app.theme_templates WHERE theme_key=$1 AND version=$2", [input.themeKey, input.themeVersion]);
    if (!template.rows[0]) throw new ApiError(503, "THEME_UNAVAILABLE", "주제 설정을 불러올 수 없습니다.");
    if (input.themeKey !== "custom" && input.custom) throw new ApiError(422, "CUSTOM_NOT_ALLOWED", "선택한 주제에 직접 만든 분류를 사용할 수 없습니다.");
    if (input.themeKey === "custom" && !input.custom) throw new ApiError(422, "CUSTOM_REQUIRED", "분류와 이모지를 설정해 주세요.");
    const base = template.rows[0].definition;
    const custom = input.custom;
    if (custom && !validCustomCategories(custom.categories)) throw new ApiError(422, "INVALID_EMOJI", "분류와 대표 이모지를 확인해 주세요.");
    const theme = buildMapTheme(base, custom, input.proposalsEnabled);
    const inserted = await client.query<MapRow>(`INSERT INTO app.maps(
      owner_principal_id,template_id,theme_key,title,description,location_label,activity_context,center_lat,center_lng,initial_zoom,visibility,participation,moderation,pin_mode,single_color,rating_enabled,ideas_enabled,proposals_enabled,comments_enabled)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING *`, [session.principalId, template.rows[0].id, input.themeKey, input.title, input.description, input.locationLabel, input.activityContext, input.center?.lat ?? null, input.center?.lng ?? null, input.initialZoom, input.visibility, input.participation, input.moderation, theme.pin.mode, theme.pin.mode === "single" ? "#285943" : null, theme.features.ratingEnabled, theme.features.ideasEnabled, theme.features.proposalsEnabled, input.commentsEnabled??theme.features.commentsEnabled]);
    const map = inserted.rows[0];
    await client.query("INSERT INTO app.map_members(map_id,principal_id,nickname) VALUES($1,$2,'지도 개설자')", [map.id, session.principalId]);
    const identifiers = { categories: {} as Record<string, string>, emojiOptions: {} as Record<string, string>, ratingOptions: {} as Record<string, string>, questionVersions: {} as Record<string, string> };
    for (const [index, category] of theme.categories.entries()) {
      const added = await client.query<{ id: string }>("INSERT INTO app.categories(map_id,key,label,color,sort_order) VALUES($1,$2,$3,$4,$5) RETURNING id", [map.id, category.key, category.label, category.color, index]);
      const categoryId = added.rows[0].id;
      identifiers.categories[category.key] = categoryId;
      let defaultId: string | null = null;
      for (const [order, emoji] of category.emojiOptions.entries()) {
        const option = await client.query<{ id: string }>("INSERT INTO app.emoji_options(map_id,category_id,key,glyph,label,sort_order) VALUES($1,$2,$3,$4,$5,$6) RETURNING id", [map.id, categoryId, emoji.key, emoji.glyph, emoji.label, order]);
        identifiers.emojiOptions[`${category.key}:${emoji.key}`] = option.rows[0].id;
        if (emoji.key === category.defaultEmojiKey) defaultId = option.rows[0].id;
      }
      if (!defaultId) throw new ApiError(422, "INVALID_EMOJI", "대표 이모지를 확인해 주세요.");
      await client.query("UPDATE app.categories SET default_emoji_id=$1 WHERE id=$2", [defaultId, categoryId]);
    }
    if (theme.rating) {
      const scheme = await client.query<{ id: string }>("INSERT INTO app.rating_schemes(map_id,label) VALUES($1,$2) RETURNING id", [map.id, theme.rating.label]);
      for (const [index, option] of theme.rating.options.entries()) {
        const added = await client.query<{ id: string }>("INSERT INTO app.rating_options(map_id,scheme_id,key,label,color,symbol,ordinal) VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id", [map.id, scheme.rows[0].id, option.key, option.label, option.color, option.symbol, index]);
        identifiers.ratingOptions[option.key] = added.rows[0].id;
      }
    }
    for (const [index, question] of theme.questions.entries()) {
      const added = await client.query<{ id: string }>("INSERT INTO app.questions(map_id,key,sort_order) VALUES($1,$2,$3) RETURNING id", [map.id, question.key, index]);
      const version = await client.query<{ id: string }>(`INSERT INTO app.question_versions(map_id,question_id,label,type,required,allow_unknown,allow_na,options,max_length)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [map.id, added.rows[0].id, question.label, question.type, question.required, question.allowUnknown, question.allowNotApplicable, JSON.stringify(question.options ?? []), question.maxLength ?? null]);
      identifiers.questionVersions[question.key] = version.rows[0].id;
      await client.query("UPDATE app.questions SET current_version_id=$1 WHERE id=$2", [version.rows[0].id, added.rows[0].id]);
    }
    await client.query("INSERT INTO app.map_config_revisions(map_id,revision,definition,created_by) VALUES($1,1,$2,$3)", [map.id, JSON.stringify({ ...theme, identifiers }), session.principalId]);
    await client.query(`UPDATE app_private.idempotency_keys SET resource_id=$1,response_code=201,completed_at=now() WHERE principal_id=$2 AND route_scope='create_map' AND key=$3`, [map.id, session.principalId, key]);
    const full = await readMap(client, map.id, session.principalId);
    return { map: mapDto(full!, session.principalId), repeated: false };
  });
}

export async function getManageableMap(client: PoolClient, mapId: string, session: AppSession): Promise<MapRow> {
  const row = await readMap(client, mapId, session.principalId);
  const member: MemberPolicyInput = row?.member_status ? { status: row.member_status, role: row.member_role! } : null;
  if (!row || !canManageMap(session.principalId, { visibility: row.visibility, status: row.status, ownerPrincipalId: row.owner_principal_id }, member)) throw new ApiError(404, "NOT_FOUND", "지도를 찾을 수 없습니다.");
  return row;
}
