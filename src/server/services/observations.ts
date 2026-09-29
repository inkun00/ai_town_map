import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { z } from "zod";
import type { Theme } from "@/lib/demo-data";
import type { AppSession } from "@/server/auth/session";
import { withTransaction } from "@/server/db";
import { ApiError } from "@/server/http";
import { canReadMap } from "@/server/policies/maps";
import { audit } from "./community-access";

const answerSchema = z.record(z.string().min(1).max(60), z.array(z.string().max(500)).max(10));
export const observationSchema = z.strictObject({
  configRevision: z.number().int().positive(),
  title: z.string().trim().min(1).max(60), body: z.string().trim().min(10).max(2000),
  locationLabel: z.string().trim().min(1).max(120), locationSource: z.enum(["gps", "search", "manual"]),
  location: z.strictObject({ lat: z.number().min(-90).max(90), lng: z.number().min(-180).max(180) }),
  categoryKey: z.string().min(1).max(60), emojiKey: z.string().min(1).max(60),
  ratingKey: z.string().min(1).max(60).nullable(), answers: answerSchema,
  improvementIdea: z.string().trim().max(1000).optional(), link: z.url().max(2000).optional(),
});
export type ObservationInput = z.infer<typeof observationSchema>;

type MapAccess = QueryResultRow & { id: string; visibility: "public" | "invite_only"; status: "draft" | "active" | "archived" | "deleted"; participation: "invited" | "admin_only" | "closed"; moderation: "immediate" | "approval"; owner_principal_id: string; config_revision: number; member_id: string | null; member_status: "active" | "blocked" | "left" | null; member_role: "admin" | "participant" | null };
type ObservationRow = QueryResultRow & { id: string; map_id: string; author_member_id: string; title: string; body: string; location_label: string; location_source: string; lat: number; lng: number; category_key: string; emoji_key: string; rating_key: string | null; answers: Record<string,string[]>; improvement_idea: string | null; link_url: string | null; status: string; version: string; created_at: Date; nickname: string; photo_id: string | null; moderation_reason:string|null;deleted_at:Date|null };

async function mapAccess(client: PoolClient, mapId: string, session: AppSession | null): Promise<MapAccess> {
  const rows = await client.query<MapAccess>(`SELECT m.id,m.visibility,m.status,m.participation,m.moderation,m.owner_principal_id,m.config_revision,mm.id AS member_id,mm.status AS member_status,mm.role AS member_role
    FROM app.maps m LEFT JOIN app.map_members mm ON mm.map_id=m.id AND mm.principal_id=$2 WHERE m.id=$1`,[mapId,session?.principalId ?? null]);
  const map = rows.rows[0];
  if (!map || !canReadMap(session?.principalId ?? null,{visibility:map.visibility,status:map.status,ownerPrincipalId:map.owner_principal_id},map.member_status ? {status:map.member_status,role:map.member_role!} : null)) throw new ApiError(404,"NOT_FOUND","지도를 찾을 수 없습니다.");
  return map;
}

function mayWrite(map: MapAccess, session: AppSession): boolean {
  return map.status === "active" && map.member_status === "active" && !!map.member_id && (map.participation === "invited" || (map.participation === "admin_only" && (map.owner_principal_id === session.principalId || map.member_role === "admin")));
}
function mayEdit(map: MapAccess): boolean { return map.status === "active" && map.member_status === "active" && !!map.member_id; }
function isModerator(map:MapAccess,session:AppSession|null):boolean{return !!session&&map.member_status==="active"&&(map.member_role==="admin"||map.owner_principal_id===session.principalId);}

function validateAnswers(theme: Theme, answers: Record<string,string[]>) {
  const known = new Map(theme.questions.map((question) => [question.key, question]));
  for (const [key, values] of Object.entries(answers)) {
    const question = known.get(key);
    if (!question) throw new ApiError(422,"INVALID_ANSWER","현재 지도에 없는 평가 항목입니다.");
    if (question.type !== "multi" && values.length > 1) throw new ApiError(422,"INVALID_ANSWER","평가 항목의 답변을 확인해 주세요.");
    const allowed = new Set([...(question.type === "boolean" ? ["yes","no"] : question.options?.map((item) => item.key) ?? []),...(question.allowUnknown ? ["unknown"] : []),...(question.allowNotApplicable ? ["na"] : [])]);
    if (question.type === "text") { if (values.some((value) => value.length > (question.maxLength ?? 500))) throw new ApiError(422,"INVALID_ANSWER","답변이 너무 깁니다."); }
    else if (values.some((value) => !allowed.has(value)) || (values.length > 1 && values.some((value) => value === "unknown" || value === "na"))) throw new ApiError(422,"INVALID_ANSWER","평가 항목의 답변을 확인해 주세요.");
  }
  if (theme.questions.some((question) => question.required && !answers[question.key]?.length)) throw new ApiError(422,"REQUIRED_ANSWER","필수 평가 항목에 답해 주세요.");
}

