import "server-only";

import {createHash,randomUUID} from "node:crypto";
import type {PoolClient,QueryResultRow} from "pg";
import {z} from "zod";
import {buildMergedTheme,type MergePoint,type MergeSource} from "@/domain/map-merge";
import type {Theme,ThemeKey} from "@/lib/demo-data";
import type {AppSession} from "@/server/auth/session";
import {withTransaction} from "@/server/db";
import {ApiError} from "@/server/http";
import {canReadMap} from "@/server/policies/maps";
import {requireTeacher} from "./accounts";
import {getMapInTransaction,insertMapDefinition} from "./maps";

const mapIds=z.array(z.uuid()).min(2).max(10).refine(ids=>new Set(ids).size===ids.length,"지도를 중복 선택할 수 없습니다.");
const versions=z.record(z.uuid(),z.string().regex(/^\d+$/));
export const mergePreviewSchema=z.strictObject({mapIds});
export const createMergedMapSchema=z.strictObject({
  mapIds,title:z.string().trim().min(2).max(60),description:z.string().trim().max(300).default(""),locationLabel:z.string().trim().min(1).max(120),
  pointIds:z.array(z.uuid()).min(1).max(1000).refine(ids=>new Set(ids).size===ids.length,"위치 기록을 중복 선택할 수 없습니다."),
  sourceVersions:z.record(z.uuid(),z.string().regex(/^\d+:\d+:\d+$/)),pointVersions:versions,
}).superRefine((input,context)=>{
  if(Object.keys(input.sourceVersions).length!==input.mapIds.length||input.mapIds.some(id=>!input.sourceVersions[id]))context.addIssue({code:"custom",path:["sourceVersions"],message:"선택한 모든 지도의 미리보기 버전이 필요합니다."});
  if(Object.keys(input.pointVersions).length!==input.pointIds.length||input.pointIds.some(id=>!input.pointVersions[id]))context.addIssue({code:"custom",path:["pointVersions"],message:"선택한 모든 기록의 버전이 필요합니다."});
});
export type CreateMergedMapInput=z.infer<typeof createMergedMapSchema>;

type SourceRow=QueryResultRow&{id:string;title:string;theme_key:ThemeKey;location_label:string;visibility:"public"|"invite_only";status:"active"|"archived"|"deleted"|"draft";owner_principal_id:string;version:string;config_revision:number;data_revision:string;center_lat:number|null;center_lng:number|null;member_status:"active"|"blocked"|"left"|null;member_role:"admin"|"participant"|null;definition:Theme|null;point_count:number};
type PointRow=QueryResultRow&{id:string;map_id:string;title:string;body:string;location_label:string;location_source:"gps"|"search"|"manual";lat:number;lng:number;category_key:string;emoji_key:string;emoji_glyph:string;emoji_label:string;rating_key:string|null;answers:Record<string,string[]>;improvement_idea:string|null;link_url:string|null;created_at:Date|string;nickname:string;version:string;has_photo:boolean};

async function teacher(client:PoolClient,session:AppSession,lock=false){
  // Serialize the creator and role changes without blocking FK KEY SHARE locks
  // taken by a concurrent observation write that already holds its map lock.
  const actor=await client.query<{kind:string}>(`SELECT kind FROM app.principals WHERE id=$1 AND status='active'${lock?" FOR NO KEY UPDATE":""}`,[session.principalId]);
  if(session.kind!=="account"||actor.rows[0]?.kind!=="account")throw new ApiError(403,"ACCOUNT_REQUIRED","지도 합치기에는 Google 로그인이 필요합니다.");
  await requireTeacher(client,session);
}

