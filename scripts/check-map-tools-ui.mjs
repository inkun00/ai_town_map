// Temporary, public synthetic points for real Kakao/browser UI verification.
// Run with RUN_MAP_TOOLS_UI=1 and LIVE_APP_ORIGIN=http://localhost:3001.
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {loadEnvFile} from "node:process";
import {readFileSync,writeFileSync,unlinkSync,existsSync} from "node:fs";
import {join} from "node:path";
import {tmpdir} from "node:os";
import nextEnv from "@next/env";
import pg from "pg";
import {liveTestTarget} from "./live-test-target.mjs";

if(process.env.RUN_MAP_TOOLS_UI!=="1")throw new Error("Set RUN_MAP_TOOLS_UI=1");
nextEnv.loadEnvConfig(process.cwd());loadEnvFile(".env.migrate.local");
const {base,sessionName,csrfName}=liveTestTarget();
const marker=join(tmpdir(),"ai-town-map-tools-ui-fixture.json");
const admin=new pg.Client({connectionString:process.env.DATABASE_ADMIN_URL});
await admin.connect();
try{
  if(process.argv[2]==="cleanup"){
    const fixture=JSON.parse(readFileSync(marker,"utf8"));
    const owner=await admin.query("SELECT id FROM app.principals WHERE id=$1 AND auth_user_id=$2 AND kind='account'",[fixture.principalId,fixture.authId]);
    if(owner.rowCount!==1)throw new Error("Fixture principal mismatch; stop cleanup");
    await admin.query("DELETE FROM app.maps WHERE owner_principal_id=$1 AND title=$2",[fixture.principalId,"지도 도구 기능 검사 · 자동 정리"]);
    await admin.query("DELETE FROM app.principals WHERE id=$1 AND auth_user_id=$2",[fixture.principalId,fixture.authId]);
    unlinkSync(marker);console.log("Synthetic map tools fixture cleaned up");
  }else{
    if(existsSync(marker))throw new Error("Clean up the previous map tools fixture first");
    const authId=randomUUID(),principalId=(await admin.query("INSERT INTO app.principals(kind,auth_user_id) VALUES('account',$1) RETURNING id",[authId])).rows[0].id;
    const sessionToken=randomBytes(32).toString("base64url"),csrf=randomBytes(32).toString("base64url"),hash=value=>createHash("sha256").update(value).digest();
    await admin.query("INSERT INTO app_private.sessions(principal_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[principalId,hash(sessionToken),hash(csrf)]);
    const cookie=`${sessionName}=${sessionToken}; ${csrfName}=${csrf}`;
    const api=async(path,body)=>{const response=await fetch(new URL(path,base),{method:body?"POST":"GET",headers:{Cookie:cookie,...(body?{Origin:base,"X-CSRF-Token":csrf,"Content-Type":"application/json","Idempotency-Key":randomUUID()}: {})},body:body?JSON.stringify(body):undefined});const payload=await response.json();if(!response.ok)throw new Error(payload.error?.message??`HTTP ${response.status}`);return payload.data;};
    try{
      const map=await api("/api/v1/maps",{themeKey:"ecology",themeVersion:2,title:"지도 도구 기능 검사 · 자동 정리",locationLabel:"서울시청 인근 · 가상 검사",activityContext:"community",visibility:"public",moderation:"immediate",center:{lat:37.5665,lng:126.978}});
      const {theme}=await api(`/api/v1/maps/${map.id}/configuration`),points=[];
      for(const [index,title] of ["검사 나무 A","검사 꽃 B","검사 새 C"].entries()){
        const category=theme.categories[index===2?1:0],emoji=category.emojiOptions[index===1?1:0];
        points.push(await api(`/api/v1/maps/${map.id}/observations`,{configRevision:1,title,body:"지도 도구의 기능을 확인하기 위한 가상 관찰 기록입니다.",locationLabel:"가상 검사 위치",locationSource:"manual",location:{lat:37.5665+index*.001,lng:126.978+index*.001},categoryKey:category.key,emojiKey:emoji.key,ratingKey:null,answers:Object.fromEntries(theme.questions.filter(question=>question.required).map(question=>[question.key,question.type==="text"?["검사용 기록"]:[question.options?.[0]?.key??"unknown"]]))}));
      }
      writeFileSync(marker,JSON.stringify({principalId,authId,mapId:map.id,pointIds:points.map(point=>point.id)},null,2));
      console.log(JSON.stringify({url:`${base}/?map=${map.id}`,pointIds:points.map(point=>point.id),marker},null,2));
    }catch(error){await admin.query("DELETE FROM app.maps WHERE owner_principal_id=$1",[principalId]);await admin.query("DELETE FROM app.principals WHERE id=$1",[principalId]);throw error;}
  }
}finally{await admin.end();}
