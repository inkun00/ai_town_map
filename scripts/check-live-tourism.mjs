// Opt-in HTTP check. Only newly created fictional teacher/map data is removed.
import assert from "node:assert/strict";
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {loadEnvFile} from "node:process";
import {readFile} from "node:fs/promises";
import nextEnv from "@next/env";
import pg from "pg";
import sharp from "sharp";
import {liveTestTarget} from "./live-test-target.mjs";

if(process.env.RUN_LIVE_TOURISM!=="1")throw new Error("Set RUN_LIVE_TOURISM=1 to run this synthetic check");
nextEnv.loadEnvConfig(process.cwd());loadEnvFile(".env.migrate.local");
const {base,sessionName,csrfName}=liveTestTarget();
const template=JSON.parse(await readFile("docs/contracts/theme-presets.json","utf8")).templates.find(theme=>theme.key==="tourism");
assert.ok(template,"Tourism contract is required");
const client=new pg.Client({connectionString:process.env.DATABASE_ADMIN_URL});
const hash=value=>createHash("sha256").update(value).digest();
const token=()=>randomBytes(32).toString("base64url");
let ownerId=null,cookie="",csrf="";
async function cleanup(){
  if(!ownerId)return;
  await client.query("BEGIN");
  try{
    await client.query("SET CONSTRAINTS ALL DEFERRED");
    const mapIds=(await client.query("SELECT id FROM app.maps WHERE owner_principal_id=$1 FOR UPDATE",[ownerId])).rows.map(row=>row.id);
    for(const table of ["app.student_analysis_reports","app.proposal_versions","app.proposals","app.audit_events","app.reports","app.comments","app.observation_photos","app.observations","app.map_config_revisions","app.question_versions","app.questions","app.rating_options","app.rating_schemes","app.emoji_options","app.categories","app_private.invites","app.map_members"]){
      await client.query(`DELETE FROM ${table} WHERE map_id=ANY($1::uuid[])`,[mapIds]);
    }
    await client.query("DELETE FROM app.maps WHERE owner_principal_id=$1",[ownerId]);
    await client.query("DELETE FROM app_private.idempotency_keys WHERE principal_id=$1",[ownerId]);
    await client.query("DELETE FROM app_private.sessions WHERE principal_id=$1",[ownerId]);
    await client.query("DELETE FROM app.principals WHERE id=$1",[ownerId]);
    await client.query("COMMIT");
    assert.equal((await client.query("SELECT id FROM app.principals WHERE id=$1",[ownerId])).rowCount,0);
    console.log("Removed only the fictional tourism check data.");
  }catch(error){await client.query("ROLLBACK");throw error;}
}
async function api(path,{body,method=body===undefined?"GET":"POST",key,anonymous=false,mime}={}){
  const response=await fetch(new URL(path,base),{method,headers:{
    ...(!anonymous&&cookie?{Cookie:cookie}:{}),...(method!=="GET"?{Origin:base}:{}),
    ...(!anonymous&&csrf?{"X-CSRF-Token":csrf}:{}),...(key?{"Idempotency-Key":key}:{}),
    ...(body!==undefined?{"Content-Type":mime??"application/json"}:{}),
  },...(body===undefined?{}:{body:Buffer.isBuffer(body)?body:JSON.stringify(body)})});
  const type=response.headers.get("content-type")??"";
  const result=type.includes("application/json")?await response.json():Buffer.from(await response.arrayBuffer());
  assert.ok(response.ok,`${path}: ${response.status} ${result.error?.code??""}`);
  return {data:result.data??result,response};
}