function validateInput(input: ObservationInput, theme: Theme) {
  const category = theme.categories.find((item) => item.key === input.categoryKey);
  if (!category || !category.emojiOptions.some((item) => item.key === input.emojiKey)) throw new ApiError(422,"INVALID_EMOJI","이 지도에서 사용할 수 없는 이모지입니다.");
  if (theme.features.ratingEnabled) { if (!theme.rating?.options.some((item) => item.key === input.ratingKey)) throw new ApiError(422,"RATING_REQUIRED","평가를 선택해 주세요."); }
  else if (input.ratingKey !== null) throw new ApiError(422,"RATING_NOT_ALLOWED","이 지도에는 종합평가가 없습니다.");
  if (!theme.features.ideasEnabled && input.improvementIdea) throw new ApiError(422,"FEATURE_DISABLED","이 지도에는 개선 아이디어 항목이 없습니다.");
  if (input.link) { const url = new URL(input.link); if (!["http:","https:"].includes(url.protocol) || url.username || url.password) throw new ApiError(422,"INVALID_LINK","안전한 http 또는 https 주소를 입력해 주세요."); }
  validateAnswers(theme,input.answers);
}

const rowSql = `SELECT o.*,c.key AS category_key,e.key AS emoji_key,r.key AS rating_key,mm.nickname,p.id AS photo_id
  FROM app.observations o JOIN app.categories c ON c.id=o.category_id JOIN app.emoji_options e ON e.id=o.emoji_option_id
  LEFT JOIN app.rating_options r ON r.id=o.rating_option_id JOIN app.map_members mm ON mm.id=o.author_member_id
  LEFT JOIN app.observation_photos p ON p.observation_id=o.id`;
function dto(row: ObservationRow, memberId: string | null, moderator=false,mapActive=true) { const redacted=["hidden","deleted"].includes(row.status)&&!moderator;const author=memberId===row.author_member_id;return { id:row.id,mapId:row.map_id,title:redacted?(row.status==="hidden"?"숨겨진 기록":"삭제된 기록"):row.title,body:redacted?"":row.body,locationLabel:redacted?"":row.location_label,locationSource:row.location_source,location:redacted?null:{lat:row.lat,lng:row.lng},categoryKey:redacted?null:row.category_key,emojiKey:redacted?null:row.emoji_key,ratingKey:redacted?null:row.rating_key,answers:redacted?{}:row.answers,improvementIdea:redacted?null:row.improvement_idea,link:redacted?null:row.link_url,status:row.status,version:row.version,createdAt:row.created_at,author:redacted?null:row.nickname,canEdit:mapActive&&!redacted&&author,canDelete:author&&row.status!=="deleted",canModerate:moderator,moderationReason:["hidden","pending"].includes(row.status)?row.moderation_reason:null,photoUrl:!redacted&&row.status!=="deleted"&&row.photo_id ? `/api/v1/maps/${row.map_id}/observations/${row.id}/photo` : null}; }

export async function listObservations(mapId:string,session:AppSession|null,scope:"published"|"mine"|"review"="published") {
  return withTransaction(async(client)=>{
    const map=await mapAccess(client,mapId,session);
    const moderator=isModerator(map,session);
    if(scope==="review"&&!moderator) throw new ApiError(403,"ADMIN_REQUIRED","검수함은 관리자만 볼 수 있습니다.");
    if(scope==="mine"&&(map.member_status!=="active"||!map.member_id)) throw new ApiError(403,"MEMBERSHIP_REQUIRED","지도에 참여해야 합니다.");
    const rows=await client.query<ObservationRow>(`${rowSql} WHERE o.map_id=$1 AND (($2::text='published' AND o.status='published') OR ($2='mine' AND o.author_member_id=$3 AND o.status IN ('published','pending','hidden','deleted')) OR ($2='review' AND o.status IN ('pending','hidden','deleted'))) ORDER BY o.created_at DESC LIMIT 500`,[mapId,scope,map.member_id]);
    return {items:rows.rows.map((row)=>dto(row,map.member_status==="active"?map.member_id:null,moderator,map.status==="active")),nextCursor:null};
  });
}

