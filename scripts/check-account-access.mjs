// Local HTTP regression using only newly generated fictional accounts and private maps.
import assert from "node:assert/strict";
import {randomUUID,randomBytes,createHash} from "node:crypto";
import nextEnv from "@next/env";
import pg from "pg";
nextEnv.loadEnvConfig(process.cwd());
const origin=process.env.APP_ORIGIN;
if(!/^http:\/\/localhost:\d+$/.test(origin??""))throw new Error("This check requires a local APP_ORIGIN");
const db=new pg.Client({connectionString:process.env.DATABASE_URL});
const actors=[];let mapId,gameId;
await db.connect();
async function actor(kind="account"){
 const id=randomUUID(),session=randomBytes(32).toString("base64url"),csrf=randomBytes(32).toString("base64url"),digest=s=>createHash("sha256").update(s).digest();
 await db.query("INSERT INTO app.principals(id,kind,auth_user_id) VALUES($1,$2,$3)",[id,kind,kind==="account"?randomUUID():null]);
 await db.query("INSERT INTO app_private.sessions(principal_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[id,digest(session),digest(csrf)]);
 const value={id,csrf,cookie:`moa_dev_session=${session}; moa_dev_csrf=${csrf}`};actors.push(value);return value;
}
async function api(path,who,method="GET",body,expected=200){
 const r=await fetch(origin+path,{method,headers:{Cookie:who.cookie,Origin:origin,"X-CSRF-Token":who.csrf,...(body?{"Content-Type":"application/json"}:{}),"Idempotency-Key":randomUUID()},...(body?{body:JSON.stringify(body)}:{})});
 const value=r.status===204?{}:await r.json();assert.equal(r.status,expected,`${method} ${path}: ${value.error?.code}`);return value.data;
}
try{
 const teacher=await actor(),student=await actor(),member=await actor(),unset=await actor(),other=await actor(),guest=await actor("guest");
 await api("/api/v1/account",teacher,"POST",{role:"teacher"});await api("/api/v1/account",other,"POST",{role:"teacher"});
 await api("/api/v1/account",student,"POST",{role:"student"});await api("/api/v1/account",member,"POST",{role:"member"});
 await api("/api/v1/account",student,"POST",{role:"teacher"},409);await api("/api/v1/account",guest,"POST",{role:"teacher"},403);
 assert.equal((await api("/api/v1/session",teacher)).canCreateMap,true);assert.equal((await api("/api/v1/session",student)).canCreateMap,false);
 const input={themeKey:"ecology",themeVersion:2,title:"HTTP 교사 권한 검증 지도",locationLabel:"가상 지역",visibility:"invite_only"};
 for(const who of [student,member,unset,guest])await api("/api/v1/maps",who,"POST",input,403);
 const map=await api("/api/v1/maps",teacher,"POST",input,201);mapId=map.id;
 await db.query("INSERT INTO app.map_members(map_id,principal_id,nickname,role) VALUES($1,$2,'가상 관리자','admin')",[mapId,other.id]);
 gameId=(await api("/api/v1/games",teacher,"POST",{sourceMapId:mapId,title:"HTTP 삭제 검증 게임",description:"가상 권한 검증",requestId:randomUUID()},201)).id;
 let game=await api(`/api/v1/games/${gameId}`,teacher);assert.equal(game.canDelete,true);assert.equal((await api(`/api/v1/games/${gameId}`,other)).canDelete,false);
 for(const who of [student,member,unset])await api("/api/v1/games",who,"POST",{sourceMapId:mapId,title:"거부될 게임맵",description:"",requestId:randomUUID()},403);
 await api(`/api/v1/games/${gameId}`,other,"DELETE",{version:game.version},403);
 await api(`/api/v1/games/${gameId}`,teacher,"DELETE",{version:game.version});game=await api(`/api/v1/games/${gameId}`,teacher);assert.equal(game.status,"deleted");
 await api(`/api/v1/games/${gameId}`,other,"GET",undefined,404);
 assert.ok((await api("/api/v1/games?scope=deleted",teacher)).items.some(g=>g.id===gameId));
 await api(`/api/v1/games/${gameId}/restore`,teacher,"POST",{version:game.version});assert.equal((await api(`/api/v1/games/${gameId}`,teacher)).status,"archived");
 assert.equal((await api(`/api/v1/maps/${mapId}`,teacher)).status,"active");
 const current=await api(`/api/v1/maps/${mapId}`,teacher);
 const headers=who=>({Cookie:who.cookie,Origin:origin,"X-CSRF-Token":who.csrf,"X-Resource-Version":`"${current.version}"`});
 assert.equal((await fetch(`${origin}/api/v1/maps/${mapId}`,{method:"DELETE",headers:headers(other)})).status,403);
 assert.equal((await fetch(`${origin}/api/v1/maps/${mapId}`,{method:"DELETE",headers:headers(teacher)})).status,204);
 console.log("PASS: signup roles, immutable role, teacher-only normal/game creation, creator-only deletion, recovery and original map preservation through real HTTP.");
}finally{
 // Only this run's generated private fixture is soft deleted; no user map is touched.
 if(mapId)await db.query("UPDATE app.maps SET status='deleted',deleted_at=COALESCE(deleted_at,now()),deleted_by=owner_principal_id WHERE id=$1 AND owner_principal_id=$2",[mapId,actors[0].id]);
 await db.query("UPDATE app_private.sessions SET revoked_at=now() WHERE principal_id=ANY($1::uuid[])",[actors.map(a=>a.id)]);
 await db.query("UPDATE app.principals SET status='deleted' WHERE id=ANY($1::uuid[])",[actors.map(a=>a.id)]);
 await db.end();
}
