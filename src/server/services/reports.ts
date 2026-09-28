import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient,QueryResultRow } from "pg";
import { z } from "zod";
import type { AppSession } from "@/server/auth/session";
import { withTransaction } from "@/server/db";
import { ApiError } from "@/server/http";
import { audit,communityMap,requireAdmin,requireMember } from "./community-access";

export const reportInput=z.strictObject({targetType:z.enum(["observation","comment"]),targetId:z.uuid(),reasonCode:z.enum(["privacy","unsafe","spam","other"]),detail:z.string().trim().max(500).optional()});
export const reportReviewInput=z.strictObject({status:z.enum(["resolved","dismissed"]),reason:z.string().trim().min(2).max(500)});
type ReportRow=QueryResultRow&{id:string;map_id:string;reporter_member_id:string;target_type:"observation"|"comment";target_id:string;reason_code:string;detail:string|null;status:"open"|"resolved"|"dismissed";resolution_reason:string|null;version:string;created_at:Date;updated_at:Date;nickname:string;target_title:string|null;target_body:string|null;target_status:string|null;photo_id:string|null};
const selectReport=`SELECT r.*,mm.nickname,coalesce(o.title,parent.title) AS target_title,
  CASE WHEN r.target_type='observation' THEN o.body ELSE c.body END AS target_body,
  CASE WHEN r.target_type='observation' THEN o.status ELSE c.status END AS target_status,p.id AS photo_id
  FROM app.reports r JOIN app.map_members mm ON mm.id=r.reporter_member_id
  LEFT JOIN app.observations o ON r.target_type='observation' AND o.map_id=r.map_id AND o.id=r.target_id
  LEFT JOIN app.comments c ON r.target_type='comment' AND c.map_id=r.map_id AND c.id=r.target_id
  LEFT JOIN app.observations parent ON parent.map_id=c.map_id AND parent.id=c.observation_id
  LEFT JOIN app.observation_photos p ON p.map_id=o.map_id AND p.observation_id=o.id`;
