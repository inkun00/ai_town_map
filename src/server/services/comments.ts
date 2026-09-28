import "server-only";
import { createHash } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";
import { z } from "zod";
import type { AppSession } from "@/server/auth/session";
import { withTransaction } from "@/server/db";
import { ApiError } from "@/server/http";
import { audit, communityMap, isAdmin, requireAdmin, requireMember } from "./community-access";

export const commentInput = z.strictObject({body:z.string().trim().min(1).max(500)});
export const commentModerationInput = z.strictObject({action:z.enum(["hide","restore"]),reason:z.string().trim().min(2).max(500)});
type CommentRow = QueryResultRow & {id:string;map_id:string;observation_id:string;author_member_id:string;body:string;status:"visible"|"hidden"|"deleted";version:string;created_at:Date;updated_at:Date;nickname:string};
const selectComment = `SELECT c.*,mm.nickname FROM app.comments c JOIN app.map_members mm ON mm.id=c.author_member_id`;
function dto(row:CommentRow,memberId:string|null,admin:boolean) {
  return {id:row.id,observationId:row.observation_id,body:row.status==="visible"||admin?row.body:null,status:row.status,version:row.version,createdAt:row.created_at,updatedAt:row.updated_at,author:row.status==="visible"||admin?row.nickname:null,canEdit:row.status==="visible"&&memberId===row.author_member_id,canModerate:admin};
}
async function publishedParent(client:PoolClient,mapId:string,observationId:string) {
  const parent=await client.query<{status:string}>("SELECT status FROM app.observations WHERE map_id=$1 AND id=$2",[mapId,observationId]);
  if(parent.rows[0]?.status!=="published") throw new ApiError(404,"NOT_FOUND","기록을 찾을 수 없습니다.");
}

export async function listComments(mapId:string,observationId:string,session:AppSession|null) {
  return withTransaction(async(client)=>{
    const map=await communityMap(client,mapId,session);
    const admin=isAdmin(map,session);
    const parent=await client.query<{status:string}>("SELECT status FROM app.observations WHERE map_id=$1 AND id=$2",[mapId,observationId]);
    if(!parent.rows[0]||!(parent.rows[0].status==="published"||(admin&&["pending","hidden"].includes(parent.rows[0].status))))throw new ApiError(404,"NOT_FOUND","기록을 찾을 수 없습니다.");
    const rows=await client.query<CommentRow>(`${selectComment} WHERE c.map_id=$1 AND c.observation_id=$2 AND (c.status='visible' OR ($3::boolean AND c.status='hidden')) ORDER BY c.created_at ASC,c.id ASC LIMIT 200`,[mapId,observationId,admin]);
    return {items:rows.rows.map((row)=>dto(row,map.member_status==="active"?map.member_id:null,admin)),nextCursor:null};
  });
}

export async function createComment(mapId:string,observationId:string,session:AppSession,key:string,body:string) {
  return withTransaction(async(client)=>{
    const map=await communityMap(client,mapId,session);
    const memberId=requireMember(map);
    if(map.status!=="active"||!map.comments_enabled) throw new ApiError(403,"COMMENTS_DISABLED","이 지도에는 댓글을 남길 수 없습니다.");
    await publishedParent(client,mapId,observationId);
    const requestHash=createHash("sha256").update(JSON.stringify({observationId,body})).digest();
    const scope=`comment:${mapId}`;
    await client.query("DELETE FROM app_private.idempotency_keys WHERE principal_id=$1 AND route_scope=$2 AND key=$3 AND expires_at<now()",[session.principalId,scope,key]);
    await client.query("INSERT INTO app_private.idempotency_keys(principal_id,route_scope,key,request_hash) VALUES($1,$2,$3,$4) ON CONFLICT DO NOTHING",[session.principalId,scope,key,requestHash]);
    const idem=await client.query<{request_hash:Buffer;resource_id:string|null}>("SELECT request_hash,resource_id FROM app_private.idempotency_keys WHERE principal_id=$1 AND route_scope=$2 AND key=$3 FOR UPDATE",[session.principalId,scope,key]);
    if(!idem.rows[0].request_hash.equals(requestHash)) throw new ApiError(409,"IDEMPOTENCY_CONFLICT","같은 요청 키가 다른 댓글에 사용됐습니다.");
    if(idem.rows[0].resource_id){const prior=await client.query<CommentRow>(`${selectComment} WHERE c.map_id=$1 AND c.id=$2`,[mapId,idem.rows[0].resource_id]);if(prior.rows[0]) return {comment:dto(prior.rows[0],memberId,isAdmin(map,session)),repeated:true};}
    await client.query("SELECT id FROM app.map_members WHERE id=$1 FOR UPDATE",[memberId]);
    const recent=await client.query<{count:string}>("SELECT count(*)::text AS count FROM app.comments WHERE author_member_id=$1 AND created_at>now()-interval '10 minutes'",[memberId]);
    if(Number(recent.rows[0].count)>=10)throw new ApiError(429,"COMMENT_RATE_LIMIT","잠시 후 다시 댓글을 남겨주세요.");
    const added=await client.query<{id:string}>("INSERT INTO app.comments(map_id,observation_id,author_member_id,body) VALUES($1,$2,$3,$4) RETURNING id",[mapId,observationId,memberId,body]);
    await client.query("UPDATE app_private.idempotency_keys SET resource_id=$1,response_code=201,completed_at=now() WHERE principal_id=$2 AND route_scope=$3 AND key=$4",[added.rows[0].id,session.principalId,scope,key]);
    const row=await client.query<CommentRow>(`${selectComment} WHERE c.id=$1`,[added.rows[0].id]);
    return {comment:dto(row.rows[0],memberId,isAdmin(map,session)),repeated:false};
  });
}

