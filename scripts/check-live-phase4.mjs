// Opt-in API smoke test against the configured local app. Synthetic data is removed afterward.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { loadEnvFile } from "node:process";
import nextEnv from "@next/env";
import pg from "pg";
import sharp from "sharp";

if(process.env.RUN_LIVE_PHASE4!=="1") throw new Error("Set RUN_LIVE_PHASE4=1 to run this test");
nextEnv.loadEnvConfig(process.cwd());loadEnvFile(".env.migrate.local");
const base=process.env.APP_ORIGIN;
const admin=new pg.Client({connectionString:process.env.DATABASE_ADMIN_URL});
const hash=(value)=>createHash("sha256").update(value).digest();
const token=()=>randomBytes(32).toString("base64url");
let accountId=null;const mapIds=[];
let cookie="",csrf="";
async function api(path,{method="GET",body,key,extraHeaders={},anonymous=false}={}) {
  const response=await fetch(new URL(path,base),{method,headers:{...(!anonymous&&cookie?{Cookie:cookie}:{}),...(method!=="GET"?{Origin:base}:{}),...(body && !(body instanceof Buffer)?{"Content-Type":"application/json"}:{}),...(!anonymous&&csrf?{"X-CSRF-Token":csrf}:{}),...(key?{"Idempotency-Key":key}:{}),...extraHeaders},body:body instanceof Buffer?body:body?JSON.stringify(body):undefined});
  const contentType=response.headers.get("content-type")??"";
  const data=contentType.includes("application/json")?await response.json():Buffer.from(await response.arrayBuffer());
  return {status:response.status,data:data?.data,code:data?.error?.code,raw:data};
}
function expect(result,status,label) {if(result.status!==status) throw new Error(`${label}: expected ${status}, got ${result.status} (${result.code??"unknown"})`);}
try {
  await admin.connect();
  accountId=(await admin.query("INSERT INTO app.principals(kind,auth_user_id) VALUES('account',$1) RETURNING id",[randomUUID()])).rows[0].id;
  const sessionToken=token();csrf=token();cookie=`moa_dev_session=${sessionToken}; moa_dev_csrf=${csrf}`;
  await admin.query("INSERT INTO app_private.sessions(principal_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[accountId,hash(sessionToken),hash(csrf)]);
  for(const themeKey of ["ecology","universal_design"]) {
    const result=await api("/api/v1/maps",{method:"POST",key:randomUUID(),body:{themeKey,themeVersion:1,title:`4단계 검사 ${themeKey}`,locationLabel:"검사 위치",activityContext:"community",visibility:themeKey==="universal_design"?"public":"invite_only",moderation:themeKey==="universal_design"?"approval":"immediate",center:{lat:37.5665,lng:126.978}}});
    expect(result,201,`${themeKey} create map`);mapIds.push(result.data.id);
  }
  const configs=[];
  for(const id of mapIds) {const result=await api(`/api/v1/maps/${id}/configuration`);expect(result,200,"config");configs.push(result.data);}
  const input=(theme,ratingKey=null)=>({configRevision:1,title:"테스트 지점",body:"현장에서 직접 확인한 관찰 기록입니다.",locationLabel:"검사 지점",locationSource:"manual",location:{lat:37.5665,lng:126.978},categoryKey:theme.categories[0].key,emojiKey:theme.categories[0].emojiOptions[0].key,ratingKey,answers:Object.fromEntries(theme.questions.filter((q)=>q.required).map((q)=>[q.key,[q.type==="text"?"현장 관찰":q.type==="boolean"?"yes":q.options?.[0]?.key??"unknown"]]))});
  const ecologyInput=input(configs[0].theme);
  const key=randomUUID();const path=`/api/v1/maps/${mapIds[0]}/observations`;
  const first=await api(path,{method:"POST",key,body:ecologyInput});expect(first,201,"ecology observation");
  if(first.data.ratingKey!==null || first.data.emojiKey!==ecologyInput.emojiKey) throw new Error("Ecology emoji or disabled rating mismatch");
  const repeat=await api(path,{method:"POST",key,body:ecologyInput});expect(repeat,200,"idempotent retry");
  if(repeat.data.id!==first.data.id) throw new Error("Retry created a second point");
  const badRating=await api(path,{method:"POST",key:randomUUID(),body:{...ecologyInput,ratingKey:configs[1].theme.rating.options[0].key}});expect(badRating,422,"rating disabled");
  const badEmoji=await api(path,{method:"POST",key:randomUUID(),body:{...ecologyInput,emojiKey:configs[1].theme.categories[0].emojiOptions[0].key}});expect(badEmoji,422,"foreign emoji");
  const universalInput=input(configs[1].theme,configs[1].theme.rating.options[0].key);
  const second=await api(`/api/v1/maps/${mapIds[1]}/observations`,{method:"POST",key:randomUUID(),body:universalInput});expect(second,201,"rating map observation");
  if(second.data.status!=="pending") throw new Error("Approval map published without review");
  const anonymousList=await api(`/api/v1/maps/${mapIds[1]}/observations`,{anonymous:true});expect(anonymousList,200,"anonymous public map list");
  if(anonymousList.data.items.length) throw new Error("Pending observation exposed to public");
  expect(await api(`/api/v1/maps/${mapIds[1]}/observations`,{method:"POST",key:randomUUID(),body:universalInput,anonymous:true}),401,"anonymous write denied");
  const read=await api(path);expect(read,200,"list observations");
  if(read.data.items.length!==1 || read.data.items[0].id!==first.data.id) throw new Error("Map observation isolation failed");
  const edited=await api(`${path}/${first.data.id}`,{method:"PATCH",body:{...ecologyInput,title:"수정된 지점"},extraHeaders:{"If-Match":`"${first.data.version}"`}});expect(edited,200,"edit observation");
  expect(await api(`${path}/${first.data.id}`,{method:"PATCH",body:ecologyInput,extraHeaders:{"If-Match":`"${first.data.version}"`}}),412,"stale edit");
  const png=await sharp({create:{width:10,height:10,channels:3,background:"red"}}).png().toBuffer();
  const photo=await api(`${path}/${first.data.id}/photo`,{method:"POST",body:png,extraHeaders:{"Content-Type":"image/png"}});expect(photo,201,"photo upload");
  expect(await api(`/api/v1/maps/${mapIds[1]}/observations/${second.data.id}/photo`,{method:"POST",body:png,extraHeaders:{"Content-Type":"image/png"}}),201,"pending photo upload");
  expect(await api(`/api/v1/maps/${mapIds[1]}/observations/${second.data.id}/photo`,{anonymous:true}),404,"pending photo private");
  const image=await api(`${path}/${first.data.id}/photo`);expect(image,200,"photo read");
  if(image.raw.subarray(0,4).toString()!=="RIFF") throw new Error("Photo was not converted to WebP");
  const otherMapPhoto=await api(`/api/v1/maps/${mapIds[1]}/observations/${first.data.id}/photo`);expect(otherMapPhoto,404,"cross-map photo isolation");
  console.log("Live Phase 4 API smoke passed: emoji/rating rules, idempotency, map isolation, edit version, photo processing");
} finally {
  if(accountId) {
    await admin.query("BEGIN");
    try {
      await admin.query("SET CONSTRAINTS ALL DEFERRED");
      const ids=mapIds;
      await admin.query("DELETE FROM app.observation_photos WHERE map_id=ANY($1::uuid[])",[ids]);
      await admin.query("DELETE FROM app.observations WHERE map_id=ANY($1::uuid[])",[ids]);
      await admin.query("DELETE FROM app.map_config_revisions WHERE map_id=ANY($1::uuid[])",[ids]);
      await admin.query("DELETE FROM app.question_versions WHERE map_id=ANY($1::uuid[])",[ids]);
      await admin.query("DELETE FROM app.questions WHERE map_id=ANY($1::uuid[])",[ids]);
      await admin.query("DELETE FROM app.rating_options WHERE map_id=ANY($1::uuid[])",[ids]);
      await admin.query("DELETE FROM app.rating_schemes WHERE map_id=ANY($1::uuid[])",[ids]);
      await admin.query("DELETE FROM app.emoji_options WHERE map_id=ANY($1::uuid[])",[ids]);
      await admin.query("DELETE FROM app.categories WHERE map_id=ANY($1::uuid[])",[ids]);
      await admin.query("DELETE FROM app.map_members WHERE map_id=ANY($1::uuid[])",[ids]);
      await admin.query("DELETE FROM app.maps WHERE id=ANY($1::uuid[])",[ids]);
      await admin.query("DELETE FROM app_private.idempotency_keys WHERE principal_id=$1",[accountId]);
      await admin.query("DELETE FROM app_private.sessions WHERE principal_id=$1",[accountId]);
      await admin.query("DELETE FROM app.principals WHERE id=$1",[accountId]);
      await admin.query("COMMIT");console.log("Synthetic test data removed");
    } catch(error) {await admin.query("ROLLBACK");throw error;}
  }
  await admin.end();
}