function dto(row:ReportRow){return{id:row.id,targetType:row.target_type,targetId:row.target_id,reasonCode:row.reason_code,detail:row.detail,status:row.status,resolutionReason:row.resolution_reason,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at,reporter:row.nickname,targetTitle:row.target_title,targetBody:row.target_body,targetStatus:row.target_status,photoUrl:row.photo_id&&row.target_status!=="deleted"?`/api/v1/maps/${row.map_id}/observations/${row.target_id}/photo`:null};}
async function targetVisible(client:PoolClient,mapId:string,targetType:"observation"|"comment",targetId:string){
  if(targetType==="observation"){
    const result=await client.query("SELECT 1 FROM app.observations WHERE map_id=$1 AND id=$2 AND status='published'",[mapId,targetId]);
    if(!result.rowCount)throw new ApiError(404,"NOT_FOUND","신고 대상을 찾을 수 없습니다.");
  }else{
    const result=await client.query("SELECT 1 FROM app.comments c JOIN app.observations o ON o.id=c.observation_id AND o.map_id=c.map_id WHERE c.map_id=$1 AND c.id=$2 AND c.status='visible' AND o.status='published'",[mapId,targetId]);
    if(!result.rowCount)throw new ApiError(404,"NOT_FOUND","신고 대상을 찾을 수 없습니다.");
  }
}
export async function createReport(mapId:string,session:AppSession,key:string,input:z.infer<typeof reportInput>){
  return withTransaction(async(client)=>{
    const map=await communityMap(client,mapId,session);const memberId=requireMember(map);
    if(map.status!=="active")throw new ApiError(403,"MAP_CLOSED","보관된 지도에는 신고할 수 없습니다.");
    await targetVisible(client,mapId,input.targetType,input.targetId);
    const scope=`report:${mapId}`,hash=createHash("sha256").update(JSON.stringify(input)).digest();
    await client.query("DELETE FROM app_private.idempotency_keys WHERE principal_id=$1 AND route_scope=$2 AND key=$3 AND expires_at<now()",[session.principalId,scope,key]);
    await client.query("INSERT INTO app_private.idempotency_keys(principal_id,route_scope,key,request_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",[session.principalId,scope,key,hash]);
    const idem=await client.query<{request_hash:Buffer;resource_id:string|null}>("SELECT request_hash,resource_id FROM app_private.idempotency_keys WHERE principal_id=$1 AND route_scope=$2 AND key=$3 FOR UPDATE",[session.principalId,scope,key]);
    if(!idem.rows[0].request_hash.equals(hash))throw new ApiError(409,"IDEMPOTENCY_CONFLICT","같은 요청 키가 다른 신고에 사용됐습니다.");
    if(idem.rows[0].resource_id){const prior=await client.query<ReportRow>(`${selectReport} WHERE r.map_id=$1 AND r.id=$2`,[mapId,idem.rows[0].resource_id]);if(prior.rows[0])return{report:dto(prior.rows[0]),repeated:true};}
    await client.query("SELECT id FROM app.map_members WHERE id=$1 FOR UPDATE",[memberId]);
    const recent=await client.query<{count:string}>("SELECT count(*)::text AS count FROM app.reports WHERE reporter_member_id=$1 AND created_at>now()-interval '1 hour'",[memberId]);
    if(Number(recent.rows[0].count)>=5)throw new ApiError(429,"REPORT_RATE_LIMIT","잠시 후 다시 신고해 주세요.");
    const existing=await client.query<ReportRow>(`${selectReport} WHERE r.map_id=$1 AND r.reporter_member_id=$2 AND r.target_type=$3 AND r.target_id=$4 AND r.status='open'`,[mapId,memberId,input.targetType,input.targetId]);
    if(existing.rows[0])throw new ApiError(409,"ALREADY_REPORTED","이미 신고한 대상입니다.");
    let added;
    try{added=await client.query<{id:string}>("INSERT INTO app.reports(map_id,reporter_member_id,target_type,target_id,reason_code,detail) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",[mapId,memberId,input.targetType,input.targetId,input.reasonCode,input.detail || null]);}
    catch(error){if(error&&typeof error==="object"&&"code" in error&&error.code==="23505")throw new ApiError(409,"ALREADY_REPORTED","이미 신고한 대상입니다.");throw error;}
    await client.query("UPDATE app_private.idempotency_keys SET resource_id=$1,response_code=201,completed_at=now() WHERE principal_id=$2 AND route_scope=$3 AND key=$4",[added.rows[0].id,session.principalId,scope,key]);
    const row=await client.query<ReportRow>(`${selectReport} WHERE r.id=$1`,[added.rows[0].id]);
    return{report:dto(row.rows[0]),repeated:false};
  });
}
export async function listReports(mapId:string,session:AppSession,status:"open"|"resolved"|"dismissed"|"all"){
  return withTransaction(async(client)=>{const map=await communityMap(client,mapId,session);requireAdmin(map,session);const rows=await client.query<ReportRow>(`${selectReport} WHERE r.map_id=$1 AND ($2::text='all' OR r.status=$2) ORDER BY r.created_at DESC,r.id DESC LIMIT 200`,[mapId,status]);return{items:rows.rows.map(dto),nextCursor:null};});
}
export async function reviewReport(mapId:string,id:string,session:AppSession,version:string,input:z.infer<typeof reportReviewInput>){
  return withTransaction(async(client)=>{const map=await communityMap(client,mapId,session);requireAdmin(map,session);const existing=await client.query<ReportRow>(`${selectReport} WHERE r.map_id=$1 AND r.id=$2 FOR UPDATE OF r`,[mapId,id]);const report=existing.rows[0];if(!report)throw new ApiError(404,"NOT_FOUND","신고를 찾을 수 없습니다.");if(report.version!==version)throw new ApiError(412,"VERSION_CHANGED","신고가 다른 곳에서 처리됐습니다.");if(report.status!=="open")throw new ApiError(409,"STATUS_CHANGED","이미 처리된 신고입니다.");await client.query("UPDATE app.reports SET status=$2,resolution_reason=$3,version=version+1,updated_at=now() WHERE id=$1",[id,input.status,input.reason]);await audit(client,mapId,session,`report.${input.status}`,"report",id,input.reason);const latest=await client.query<ReportRow>(`${selectReport} WHERE r.id=$1`,[id]);return dto(latest.rows[0]);});
}