async function readSources(client:PoolClient,ids:string[],session:AppSession,lock=false):Promise<MergeSource[]>{
  if(lock){
    // All record/photo/config writers lock their source map first. Stable ordering avoids cross-merge deadlocks.
    await client.query("SELECT id FROM app.maps WHERE id=ANY($1::uuid[]) ORDER BY id FOR SHARE",[ids]);
    await client.query("SELECT id FROM app.map_members WHERE map_id=ANY($1::uuid[]) AND principal_id=$2 ORDER BY id FOR SHARE",[ids,session.principalId]);
  }
  const result=await client.query<SourceRow>(`SELECT m.id,m.title,m.theme_key,m.location_label,m.visibility,m.status,m.owner_principal_id,m.version,m.config_revision,m.data_revision,m.center_lat,m.center_lng,
    mm.status AS member_status,mm.role AS member_role,r.definition,
    (SELECT count(*)::int FROM app.observations o WHERE o.map_id=m.id AND o.status='published') AS point_count
    FROM app.maps m LEFT JOIN app.map_members mm ON mm.map_id=m.id AND mm.principal_id=$2
    LEFT JOIN app.map_config_revisions r ON r.map_id=m.id AND r.revision=m.config_revision WHERE m.id=ANY($1::uuid[])`,[ids,session.principalId]);
  const lookup=new Map(result.rows.map(row=>[row.id,row]));
  return ids.map(id=>{
    const row=lookup.get(id);
    if(!row||row.status!=="active"||!canReadMap(session.principalId,{visibility:row.visibility,status:row.status,ownerPrincipalId:row.owner_principal_id},row.member_status?{status:row.member_status,role:row.member_role!}:null))throw new ApiError(404,"SOURCE_UNAVAILABLE","선택한 지도에 접근할 수 없습니다. 공개 중이거나 참여 권한이 있는 운영 지도를 선택해 주세요.");
    if(!row.definition)throw new ApiError(503,"THEME_UNAVAILABLE","원본 지도의 주제 설정을 불러올 수 없습니다.");
    return {id:row.id,title:row.title,themeKey:row.theme_key,location:row.location_label,visibility:row.visibility,version:`${row.version}:${row.config_revision}:${row.data_revision}`,configRevision:row.config_revision,theme:row.definition,center:row.center_lat===null?null:{lat:row.center_lat,lng:row.center_lng!},pointCount:row.point_count};
  });
}

async function readPoints(client:PoolClient,ids:string[],pointIds?:string[],lock=false):Promise<MergePoint[]>{
  const rows=await client.query<PointRow>(`SELECT o.id,o.map_id,o.title,o.body,o.location_label,o.location_source,o.lat,o.lng,o.answers,o.improvement_idea,o.link_url,o.created_at,o.version,
    c.key AS category_key,e.key AS emoji_key,e.glyph AS emoji_glyph,e.label AS emoji_label,r.key AS rating_key,mm.nickname,
    EXISTS(SELECT 1 FROM app.observation_photos p WHERE p.observation_id=o.id AND p.map_id=o.map_id) AS has_photo
    FROM app.observations o JOIN app.categories c ON c.map_id=o.map_id AND c.id=o.category_id JOIN app.emoji_options e ON e.map_id=o.map_id AND e.category_id=o.category_id AND e.id=o.emoji_option_id
    LEFT JOIN app.rating_options r ON r.map_id=o.map_id AND r.id=o.rating_option_id JOIN app.map_members mm ON mm.map_id=o.map_id AND mm.id=o.author_member_id
    WHERE o.map_id=ANY($1::uuid[]) AND o.status='published' AND ($2::uuid[] IS NULL OR o.id=ANY($2::uuid[]))
    ORDER BY o.created_at DESC,o.id LIMIT 2001${lock?" FOR SHARE OF o":""}`,[ids,pointIds??null]);
  if(rows.rows.length>2000)throw new ApiError(422,"MERGE_PREVIEW_LIMIT","미리보기는 게시된 기록 총 2,000개까지 가능합니다. 더 적은 지도를 선택해 주세요.");
  return rows.rows.map(row=>({id:row.id,mapId:row.map_id,title:row.title,body:row.body,locationLabel:row.location_label,locationSource:row.location_source,location:{lat:row.lat,lng:row.lng},categoryKey:row.category_key,emojiKey:row.emoji_key,emoji:{key:row.emoji_key,glyph:row.emoji_glyph,label:row.emoji_label},ratingKey:row.rating_key,answers:row.answers,improvementIdea:row.improvement_idea,link:row.link_url,createdAt:new Date(row.created_at).toISOString(),author:row.nickname,version:String(row.version),photoUrl:row.has_photo?`/api/v1/maps/${row.map_id}/observations/${row.id}/photo?v=${encodeURIComponent(row.version)}`:null}));
}

