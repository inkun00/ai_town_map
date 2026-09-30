import { liveTestTarget } from "./live-test-target.mjs";
// Opt-in API smoke test. Creates only synthetic records and removes them afterward.
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {loadEnvFile} from "node:process";
import nextEnv from "@next/env";
import pg from "pg";
import sharp from "sharp";

if(process.env.RUN_LIVE_PHASE5!=="1")throw new Error("Set RUN_LIVE_PHASE5=1 to run this test");
nextEnv.loadEnvConfig(process.cwd());loadEnvFile(".env.migrate.local");
const { base, sessionName, csrfName } = liveTestTarget();
const admin=new pg.Client({connectionString:process.env.DATABASE_ADMIN_URL});
const hash=value=>createHash("sha256").update(value).digest();
const token=()=>randomBytes(32).toString("base64url");
const actors=[];let mapId=null;
async function actor(kind){const principal=(await admin.query("INSERT INTO app.principals(kind,auth_user_id) VALUES($1,$2) RETURNING id",[kind,kind==="account"?randomUUID():null])).rows[0].id;const session=token(),csrf=token();await admin.query("INSERT INTO app_private.sessions(principal_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[principal,hash(session),hash(csrf)]);const value={principal,csrf,cookie:`${sessionName}=${session}; ${csrfName}=${csrf}`};actors.push(value);return value;}
async function api(path,actor,{method="GET",body,key,version,mime}={}){const response=await fetch(new URL(path,base),{method,headers:{...(actor?{Cookie:actor.cookie}:{}),...(method!=="GET"?{Origin:base}:{}),...(body?{"Content-Type":mime??"application/json"}:{}),...(actor&&method!=="GET"?{"X-CSRF-Token":actor.csrf}:{}),...(key?{"Idempotency-Key":key}:{}),...(version?{"X-Resource-Version":`"${version}"`}:{})},body:body instanceof Buffer?body:body?JSON.stringify(body):undefined});const payload=response.status===204?null:response.headers.get("content-type")?.includes("application/json")?await response.json():Buffer.from(await response.arrayBuffer());return{status:response.status,data:payload?.data,code:payload?.error?.code,raw:payload};}
function expect(result,status,label){if(result.status!==status)throw new Error(`${label}: expected ${status}, got ${result.status} (${result.code??"unknown"})`);return result.data;}
try{
  await admin.connect();
  const owner=await actor("account"),guest=await actor("guest"),outsider=await actor("account");
  const map=expect(await api("/api/v1/maps",owner,{method:"POST",key:randomUUID(),body:{themeKey:"ecology",themeVersion:1,title:"5단계 권한 검사",locationLabel:"검사 위치",activityContext:"community",visibility:"public",moderation:"approval",commentsEnabled:true,center:{lat:37.5665,lng:126.978}}}),201,"map create");mapId=map.id;
  const member=(await admin.query("INSERT INTO app.map_members(map_id,principal_id,nickname) VALUES($1,$2,'테스트 참여자') RETURNING id,version",[mapId,guest.principal])).rows[0];
  const config=expect(await api(`/api/v1/maps/${mapId}/configuration`,owner),200,"configuration").theme;
  const input={configRevision:1,title:"검수할 나무",body:"현장에서 관찰한 임시 기록입니다.",locationLabel:"검사 지점",locationSource:"manual",location:{lat:37.5665,lng:126.978},categoryKey:config.categories[0].key,emojiKey:config.categories[0].emojiOptions[0].key,ratingKey:null,answers:Object.fromEntries(config.questions.filter(q=>q.required).map(q=>[q.key,[q.type==="text"?"현장 관찰":q.type==="boolean"?"yes":q.options?.[0]?.key??"unknown"]]))};
  const observation=expect(await api(`/api/v1/maps/${mapId}/observations`,guest,{method:"POST",key:randomUUID(),body:input}),201,"pending observation");
  if(observation.status!=="pending")throw new Error("Approval map should create pending observation");
  const observationPath=`/api/v1/maps/${mapId}/observations/${observation.id}`;
  const png=await sharp({create:{width:12,height:12,channels:3,background:"green"}}).png().toBuffer();
  observation.version=expect(await api(`${observationPath}/photo`,guest,{method:"POST",body:png,mime:"image/png"}),201,"pending photo upload").version;
  expect(await api(`${observationPath}/photo`,null),404,"pending photo hidden");
  const pendingBlocked=expect(await api(`/api/v1/maps/${mapId}/members/${member.id}`,owner,{method:"PATCH",version:member.version,body:{status:"blocked"}}),200,"block pending author");
  expect(await api(`/api/v1/maps/${mapId}/observations?scope=mine`,guest),403,"blocked private records denied");
  expect(await api(`${observationPath}/photo`,guest),404,"blocked pending photo denied");
  expect(await api(observationPath,guest,{method:"DELETE",version:observation.version}),403,"blocked author delete denied");
  const pendingRestored=expect(await api(`/api/v1/maps/${mapId}/members/${member.id}`,owner,{method:"PATCH",version:pendingBlocked.version,body:{status:"active"}}),200,"restore pending author");
  const changesRequested=expect(await api(`${observationPath}/moderation`,owner,{method:"POST",version:observation.version,body:{action:"request_changes",reason:"위치 설명을 더 자세히 적어주세요"}}),200,"request changes");
  if(changesRequested.status!=="pending"||changesRequested.moderationReason!=="위치 설명을 더 자세히 적어주세요")throw new Error("Change request was not preserved");
  const revised=expect(await api(observationPath,guest,{method:"PATCH",version:changesRequested.version,body:{...input,body:"현장에서 다시 확인하고 위치 설명을 더 자세히 적었습니다."}}),200,"author revises pending record");
  if(expect(await api(`/api/v1/maps/${mapId}/observations`,null),200,"anonymous list").items.length)throw new Error("Pending observation exposed");
  if(expect(await api(`/api/v1/maps/${mapId}/observations?scope=review`,owner),200,"review list").items.length!==1)throw new Error("Pending review missing");
  expect(await api(`${observationPath}/comments`,guest,{method:"POST",key:randomUUID(),body:{body:"게시 전 댓글"}}),404,"pending comment denied");
  const approved=expect(await api(`${observationPath}/moderation`,owner,{method:"POST",version:revised.version,body:{action:"approve"}}),200,"approve");
  const publicPhoto=await api(`${observationPath}/photo`,null);expect(publicPhoto,200,"published photo visible");if(publicPhoto.raw.subarray(0,4).toString()!=="RIFF")throw new Error("Published photo is not WebP");
  const commentsPath=`${observationPath}/comments`,commentKey=randomUUID();
  const comment=expect(await api(commentsPath,guest,{method:"POST",key:commentKey,body:{body:"나무를 확인했어요"}}),201,"guest comment");
  const repeated=expect(await api(commentsPath,guest,{method:"POST",key:commentKey,body:{body:"나무를 확인했어요"}}),200,"comment retry");if(comment.id!==repeated.id)throw new Error("Comment idempotency failed");
  expect(await api(commentsPath,outsider,{method:"POST",key:randomUUID(),body:{body:"참여하지 않은 계정"}}),403,"nonmember comment denied");
  if(expect(await api(commentsPath,null),200,"anonymous comments").items.length!==1)throw new Error("Published comment missing");
  const edited=expect(await api(`/api/v1/maps/${mapId}/comments/${comment.id}`,guest,{method:"PATCH",version:comment.version,body:{body:"수정한 댓글"}}),200,"edit comment");
  expect(await api(`/api/v1/maps/${mapId}/comments/${comment.id}`,guest,{method:"PATCH",version:comment.version,body:{body:"오래된 수정"}}),412,"stale comment denied");
  const hiddenComment=expect(await api(`/api/v1/maps/${mapId}/comments/${comment.id}/moderation`,owner,{method:"POST",version:edited.version,body:{action:"hide",reason:"검수 테스트"}}),200,"hide comment");
  if(expect(await api(commentsPath,null),200,"hidden comment list").items.length)throw new Error("Hidden comment exposed");
  const restoredComment=expect(await api(`/api/v1/maps/${mapId}/comments/${comment.id}/moderation`,owner,{method:"POST",version:hiddenComment.version,body:{action:"restore",reason:"복구 테스트"}}),200,"restore comment");
  const report=expect(await api(`/api/v1/maps/${mapId}/reports`,guest,{method:"POST",key:randomUUID(),body:{targetType:"comment",targetId:comment.id,reasonCode:"other",detail:"검수 테스트"}}),201,"report comment");
  expect(await api(`/api/v1/maps/${mapId}/reports`,null,{method:"POST",key:randomUUID(),body:{targetType:"comment",targetId:comment.id,reasonCode:"other"}}),401,"anonymous report denied");
  const openReports=expect(await api(`/api/v1/maps/${mapId}/reports`,owner),200,"admin report list").items;if(openReports.length!==1||openReports[0].id!==report.id||openReports[0].targetBody!=="수정한 댓글")throw new Error("Report review content mismatch");
  expect(await api(`/api/v1/maps/${mapId}/reports`,guest),403,"participant report inbox denied");
  expect(await api(`/api/v1/maps/${mapId}/reports/${report.id}`,owner,{method:"PATCH",version:openReports[0].version,body:{status:"resolved",reason:"내용 검토 완료"}}),200,"resolve report");
  expect(await api(`/api/v1/maps/${mapId}/members/${member.id}`,owner,{method:"PATCH",version:pendingRestored.version,body:{role:"admin"}}),422,"guest admin denied");
  const blocked=expect(await api(`/api/v1/maps/${mapId}/members/${member.id}`,owner,{method:"PATCH",version:pendingRestored.version,body:{status:"blocked"}}),200,"block member");
  expect(await api(commentsPath,guest,{method:"POST",key:randomUUID(),body:{body:"차단 후 댓글"}}),403,"blocked comment denied");
  expect(await api(`/api/v1/maps/${mapId}/comments/${comment.id}`,guest,{method:"DELETE",version:restoredComment.version}),403,"blocked comment deletion denied");
  if(expect(await api(commentsPath,guest),200,"blocked public comment view").items[0]?.canEdit)throw new Error("Blocked member retained edit capability");
  expect(await api(`/api/v1/maps/${mapId}/members/${member.id}`,owner,{method:"PATCH",version:blocked.version,body:{status:"active"}}),200,"restore member");
  const settings=expect(await api(`/api/v1/maps/${mapId}`,owner),200,"map settings");
  const simultaneous=await Promise.all([
    api(`/api/v1/maps/${mapId}`,owner,{method:"PATCH",version:settings.version,body:{commentsEnabled:true}}),
    api(`/api/v1/maps/${mapId}`,owner,{method:"PATCH",version:settings.version,body:{commentsEnabled:true}}),
  ]);
  if(simultaneous.map(result=>result.status).sort().join(",")!=="200,412")throw new Error("Concurrent map settings did not reject the stale writer");
  settings.version=simultaneous.find(result=>result.status===200).data.version;
  const disabled=expect(await api(`/api/v1/maps/${mapId}`,owner,{method:"PATCH",version:settings.version,body:{commentsEnabled:false}}),200,"disable comments");
  expect(await api(commentsPath,guest,{method:"POST",key:randomUUID(),body:{body:"댓글 비활성 상태"}}),403,"disabled comments denied");
  if(expect(await api(commentsPath,null),200,"read old comments").items.length!==1)throw new Error("Existing comment became invisible");
  const observationHidden=expect(await api(`${observationPath}/moderation`,owner,{method:"POST",version:approved.version,body:{action:"hide",reason:"위치 검토"}}),200,"hide observation");
  if(expect(await api(`/api/v1/maps/${mapId}/observations`,null),200,"hidden observation list").items.length)throw new Error("Hidden observation exposed");
  expect(await api(`${observationPath}/photo`,null),404,"hidden photo denied");
  expect(await api(commentsPath,null),404,"hidden parent comments denied");
  if(expect(await api(commentsPath,owner),200,"admin hidden parent comments").items.length!==1)throw new Error("Admin lost comments during review");
  const mine=expect(await api(`/api/v1/maps/${mapId}/observations?scope=mine`,guest),200,"author hidden record").items[0];if(mine.body||mine.title!=="숨겨진 기록")throw new Error("Hidden observation body exposed to author");
  const restored=expect(await api(`${observationPath}/moderation`,owner,{method:"POST",version:observationHidden.version,body:{action:"restore",reason:"복구"}}),200,"restore observation");if(restored.status!=="pending")throw new Error("Approval map restore should require review");
  const reapproved=expect(await api(`${observationPath}/moderation`,owner,{method:"POST",version:restored.version,body:{action:"approve"}}),200,"reapprove");
  expect(await api(`/api/v1/maps/${mapId}/comments/${comment.id}`,guest,{method:"DELETE",version:restoredComment.version}),204,"delete own comment");
  if(expect(await api(commentsPath,null),200,"deleted comment list").items.length)throw new Error("Deleted comment exposed");
  const enabledAgain=expect(await api(`/api/v1/maps/${mapId}`,owner,{method:"PATCH",version:disabled.version,body:{commentsEnabled:true}}),200,"re-enable comments");
  for(let index=0;index<9;index++)expect(await api(commentsPath,guest,{method:"POST",key:randomUUID(),body:{body:`추가 검사 댓글 ${index}`}}),201,`comment ${index}`);
  expect(await api(commentsPath,guest,{method:"POST",key:randomUUID(),body:{body:"제한 초과 댓글"}}),429,"comment rate limit");
  expect(await api(observationPath,guest,{method:"DELETE",version:reapproved.version}),204,"soft delete observation");
  if(expect(await api(`/api/v1/maps/${mapId}/observations`,null),200,"deleted observation list").items.length)throw new Error("Deleted observation exposed");
  const deleted=expect(await api(`/api/v1/maps/${mapId}/observations?scope=review`,owner),200,"deleted review").items[0];
  expect(await api(`${observationPath}/moderation`,owner,{method:"POST",version:deleted.version,body:{action:"restore",reason:"삭제 취소"}}),200,"restore deleted observation");
  const archived=expect(await api(`/api/v1/maps/${mapId}`,owner,{method:"PATCH",version:enabledAgain.version,body:{status:"archived"}}),200,"archive map");
  expect(await api(commentsPath,guest,{method:"POST",key:randomUUID(),body:{body:"보관 후 댓글"}}),403,"archived comment denied");
  const reopened=expect(await api(`/api/v1/maps/${mapId}`,owner,{method:"PATCH",version:archived.version,body:{status:"active"}}),200,"reopen map");
  const privateMap=expect(await api(`/api/v1/maps/${mapId}`,owner,{method:"PATCH",version:reopened.version,body:{visibility:"invite_only"}}),200,"make map private");
  expect(await api(`/api/v1/maps/${mapId}`,null),404,"anonymous private map denied");
  expect(await api(commentsPath,null),404,"anonymous private comments denied");
  expect(await api(`/api/v1/maps/${mapId}/observations`,guest),200,"member private observations");
  expect(await api(`/api/v1/maps/${mapId}`,owner,{method:"DELETE",version:privateMap.version}),204,"soft delete map");
  expect(await api(`/api/v1/maps/${mapId}`,owner),404,"deleted map inaccessible");
  const deletedMap=expect(await api("/api/v1/maps?scope=deleted",owner),200,"deleted map list").items.find(item=>item.id===mapId);
  if(!deletedMap)throw new Error("Deleted map recovery entry missing");
  expect(await api("/api/v1/maps?scope=deleted",guest),200,"guest deleted scope");
  const mapRestored=expect(await api(`/api/v1/maps/${mapId}/restore`,owner,{method:"POST",version:deletedMap.version}),200,"restore map");
  if(mapRestored.status!=="archived")throw new Error("Restored map should be archived");
  void restoredComment;
  console.log("Live Phase 5 API smoke passed: moderation, comments, reports, member controls, archive and visibility boundaries");
}finally{
  if(actors.length){await admin.query("BEGIN");try{await admin.query("SET CONSTRAINTS ALL DEFERRED");if(mapId)for(const table of ["app.audit_events","app.reports","app.comments","app.observation_photos","app.observations","app.map_config_revisions","app.question_versions","app.questions","app.rating_options","app.rating_schemes","app.emoji_options","app.categories","app.map_members","app.maps"]){await admin.query(`DELETE FROM ${table} WHERE ${table==="app.maps"?"id":"map_id"}=$1`,[mapId]);}await admin.query("DELETE FROM app_private.idempotency_keys WHERE principal_id=ANY($1::uuid[])",[actors.map(value=>value.principal)]);await admin.query("DELETE FROM app_private.sessions WHERE principal_id=ANY($1::uuid[])",[actors.map(value=>value.principal)]);await admin.query("DELETE FROM app.principals WHERE id=ANY($1::uuid[])",[actors.map(value=>value.principal)]);await admin.query("COMMIT");console.log("Synthetic test data removed");}catch(error){await admin.query("ROLLBACK");throw error;}}
  await admin.end();
}