export async function editComment(mapId:string,id:string,session:AppSession,version:string,body:string) {
  return withTransaction(async(client)=>{
    const map=await communityMap(client,mapId,session);
    const memberId=requireMember(map);
    const existing=await client.query<CommentRow>(`${selectComment} WHERE c.map_id=$1 AND c.id=$2 FOR UPDATE OF c`,[mapId,id]);
    const row=existing.rows[0];
    if(!row||row.author_member_id!==memberId||row.status!=="visible") throw new ApiError(404,"NOT_FOUND","댓글을 찾을 수 없습니다.");
    if(map.status!=="active"||!map.comments_enabled) throw new ApiError(403,"COMMENTS_DISABLED","이 지도에는 댓글을 수정할 수 없습니다.");
    await publishedParent(client,mapId,row.observation_id);
    if(row.version!==version) throw new ApiError(412,"VERSION_CHANGED","댓글이 다른 곳에서 변경됐습니다.");
    await client.query("UPDATE app.comments SET body=$2,version=version+1,updated_at=now() WHERE id=$1",[id,body]);
    const latest=await client.query<CommentRow>(`${selectComment} WHERE c.id=$1`,[id]);
    return dto(latest.rows[0],memberId,isAdmin(map,session));
  });
}

export async function deleteComment(mapId:string,id:string,session:AppSession,version:string) {
  return withTransaction(async(client)=>{
    const map=await communityMap(client,mapId,session);
    const row=await client.query<CommentRow>(`${selectComment} WHERE c.map_id=$1 AND c.id=$2 FOR UPDATE OF c`,[mapId,id]);
    const comment=row.rows[0];
    if(!comment||comment.status==="deleted") throw new ApiError(404,"NOT_FOUND","댓글을 찾을 수 없습니다.");
    if(!(map.member_status==="active"&&comment.author_member_id===map.member_id)&&!isAdmin(map,session)) throw new ApiError(403,"WRITE_FORBIDDEN","댓글을 삭제할 수 없습니다.");
    if(comment.version!==version) throw new ApiError(412,"VERSION_CHANGED","댓글이 다른 곳에서 변경됐습니다.");
    await client.query("UPDATE app.comments SET status='deleted',version=version+1,updated_at=now() WHERE id=$1",[id]);
    await audit(client,mapId,session,"comment.delete","comment",id);
  });
}

export async function moderateComment(mapId:string,id:string,session:AppSession,version:string,action:"hide"|"restore",reason:string) {
  return withTransaction(async(client)=>{
    const map=await communityMap(client,mapId,session);requireAdmin(map,session);
    const row=await client.query<CommentRow>(`${selectComment} WHERE c.map_id=$1 AND c.id=$2 FOR UPDATE OF c`,[mapId,id]);
    const comment=row.rows[0];
    if(!comment||comment.status==="deleted") throw new ApiError(404,"NOT_FOUND","댓글을 찾을 수 없습니다.");
    if(comment.version!==version) throw new ApiError(412,"VERSION_CHANGED","댓글이 다른 곳에서 변경됐습니다.");
    if((action==="hide"&&comment.status!=="visible")||(action==="restore"&&comment.status!=="hidden")) throw new ApiError(409,"STATUS_CHANGED","댓글 상태를 확인해 주세요.");
    await client.query("UPDATE app.comments SET status=$2,version=version+1,updated_at=now() WHERE id=$1",[id,action==="hide"?"hidden":"visible"]);
    await audit(client,mapId,session,`comment.${action}`,"comment",id,reason);
    const latest=await client.query<CommentRow>(`${selectComment} WHERE c.id=$1`,[id]);
    return dto(latest.rows[0],map.member_id,true);
  });
}
