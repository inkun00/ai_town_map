import {describe,it,expect,beforeAll,afterAll,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import type {AppSession} from "../src/server/auth/session";
import {arrivalFailure,evaluateMission,rankedPlayers,missionSchema,missionArrivalMode,joinGameSchema,submitMissionSchema,type GameDefinition,type MissionKind,type MissionArrivalMode} from "../src/domain/exploration-game";
let db:PGlite;let queue:Promise<unknown>=Promise.resolve();
// Match pg's bytea Buffer and int8 string decoding when using PGlite.
const execute=async(sql:string,values:unknown[]=[])=>{const r=await db.query(sql,values);return {...r,rows:r.rows.map(row=>Object.fromEntries(Object.entries(row as Record<string,unknown>).map(([key,value])=>[key,value instanceof Uint8Array?Buffer.from(value):key==="version"?String(value):value]))),rowCount:r.rows.length||r.affectedRows||0};};
vi.mock("../src/server/db",()=>({query:async(sql:string,values:unknown[]=[])=> (await execute(sql,values)).rows,withTransaction:(action:(client:unknown)=>unknown)=>{const next=queue.then(async()=>{await db.exec("BEGIN");try{const result=await action({query:execute});await db.exec("COMMIT");return result;}catch(e){await db.exec("ROLLBACK");throw e;}});queue=next.catch(()=>{});return next;}}));
vi.mock("../src/server/env",()=>({getServerConfig:()=>({invitePepper:"test-game-pepper-only",appOrigin:"http://localhost:3001"})}));
vi.mock("../src/server/auth/session",()=>({issueSession:async()=>({sessionToken:"test-only",csrfToken:"test-only",expiresAt:new Date(Date.now()+86400000)})}));
import {createGame,getGame,changeGame,createRoom,joinRoom,getRoom,roomAction,updateLocation,submitMission,listGames,deleteGame,restoreGame,getGameCheckpoints,getRoomCheckpoints,scanCheckpoint} from "../src/server/services/exploration-games";
import {createCheckpointProof,validCheckpointProof,readCheckpointCode} from "../src/server/services/game-checkpoints";
import {registerAccount} from "../src/server/services/accounts";
import {registrationSchema} from "../src/domain/account";
import {createMap,createMapSchema} from "../src/server/services/maps";
import {deleteMap,restoreMap} from "../src/server/services/operations";
const session=(id:string,kind:AppSession["kind"]="account"):AppSession=>({id:randomUUID(),principalId:id,kind,csrfHash:Buffer.alloc(32),expiresAt:new Date(Date.now()+86400000)});
beforeAll(async()=>{db=new PGlite();await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");for(const name of ["001_core.sql","002_observations.sql","003_community_moderation.sql","004_analysis_proposals.sql","005_retention.sql","006_exploration_games.sql", "007_account_roles_game_deletion.sql","008_map_participation_passwords.sql","009_student_identifiers.sql"])await db.exec(await readFile(`db/migrations/${name}`,"utf8"));},30000);
afterAll(async()=>{await db.close();});
describe("registration, teacher-only creation and owner deletion",()=>{
 it("registers an account once, rejects guest roles and ignores forged session roles",async()=>{
  const id=randomUUID();await execute("INSERT INTO app.principals(id,kind,auth_user_id) VALUES($1,'account',$2)",[id,randomUUID()]);const student=session(id);
  expect(await registerAccount(student,"student")).toMatchObject({accountRole:"student",canCreateMap:false});
  expect(await registerAccount(student,"student")).toMatchObject({accountRole:"student"});
  await expect(registerAccount(student,"teacher")).rejects.toMatchObject({code:"ROLE_ALREADY_SET"});
  const guest=randomUUID();await execute("INSERT INTO app.principals(id,kind) VALUES($1,'guest')",[guest]);await expect(registerAccount(session(guest,"guest"),"teacher")).rejects.toMatchObject({code:"ACCOUNT_REQUIRED"});
  expect(registrationSchema.safeParse({role:"admin"}).success).toBe(false);
  const input=createMapSchema.parse({themeKey:"ecology",themeVersion:2,title:"권한 확인 지도",locationLabel:"가상 지역",visibility:"invite_only"});
  await expect(createMap(input,{...student,accountRole:"teacher"},randomUUID())).rejects.toMatchObject({code:"TEACHER_REQUIRED"});
 });
 it("allows teacher map creation and blocks member and unset accounts for both map types",async()=>{
  const preset=JSON.parse(await readFile("docs/contracts/theme-presets.json","utf8")).templates.find((t:{key:string})=>t.key==="ecology");
  await execute("INSERT INTO app.theme_templates(theme_key,version,definition) VALUES('ecology',2,$1)",[JSON.stringify(preset)]);
  const id=randomUUID();await execute("INSERT INTO app.principals(id,kind,auth_user_id) VALUES($1,'account',$2)",[id,randomUUID()]);const teacher=session(id);
  const input=createMapSchema.parse({themeKey:"ecology",themeVersion:2,title:"교사 생성 지도",locationLabel:"가상 지역",visibility:"invite_only"});
  await expect(createMap(input,teacher,randomUUID())).rejects.toMatchObject({code:"TEACHER_REQUIRED"});
  await registerAccount(teacher,"teacher");const created=await createMap(input,teacher,randomUUID());expect(created.map.isOwner).toBe(true);
  const f=await fixture();for(const role of ["student","member",null]){
   await execute("UPDATE app.principals SET account_role=$2 WHERE id=$1",[f.teacher.principalId,role]);
   await expect(createMap(input,f.teacher,randomUUID())).rejects.toMatchObject({code:"TEACHER_REQUIRED"});
   await expect(createGame(f.teacher,{...f.input,requestId:randomUUID()})).rejects.toMatchObject({code:"TEACHER_REQUIRED"});
   expect((await getGame(f.game.id,f.teacher)).canManage).toBe(false);
  }
 });
 it("lets the game creator delete, ends rooms and hides deleted games from other administrators",async()=>{
  const f=await fixture();await mission(f);const r=await opened(f),p=await player(r.id,f.teacher);await roomAction(r.id,f.teacher,{action:"start"});await locate(r.id,p);
  const otherId=randomUUID();await execute("INSERT INTO app.principals(id,kind,auth_user_id,account_role) VALUES($1,'account',$2,'teacher')",[otherId,randomUUID()]);await execute("INSERT INTO app.map_members(map_id,principal_id,nickname,role) VALUES($1,$2,'다른 교사','admin')",[f.map,otherId]);const other=session(otherId);
  const current=await getGame(f.game.id,f.teacher);expect((await getGame(current.id,other)).canDelete).toBe(false);
  await expect(deleteGame(current.id,other,current.version)).rejects.toMatchObject({code:"OWNER_REQUIRED"});
  await expect(deleteGame(current.id,f.teacher,"999")).rejects.toMatchObject({code:"VERSION_CONFLICT"});
  await deleteGame(current.id,f.teacher,current.version);expect((await getRoom(r.id,f.teacher)).players[0]).toMatchObject({sharing:false,location:null});expect((await getRoom(r.id,p)).room.status).toBe("ended");
  expect((await getGame(current.id,f.teacher)).status).toBe("deleted");await expect(getGame(current.id,other)).rejects.toMatchObject({status:404});
  expect((await listGames(f.teacher)).items.some(g=>g.id===current.id)).toBe(false);expect((await listGames(f.teacher,"","deleted")).items.some(g=>g.id===current.id)).toBe(true);expect((await listGames(other,"","deleted")).items.some(g=>g.id===current.id)).toBe(false);
 });
 it("restores a deleted game archived without restarting rooms, and expires restoration",async()=>{
  const f=await fixture();await mission(f);const r=await opened(f);let g=await getGame(f.game.id,f.teacher);await deleteGame(g.id,f.teacher,g.version);g=await getGame(g.id,f.teacher);
  await restoreGame(g.id,f.teacher,g.version);expect((await getGame(g.id,f.teacher)).status).toBe("archived");expect((await getRoom(r.id,f.teacher)).room.status).toBe("ended");
  g=await getGame(g.id,f.teacher);await deleteGame(g.id,f.teacher,g.version);await execute("UPDATE app.game_maps SET deleted_at=now()-interval '31 days' WHERE id=$1",[g.id]);g=await getGame(g.id,f.teacher);await expect(restoreGame(g.id,f.teacher,g.version)).rejects.toMatchObject({code:"RESTORE_EXPIRED"});
  await execute("SELECT app_private.purge_expired_content()");expect((await execute("SELECT id FROM app.game_rooms WHERE id=$1",[r.id])).rows).toHaveLength(0);expect((await execute("SELECT id FROM app.maps WHERE id=$1",[f.map])).rows).toHaveLength(1);
 });
 it("keeps legacy owners able to delete normal maps and denies even delegated admins",async()=>{
  const f=await fixture();await mission(f);const r=await opened(f),p=await player(r.id,f.teacher);await locate(r.id,p);await execute("UPDATE app.principals SET account_role=NULL WHERE id=$1",[f.teacher.principalId]);
  const otherId=randomUUID();await execute("INSERT INTO app.principals(id,kind,auth_user_id,account_role) VALUES($1,'account',$2,'teacher')",[otherId,randomUUID()]);await execute("INSERT INTO app.map_members(map_id,principal_id,nickname,role) VALUES($1,$2,'관리자','admin')",[f.map,otherId]);
  let map=(await execute("SELECT version FROM app.maps WHERE id=$1",[f.map])).rows[0] as {version:string};await expect(deleteMap(f.map,session(otherId),String(map.version))).rejects.toMatchObject({code:"OWNER_REQUIRED"});
  await deleteMap(f.map,f.teacher,String(map.version));await expect(getRoom(r.id,p)).rejects.toMatchObject({status:404});expect((await execute("SELECT status FROM app.game_rooms WHERE id=$1",[r.id])).rows[0]).toMatchObject({status:"ended"});expect((await execute("SELECT lat,lng FROM app.game_players WHERE room_id=$1",[r.id])).rows[0]).toMatchObject({lat:null,lng:null});
  map=(await execute("SELECT version FROM app.maps WHERE id=$1",[f.map])).rows[0] as {version:string};expect(await restoreMap(f.map,f.teacher,String(map.version))).toMatchObject({status:"archived"});
 });
});
async function fixture(){
 const owner=randomUUID(),map=randomUUID(),template=randomUUID(),member=randomUUID(),category=randomUUID(),emoji=randomUUID();
 await execute("INSERT INTO app.principals(id,kind,auth_user_id,account_role) VALUES($1,'account',$2,'teacher')",[owner,randomUUID()]);
 await execute("INSERT INTO app.theme_templates(id,theme_key,version,definition) VALUES($1,$2,1,'{}')",[template,randomUUID()]);
 await execute(`INSERT INTO app.maps(id,owner_principal_id,template_id,theme_key,title,location_label,activity_context,visibility,pin_mode,single_color,rating_enabled,ideas_enabled,proposals_enabled,comments_enabled) VALUES($1,$2,$3,'custom','게임 시험 지도','가상 지역','school','invite_only','single','#267253',false,false,false,true)`,[map,owner,template]);
 await execute("INSERT INTO app.map_members(id,map_id,principal_id,nickname,role) VALUES($1,$2,$3,'교사','admin')",[member,map,owner]);
 await execute("INSERT INTO app.categories(id,map_id,key,label,sort_order) VALUES($1,$2,'test','예시',0)",[category,map]);
 await execute("INSERT INTO app.emoji_options(id,map_id,category_id,key,glyph,label,sort_order) VALUES($1,$2,$3,'tree','🌳','나무',0)",[emoji,map,category]);
 for(const status of ["published","hidden"])await execute("INSERT INTO app.observations(map_id,author_member_id,title,body,location_label,location_source,lat,lng,category_id,emoji_option_id,status,config_revision) VALUES($1,$2,$3,'가상 관찰을 위한 예시 기록입니다.','가상 지점','manual',37.5,127,$4,$5,$6,1)",[map,member,status==="published"?"나무 포인트":"숨긴 포인트",category,emoji,status]);
 const teacher=session(owner);const input={sourceMapId:map,title:"가상 탐험게임",description:"",requestId:randomUUID()};const g=await createGame(teacher,input);const game=await getGame(g.id,teacher);return {teacher,map,input,game};
}
async function mission(f:Awaited<ReturnType<typeof fixture>>,kind:MissionKind="quiz",points=100,arrivalMode?:MissionArrivalMode){
 const current=await getGame(f.game.id,f.teacher);await changeGame(current.id,f.teacher,{action:"mission",version:current.version,mission:{pointId:current.points[0].id,title:"현장 미션",prompt:"현장에서 발견한 내용을 답해 주세요.",kind,...(arrivalMode?{arrivalMode}:{}),points,radiusMeters:50,maxAttempts:2,options:kind==="quiz"?["첫 번째","두 번째"]:[],correctAnswers:kind==="quiz"?["1"]:kind==="short_answer"?["은행나무"]:[],checklist:kind==="checklist"?["주변 관찰","안내 확인"]:[]}});
}
async function opened(f:Awaited<ReturnType<typeof fixture>>){return createRoom(f.game.id,f.teacher,{title:"시험 방",durationMinutes:30,maxPlayers:2,requestId:randomUUID()});}
async function player(room:string,teacher:AppSession,nickname="학생 하늘"){
 const state=await getRoom(room,teacher);await joinRoom({code:state.room.joinCode!,nickname,locationConsent:true},null);
 const row=(await execute("SELECT principal_id FROM app.game_players WHERE room_id=$1 AND nickname=$2",[room,nickname])).rows[0] as {principal_id:string};return session(row.principal_id,"guest");
}
async function locate(room:string,p:AppSession,lat=37.5,accuracy=5){await updateLocation(room,p,{location:{lat,lng:127},accuracy,observedAt:new Date().toISOString()});}
describe("exploration missions and arrival",()=>{
 const definition=missionSchema.parse({pointId:randomUUID(),title:"장소 퀴즈",prompt:"어떤 나무인가요?",kind:"quiz",options:["참나무","은행나무"],correctAnswers:["1"]});
 it("validates quiz answers and never awards observation/checklist automatically",()=>{
  expect(evaluateMission(definition,{choice:1})).toBe("approved");expect(evaluateMission(definition,{choice:0})).toBe("incorrect");
  expect(evaluateMission({...definition,kind:"short_answer",correctAnswers:["은행 나무"]},{answer:"은행나무"})).toBe("approved");
  expect(evaluateMission({...definition,kind:"observation"},{answer:"잎의 모양을 보았어요"})).toBe("pending");
  expect(evaluateMission({...definition,kind:"checklist",checklist:["잎","줄기"]},{checks:[0,1]})).toBe("pending");
  expect(()=>evaluateMission({...definition,kind:"checklist",checklist:["잎","줄기"]},{checks:[0,0]})).toThrow();
  expect(joinGameSchema.safeParse({code:"ABCD2345",nickname:"학생",locationConsent:false}).success).toBe(false);
 });
 it("rejects distant, stale, future and inaccurate fixes",()=>{
  const now=new Date(),m={location:{lat:37.5,lng:127},radiusMeters:50},p={lat:37.5,lng:127,accuracy:5,observedAt:now};
  expect(arrivalFailure(p,m,now)).toBeNull();expect(arrivalFailure({...p,lat:37.51},m,now)).toMatch(/반경/);
  expect(arrivalFailure({...p,accuracy:100},m,now)).toMatch(/오차/);expect(arrivalFailure({...p,observedAt:new Date(now.getTime()-46000)},m,now)).toMatch(/최근/);
  expect(arrivalFailure({...p,observedAt:new Date(now.getTime()+11000)},m,now)).toMatch(/최근/);
 });
 it("announces shared ranks without rewarding speed",()=>{expect(rankedPlayers([{id:"b",nickname:"나",score:100},{id:"a",nickname:"가",score:100},{id:"c",nickname:"다",score:50}]).map(p=>p.rank)).toEqual([1,1,3]);});
 it("preserves legacy GPS missions and validates bounded QR arrival proofs",()=>{
  expect(missionArrivalMode(definition)).toBe("gps");expect(missionArrivalMode({...definition,arrivalMode:"qr"})).toBe("qr");expect(missionArrivalMode({...definition,kind:"qr",arrivalMode:"gps"})).toBe("qr");
  expect(evaluateMission({...definition,kind:"qr"},{})).toBe("approved");
  expect(missionSchema.safeParse({...definition,arrivalMode:"manual"}).success).toBe(false);
  expect(submitMissionSchema.safeParse({missionId:randomUUID(),requestId:randomUUID(),response:{checkpointProof:"a".repeat(1025)}}).success).toBe(false);
 });
});
describe("QR treasure checkpoints",()=>{
 it("issues stable codes only to teacher managers and excludes GPS-only points",async()=>{
  const f=await fixture();expect((await getGameCheckpoints(f.game.id,f.teacher)).items).toHaveLength(0);await mission(f,"qr");
  const first=await getGameCheckpoints(f.game.id,f.teacher);expect(first.items).toHaveLength(1);expect(await getGameCheckpoints(f.game.id,f.teacher)).toEqual(first);
  expect(readCheckpointCode(first.items[0].code)).toEqual({gameId:f.game.id,pointId:f.game.points[0].id});
  await expect(getGameCheckpoints(f.game.id,session(randomUUID(),"guest"))).rejects.toMatchObject({code:"TEACHER_REQUIRED"});
  const strangerId=randomUUID();await execute("INSERT INTO app.principals(id,kind,auth_user_id,account_role) VALUES($1,'account',$2,'teacher')",[strangerId,randomUUID()]);
  await expect(getGameCheckpoints(f.game.id,session(strangerId))).rejects.toMatchObject({code:"ADMIN_REQUIRED"});
  expect(await getGame(f.game.id,null)).not.toHaveProperty("checkpoints");
 });
 it("scans and completes without GPS, clears secret proof from results, and awards once",async()=>{
  const f=await fixture();await mission(f,"qr",75);const code=(await getGameCheckpoints(f.game.id,f.teacher)).items[0].code;const r=await opened(f),p=await player(r.id,f.teacher);
  await expect(scanCheckpoint(r.id,p,{code})).rejects.toMatchObject({code:"GAME_NOT_STARTED"});await roomAction(r.id,f.teacher,{action:"start"});await roomAction(r.id,p,{action:"stop_sharing"});
  const scanned=await scanCheckpoint(r.id,p,{code}),state=await getRoom(r.id,p);expect(scanned.missionIds).toEqual([state.missions[0].id]);expect(scanned.pointId).toBe(f.game.points[0].id);
  await expect(submitMission(r.id,p,{missionId:scanned.missionIds[0],requestId:randomUUID(),response:{}})).rejects.toMatchObject({code:"CHECKPOINT_REQUIRED"});
  const request={missionId:scanned.missionIds[0],requestId:randomUUID(),response:{checkpointProof:scanned.proof}},result=await submitMission(r.id,p,request);expect(result).toMatchObject({status:"approved",score:75,response:{}});
  expect(await submitMission(r.id,p,request)).toEqual(result);expect((await getRoom(r.id,p)).me).toMatchObject({score:75,completed:1,sharing:false});
  expect((await execute("SELECT response FROM app.game_submissions WHERE id=$1",[result.id])).rows[0]).toEqual({response:{}});
  expect((await getRoom(r.id,p)).submissions[0].response).not.toHaveProperty("checkpointProof");
  await expect(submitMission(r.id,p,{...request,requestId:randomUUID()})).rejects.toMatchObject({code:"ALREADY_SUBMITTED"});
 });
 it("rejects forged codes, cross-game codes, outsiders, hosts and other-player proofs",async()=>{
  const f=await fixture();await mission(f,"qr");const code=(await getGameCheckpoints(f.game.id,f.teacher)).items[0].code;const r=await opened(f),p=await player(r.id,f.teacher),p2=await player(r.id,f.teacher,"학생 달");await roomAction(r.id,f.teacher,{action:"start"});
  await expect(scanCheckpoint(r.id,session(randomUUID(),"guest"),{code})).rejects.toMatchObject({code:"ROOM_MEMBERSHIP_REQUIRED"});await expect(scanCheckpoint(r.id,f.teacher,{code})).rejects.toMatchObject({code:"PLAYER_REQUIRED"});
  await expect(scanCheckpoint(r.id,p,{code:`${code.slice(0,-3)}AAA`})).rejects.toMatchObject({code:"CHECKPOINT_INVALID"});
  const other=await fixture();await mission(other,"qr");const otherCode=(await getGameCheckpoints(other.game.id,other.teacher)).items[0].code;await expect(scanCheckpoint(r.id,p,{code:otherCode})).rejects.toMatchObject({code:"CHECKPOINT_INVALID"});
  const scanned=await scanCheckpoint(r.id,p,{code});await expect(submitMission(r.id,p2,{missionId:scanned.missionIds[0],requestId:randomUUID(),response:{checkpointProof:scanned.proof}})).rejects.toMatchObject({code:"CHECKPOINT_REQUIRED"});
  await expect(submitMission(r.id,p,{missionId:scanned.missionIds[0],requestId:randomUUID(),response:{checkpointProof:`${scanned.proof.slice(0,-3)}AAA`}})).rejects.toMatchObject({code:"CHECKPOINT_REQUIRED"});
 });
 it("binds proof to the room, point and expiry, and GPS missions still need a location",async()=>{
  const f=await fixture();await mission(f,"qr");await mission(f,"quiz");const code=(await getGameCheckpoints(f.game.id,f.teacher)).items[0].code;const r=await opened(f),p=await player(r.id,f.teacher);await roomAction(r.id,f.teacher,{action:"start"});
  const scanned=await scanCheckpoint(r.id,p,{code}),state=await getRoom(r.id,p),qr=state.missions.find(m=>m.kind==="qr")!,gps=state.missions.find(m=>m.kind==="quiz")!;
  expect(scanned.missionIds).toEqual([qr.id]);await expect(submitMission(r.id,p,{missionId:gps.id,requestId:randomUUID(),response:{choice:1,checkpointProof:scanned.proof}})).rejects.toMatchObject({code:"ARRIVAL_REQUIRED"});
  const scope={gameId:f.game.id,roomId:r.id,playerId:state.me!.id,pointId:qr.pointId,expiresAt:new Date(state.room.endsAt!).getTime()};
  expect(validCheckpointProof(scanned.proof,scope,new Date())).toBe(true);expect(validCheckpointProof(scanned.proof,{...scope,roomId:randomUUID()},new Date())).toBe(false);expect(validCheckpointProof(scanned.proof,{...scope,pointId:randomUUID()},new Date())).toBe(false);expect(validCheckpointProof(scanned.proof,scope,new Date(scope.expiresAt))).toBe(false);
  await expect(submitMission(r.id,p,{missionId:qr.id,requestId:randomUUID(),response:{checkpointProof:createCheckpointProof({...scope,pointId:randomUUID()})}})).rejects.toMatchObject({code:"CHECKPOINT_REQUIRED"});
  const r2=await opened(f);await player(r2.id,f.teacher);await joinRoom({code:(await getRoom(r2.id,f.teacher)).room.joinCode!,nickname:"학생 하늘 둘",locationConsent:true},p);await roomAction(r2.id,f.teacher,{action:"start"});const qr2=(await getRoom(r2.id,p)).missions.find(m=>m.kind==="qr")!;
  await expect(submitMission(r2.id,p,{missionId:qr2.id,requestId:randomUUID(),response:{checkpointProof:scanned.proof}})).rejects.toMatchObject({code:"CHECKPOINT_REQUIRED"});
  await execute("UPDATE app.game_rooms SET ends_at=now()-interval '1 second' WHERE id=$1",[r.id]);await expect(scanCheckpoint(r.id,p,{code})).rejects.toMatchObject({code:"ROOM_ENDED"});await expect(submitMission(r.id,p,{missionId:qr.id,requestId:randomUUID(),response:{checkpointProof:scanned.proof}})).rejects.toMatchObject({code:"ROOM_ENDED"});
 });
 it("keeps QR observation and checklist scoring under teacher approval and respects frozen missions",async()=>{
  const f=await fixture();await mission(f,"observation",125,"qr");await mission(f,"checklist",60,"qr");const code=(await getGameCheckpoints(f.game.id,f.teacher)).items[0].code;const r=await opened(f),p=await player(r.id,f.teacher);await roomAction(r.id,f.teacher,{action:"start"});
  let g=await getGame(f.game.id,f.teacher);for(const m of g.missions){const {id,location,emoji,pointTitle,...definition}=m;void location;void emoji;void pointTitle;await changeGame(g.id,f.teacher,{action:"mission",version:g.version,id,mission:{...definition,arrivalMode:"gps",correctAnswers:[]}});g=await getGame(g.id,f.teacher);}
  expect((await getGameCheckpoints(g.id,f.teacher)).items).toHaveLength(0);expect((await getRoomCheckpoints(r.id,f.teacher)).items[0].code).toBe(code);await expect(getRoomCheckpoints(r.id,p)).rejects.toMatchObject({code:"HOST_REQUIRED"});const scanned=await scanCheckpoint(r.id,p,{code});expect(scanned.missionIds).toHaveLength(2);
  const state=await getRoom(r.id,p),observation=state.missions.find(m=>m.kind==="observation")!,checklist=state.missions.find(m=>m.kind==="checklist")!;
  const pending=await submitMission(r.id,p,{missionId:observation.id,requestId:randomUUID(),response:{answer:"QR 장소에서 잎을 관찰했어요.",checkpointProof:scanned.proof}});expect(pending).toMatchObject({status:"pending",score:0,response:{answer:"QR 장소에서 잎을 관찰했어요."}});
  const checks=await submitMission(r.id,p,{missionId:checklist.id,requestId:randomUUID(),response:{checks:[0,1],checkpointProof:scanned.proof}});expect(checks).toMatchObject({status:"pending",score:0});expect((await getRoom(r.id,p)).me!.score).toBe(0);
  await roomAction(r.id,f.teacher,{action:"review",submissionId:pending.id,version:pending.version,decision:"approve",reason:"현장 관찰 확인"});expect((await getRoom(r.id,p)).me!.score).toBe(125);
 });
 it("does not accept a QR checkpoint newly enabled after the room was created",async()=>{
  const f=await fixture();await mission(f);const r=await opened(f),p=await player(r.id,f.teacher);await roomAction(r.id,f.teacher,{action:"start"});await mission(f,"qr");const code=(await getGameCheckpoints(f.game.id,f.teacher)).items[0].code;
  await expect(scanCheckpoint(r.id,p,{code})).rejects.toMatchObject({code:"CHECKPOINT_INVALID"});
 });
});
describe("game database, access and score integrity",()=>{
 it("copies only published points, preserves source and makes retries idempotent",async()=>{
  const f=await fixture();expect(f.game.points).toHaveLength(1);expect((await createGame(f.teacher,f.input)).id).toBe(f.game.id);
  expect((await execute("SELECT id FROM app.observations WHERE map_id=$1",[f.map])).rows).toHaveLength(2);
  const outsider=session(randomUUID());expect(await getGame(f.game.id,outsider)).toMatchObject({canManage:false,canDelete:false,pointCount:1});expect((await listGames(null)).items.some(game=>game.id===f.game.id)).toBe(true);
  await expect(changeGame(f.game.id,f.teacher,{action:"point",version:"999",point:{title:"새 지점",emoji:"🌳",location:{lat:37.5,lng:127}}})).rejects.toMatchObject({code:"VERSION_CONFLICT"});
 });
 it("freezes missions per room and hides answer keys and other students' locations",async()=>{
  const f=await fixture();await mission(f);const r=await opened(f);const p=await player(r.id,f.teacher),p2=await player(r.id,f.teacher,"학생 별");await locate(r.id,p);await locate(r.id,p2);
  const teacher=await getRoom(r.id,f.teacher),student=await getRoom(r.id,p);expect(teacher.players.filter(p=>p.location)).toHaveLength(2);expect(student.players.find(x=>x.id!==student.me!.id)).not.toHaveProperty("location");expect(student.missions[0]).not.toHaveProperty("correctAnswers");expect(student.room).not.toHaveProperty("joinCode");
  const g=await getGame(f.game.id,f.teacher);const m=g.missions[0];await changeGame(g.id,f.teacher,{action:"mission",version:g.version,id:m.id,mission:{...m,points:999,correctAnswers:["0"]}});
  expect((await getRoom(r.id,p)).missions[0].points).toBe(100);
  await expect(getRoom(r.id,session(randomUUID(),"guest"))).rejects.toMatchObject({code:"ROOM_MEMBERSHIP_REQUIRED"});
  await expect(joinRoom({code:teacher.room.joinCode!,nickname:"학생 셋",locationConsent:true},null)).rejects.toMatchObject({code:"ROOM_FULL"});
 });
 it("enforces start, radius and attempts, and replay cannot award points twice",async()=>{
  const f=await fixture();await mission(f);const r=await opened(f),p=await player(r.id,f.teacher);const m=(await getRoom(r.id,p)).missions[0];const first={missionId:m.id,requestId:randomUUID(),response:{choice:0}};
  await expect(submitMission(r.id,p,first)).rejects.toMatchObject({code:"GAME_NOT_STARTED"});await roomAction(r.id,f.teacher,{action:"start"});await locate(r.id,p,37.51);
  await expect(submitMission(r.id,p,first)).rejects.toMatchObject({code:"ARRIVAL_REQUIRED"});await locate(r.id,p);
  const wrong=await submitMission(r.id,p,first);expect(wrong).toMatchObject({status:"incorrect",score:0,attempts:1});expect(await submitMission(r.id,p,first)).toEqual(wrong);
  const correct={missionId:m.id,requestId:randomUUID(),response:{choice:1}};await submitMission(r.id,p,correct);await submitMission(r.id,p,correct);
  expect((await getRoom(r.id,p)).me).toMatchObject({score:100,completed:1});await expect(submitMission(r.id,p,{...correct,requestId:randomUUID()})).rejects.toMatchObject({code:"ALREADY_SUBMITTED"});
  await expect(roomAction(r.id,p,{action:"end"})).rejects.toMatchObject({code:"HOST_REQUIRED"});
 });
 it("limits attempts and preserves idempotency even after another attempt",async()=>{
  const f=await fixture();await mission(f);const r=await opened(f),p=await player(r.id,f.teacher);await roomAction(r.id,f.teacher,{action:"start"});await locate(r.id,p);const m=(await getRoom(r.id,p)).missions[0];
  const a={missionId:m.id,requestId:randomUUID(),response:{choice:0}};const old=await submitMission(r.id,p,a);await submitMission(r.id,p,{...a,requestId:randomUUID()});expect(await submitMission(r.id,p,a)).toEqual(old);
  await expect(submitMission(r.id,p,{...a,requestId:randomUUID(),response:{choice:1}})).rejects.toMatchObject({code:"ATTEMPTS_EXHAUSTED"});
 });
 it("reviews timely observations after timeout, rejects late submissions and clears coordinates",async()=>{
  const f=await fixture();await mission(f,"observation",150);const r=await opened(f),p=await player(r.id,f.teacher);await roomAction(r.id,f.teacher,{action:"start"});await locate(r.id,p);const m=(await getRoom(r.id,p)).missions[0];
  const pending=await submitMission(r.id,p,{missionId:m.id,requestId:randomUUID(),response:{answer:"현장에서 나무의 특징을 발견했습니다."}});expect(pending.status).toBe("pending");expect((await getRoom(r.id,p)).me!.score).toBe(0);
  await execute("UPDATE app.game_rooms SET ends_at=now()-interval '1 second' WHERE id=$1",[r.id]);const ended=await getRoom(r.id,f.teacher);expect(ended.room.status).toBe("ended");expect(ended.players[0].location).toBeNull();
  await expect(submitMission(r.id,p,{missionId:m.id,requestId:randomUUID(),response:{answer:"늦은 응답"}})).rejects.toMatchObject({code:"ROOM_ENDED"});
  await expect(roomAction(r.id,p,{action:"review",submissionId:pending.id,version:pending.version,decision:"approve",reason:""})).rejects.toMatchObject({code:"HOST_REQUIRED"});
  await roomAction(r.id,f.teacher,{action:"review",submissionId:pending.id,version:pending.version,decision:"approve",reason:"확인 완료"});expect((await getRoom(r.id,p)).me).toMatchObject({score:150,completed:1});
  await expect(roomAction(r.id,f.teacher,{action:"review",submissionId:pending.id,version:pending.version,decision:"approve",reason:""})).rejects.toMatchObject({code:"REVIEW_CONFLICT"});
 });
 it("stops sharing on request and scheduled expiry removes stale coordinates",async()=>{
  const f=await fixture();await mission(f);const r=await opened(f),p=await player(r.id,f.teacher);await locate(r.id,p);await roomAction(r.id,p,{action:"stop_sharing"});expect((await getRoom(r.id,f.teacher)).players[0]).toMatchObject({sharing:false,location:null});await expect(locate(r.id,p)).rejects.toMatchObject({code:"LOCATION_SHARING_OFF"});
  await roomAction(r.id,p,{action:"resume_sharing"});await locate(r.id,p);await execute("UPDATE app.game_players SET observed_at=now()-interval '2 minutes' WHERE room_id=$1",[r.id]);await execute("SELECT app_private.expire_game_rooms()");expect((await getRoom(r.id,f.teacher)).players[0].location).toBeNull();
  const grants=(await execute("SELECT has_table_privilege('anon','app.game_players','SELECT') a,has_function_privilege('app_backend','app_private.expire_game_rooms()','EXECUTE') b")).rows[0];expect(grants).toEqual({a:false,b:false});
 });
 it("map archival ends rooms and 30-day source purge cascades game data",async()=>{
  const f=await fixture();await mission(f);const r=await opened(f),p=await player(r.id,f.teacher);await locate(r.id,p);await execute("UPDATE app.maps SET status='archived' WHERE id=$1",[f.map]);expect((await getRoom(r.id,f.teacher)).room.status).toBe("ended");
  await execute("UPDATE app.maps SET status='deleted',deleted_at=now()-interval '31 days' WHERE id=$1",[f.map]);await execute("SELECT app_private.purge_expired_content()");expect((await execute("SELECT id FROM app.game_maps WHERE id=$1",[f.game.id])).rows).toHaveLength(0);expect((await execute("SELECT id FROM app.game_players WHERE room_id=$1",[r.id])).rows).toHaveLength(0);
 });
});