try{
  await client.connect();
  ownerId=(await client.query("INSERT INTO app.principals(kind,auth_user_id,account_role) VALUES('account',$1,'teacher') RETURNING id",[randomUUID()])).rows[0].id;
  const session=token();csrf=token();cookie=`${sessionName}=${session}; ${csrfName}=${csrf}`;
  await client.query("INSERT INTO app_private.sessions(principal_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,now()+interval '20 minutes')",[ownerId,hash(session),hash(csrf)]);
  const title=`관광 합성 검사 ${randomUUID().slice(0,8)}`;
  const created=(await api("/api/v1/maps",{key:randomUUID(),body:{themeKey:"tourism",themeVersion:template.version,title,description:"관광 주제 기본 기능을 확인하는 합성 자료입니다.",locationLabel:"가상 검사 지역",visibility:"public",activityContext:"community"}})).data;
  const mapId=created.id,path=`/api/v1/maps/${mapId}`;
  assert.equal(created.themeKey,"tourism");
  const configuration=(await api(path+"/configuration")).data;
  const theme=configuration.theme;
  assert.equal(theme.categories.length,template.categories.length);
  assert.equal(theme.categories.reduce((sum,c)=>sum+c.emojiOptions.length,0),template.categories.reduce((sum,c)=>sum+c.emojiOptions.length,0));
  assert.equal(theme.pin.mode,"category");assert.equal(theme.rating,null);
  const recorded=[];
  // One record in every category checks all category/emoji foreign keys.
  for(const [index,category] of theme.categories.entries()){
    const emoji=category.emojiOptions.at(-1);
    const input={configRevision:configuration.configRevision,title:`가상 관광지 ${index+1} · ${category.label}`,body:"가상 관광지를 둘러보고 볼거리와 편의시설을 기록했습니다.",locationLabel:"가상 관광 장소",locationSource:"manual",location:{lat:0,lng:0},categoryKey:category.key,emojiKey:emoji.key,ratingKey:null,answers:{},improvementIdea:"안내 표지와 쉴 수 있는 곳을 더 마련하면 좋겠습니다.",link:"https://example.com/tourism-test"};
    const key=randomUUID(),saved=(await api(path+"/observations",{body:input,key})).data;
    assert.equal(saved.categoryKey,category.key);assert.equal(saved.emojiKey,emoji.key);assert.equal(saved.link,input.link);assert.ok(saved.createdAt);
    if(index===0)assert.equal((await api(path+"/observations",{body:input,key})).data.id,saved.id);
    recorded.push(saved);
  }
  const picture=await sharp({create:{width:64,height:64,channels:3,background:"#51a8b4"}}).png().toBuffer();
  const photoPath=`${path}/observations/${recorded[0].id}/photo`;
  await api(photoPath,{body:picture,mime:"image/png"});
  const photo=await api(photoPath,{anonymous:true});assert.equal(photo.response.headers.get("content-type"),"image/webp");assert.ok(photo.data.length>0);
  const commentsPath=`${path}/observations/${recorded[0].id}/comments`;
  await api(commentsPath,{body:{body:"가상 관광 기록의 댓글 저장 확인입니다."},key:randomUUID()});
  assert.equal((await api(commentsPath,{anonymous:true})).data.items.length,1);
  const publicMap=(await api(path,{anonymous:true})).data;assert.equal(publicMap.themeKey,"tourism");
  const records=(await api(path+"/observations",{anonymous:true})).data.items;
  assert.equal(records.length,theme.categories.length);assert.ok(records.find(item=>item.id===recorded[0].id).photoUrl);
  const analysis=(await api(path+"/analysis",{anonymous:true})).data;assert.equal(analysis.stats.total,theme.categories.length);assert.equal(analysis.stats.ratedCount,null);
  const mine=(await api(`/api/v1/maps?scope=mine&themeKey=tourism&q=${encodeURIComponent(title)}`)).data.items;assert.equal(mine.length,1);assert.equal(mine[0].id,mapId);
  const csv=(await api(path+"/exports",{body:{filter:{},includeAuthor:false,includeCoordinates:false}})).data.toString("utf8");
  assert.ok(csv.includes(recorded[0].title));assert.ok(csv.includes(theme.categories[0].label));
  console.log(`PASS: tourism v${theme.version}, ${theme.categories.length} categories, ${theme.categories.reduce((sum,c)=>sum+c.emojiOptions.length,0)} emojis; HTTP create, all-category records, idempotency, photo, link, comment, public reading, filter, statistics and CSV.`);
}catch(error){
  console.error(error instanceof assert.AssertionError?error.message:`Tourism check failed (${error instanceof Error?error.name:"unknown error"})`);
  process.exitCode=1;
}finally{
  try{await cleanup();}catch{console.error("Synthetic tourism fixture cleanup failed");process.exitCode=1;}
  try{await client.end();}catch{process.exitCode=1;}
}
