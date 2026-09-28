import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { aggregateRecords,csvCell,filterSchema,type ObservationFilter } from "@/domain/analysis";
import type { Theme } from "@/lib/demo-data";
import type { AppSession } from "@/server/auth/session";
import { withTransaction } from "@/server/db";
import { ApiError } from "@/server/http";
import { communityMap,isAdmin,requireAdmin } from "./community-access";

export async function readDataset(client:PoolClient,mapId:string,session:AppSession|null,input:ObservationFilter) {
  const map=await communityMap(client,mapId,session);
  const filter=filterSchema.parse(input);
  const meta=(await client.query<{config_revision:number;data_revision:string;proposals_enabled:boolean;title:string}>("SELECT config_revision,data_revision,proposals_enabled,title FROM app.maps WHERE id=$1",[mapId])).rows[0];
  const revisions=(await client.query<{revision:number;definition:Theme}>("SELECT revision,definition FROM app.map_config_revisions WHERE map_id=$1",[mapId])).rows;
  const theme=revisions.find(r=>r.revision===meta.config_revision)!.definition;
  if((filter.category&&!theme.categories.some(c=>c.key===filter.category))||(filter.rating&&(!theme.features.ratingEnabled||!theme.rating?.options.some(r=>r.key===filter.rating)))) throw new ApiError(422,"INVALID_FILTER","현재 지도에서 사용할 수 없는 필터입니다.");
  if(filter.question){const q=theme.questions.find(q=>q.key===filter.question);if(!q || q.type==="text" || ![...(q.options?.map(o=>o.key)??[]),...(q.type==="boolean"?["yes","no"]:[]),...(q.allowUnknown?["unknown"]:[]),...(q.allowNotApplicable?["na"]:[])].includes(filter.answer!))throw new ApiError(422,"INVALID_FILTER","질문 필터를 확인해 주세요.");}
  const rows=(await client.query(`SELECT o.*,c.key AS category_key,e.key AS emoji_key,r.key AS rating_key,mm.nickname,p.id AS photo_id
    FROM app.observations o JOIN app.categories c ON c.id=o.category_id JOIN app.emoji_options e ON e.id=o.emoji_option_id
    LEFT JOIN app.rating_options r ON r.id=o.rating_option_id JOIN app.map_members mm ON mm.id=o.author_member_id
    LEFT JOIN app.observation_photos p ON p.observation_id=o.id
    WHERE o.map_id=$1 AND o.status='published'
      AND ($2::text IS NULL OR c.key=$2) AND ($3::text IS NULL OR r.key=$3)
      AND ($4::date IS NULL OR o.created_at >= ($4::date::timestamp AT TIME ZONE 'Asia/Seoul'))
      AND ($5::date IS NULL OR o.created_at < (($5::date+1)::timestamp AT TIME ZONE 'Asia/Seoul'))
      AND ($6::float8 IS NULL OR (o.lng BETWEEN $6 AND $8 AND o.lat BETWEEN $7 AND $9))
      AND ($10::text IS NULL OR o.answers->$10 ? $11)
    ORDER BY o.created_at DESC,o.id DESC LIMIT 10001`,[mapId,filter.category??null,filter.rating??null,filter.from??null,filter.to??null,...(filter.bbox??[null,null,null,null]),filter.question??null,filter.answer??null])).rows;
  if(rows.length>10000)throw new ApiError(422,"NARROW_FILTER","기록이 10,000건을 넘습니다. 기간이나 영역을 좁혀 주세요.");
  const items=rows.map(r=>({id:r.id as string,mapId,title:r.title as string,body:r.body as string,locationLabel:r.location_label as string,locationSource:r.location_source,location:{lat:r.lat as number,lng:r.lng as number},categoryKey:r.category_key as string,emojiKey:r.emoji_key as string,ratingKey:r.rating_key as string|null,answers:r.answers as Record<string,string[]>,improvementIdea:r.improvement_idea as string|null,link:r.link_url as string|null,status:"published" as const,version:r.version as string,configRevision:r.config_revision as number,createdAt:(r.created_at as Date).toISOString(),author:r.nickname as string,canEdit:map.status==="active"&&map.member_status==="active"&&r.author_member_id===map.member_id,canDelete:map.member_status==="active"&&r.author_member_id===map.member_id,canModerate:isAdmin(map,session),photoUrl:r.photo_id?`/api/v1/maps/${mapId}/observations/${r.id}/photo`:null}));
  const normalized=Object.fromEntries(Object.entries(filter).sort(([a],[b])=>a.localeCompare(b)));
  return {map,theme,meta,items,filter,stats:aggregateRecords(items,theme,Object.fromEntries(revisions.map(r=>[r.revision,r.definition]))),dataRevision:meta.data_revision,generatedAt:new Date().toISOString(),filterFingerprint:createHash("sha256").update(JSON.stringify(normalized)).digest("hex")};
}
function ensureDownloadSize(content:string){if(Buffer.byteLength(content,"utf8")>3_500_000)throw new ApiError(422,"NARROW_FILTER","선택한 기록의 분량이 많습니다. 기간이나 영역을 좁혀 주세요.");}
export async function getAnalysis(mapId:string,session:AppSession|null,filter:ObservationFilter){return withTransaction(async client=>{await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");const {map,theme,meta,...data}=await readDataset(client,mapId,session,filter);void map;void theme;void meta;ensureDownloadSize(JSON.stringify(data));return data;});}
export async function exportCsv(mapId:string,session:AppSession,filter:ObservationFilter,includeAuthor:boolean,includeCoordinates:boolean){
  return withTransaction(async client=>{
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    requireAdmin(await communityMap(client,mapId,session),session);
    const data=await readDataset(client,mapId,session,filter);
    const columns=["기록 ID","제목","관찰 내용","유형","이모지",...(data.theme.features.ratingEnabled?[data.theme.rating?.label??"평가"]:[]),"게시 상태","등록 시각(UTC)","설정 버전","답변(키)","개선 아이디어","링크","집계 시각(UTC)","필터",...(includeAuthor?["작성자 닉네임"]:[]),...(includeCoordinates?["장소","위도","경도"]:[])];
    const lines=data.items.map(r=>[r.id,r.title,r.body,data.theme.categories.find(c=>c.key===r.categoryKey)?.label,data.theme.categories.flatMap(c=>c.emojiOptions).find(e=>e.key===r.emojiKey)?.glyph,...(data.theme.features.ratingEnabled?[data.theme.rating?.options.find(o=>o.key===r.ratingKey)?.label??""]:[]),r.status,r.createdAt,r.configRevision,JSON.stringify(r.answers),r.improvementIdea,r.link,data.generatedAt,JSON.stringify(data.filter),...(includeAuthor?[r.author]:[]),...(includeCoordinates?[r.locationLabel,r.location.lat,r.location.lng]:[])]);
    const questionColumns=data.theme.questions.map(q=>`${q.label} [${q.key}]`);
    const questionValues=data.items.map(item=>data.theme.questions.map(q=>(item.answers[q.key]??[]).map(value=>value==="unknown"?"확인 못함":value==="na"?"해당 없음":q.type==="boolean"?(value==="yes"?"있음":"없음"):q.options?.find(o=>o.key===value)?.label??value).join(" | ")));
    const csv="\uFEFF"+[[...columns,...questionColumns],...lines.map((line,index)=>[...line,...questionValues[index]])].map(line=>line.map(csvCell).join(",")).join("\r\n");
    ensureDownloadSize(csv);return csv;
  });
}
