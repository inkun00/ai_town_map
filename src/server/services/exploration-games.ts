import "server-only";
import {createHash,createHmac,randomBytes} from "node:crypto";
import {z} from "zod";
import type {PoolClient,QueryResultRow} from "pg";
import {withTransaction,query} from "@/server/db";
import {ApiError} from "@/server/http";
import {getServerConfig} from "@/server/env";
import {issueSession,type AppSession} from "@/server/auth/session";
import {communityMap,isAdmin,requireAdmin} from "./community-access";
import {inviteAttemptActor} from "@/server/policies/invite-attempts";
import {accountRole,requireTeacher} from "./accounts";
import {arrivalFailure,evaluateMission,publicMission,rankedPlayers,missionSchema,coordinatesSchema,
  type MissionDefinition,type GameMission,type GameSummary,type GameSubmission,
  type createGameSchema,type createRoomSchema,type joinGameSchema,type locationSchema,type submitMissionSchema} from "@/domain/exploration-game";

type GameRow=QueryResultRow&{id:string;source_map_id:string;created_by:string;title:string;description:string;status:"active"|"archived";deleted_at:Date|null;version:string;location_label:string;point_count:string;mission_count:string};
type RoomRow=QueryResultRow&{id:string;game_id:string;host_principal_id:string;title:string;status:"lobby"|"running"|"ended";duration_minutes:number;max_players:number;starts_at:Date|null;ends_at:Date|null;ended_at:Date|null;join_expires_at:Date;join_code:string;source_map_id:string;game_status:string;map_status:string;host_allowed:boolean;server_now:Date};
type PlayerRow=QueryResultRow&{id:string;nickname:string;principal_id:string;sharing:boolean;lat:number|null;lng:number|null;accuracy:number|null;observed_at:Date|null;last_seen_at:Date|null;score:string;completed:string};
type SubmissionRow=QueryResultRow&{id:string;player_id:string;mission_id:string;status:GameSubmission["status"];attempts:number;score:number;response:GameSubmission["response"];reason:string|null;version:string;submitted_at:Date};
const version=z.string().regex(/^[1-9]\d{0,15}$/);
const pointSchema=z.strictObject({title:z.string().trim().min(1).max(80),emoji:z.string().trim().min(1).max(16),location:coordinatesSchema});
export const changeGameSchema=z.discriminatedUnion("action",[
  z.strictObject({action:z.literal("settings"),version,title:z.string().trim().min(2).max(80),description:z.string().trim().max(500),status:z.enum(["active","archived"])}),
  z.strictObject({action:z.literal("point"),version,point:pointSchema}),
  z.strictObject({action:z.literal("mission"),version,id:z.uuid().optional(),mission:missionSchema}),
  z.strictObject({action:z.literal("delete_mission"),version,id:z.uuid()}),
  z.strictObject({action:z.literal("delete_point"),version,id:z.uuid()}),
]);
export const roomActionSchema=z.discriminatedUnion("action",[
  z.strictObject({action:z.literal("start")}),z.strictObject({action:z.literal("end")}),
  z.strictObject({action:z.literal("stop_sharing")}),z.strictObject({action:z.literal("resume_sharing")}),
  z.strictObject({action:z.literal("review"),submissionId:z.uuid(),version,decision:z.enum(["approve","reject"]),reason:z.string().trim().max(500).default("")}),
]);
function account(session:AppSession){if(session.kind!=="account")throw new ApiError(403,"TEACHER_REQUIRED","교사의 Google 로그인이 필요합니다.");}
function summary(row:GameRow,canManage:boolean,principalId:string|null):GameSummary{return {id:row.id,sourceMapId:row.source_map_id,title:row.title,description:row.description,location:row.location_label,status:row.deleted_at?"deleted":row.status,deletedAt:row.deleted_at?.toISOString()??null,canDelete:row.created_by===principalId,version:String(row.version),pointCount:Number(row.point_count),missionCount:Number(row.mission_count),canManage};}
const gameSelect=`SELECT g.*,m.location_label,(SELECT count(*) FROM app.game_points p WHERE p.game_id=g.id)::text point_count,(SELECT count(*) FROM app.game_missions s WHERE s.game_id=g.id)::text mission_count FROM app.game_maps g JOIN app.maps m ON m.id=g.source_map_id`;
async function gameAccess(client:PoolClient,id:string,session:AppSession|null,manage=false,lock=false){
  const {rows}=await client.query<GameRow>(`${gameSelect} WHERE g.id=$1 ${lock?"FOR UPDATE OF g":""}`,[id]);
  const row=rows[0];if(!row)throw new ApiError(404,"NOT_FOUND","게임맵을 찾을 수 없습니다.");
  if(row.deleted_at&&row.created_by!==session?.principalId)throw new ApiError(404,"NOT_FOUND","게임맵을 찾을 수 없습니다.");
  const map=await communityMap(client,row.source_map_id,session);
  const canManage=!row.deleted_at&&map.status==="active"&&await accountRole(client,session)==="teacher"&&isAdmin(map,session);
  if(manage){await requireTeacher(client,session!);requireAdmin(map,session!);if(row.deleted_at)throw new ApiError(409,"GAME_DELETED","삭제한 게임맵은 먼저 복구해 주세요.");if(map.status!=="active")throw new ApiError(409,"MAP_CLOSED","운영 중인 지도에서 게임을 관리해 주세요.");}
  return {row,canManage};
}
async function missions(client:PoolClient,gameId:string){
  const {rows}=await client.query<{id:string;definition:MissionDefinition;lat:number;lng:number;emoji:string;point_title:string}>(`SELECT s.id,s.definition,p.lat,p.lng,p.emoji,p.title point_title FROM app.game_missions s JOIN app.game_points p ON p.id=s.point_id AND p.game_id=s.game_id WHERE s.game_id=$1 ORDER BY s.created_at,s.id`,[gameId]);
  return rows.map(r=>({...r.definition,id:r.id,location:{lat:r.lat,lng:r.lng},emoji:r.emoji,pointTitle:r.point_title}));
}
export async function listGames(session:AppSession|null,q:string="",scope:"active"|"deleted"="active"){
  return withTransaction(async client=>{
    const {rows}=await client.query<GameRow>(`${gameSelect} LEFT JOIN app.map_members mm ON mm.map_id=m.id AND mm.principal_id=$1
      WHERE m.status IN ('active','archived') AND (m.visibility='public' OR mm.status='active') AND (mm.status IS NULL OR mm.status<>'blocked')
      AND (($3='deleted' AND g.deleted_at IS NOT NULL AND g.created_by=$1) OR ($3='active' AND g.deleted_at IS NULL AND (g.status='active' OR (mm.status='active' AND (mm.role='admin' OR m.owner_principal_id=$1)))))
      AND ($2='' OR strpos(lower(g.title),lower($2))>0) ORDER BY g.created_at DESC,g.id LIMIT 100`,[session?.principalId??null,q,scope]);
    const teacher=await accountRole(client,session)==="teacher";
    const items=[];for(const row of rows){const map=await communityMap(client,row.source_map_id,session);items.push(summary(row,!row.deleted_at&&map.status==="active"&&teacher&&isAdmin(map,session),session?.principalId??null));}
    return {items};
  });
}
export async function createGame(session:AppSession,input:z.infer<typeof createGameSchema>){
  account(session);
  return withTransaction(async client=>{
    await requireTeacher(client,session);
    const map=await communityMap(client,input.sourceMapId,session);requireAdmin(map,session);
    if(map.status!=="active")throw new ApiError(409,"MAP_CLOSED","운영 중인 지도에서 게임맵을 만들어 주세요.");
    // Lock source so racing retries cannot create duplicate game maps.
    const locked=await client.query("SELECT id FROM app.maps WHERE id=$1 AND status='active' FOR UPDATE",[input.sourceMapId]);if(!locked.rowCount)throw new ApiError(409,"MAP_CLOSED","지도가 종료되었습니다.");
    const old=await client.query<{id:string;source_map_id:string;title:string;description:string}>("SELECT id,source_map_id,title,description FROM app.game_maps WHERE created_by=$1 AND request_id=$2",[session.principalId,input.requestId]);
    if(old.rows[0]){if(old.rows[0].source_map_id!==input.sourceMapId||old.rows[0].title!==input.title||old.rows[0].description!==input.description)throw new ApiError(409,"RETRY_CONFLICT","새 요청으로 다시 만들어 주세요.");return {id:old.rows[0].id};}
    const count=await client.query<{n:string}>("SELECT count(*)::text n FROM app.observations WHERE map_id=$1 AND status='published'",[input.sourceMapId]);
    if(Number(count.rows[0].n)>2000)throw new ApiError(422,"TOO_MANY_POINTS","게임맵은 최대 2,000개 포인트를 사용할 수 있습니다.");
    const created=await client.query<{id:string}>("INSERT INTO app.game_maps(source_map_id,created_by,request_id,title,description) VALUES($1,$2,$3,$4,$5) RETURNING id",[input.sourceMapId,session.principalId,input.requestId,input.title,input.description]);
    const id=created.rows[0].id;
    await client.query(`INSERT INTO app.game_points(game_id,source_observation_id,title,emoji,lat,lng)
      SELECT $1,o.id,o.title,e.glyph,o.lat,o.lng FROM app.observations o JOIN app.emoji_options e ON e.id=o.emoji_option_id WHERE o.map_id=$2 AND o.status='published'`,[id,input.sourceMapId]);
    return {id};
  });
}
export async function getGame(id:string,session:AppSession|null){
  return withTransaction(async client=>{
    const {row,canManage}=await gameAccess(client,id,session);
    const {rows:points}=await client.query<{id:string;title:string;emoji:string;lat:number;lng:number}>("SELECT id,title,emoji,lat,lng FROM app.game_points WHERE game_id=$1 ORDER BY title,id",[id]);
    const all=await missions(client,id);
    const rooms=canManage?await client.query<{id:string;title:string;status:string;created_at:Date}>("SELECT id,title,status,created_at FROM app.game_rooms WHERE game_id=$1 AND host_principal_id=$2 ORDER BY created_at DESC LIMIT 20",[id,session!.principalId]):{rows:[]};
    return {...summary(row,canManage,session?.principalId??null),points:points.map(p=>({id:p.id,title:p.title,emoji:p.emoji,location:{lat:p.lat,lng:p.lng}})),missions:canManage?all:all.map(publicMission),rooms:rooms.rows.map(r=>({id:r.id,title:r.title,status:r.status,createdAt:r.created_at.toISOString()}))};
  });
}
export async function changeGame(id:string,session:AppSession,input:z.infer<typeof changeGameSchema>){
  return withTransaction(async client=>{
    const {row}=await gameAccess(client,id,session,true,true);
    if(String(row.version)!==input.version)throw new ApiError(409,"VERSION_CONFLICT","다른 교사가 변경했습니다. 새로고침 후 다시 시도해 주세요.");
    if(input.action==="settings"){
      if(input.status==="archived"){
        await client.query("UPDATE app.game_rooms SET status='ended',ended_at=now() WHERE game_id=$1 AND status<>'ended'",[id]);
        await client.query("UPDATE app.game_players SET sharing=false,lat=NULL,lng=NULL,accuracy=NULL,observed_at=NULL WHERE room_id IN(SELECT id FROM app.game_rooms WHERE game_id=$1)",[id]);
      }
      await client.query("UPDATE app.game_maps SET title=$2,description=$3,status=$4 WHERE id=$1",[id,input.title,input.description,input.status]);
    }else if(row.status!=="active")throw new ApiError(409,"GAME_ARCHIVED","보관된 게임맵은 다시 운영한 뒤 수정해 주세요.");
    else if(input.action==="point"){
      const count=await client.query<{n:string}>("SELECT count(*)::text n FROM app.game_points WHERE game_id=$1",[id]);
      if(Number(count.rows[0].n)>=2000)throw new ApiError(422,"TOO_MANY_POINTS","포인트는 최대 2,000개입니다.");
      await client.query("INSERT INTO app.game_points(game_id,title,emoji,lat,lng) VALUES($1,$2,$3,$4,$5)",[id,input.point.title,input.point.emoji,input.point.location.lat,input.point.location.lng]);
    }else if(input.action==="mission"){
      const point=await client.query("SELECT id FROM app.game_points WHERE id=$1 AND game_id=$2",[input.mission.pointId,id]);
      if(!point.rowCount)throw new ApiError(422,"POINT_INVALID","이 게임맵의 포인트를 선택해 주세요.");
      if(input.id){const result=await client.query("UPDATE app.game_missions SET point_id=$3,definition=$4 WHERE id=$1 AND game_id=$2",[input.id,id,input.mission.pointId,JSON.stringify(input.mission)]);if(!result.rowCount)throw new ApiError(404,"NOT_FOUND","미션을 찾을 수 없습니다.");}
      else {const count=await client.query<{n:string}>("SELECT count(*)::text n FROM app.game_missions WHERE game_id=$1",[id]);if(Number(count.rows[0].n)>=200)throw new ApiError(422,"TOO_MANY_MISSIONS","미션은 최대 200개입니다.");await client.query("INSERT INTO app.game_missions(game_id,point_id,definition) VALUES($1,$2,$3)",[id,input.mission.pointId,JSON.stringify(input.mission)]);}
    }else{const table=input.action==="delete_mission"?"game_missions":"game_points";const result=await client.query(`DELETE FROM app.${table} WHERE id=$1 AND game_id=$2`,[input.id,id]);if(!result.rowCount)throw new ApiError(404,"NOT_FOUND","대상을 찾을 수 없습니다.");}
    await client.query("UPDATE app.game_maps SET version=version+1 WHERE id=$1",[id]);
    return {id};
  });
}
const alphabet="23456789ABCDEFGHJKMNPQRSTVWXYZ";
export const gameVersionSchema=z.strictObject({version});
async function ownedGame(client:PoolClient,id:string,session:AppSession){
  const {rows}=await client.query<GameRow>(`${gameSelect} WHERE g.id=$1 FOR UPDATE OF g`,[id]);
  const row=rows[0];if(!row)throw new ApiError(404,"NOT_FOUND","게임맵을 찾을 수 없습니다.");
  if(row.created_by!==session.principalId)throw new ApiError(403,"OWNER_REQUIRED","게임맵을 만든 사람만 삭제하거나 복구할 수 있습니다.");
  return row;
}
export async function deleteGame(id:string,session:AppSession,expectedVersion:string){
  return withTransaction(async client=>{
    const row=await ownedGame(client,id,session);
    if(String(row.version)!==expectedVersion)throw new ApiError(409,"VERSION_CONFLICT","게임맵이 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
    if(row.deleted_at)throw new ApiError(409,"GAME_DELETED","이미 삭제한 게임맵입니다.");
    await client.query("UPDATE app.game_maps SET status='archived',deleted_at=now(),version=version+1 WHERE id=$1",[id]);
    await client.query("UPDATE app.game_rooms SET status='ended',ended_at=COALESCE(ended_at,now()) WHERE game_id=$1",[id]);
    await client.query("UPDATE app.game_players SET sharing=false,lat=NULL,lng=NULL,accuracy=NULL,observed_at=NULL WHERE room_id IN(SELECT id FROM app.game_rooms WHERE game_id=$1)",[id]);
    return {deleted:true};
  });
}
export async function restoreGame(id:string,session:AppSession,expectedVersion:string){
  return withTransaction(async client=>{
    const row=await ownedGame(client,id,session);
    if(String(row.version)!==expectedVersion)throw new ApiError(409,"VERSION_CONFLICT","게임맵이 변경되었습니다. 새로고침 후 다시 시도해 주세요.");
    if(!row.deleted_at||Date.now()-row.deleted_at.getTime()>=30*86400000)throw new ApiError(409,"RESTORE_EXPIRED","복구 가능한 삭제일로부터 30일이 지났거나 삭제한 게임맵이 아닙니다.");
    const source=await client.query<{status:string}>("SELECT status FROM app.maps WHERE id=$1",[row.source_map_id]);
    if(source.rows[0]?.status==="deleted")throw new ApiError(409,"SOURCE_DELETED","원본 지도를 먼저 복구해 주세요.");
    await client.query("UPDATE app.game_maps SET deleted_at=NULL,status='archived',version=version+1 WHERE id=$1",[id]);
    return {restored:true};
  });
}
function newCode(){return [...randomBytes(8)].map(v=>alphabet[v%alphabet.length]).join("");}
function normalizeCode(value:string){return value.trim().toUpperCase().replace(/[\s-]/g,"");}
function codeHash(value:string){return createHmac("sha256",getServerConfig().invitePepper).update(`game-room:${value}`).digest();}
export async function gameJoinAttempt(headers:Headers){
  const actor=inviteAttemptActor(headers,process.env);if(actor===undefined)throw new ApiError(503,"GAME_JOIN_UNAVAILABLE","게임 입장을 준비하고 있습니다.");
  const h=createHmac("sha256",getServerConfig().invitePepper).update(`game-attempt:${actor}`).digest();
  const rows=await query<{attempts:number}>(`INSERT INTO app_private.invite_attempts(actor_hash,window_start,attempts) VALUES($1,now(),1)
    ON CONFLICT(actor_hash) DO UPDATE SET attempts=CASE WHEN app_private.invite_attempts.window_start<now()-interval '10 minutes' THEN 1 ELSE app_private.invite_attempts.attempts+1 END,
    window_start=CASE WHEN app_private.invite_attempts.window_start<now()-interval '10 minutes' THEN now() ELSE app_private.invite_attempts.window_start END RETURNING attempts`,[h]);
  if(rows[0].attempts>300)throw new ApiError(429,"GAME_JOIN_RATE_LIMIT","입장 시도가 많아요. 잠시 후 다시 시도해 주세요.");
}
export async function createRoom(gameId:string,session:AppSession,input:z.infer<typeof createRoomSchema>){
  return withTransaction(async client=>{
    const {row}=await gameAccess(client,gameId,session,true,true);
    if(row.status!=="active")throw new ApiError(409,"GAME_ARCHIVED","보관된 게임맵에서는 방을 만들 수 없습니다.");
    const old=await client.query<{id:string;game_id:string;title:string;duration_minutes:number;max_players:number}>("SELECT id,game_id,title,duration_minutes,max_players FROM app.game_rooms WHERE host_principal_id=$1 AND request_id=$2",[session.principalId,input.requestId]);
    if(old.rows[0]){const r=old.rows[0];if(r.game_id!==gameId||r.title!==input.title||r.duration_minutes!==input.durationMinutes||r.max_players!==input.maxPlayers)throw new ApiError(409,"RETRY_CONFLICT","새 요청으로 게임방을 만들어 주세요.");return {id:r.id};}
    const all=await missions(client,gameId);if(!all.length)throw new ApiError(422,"MISSION_REQUIRED","미션을 하나 이상 만든 뒤 게임방을 열어 주세요.");
    const code=newCode();const {rows}=await client.query<{id:string}>("INSERT INTO app.game_rooms(game_id,host_principal_id,title,duration_minutes,max_players,join_code,code_hmac,request_id) VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id",[gameId,session.principalId,input.title,input.durationMinutes,input.maxPlayers,code,codeHash(code),input.requestId]);
    const id=rows[0].id;for(const m of all){await client.query("INSERT INTO app.game_room_missions(room_id,definition) VALUES($1,$2)",[id,JSON.stringify(m)]);}
    return {id};
  });
}
async function roomRow(client:PoolClient,id:string,lock=true){
  const {rows}=await client.query<RoomRow>(`SELECT r.*,g.source_map_id,CASE WHEN g.deleted_at IS NOT NULL THEN 'deleted' ELSE g.status END game_status,m.status map_status,clock_timestamp() server_now,
    (hm.status='active' AND (hm.role='admin' OR m.owner_principal_id=r.host_principal_id)) host_allowed
    FROM app.game_rooms r JOIN app.game_maps g ON g.id=r.game_id JOIN app.maps m ON m.id=g.source_map_id
    LEFT JOIN app.map_members hm ON hm.map_id=m.id AND hm.principal_id=r.host_principal_id WHERE r.id=$1 ${lock?"FOR UPDATE OF r":""}`,[id]);
  const r=rows[0];if(!r)throw new ApiError(404,"NOT_FOUND","게임방을 찾을 수 없습니다.");
  if(r.status!=="ended"&&(r.map_status!=="active"||r.game_status!=="active"||!r.host_allowed||(r.status==="running"&&r.ends_at!<=r.server_now)||(r.status==="lobby"&&r.join_expires_at<=r.server_now))){
    await client.query("UPDATE app.game_rooms SET status='ended',ended_at=$2 WHERE id=$1",[id,r.status==="running"?r.ends_at:r.server_now]);
    await client.query("UPDATE app.game_players SET sharing=false,lat=NULL,lng=NULL,accuracy=NULL,observed_at=NULL WHERE room_id=$1",[id]);r.status="ended";
  }
  return r;
}
async function roomAccess(client:PoolClient,id:string,session:AppSession,lock=true){
  const r=await roomRow(client,id,lock);
  if(r.map_status==="deleted")throw new ApiError(404,"NOT_FOUND","게임방을 찾을 수 없습니다.");
  const isHost=session.kind==="account"&&r.host_principal_id===session.principalId&&r.host_allowed;
  const blocked=await client.query<{status:string}>("SELECT status FROM app.map_members WHERE map_id=$1 AND principal_id=$2",[r.source_map_id,session.principalId]);
  if(blocked.rows[0]?.status==="blocked")throw new ApiError(403,"PLAYER_BLOCKED","이 게임방에 참여할 수 없습니다.");
  const player=await client.query<PlayerRow>("SELECT * FROM app.game_players WHERE room_id=$1 AND principal_id=$2",[id,session.principalId]);
  if(!isHost&&!player.rows[0])throw new ApiError(403,"ROOM_MEMBERSHIP_REQUIRED","방 코드로 먼저 참여해 주세요.");
  return {r,isHost,player:player.rows[0]??null};
}
export async function joinRoom(input:z.infer<typeof joinGameSchema>,existing:AppSession|null){
  const code=normalizeCode(input.code);if(!/^[2-9A-HJKMNP-TV-Z]{8}$/.test(code))throw new ApiError(422,"ROOM_CODE_INVALID","방 코드를 확인해 주세요.");
  return withTransaction(async client=>{
    const found=await client.query<{id:string}>("SELECT id FROM app.game_rooms WHERE code_hmac=$1",[codeHash(code)]);
    if(!found.rows[0])throw new ApiError(422,"ROOM_CODE_INVALID","방 코드를 확인해 주세요.");
    const r=await roomRow(client,found.rows[0].id);
    if(r.status==="ended"||r.join_expires_at<=r.server_now||r.map_status!=="active"||r.game_status!=="active")throw new ApiError(409,"ROOM_ENDED","종료된 게임방입니다. 선생님에게 새 방 코드를 요청해 주세요.");
    if(existing?.principalId===r.host_principal_id)throw new ApiError(409,"HOST_NOT_PLAYER","교사 화면이 열려 있습니다. 학생은 다른 기기에서 참여해 주세요.");
    if(existing){const membership=await client.query<{status:string}>("SELECT status FROM app.map_members WHERE map_id=$1 AND principal_id=$2",[r.source_map_id,existing.principalId]);if(membership.rows[0]?.status==="blocked")throw new ApiError(403,"PLAYER_BLOCKED","이 게임방에 참여할 수 없습니다.");
      const previous=await client.query<{id:string}>("SELECT id FROM app.game_players WHERE room_id=$1 AND principal_id=$2",[r.id,existing.principalId]);if(previous.rows[0]){await client.query("UPDATE app.game_players SET sharing=true,location_consent_at=now() WHERE id=$1",[previous.rows[0].id]);return {roomId:r.id,session:null};}}
    const count=await client.query<{n:string}>("SELECT count(*)::text n FROM app.game_players WHERE room_id=$1",[r.id]);if(Number(count.rows[0].n)>=r.max_players)throw new ApiError(409,"ROOM_FULL","게임방 인원이 가득 찼습니다.");
    const duplicate=await client.query("SELECT id FROM app.game_players WHERE room_id=$1 AND lower(nickname)=lower($2)",[r.id,input.nickname]);if(duplicate.rowCount)throw new ApiError(409,"NICKNAME_TAKEN","같은 닉네임이 있어요. 다른 닉네임을 입력해 주세요.");
    let principal=existing?.principalId;if(!principal){const created=await client.query<{id:string}>("INSERT INTO app.principals(kind) VALUES('guest') RETURNING id");principal=created.rows[0].id;}
    await client.query("INSERT INTO app.game_players(room_id,principal_id,nickname) VALUES($1,$2,$3)",[r.id,principal,input.nickname]);
    return {roomId:r.id,session:existing?null:await issueSession(client,principal)};
  });
}
function submission(r:SubmissionRow):GameSubmission{return {id:r.id,playerId:r.player_id,missionId:r.mission_id,status:r.status,attempts:r.attempts,score:r.score,response:r.response,reason:r.reason,version:String(r.version),submittedAt:r.submitted_at.toISOString()};}
export async function getRoom(id:string,session:AppSession){
  return withTransaction(async client=>{
    const {r,isHost,player}=await roomAccess(client,id,session,false);
    const {rows:defs}=await client.query<{id:string;definition:GameMission}>("SELECT id,definition FROM app.game_room_missions WHERE room_id=$1 ORDER BY id",[id]);
    const all=defs.map(m=>({...m.definition,id:m.id}));
    const {rows}=await client.query<PlayerRow>(`SELECT p.*,COALESCE(sum(s.score),0)::text score,count(s.id) FILTER(WHERE s.status='approved')::text completed FROM app.game_players p
      LEFT JOIN app.game_submissions s ON s.player_id=p.id WHERE p.room_id=$1 GROUP BY p.id ORDER BY p.joined_at,p.id`,[id]);
    const players=rankedPlayers(rows.map(p=>({id:p.id,nickname:p.nickname,score:Number(p.score),completed:Number(p.completed),sharing:r.status!=="ended"&&p.sharing,
      ...(isHost||p.id===player?.id?{location:r.status!=="ended"&&p.sharing&&p.observed_at&&r.server_now.getTime()-p.observed_at.getTime()<=90000?{lat:p.lat!,lng:p.lng!,accuracy:p.accuracy!,observedAt:p.observed_at.toISOString()}:null,lastSeenAt:p.last_seen_at?.toISOString()??null}:{})})));
    const submissions=await client.query<SubmissionRow>(`SELECT * FROM app.game_submissions WHERE room_id=$1 AND (($2::boolean AND status='pending') OR player_id=$3) ORDER BY submitted_at,id LIMIT 200`,[id,isHost,player?.id??null]);
    const pending=await client.query<{n:string}>("SELECT count(*)::text n FROM app.game_submissions WHERE room_id=$1 AND status='pending'",[id]);
    return {room:{id:r.id,gameId:r.game_id,title:r.title,status:r.status,durationMinutes:r.duration_minutes,maxPlayers:r.max_players,startsAt:r.starts_at?.toISOString()??null,endsAt:r.ends_at?.toISOString()??null,joinExpiresAt:r.join_expires_at.toISOString(),serverNow:r.server_now.toISOString(),isHost,...(isHost&&r.status!=="ended"?{joinCode:r.join_code.match(/.{4}/g)!.join("-")}:{})},missions:isHost?all:all.map(publicMission),players,me:players.find(p=>p.id===player?.id)??null,submissions:submissions.rows.map(submission),pendingCount:Number(pending.rows[0].n)};
  });
}
export async function updateLocation(id:string,session:AppSession,input:z.infer<typeof locationSchema>){
  return withTransaction(async client=>{
    const {r,player}=await roomAccess(client,id,session);
    if(!player||!player.sharing)throw new ApiError(403,"LOCATION_SHARING_OFF","위치 공유를 켜고 다시 시도해 주세요.");
    if(r.status==="ended")throw new ApiError(409,"ROOM_ENDED","게임이 종료되어 위치 공유를 중지했어요.");
    const stamp=new Date(input.observedAt),age=r.server_now.getTime()-stamp.getTime();
    if(age>45000||age< -10000)throw new ApiError(422,"LOCATION_STALE","기기의 현재 위치를 다시 확인해 주세요.");
    if(player.observed_at&&stamp<player.observed_at)return {shared:true};
    await client.query("UPDATE app.game_players SET lat=$2,lng=$3,accuracy=$4,observed_at=$5,last_seen_at=now() WHERE id=$1",[player.id,input.location.lat,input.location.lng,input.accuracy,stamp]);
    return {shared:true};
  });
}
export async function submitMission(id:string,session:AppSession,input:z.infer<typeof submitMissionSchema>){
  return withTransaction(async client=>{
    const {r,player}=await roomAccess(client,id,session);if(!player)throw new ApiError(403,"PLAYER_REQUIRED","학생만 미션을 제출할 수 있습니다.");
    const payloadHash=createHash("sha256").update(JSON.stringify(input.response)).digest("hex");
    const replay=await client.query<{payload_hash:string;result:GameSubmission}>("SELECT payload_hash,result FROM app.game_attempt_requests WHERE player_id=$1 AND mission_id=$2 AND request_id=$3",[player.id,input.missionId,input.requestId]);
    if(replay.rows[0]){if(replay.rows[0].payload_hash!==payloadHash)throw new ApiError(409,"RETRY_CONFLICT","응답이 바뀌었습니다. 새 요청으로 제출해 주세요.");return replay.rows[0].result;}
    if(r.status!=="running")throw new ApiError(409,r.status==="ended"?"ROOM_ENDED":"GAME_NOT_STARTED",r.status==="ended"?"제한시간이 끝났어요. 새 응답을 제출할 수 없습니다.":"선생님이 게임을 시작하면 제출할 수 있어요.");
    const found=await client.query<{definition:GameMission}>("SELECT definition FROM app.game_room_missions WHERE room_id=$1 AND id=$2",[id,input.missionId]);
    const mission=found.rows[0]?.definition;if(!mission)throw new ApiError(404,"NOT_FOUND","미션을 찾을 수 없습니다.");
    if(!player.sharing)throw new ApiError(403,"LOCATION_SHARING_OFF","위치 공유를 켜 주세요.");
    const arrival=arrivalFailure(player.observed_at?{lat:player.lat!,lng:player.lng!,accuracy:player.accuracy!,observedAt:player.observed_at}:null,mission,r.server_now);
    if(arrival)throw new ApiError(422,"ARRIVAL_REQUIRED",arrival);
    const previous=await client.query<SubmissionRow>("SELECT * FROM app.game_submissions WHERE player_id=$1 AND mission_id=$2 FOR UPDATE",[player.id,input.missionId]);
    const old=previous.rows[0];if(old&&(old.status==="approved"||old.status==="pending"))throw new ApiError(409,"ALREADY_SUBMITTED",old.status==="approved"?"이미 완료한 미션이에요.":"선생님의 검토를 기다리고 있어요.");
    if(old&&old.attempts>=mission.maxAttempts)throw new ApiError(409,"ATTEMPTS_EXHAUSTED","이 미션의 제출 기회를 모두 사용했어요.");
    let status:GameSubmission["status"];try{status=evaluateMission(mission as MissionDefinition,input.response);}catch(e){throw new ApiError(422,"ANSWER_REQUIRED",e instanceof Error?e.message:"응답을 확인해 주세요.");}
    const score=status==="approved"?mission.points:0;
    const {rows}=await client.query<SubmissionRow>(`INSERT INTO app.game_submissions(room_id,player_id,mission_id,status,response,score) VALUES($1,$2,$3,$4,$5,$6)
      ON CONFLICT(player_id,mission_id) DO UPDATE SET status=EXCLUDED.status,response=EXCLUDED.response,score=EXCLUDED.score,attempts=app.game_submissions.attempts+1,reason=NULL,version=app.game_submissions.version+1,submitted_at=now() RETURNING *`,[id,player.id,input.missionId,status,JSON.stringify(input.response),score]);
    const result=submission(rows[0]);await client.query("INSERT INTO app.game_attempt_requests(room_id,player_id,mission_id,request_id,payload_hash,result) VALUES($1,$2,$3,$4,$5,$6)",[id,player.id,input.missionId,input.requestId,payloadHash,JSON.stringify(result)]);
    return result;
  });
}
export async function roomAction(id:string,session:AppSession,input:z.infer<typeof roomActionSchema>){
  return withTransaction(async client=>{
    const {r,isHost,player}=await roomAccess(client,id,session);
    if(input.action==="stop_sharing"||input.action==="resume_sharing"){
      if(!player)throw new ApiError(403,"PLAYER_REQUIRED","학생의 위치 공유 설정입니다.");
      if(input.action==="resume_sharing"&&r.status==="ended")throw new ApiError(409,"ROOM_ENDED","종료된 게임에서는 위치를 공유하지 않습니다.");
      await client.query("UPDATE app.game_players SET sharing=$2,lat=NULL,lng=NULL,accuracy=NULL,observed_at=NULL WHERE id=$1",[player.id,input.action==="resume_sharing"]);return {done:true};
    }
    if(!isHost)throw new ApiError(403,"HOST_REQUIRED","이 게임방을 연 교사만 할 수 있습니다.");
    if(input.action==="start"){
      if(r.status!=="lobby")throw new ApiError(409,"ROOM_STATE_INVALID","대기 중인 게임방만 시작할 수 있어요.");
      const count=await client.query<{n:string}>("SELECT count(*)::text n FROM app.game_players WHERE room_id=$1",[id]);if(!Number(count.rows[0].n))throw new ApiError(422,"PLAYERS_REQUIRED","학생이 한 명 이상 참여한 뒤 시작해 주세요.");
      await client.query("UPDATE app.game_rooms SET status='running',starts_at=now(),ends_at=now()+duration_minutes*interval '1 minute',join_expires_at=now()+duration_minutes*interval '1 minute' WHERE id=$1",[id]);
    }else if(input.action==="end"){
      await client.query("UPDATE app.game_rooms SET status='ended',ended_at=now(),ends_at=CASE WHEN status='running' THEN now() ELSE ends_at END WHERE id=$1",[id]);
      await client.query("UPDATE app.game_players SET sharing=false,lat=NULL,lng=NULL,accuracy=NULL,observed_at=NULL WHERE room_id=$1",[id]);
    }else{
      if(input.decision==="reject"&&input.reason.length<2)throw new ApiError(422,"REASON_REQUIRED","보완할 내용을 적어 주세요.");
      const sub=await client.query<SubmissionRow>("SELECT * FROM app.game_submissions WHERE room_id=$1 AND id=$2 FOR UPDATE",[id,input.submissionId]);
      if(!sub.rows[0]||sub.rows[0].status!=="pending"||String(sub.rows[0].version)!==input.version)throw new ApiError(409,"REVIEW_CONFLICT","이미 검토되었거나 변경된 응답입니다.");
      const mission=await client.query<{definition:GameMission}>("SELECT definition FROM app.game_room_missions WHERE id=$1 AND room_id=$2",[sub.rows[0].mission_id,id]);
      const approved=input.decision==="approve";
      await client.query("UPDATE app.game_submissions SET status=$2,score=$3,reason=$4,version=version+1 WHERE id=$1",[input.submissionId,approved?"approved":"rejected",approved?mission.rows[0].definition.points:0,input.reason||null]);
    }
    return {done:true};
  });
}