export async function createObservation(mapId:string,session:AppSession,key:string,input:ObservationInput) {
  const requestHash=createHash("sha256").update(JSON.stringify(input)).digest();
  return withTransaction(async(client)=>{
    await client.query("SELECT id FROM app.maps WHERE id=$1 FOR UPDATE",[mapId]);
    const map=await mapAccess(client,mapId,session);
    if (!mayWrite(map,session)) throw new ApiError(403,"WRITE_FORBIDDEN","이 지도에 기록을 남길 수 없습니다.");
    await client.query("DELETE FROM app_private.idempotency_keys WHERE principal_id=$1 AND route_scope=$2 AND key=$3 AND expires_at<now()",[session.principalId,`observation:${mapId}`,key]);
    await client.query("INSERT INTO app_private.idempotency_keys(principal_id,route_scope,key,request_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",[session.principalId,`observation:${mapId}`,key,requestHash]);
    const idem=await client.query<{request_hash:Buffer;resource_id:string|null}>("SELECT request_hash,resource_id FROM app_private.idempotency_keys WHERE principal_id=$1 AND route_scope=$2 AND key=$3 FOR UPDATE",[session.principalId,`observation:${mapId}`,key]);
    if (!idem.rows[0].request_hash.equals(requestHash)) throw new ApiError(409,"IDEMPOTENCY_CONFLICT","같은 요청 키에 다른 기록이 사용됐습니다.");
    if (idem.rows[0].resource_id) { const existing=await client.query<ObservationRow>(`${rowSql} WHERE o.id=$1 AND o.map_id=$2`,[idem.rows[0].resource_id,mapId]); return {observation:dto(existing.rows[0],map.member_id),repeated:true}; }
    if(input.configRevision!==map.config_revision) throw new ApiError(409,"CONFIG_CHANGED","지도 설정이 바뀌었습니다. 화면을 다시 열어 주세요.");
    const config=await client.query<{definition:Theme}>("SELECT definition FROM app.map_config_revisions WHERE map_id=$1 AND revision=$2",[mapId,map.config_revision]);
    const theme=config.rows[0]?.definition;
    if(!theme) throw new ApiError(503,"THEME_UNAVAILABLE","지도 설정을 불러올 수 없습니다.");
    validateInput(input,theme);
    const category=await client.query<{id:string}>("SELECT id FROM app.categories WHERE map_id=$1 AND key=$2 AND active=true",[mapId,input.categoryKey]);
    const emoji=await client.query<{id:string}>("SELECT id FROM app.emoji_options WHERE map_id=$1 AND category_id=$2 AND key=$3 AND active=true",[mapId,category.rows[0]?.id,input.emojiKey]);
    const rating=input.ratingKey ? await client.query<{id:string}>("SELECT id FROM app.rating_options WHERE map_id=$1 AND key=$2",[mapId,input.ratingKey]) : null;
    if(!category.rows[0] || !emoji.rows[0] || (input.ratingKey && !rating?.rows[0])) throw new ApiError(422,"CONFIG_CHANGED","분류나 이모지 설정이 바뀌었습니다.");
    const status=map.moderation==="approval" ? "pending" : "published";
    const added=await client.query<{id:string}>(`INSERT INTO app.observations(map_id,author_member_id,title,body,location_label,location_source,lat,lng,category_id,emoji_option_id,rating_option_id,answers,improvement_idea,link_url,status,config_revision)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,[mapId,map.member_id,input.title,input.body,input.locationLabel,input.locationSource,input.location.lat,input.location.lng,category.rows[0].id,emoji.rows[0].id,rating?.rows[0]?.id ?? null,JSON.stringify(input.answers),input.improvementIdea || null,input.link || null,status,map.config_revision]);
    await client.query("UPDATE app.maps SET data_revision=data_revision+1,theme_locked_at=coalesce(theme_locked_at,now()) WHERE id=$1",[mapId]);
    await client.query("UPDATE app_private.idempotency_keys SET resource_id=$1,response_code=201,completed_at=now() WHERE principal_id=$2 AND route_scope=$3 AND key=$4",[added.rows[0].id,session.principalId,`observation:${mapId}`,key]);
    const row=await client.query<ObservationRow>(`${rowSql} WHERE o.id=$1`,[added.rows[0].id]);
    return {observation:dto(row.rows[0],map.member_id),repeated:false};
  });
}

export async function updateObservation(mapId:string,id:string,session:AppSession,version:string,input:ObservationInput) {
  return withTransaction(async(client)=>{
    await client.query("SELECT id FROM app.maps WHERE id=$1 FOR UPDATE",[mapId]);
    const map=await mapAccess(client,mapId,session);
    if (!mayEdit(map)) throw new ApiError(403,"WRITE_FORBIDDEN","이 지도에 기록을 수정할 수 없습니다.");
    const existing=await client.query<ObservationRow>(`${rowSql} WHERE o.id=$1 AND o.map_id=$2 FOR UPDATE OF o`,[id,mapId]);
    const row=existing.rows[0];
    if(!row || row.author_member_id!==map.member_id || !["pending","published"].includes(row.status)) throw new ApiError(404,"NOT_FOUND","기록을 찾을 수 없습니다.");
    if(row.version!==version) throw new ApiError(412,"VERSION_CHANGED","다른 곳에서 기록이 수정됐습니다.");
    if(input.configRevision!==map.config_revision) throw new ApiError(409,"CONFIG_CHANGED","지도 설정이 바뀌었습니다.");
    const config=await client.query<{definition:Theme}>("SELECT definition FROM app.map_config_revisions WHERE map_id=$1 AND revision=$2",[mapId,map.config_revision]);
    validateInput(input,config.rows[0].definition);
    const category=await client.query<{id:string}>("SELECT id FROM app.categories WHERE map_id=$1 AND key=$2 AND active=true",[mapId,input.categoryKey]);
    const emoji=await client.query<{id:string}>("SELECT id FROM app.emoji_options WHERE map_id=$1 AND category_id=$2 AND key=$3 AND (active=true OR $4)",[mapId,category.rows[0]?.id,input.emojiKey,row.category_key===input.categoryKey&&row.emoji_key===input.emojiKey]);
    const rating=input.ratingKey ? await client.query<{id:string}>("SELECT id FROM app.rating_options WHERE map_id=$1 AND key=$2",[mapId,input.ratingKey]) : null;
    if(!category.rows[0] || !emoji.rows[0] || (input.ratingKey && !rating?.rows[0])) throw new ApiError(422,"CONFIG_CHANGED","분류나 이모지 설정이 바뀌었습니다.");
    await client.query(`UPDATE app.observations SET title=$3,body=$4,location_label=$5,location_source=$6,lat=$7,lng=$8,category_id=$9,emoji_option_id=$10,rating_option_id=$11,answers=$12,improvement_idea=$13,link_url=$14,status=$15,version=version+1,updated_at=now() WHERE id=$1 AND map_id=$2`,[id,mapId,input.title,input.body,input.locationLabel,input.locationSource,input.location.lat,input.location.lng,category.rows[0].id,emoji.rows[0].id,rating?.rows[0]?.id ?? null,JSON.stringify(input.answers),input.improvementIdea || null,input.link || null,map.moderation==="approval" ? "pending" : "published"]);
    await client.query("UPDATE app.maps SET data_revision=data_revision+1 WHERE id=$1",[mapId]);
    const updated=await client.query<ObservationRow>(`${rowSql} WHERE o.id=$1`,[id]);
    return dto(updated.rows[0],map.member_id);
  });
}

export async function photoAccess(mapId:string,id:string,session:AppSession|null) {
  return withTransaction(async(client)=>{
    const map=await mapAccess(client,mapId,session);
    const result=await client.query<{content:Buffer;status:string;author_member_id:string}>(`SELECT p.content,o.status,o.author_member_id FROM app.observation_photos p JOIN app.observations o ON o.id=p.observation_id WHERE o.map_id=$1 AND o.id=$2`,[mapId,id]);
    const photo=result.rows[0];
    if(!photo || !(photo.status==="published" || (photo.status==="pending" && ((map.member_status==="active"&&photo.author_member_id===map.member_id) || isModerator(map,session))) || (photo.status==="hidden" && isModerator(map,session)))) throw new ApiError(404,"NOT_FOUND","사진을 찾을 수 없습니다.");
    return photo.content;
  });
}

export async function savePhoto(mapId:string,id:string,session:AppSession,content:Buffer) {
  return withTransaction(async(client)=>{
    const map=await mapAccess(client,mapId,session);
    const row=await client.query<{author_member_id:string;status:string}>("SELECT author_member_id,status FROM app.observations WHERE map_id=$1 AND id=$2 FOR UPDATE",[mapId,id]);
    if(!mayEdit(map)||!row.rows[0] || row.rows[0].author_member_id!==map.member_id || !["pending","published"].includes(row.rows[0].status)) throw new ApiError(404,"NOT_FOUND","기록을 찾을 수 없습니다.");
    await client.query(`INSERT INTO app.observation_photos(map_id,observation_id,uploaded_by,content,mime) VALUES($1,$2,$3,$4,'image/webp') ON CONFLICT(observation_id) DO UPDATE SET content=excluded.content,uploaded_by=excluded.uploaded_by,created_at=now()`,[mapId,id,session.principalId,content]);
    await client.query("UPDATE app.observations SET status=CASE WHEN status='published' AND $2='approval' THEN 'pending' ELSE status END,version=version+1,updated_at=now() WHERE id=$1",[id,map.moderation]);
    await client.query("UPDATE app.maps SET data_revision=data_revision+1 WHERE id=$1",[mapId]);
    const latest=await client.query<{status:string;version:string}>("SELECT status,version FROM app.observations WHERE id=$1",[id]);
    return {photoUrl:`/api/v1/maps/${mapId}/observations/${id}/photo`,status:latest.rows[0].status,version:latest.rows[0].version};
  });
}

export async function moderateObservation(mapId:string,id:string,session:AppSession,version:string,action:"approve"|"hide"|"restore"|"request_changes",reason?:string){
  return withTransaction(async(client)=>{
    const map=await mapAccess(client,mapId,session);
    if(!isModerator(map,session)) throw new ApiError(403,"ADMIN_REQUIRED","지도 관리자만 할 수 있습니다.");
    const existing=await client.query<ObservationRow>(`${rowSql} WHERE o.map_id=$1 AND o.id=$2 FOR UPDATE OF o`,[mapId,id]);
    const row=existing.rows[0];if(!row)throw new ApiError(404,"NOT_FOUND","기록을 찾을 수 없습니다.");
    if(row.version!==version)throw new ApiError(412,"VERSION_CHANGED","기록이 다른 곳에서 변경됐습니다.");
    if((action==="approve"&&row.status!=="pending")||(action==="restore"&&!(["hidden","deleted"].includes(row.status)))||((action==="hide"||action==="request_changes")&&!(["published","pending"].includes(row.status))))throw new ApiError(409,"STATUS_CHANGED","기록 상태를 확인해 주세요.");
    if(action==="restore"&&row.status==="deleted"&&(!row.deleted_at||Date.now()-row.deleted_at.getTime()>30*86400000))throw new ApiError(409,"RESTORE_EXPIRED","복구 기간이 지났습니다.");
    if((action==="hide"||action==="request_changes")&&!reason?.trim())throw new ApiError(422,"REASON_REQUIRED","사유를 입력해 주세요.");
    const next=action==="approve"?"published":action==="request_changes"?"pending":action==="restore"?(map.moderation==="approval"?"pending":"published"):"hidden";
    await client.query("UPDATE app.observations SET status=$2,moderation_reason=$3,moderated_at=now(),moderated_by=$4,deleted_at=NULL,version=version+1,updated_at=now() WHERE id=$1",[id,next,reason?.trim()??null,session.principalId]);
    await client.query("UPDATE app.maps SET data_revision=data_revision+1 WHERE id=$1",[mapId]);
    await audit(client,mapId,session,`observation.${action}`,"observation",id,reason);
    const latest=await client.query<ObservationRow>(`${rowSql} WHERE o.id=$1`,[id]);return dto(latest.rows[0],map.member_id,true);
  });
}

export async function deleteObservation(mapId:string,id:string,session:AppSession,version:string){
  return withTransaction(async(client)=>{const map=await mapAccess(client,mapId,session);const existing=await client.query<ObservationRow>(`${rowSql} WHERE o.map_id=$1 AND o.id=$2 FOR UPDATE OF o`,[mapId,id]);const row=existing.rows[0];if(!row||row.status==="deleted")throw new ApiError(404,"NOT_FOUND","기록을 찾을 수 없습니다.");if(!(map.member_status==="active"&&row.author_member_id===map.member_id)&&!isModerator(map,session))throw new ApiError(403,"WRITE_FORBIDDEN","기록을 삭제할 수 없습니다.");if(row.version!==version)throw new ApiError(412,"VERSION_CHANGED","기록이 다른 곳에서 변경됐습니다.");await client.query("UPDATE app.observations SET status='deleted',deleted_at=now(),version=version+1,updated_at=now() WHERE id=$1",[id]);await client.query("UPDATE app.maps SET data_revision=data_revision+1 WHERE id=$1",[mapId]);await audit(client,mapId,session,"observation.delete","observation",id);});
}
