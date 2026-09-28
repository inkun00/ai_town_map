import "server-only";
import type { QueryResultRow } from "pg";
import { z } from "zod";
import type { AppSession } from "@/server/auth/session";
import { withTransaction } from "@/server/db";
import { ApiError } from "@/server/http";
import { audit,communityMap,requireAdmin } from "./community-access";

export const mapSettingsInput=z.strictObject({visibility:z.enum(["public","invite_only"]).optional(),participation:z.enum(["invited","admin_only","closed"]).optional(),moderation:z.enum(["immediate","approval"]).optional(),commentsEnabled:z.boolean().optional(),status:z.enum(["active","archived"]).optional()}).refine(value=>Object.keys(value).length>0);
export const memberInput=z.strictObject({role:z.enum(["admin","participant"]).optional(),status:z.enum(["active","blocked"]).optional()}).refine(value=>Object.keys(value).length===1);
type MemberRow=QueryResultRow&{id:string;principal_id:string;nickname:string;role:"admin"|"participant";status:"active"|"blocked"|"left";version:string;joined_at:Date;kind:"account"|"guest"};
function memberDto(row:MemberRow,ownerId:string){return{id:row.id,nickname:row.nickname,role:row.role,status:row.status,version:row.version,joinedAt:row.joined_at,isOwner:row.principal_id===ownerId,accountType:row.kind};}

export async function changeMapSettings(mapId:string,session:AppSession,version:string,input:z.infer<typeof mapSettingsInput>){
  return withTransaction(async(client)=>{
    const map=await communityMap(client,mapId,session);requireAdmin(map,session);
    if(map.version!==version)throw new ApiError(412,"VERSION_CHANGED","지도 설정이 다른 곳에서 변경됐습니다.");
    const owner=map.owner_principal_id===session.principalId;
    if(!owner&&(input.visibility!==undefined||input.participation!==undefined||input.status!==undefined))throw new ApiError(403,"OWNER_REQUIRED","지도 개설자만 변경할 수 있습니다.");
    if(input.status&&input.status===map.status&&Object.keys(input).length===1)return{version:map.version};
    await client.query(`UPDATE app.maps SET visibility=coalesce($2,visibility),participation=coalesce($3,participation),moderation=coalesce($4,moderation),comments_enabled=coalesce($5,comments_enabled),status=coalesce($6,status),version=version+1,updated_at=now() WHERE id=$1`,[mapId,input.visibility??null,input.participation??null,input.moderation??null,input.commentsEnabled??null,input.status??null]);
    await audit(client,mapId,session,"map.settings","map",mapId,JSON.stringify(input));
    const result=await client.query<{version:string}>("SELECT version FROM app.maps WHERE id=$1",[mapId]);return{version:result.rows[0].version};
  });
}

export async function deleteMap(mapId:string,session:AppSession,version:string){
  return withTransaction(async(client)=>{const map=await communityMap(client,mapId,session);if(map.owner_principal_id!==session.principalId)throw new ApiError(403,"OWNER_REQUIRED","지도 개설자만 삭제할 수 있습니다.");if(map.version!==version)throw new ApiError(412,"VERSION_CHANGED","지도 설정이 변경됐습니다.");await client.query("UPDATE app.maps SET status='deleted',deleted_at=now(),deleted_by=$2,version=version+1,updated_at=now() WHERE id=$1",[mapId,session.principalId]);await audit(client,mapId,session,"map.delete","map",mapId);});
}

export async function restoreMap(mapId:string,session:AppSession,version:string){
  return withTransaction(async(client)=>{const result=await client.query<{owner_principal_id:string;status:string;version:string;deleted_at:Date|null}>("SELECT owner_principal_id,status,version,deleted_at FROM app.maps WHERE id=$1 FOR UPDATE",[mapId]);const map=result.rows[0];if(!map||map.owner_principal_id!==session.principalId||map.status!=="deleted")throw new ApiError(404,"NOT_FOUND","복구할 지도를 찾을 수 없습니다.");if(map.version!==version)throw new ApiError(412,"VERSION_CHANGED","지도 설정이 변경됐습니다.");if(!map.deleted_at||Date.now()-map.deleted_at.getTime()>30*86400000)throw new ApiError(409,"RESTORE_EXPIRED","복구 기간이 지났습니다.");const updated=await client.query<{version:string}>("UPDATE app.maps SET status='archived',deleted_at=NULL,deleted_by=NULL,version=version+1,updated_at=now() WHERE id=$1 RETURNING version",[mapId]);await audit(client,mapId,session,"map.restore","map",mapId);return{version:updated.rows[0].version,status:"archived"};});
}

export async function listMembers(mapId:string,session:AppSession){
  return withTransaction(async(client)=>{const map=await communityMap(client,mapId,session);requireAdmin(map,session);const rows=await client.query<MemberRow>(`SELECT mm.*,p.kind FROM app.map_members mm JOIN app.principals p ON p.id=mm.principal_id WHERE mm.map_id=$1 ORDER BY mm.joined_at ASC,mm.id ASC LIMIT 500`,[mapId]);return{items:rows.rows.map(row=>memberDto(row,map.owner_principal_id)),nextCursor:null};});
}

export async function changeMember(mapId:string,id:string,session:AppSession,version:string,input:z.infer<typeof memberInput>){
  return withTransaction(async(client)=>{
    const map=await communityMap(client,mapId,session);requireAdmin(map,session);
    const result=await client.query<MemberRow>(`SELECT mm.*,p.kind FROM app.map_members mm JOIN app.principals p ON p.id=mm.principal_id WHERE mm.map_id=$1 AND mm.id=$2 FOR UPDATE OF mm`,[mapId,id]);const member=result.rows[0];
    if(!member)throw new ApiError(404,"NOT_FOUND","참여자를 찾을 수 없습니다.");
    if(member.version!==version)throw new ApiError(412,"VERSION_CHANGED","참여자 정보가 변경됐습니다.");
    if(member.principal_id===map.owner_principal_id)throw new ApiError(403,"OWNER_PROTECTED","지도 개설자의 권한은 변경할 수 없습니다.");
    if(input.role){if(session.principalId!==map.owner_principal_id)throw new ApiError(403,"OWNER_REQUIRED","지도 개설자만 관리자를 지정할 수 있습니다.");if(member.status!=="active"||member.kind!=="account")throw new ApiError(422,"ACCOUNT_REQUIRED","활성 Google 계정만 관리자로 지정할 수 있습니다.");}
    if(input.status&&member.role==="admin"&&session.principalId!==map.owner_principal_id)throw new ApiError(403,"OWNER_REQUIRED","관리자 차단은 지도 개설자만 할 수 있습니다.");
    if(input.status==="active"&&member.status!=="blocked")throw new ApiError(409,"STATUS_CHANGED","차단된 참여자만 복구할 수 있습니다.");
    if(input.status==="blocked"&&member.status!=="active")throw new ApiError(409,"STATUS_CHANGED","활성 참여자만 차단할 수 있습니다.");
    await client.query("UPDATE app.map_members SET role=coalesce($2,role),status=coalesce($3,status),version=version+1 WHERE id=$1",[id,input.role??null,input.status??null]);
    await audit(client,mapId,session,input.role?"member.role":"member.status","member",id,JSON.stringify(input));
    const latest=await client.query<MemberRow>(`SELECT mm.*,p.kind FROM app.map_members mm JOIN app.principals p ON p.id=mm.principal_id WHERE mm.id=$1`,[id]);return memberDto(latest.rows[0],map.owner_principal_id);
  });
}