export async function previewMapMerge(input:z.infer<typeof mergePreviewSchema>,session:AppSession){
  const parsed=mergePreviewSchema.parse(input);
  return withTransaction(async client=>{
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");await teacher(client,session);
    const sources=await readSources(client,parsed.mapIds,session);
    if(sources.reduce((sum,source)=>sum+(source.pointCount??0),0)>2000)throw new ApiError(422,"MERGE_PREVIEW_LIMIT","미리보기는 게시된 기록 총 2,000개까지 가능합니다. 더 적은 지도를 선택해 주세요.");
    const points=await readPoints(client,parsed.mapIds);
    const result={sources,points};
    if(Buffer.byteLength(JSON.stringify(result),"utf8")>4_000_000)throw new ApiError(422,"MERGE_PREVIEW_SIZE","선택한 기록의 분량이 너무 큽니다. 더 적은 지도를 선택해 주세요.");
    return result;
  });
}

export async function createMergedMap(input:CreateMergedMapInput,session:AppSession,key:string){
  const parsed=createMergedMapSchema.parse(input);const hash=createHash("sha256").update(JSON.stringify(parsed)).digest();
  return withTransaction(async client=>{
    await teacher(client,session,true);
    await client.query("DELETE FROM app_private.idempotency_keys WHERE principal_id=$1 AND route_scope='create_merged_map' AND key=$2 AND expires_at<now()",[session.principalId,key]);
    await client.query("INSERT INTO app_private.idempotency_keys(principal_id,route_scope,key,request_hash) VALUES($1,'create_merged_map',$2,$3) ON CONFLICT DO NOTHING",[session.principalId,key,hash]);
    const idem=await client.query<{request_hash:Buffer;resource_id:string|null}>("SELECT request_hash,resource_id FROM app_private.idempotency_keys WHERE principal_id=$1 AND route_scope='create_merged_map' AND key=$2 FOR UPDATE",[session.principalId,key]);
    if(!idem.rows[0]?.request_hash.equals(hash))throw new ApiError(409,"IDEMPOTENCY_CONFLICT","같은 요청 키에 다른 내용이 사용됐습니다.");
    if(idem.rows[0].resource_id)return {map:await getMapInTransaction(client,idem.rows[0].resource_id,session),copiedPoints:parsed.pointIds.length,repeated:true};
    const sources=await readSources(client,parsed.mapIds,session,true);
    if(sources.some(source=>parsed.sourceVersions[source.id]!==source.version))throw new ApiError(409,"MERGE_SOURCE_CHANGED","미리보기 이후 원본 지도나 기록이 바뀌었습니다. 미리보기를 다시 확인해 주세요.");
    const points=await readPoints(client,parsed.mapIds,parsed.pointIds,true);
    if(points.length!==parsed.pointIds.length||points.some(point=>parsed.pointVersions[point.id]!==point.version))throw new ApiError(409,"MERGE_POINTS_CHANGED","선택한 기록이 변경됐거나 더 이상 게시되지 않습니다. 미리보기를 다시 확인해 주세요.");
    let merged:ReturnType<typeof buildMergedTheme>;
    try{merged=buildMergedTheme(sources,points);}catch(error){throw new ApiError(422,"MERGE_DEFINITION_INVALID",error instanceof Error?error.message:"원본 기록의 분류와 질문을 확인해 주세요.");}
    const template=await client.query<{id:string}>("SELECT id FROM app.theme_templates WHERE theme_key=$1 AND version=$2",[merged.theme.key,merged.theme.version]);
    if(!template.rows[0])throw new ApiError(503,"THEME_UNAVAILABLE","합친 지도의 주제 설정을 불러올 수 없습니다.");
    const center=points.length?{lat:points.reduce((sum,point)=>sum+point.location.lat,0)/points.length,lng:points.reduce((sum,point)=>sum+point.location.lng,0)/points.length}:null;
    const added=await client.query<{id:string}>(`INSERT INTO app.maps(owner_principal_id,template_id,theme_key,title,description,location_label,activity_context,center_lat,center_lng,initial_zoom,visibility,participation,moderation,pin_mode,single_color,rating_enabled,ideas_enabled,proposals_enabled,comments_enabled)
      VALUES($1,$2,$3,$4,$5,$6,'community',$7,$8,5,'invite_only','invited','immediate',$9,$10,$11,$12,$13,$14) RETURNING id`,[session.principalId,template.rows[0].id,merged.theme.key,parsed.title,parsed.description,parsed.locationLabel,center?.lat??null,center?.lng??null,merged.theme.pin.mode,merged.theme.pin.mode==="single"?"#285943":null,merged.theme.features.ratingEnabled,merged.theme.features.ideasEnabled,merged.theme.features.proposalsEnabled,merged.theme.features.commentsEnabled]);
    const targetId=added.rows[0].id;
    const member=await client.query<{id:string}>("INSERT INTO app.map_members(map_id,principal_id,nickname) VALUES($1,$2,'지도 개설자') RETURNING id",[targetId,session.principalId]);
    const identifiers=await insertMapDefinition(client,targetId,merged.theme,session.principalId);
    const mappings=merged.copies.map(copy=>{
      const categoryId=identifiers.categories[copy.categoryKey],emojiId=identifiers.emojiOptions[`${copy.categoryKey}:${copy.emojiKey}`];
      const ratingId=copy.ratingKey?identifiers.ratingOptions[copy.ratingKey]:null;
      if(!categoryId||!emojiId)throw new ApiError(422,"MERGE_DEFINITION_INVALID","합친 기록의 분류와 이모지를 확인해 주세요.");
      return {target_id:randomUUID(),source_id:copy.sourceId,source_map_id:copy.sourceMapId,category_id:categoryId,emoji_id:emojiId,rating_id:ratingId??null,answers:copy.answers};
    });
    const serializedMappings=JSON.stringify(mappings);
    const copied=await client.query<{id:string}>(`INSERT INTO app.observations(id,map_id,author_member_id,title,body,location_label,location_source,lat,lng,category_id,emoji_option_id,rating_option_id,answers,improvement_idea,link_url,status,config_revision,created_at)
      SELECT x.target_id,$1,$2,o.title,o.body,o.location_label,o.location_source,o.lat,o.lng,x.category_id,x.emoji_id,x.rating_id,x.answers,o.improvement_idea,o.link_url,'published',1,o.created_at
      FROM jsonb_to_recordset($3::jsonb) AS x(target_id uuid,source_id uuid,source_map_id uuid,category_id uuid,emoji_id uuid,rating_id uuid,answers jsonb)
      JOIN app.observations o ON o.id=x.source_id AND o.map_id=x.source_map_id AND o.status='published' RETURNING id`,[targetId,member.rows[0].id,serializedMappings]);
    if(copied.rows.length!==mappings.length)throw new ApiError(409,"MERGE_POINTS_CHANGED","원본 기록이 바뀌었습니다. 미리보기를 다시 확인해 주세요.");
    // Copy image bytes inside PostgreSQL rather than fetching photos through JavaScript or source URLs.
    await client.query(`INSERT INTO app.observation_photos(map_id,observation_id,uploaded_by,content,mime,created_at)
      SELECT $1,x.target_id,$2,p.content,p.mime,p.created_at
      FROM jsonb_to_recordset($3::jsonb) AS x(target_id uuid,source_id uuid,source_map_id uuid)
      JOIN app.observation_photos p ON p.map_id=x.source_map_id AND p.observation_id=x.source_id`,[targetId,session.principalId,serializedMappings]);
    await client.query("UPDATE app.maps SET data_revision=1,theme_locked_at=now() WHERE id=$1",[targetId]);
    await client.query("UPDATE app_private.idempotency_keys SET resource_id=$1,response_code=201,completed_at=now() WHERE principal_id=$2 AND route_scope='create_merged_map' AND key=$3",[targetId,session.principalId,key]);
    return {map:await getMapInTransaction(client,targetId,session),copiedPoints:merged.copies.length,repeated:false};
  });
}
