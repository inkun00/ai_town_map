import { liveTestTarget } from "./live-test-target.mjs";
// Opt-in API smoke test. Creates only synthetic records and removes them afterward.
import {createHash,randomBytes,randomUUID} from "node:crypto";
import {loadEnvFile} from "node:process";
import nextEnv from "@next/env";
import pg from "pg";
import {existsSync,writeFileSync,unlinkSync} from "node:fs";
import {setTimeout as pause} from "node:timers/promises";
import sharp from "sharp";


if(process.env.RUN_LIVE_PHASE6!=="1")throw new Error("Set RUN_LIVE_PHASE6=1 to run this test");
nextEnv.loadEnvConfig(process.cwd());loadEnvFile(".env.migrate.local");
const { base, sessionName, csrfName } = liveTestTarget();
const admin=new pg.Client({connectionString:process.env.DATABASE_ADMIN_URL});
const hash=value=>createHash("sha256").update(value).digest();
const token=()=>randomBytes(32).toString("base64url");
const actors=[];let mapId=null;const extraMapIds=[];
async function actor(kind){const principal=(await admin.query("INSERT INTO app.principals(kind,auth_user_id) VALUES($1,$2) RETURNING id",[kind,kind==="account"?randomUUID():null])).rows[0].id;const session=token(),csrf=token();await admin.query("INSERT INTO app_private.sessions(principal_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,now()+interval '1 hour')",[principal,hash(session),hash(csrf)]);const value={principal,csrf,cookie:`${sessionName}=${session}; ${csrfName}=${csrf}`};actors.push(value);return value;}
async function api(path,actor,{method="GET",body,key,version,mime}={}){const response=await fetch(new URL(path,base),{method,headers:{...(actor?{Cookie:actor.cookie}:{}),...(method!=="GET"?{Origin:base}:{}),...(body?{"Content-Type":mime??"application/json"}:{}),...(actor&&method!=="GET"?{"X-CSRF-Token":actor.csrf}:{}),...(key?{"Idempotency-Key":key}:{}),...(version?{"X-Resource-Version":`"${version}"`}:{})},body:body instanceof Buffer?body:body?JSON.stringify(body):undefined});const payload=response.status===204?null:response.headers.get("content-type")?.includes("application/json")?await response.json():Buffer.from(await response.arrayBuffer());return{status:response.status,data:payload?.data,code:payload?.error?.code,raw:payload};}
function expect(result,status,label){if(result.status!==status)throw new Error(`${label}: expected ${status}, got ${result.status} (${result.code??"unknown"})`);return result.data;}

try{
  await admin.connect();
  const owner=await actor("account"),guest=await actor("guest"),outsider=await actor("account");
  const map=expect(await api("/api/v1/maps",owner,{method:"POST",key:randomUUID(),body:{themeKey:"universal_design",themeVersion:1,title:"6단계 합성 검증",locationLabel:"테스트 조사 지역",visibility:"public",moderation:"immediate",proposalsEnabled:true}}),201,"create map");mapId=map.id;
  const basePath=`/api/v1/maps/${mapId}`;
  const member=(await admin.query("INSERT INTO app.map_members(map_id,principal_id,nickname) VALUES($1,$2,'합성 참여자') RETURNING id",[mapId,guest.principal])).rows[0];
  const theme=expect(await api(`${basePath}/configuration`,owner),200,"config").theme;
  const observations=[];
  for(let i=0;i<5;i++){
    const input={configRevision:1,title:i===0?"=SUM(1,2)":`합성 기록 ${i}`,body:"검증용 관찰 내용입니다. 실제 조사 자료가 아닙니다.",locationLabel:"합성 지점",locationSource:"manual",location:{lat:37.56+i*0.01,lng:126.97},categoryKey:theme.categories[i%2].key,emojiKey:theme.categories[i%2].emojiOptions[0].key,ratingKey:theme.rating.options[i%3].key,answers:{}};
    for(const q of theme.questions)input.answers[q.key]=[i===2&&q.allowUnknown?"unknown":i===3&&q.allowNotApplicable?"na":q.type==="boolean"?"yes":q.type==="text"?"합성 응답":q.options[0].key];
    observations.push(expect(await api(`${basePath}/observations`,guest,{method:"POST",key:randomUUID(),body:input}),201,`record ${i}`));
  }
  await admin.query("UPDATE app.observations SET created_at=$2 WHERE map_id=$1",[mapId,"2026-09-28T15:01:00Z"]);
  const analysis=expect(await api(`${basePath}/analysis`,null),200,"public analysis");
  if(analysis.stats.total!==5||analysis.items.length!==5||analysis.stats.byDay[0].day!=="2026-09-29")throw new Error("Analysis count/date mismatch");
  const q=analysis.stats.questions.find(q=>q.unknownCount===1&&q.notApplicableCount===1);if(!q||q.answeredCount!==3||q.missingCount!==0)throw new Error("Question denominator mismatch");
  const filtered=expect(await api(`${basePath}/analysis?filter=${encodeURIComponent(JSON.stringify({category:theme.categories[0].key,from:"2026-09-29",to:"2026-09-29"}))}`,null),200,"filtered analysis");
  if(filtered.stats.total!==3||filtered.items.length!==3)throw new Error("Filter mismatch");
  const bounds=expect(await api(`${basePath}/analysis?filter=${encodeURIComponent(JSON.stringify({bbox:[126.96,37.555,126.98,37.565]}))}`,null),200,"bounds");if(bounds.stats.total!==1)throw new Error("Bounds mismatch");
  expect(await api(`${basePath}/analysis?filter=%7B`,null),422,"malformed filter");
  expect(await api(`${basePath}/exports`,guest,{method:"POST",body:{filter:{}}}),403,"participant CSV denied");
  expect(await api(`${basePath}/exports`,null,{method:"POST",body:{filter:{}}}),401,"anonymous CSV denied");
  const exported=await api(`${basePath}/exports`,owner,{method:"POST",body:{filter:{}}});expect(exported,200,"CSV");const csv=exported.raw.toString("utf8");if(!csv.startsWith("\uFEFF")||csv.includes("작성자 닉네임")||csv.includes("위도")||!csv.includes("'=SUM"))throw new Error("CSV privacy/formula protection failed");
  const withPrivate=await api(`${basePath}/exports`,owner,{method:"POST",body:{filter:{},includeAuthor:true,includeCoordinates:true}});expect(withPrivate,200,"CSV selected fields");if(!withPrivate.raw.toString().includes("작성자 닉네임")||!withPrivate.raw.toString().includes("위도"))throw new Error("CSV options failed");
  const draft={title:"합성 개선 제안",problem:"이동에 불편이 있습니다.",solution:"경사로를 정비합니다.",expectedEffect:"편리한 이동",responsibleParty:"시설 관리자",followUp:"다음 달 확인",evidenceIds:[observations[0].id],filter:{}};
  expect(await api(`${basePath}/proposals`,outsider,{method:"POST",key:randomUUID(),body:draft}),403,"outsider proposal denied");
  expect(await api(`${basePath}/proposals`,guest,{method:"POST",key:randomUUID(),body:{...draft,evidenceIds:[randomUUID()]}}),409,"unavailable evidence rejected");
  const key=randomUUID();let proposal=expect(await api(`${basePath}/proposals`,guest,{method:"POST",key,body:draft}),201,"draft create");const pp=`${basePath}/proposals/${proposal.id}`;
  if(expect(await api(`${basePath}/proposals`,guest,{method:"POST",key,body:draft}),200,"retry").id!==proposal.id)throw new Error("Proposal duplicate");
  expect(await api(pp,null),404,"draft private");expect(await api(pp,outsider),404,"non-author draft private");
  expect(await api(pp,owner),200,"admin can review draft");
  expect(await api(pp,owner,{method:"PATCH",version:proposal.version,body:draft}),403,"admin cannot edit author content");
  proposal=expect(await api(`${pp}/actions`,guest,{method:"POST",version:proposal.version,body:{action:"submit"}}),200,"submit");
  if(expect(await api(`${basePath}/proposals?scope=review`,owner),200,"review inbox").items.length!==1)throw new Error("Review inbox missing proposal");
  expect(await api(`${pp}/actions`,guest,{method:"POST",version:proposal.version,body:{action:"approve"}}),403,"participant approval denied");
  proposal=expect(await api(`${pp}/actions`,owner,{method:"POST",version:proposal.version,body:{action:"approve"}}),200,"approve");
  const published=expect(await api(`${pp}?view=published`,null),200,"share public");if(published.content.title!==draft.title)throw new Error("Published content missing");
  const extraDraft=expect(await api(`${basePath}/proposals`,guest,{method:"POST",key:randomUUID(),body:{...draft,title:"보관할 초안"}}),201,"archive fixture draft");
  const featureMap=expect(await api(basePath,owner),200,"feature map version");
  expect(await api(`${pp}?view=archive`,guest),403,"participant enabled archive detail denied");
  expect(await api(`${basePath}/emoji-options`,guest,{method:"PATCH",version:featureMap.version,body:{categoryKey:theme.categories[0].key,emojiKey:theme.categories[0].emojiOptions[0].key,active:false}}),403,"participant emoji toggle denied");
  expect(await api(basePath,guest,{method:"PATCH",version:featureMap.version,body:{proposalsEnabled:false}}),403,"participant feature toggle denied");
  const featureOff=expect(await api(basePath,owner,{method:"PATCH",version:featureMap.version,body:{proposalsEnabled:false}}),200,"disable proposal feature");
  if(expect(await api(`${basePath}/configuration`,owner),200,"disabled configuration").theme.features.proposalsEnabled!==false)throw new Error("Feature configuration was stale");
  for(const actor of [null,guest,owner])expect(await api(`${pp}?view=published`,actor),404,"disabled shared proposal denied");
  expect(await api(`${basePath}/proposals?scope=archive`,guest),404,"participant disabled archive denied");
  expect(await api(`${pp}?view=archive`,outsider),404,"outsider disabled archive denied");
  const kept=expect(await api(`${basePath}/proposals?scope=archive`,owner),200,"manager disabled archive");
  if(kept.items.length!==2||!kept.items.some(item=>item.id===extraDraft.id))throw new Error("Archive must preserve published and draft proposals");
  const keptDetail=expect(await api(`${pp}?view=archive`,owner),200,"read-only archive detail");
  if(keptDetail.canEdit||keptDetail.canReview||keptDetail.canDelete||keptDetail.canUnpublish||keptDetail.canSubmit)throw new Error("Disabled proposal retained write capability");
  expect(await api(pp,guest,{method:"PATCH",version:proposal.version,body:draft}),404,"disabled proposal edit denied");
  expect(await api(pp,owner,{method:"DELETE",version:proposal.version}),404,"disabled proposal delete denied");
  expect(await api(`${pp}/actions`,owner,{method:"POST",version:proposal.version,body:{action:"unpublish",reason:"검증"}}),404,"disabled proposal action denied");
  expect(await api(`${basePath}/proposals`,guest,{method:"POST",key:randomUUID(),body:draft}),404,"disabled proposal create denied");
  expect(await api(basePath,owner,{method:"PATCH",version:featureOff.version,body:{proposalsEnabled:true}}),200,"restore proposal feature");
  const restoredFeature=expect(await api(`${pp}?view=published`,null),200,"restored public proposal");
  if(restoredFeature.version!==proposal.version||restoredFeature.revision!==published.revision||restoredFeature.content.title!==published.content.title)throw new Error("Feature toggle mutated proposal history");
  expect(await api(`${basePath}/proposals/${extraDraft.id}`,guest,{method:"DELETE",version:extraDraft.version}),204,"remove archive fixture draft");
  if(process.env.PHASE6_UI_CHECK==="1"){
    const marker=".phase6-ui-check.json";
    writeFileSync(marker,JSON.stringify({mapUrl:`${base}/?map=${mapId}`,proposalUrl:`${base}/maps/${mapId}/proposals/${proposal.id}`}));
    console.log("Synthetic UI fixture ready; remove .phase6-ui-check.json to resume cleanup (10-minute maximum).");
    for(let i=0;i<600&&existsSync(marker);i++)await pause(1000);
    if(existsSync(marker))unlinkSync(marker);
  }
  const photo=await sharp({create:{width:10,height:10,channels:3,background:"green"}}).png().toBuffer();
  observations[0].version=expect(await api(`${basePath}/observations/${observations[0].id}/photo`,guest,{method:"POST",body:photo,mime:"image/png"}),201,"evidence photo update").version;
  if(expect(await api(`${pp}?view=published`,null),200,"photo invalidates evidence").evidence[0].state!=="changed")throw new Error("Photo change was not detected");
  const second={...draft,title:"아직 공유하지 않은 수정안"};
  const oldVersion=proposal.version;
  proposal=expect(await api(pp,guest,{method:"PATCH",version:proposal.version,body:second}),200,"new draft revision");
  if(proposal.revision!==2||proposal.status!=="draft")throw new Error("Revision not created");
  expect(await api(pp,guest,{method:"PATCH",version:oldVersion,body:second}),412,"stale edit rejected");
  if(expect(await api(`${pp}?view=published`,null),200,"old published intact").content.title!==draft.title)throw new Error("Draft overwrote shared version");
  const hidden=expect(await api(`${basePath}/observations/${observations[0].id}/moderation`,owner,{method:"POST",version:observations[0].version,body:{action:"hide",reason:"근거 변경 검사"}}),200,"hide evidence");
  const changed=expect(await api(`${pp}?view=published`,null),200,"changed evidence");if(changed.evidence[0].state!=="unavailable"||changed.evidence[0].body||changed.evidence[0].title||!changed.statsChanged)throw new Error("Hidden evidence leaked");
  if(expect(await api(`${basePath}/analysis`,null),200,"analysis after hide").stats.total!==4)throw new Error("Hidden record counted");
  expect(await api(`${pp}/actions`,guest,{method:"POST",version:proposal.version,body:{action:"submit"}}),409,"stale evidence rejected");
  proposal=expect(await api(pp,guest,{method:"PATCH",version:proposal.version,body:{...second,evidenceIds:[observations[1].id]}}),200,"refresh evidence");
  proposal=expect(await api(`${pp}/actions`,guest,{method:"POST",version:proposal.version,body:{action:"submit"}}),200,"resubmit");
  proposal=expect(await api(`${pp}/actions`,owner,{method:"POST",version:proposal.version,body:{action:"request_changes",reason:"기대 효과를 확인해 주세요"}}),200,"request changes");
  proposal=expect(await api(pp,guest,{method:"PATCH",version:proposal.version,body:{...second,evidenceIds:[observations[1].id]}}),200,"edit requested draft");
  proposal=expect(await api(`${pp}/actions`,guest,{method:"POST",version:proposal.version,body:{action:"submit"}}),200,"submit revision");
  proposal=expect(await api(`${pp}/actions`,owner,{method:"POST",version:proposal.version,body:{action:"approve"}}),200,"approve revision");
  if(expect(await api(`${pp}?view=published`,null),200,"new publication").revision!==2)throw new Error("New publication missing");
  expect(await api(`${basePath}/observations/${observations[2].id}/moderation`,owner,{method:"POST",version:observations[2].version,body:{action:"request_changes",reason:"재검수 검사"}}),200,"pending evidence excluded");
  expect(await api(`${basePath}/observations/${observations[3].id}`,guest,{method:"DELETE",version:observations[3].version}),204,"delete observation");
  if(expect(await api(`${basePath}/analysis`,null),200,"published-only totals").stats.total!==2)throw new Error("Pending or deleted observation counted");
  await admin.query("UPDATE app.map_members SET status='blocked' WHERE id=$1",[member.id]);
  expect(await api(pp,guest,{method:"PATCH",version:proposal.version,body:draft}),403,"blocked draft denied");
  expect(await api(`${basePath}/proposals?scope=mine`,guest),403,"blocked mine denied");
  await admin.query("UPDATE app.map_members SET status='active' WHERE id=$1",[member.id]);
  const currentMap=expect(await api(basePath,owner),200,"read map");
  expect(await api(basePath,owner,{method:"PATCH",version:currentMap.version,body:{visibility:"invite_only"}}),200,"private map");
  expect(await api(pp,null),404,"private share blocked");expect(await api(`${basePath}/analysis`,null),404,"private stats blocked");expect(await api(pp,guest),200,"private member share");
  proposal=expect(await api(`${pp}/actions`,owner,{method:"POST",version:proposal.version,body:{action:"unpublish",reason:"검증 완료"}}),200,"unpublish");
  if(expect(await api(`${basePath}/proposals?scope=archive`,owner),200,"archive inbox").items.length!==1)throw new Error("Archived proposal missing");
  expect(await api(`${basePath}/proposals?scope=archive`,guest),403,"participant archive denied");
  expect(await api(`${pp}?view=published`,guest),404,"shared pointer removed");
  expect(await api(pp,guest,{method:"DELETE",version:proposal.version}),204,"delete");expect(await api(pp,owner),404,"deleted proposal inaccessible");
  await admin.query(`WITH added AS (
    INSERT INTO app.proposals(map_id,author_member_id,request_key,request_hash,published_revision)
      SELECT $1,$2,gen_random_uuid(),decode('00','hex'),1 FROM generate_series(1,52) RETURNING id
  ) INSERT INTO app.proposal_versions(map_id,proposal_id,revision,status,content,evidence,snapshot)
    SELECT $1,added.id,1,'published',v.content,v.evidence,v.snapshot FROM added CROSS JOIN app.proposal_versions v WHERE v.proposal_id=$3 AND v.revision=1`,[mapId,member.id,proposal.id]);
  const page1=expect(await api(`${basePath}/proposals?scope=mine`,guest),200,"proposal first page");
  const page2=expect(await api(`${basePath}/proposals?scope=mine&cursor=${encodeURIComponent(page1.nextCursor)}`,guest),200,"proposal next page");
  if(page1.items.length!==50||page2.items.length!==2||new Set([...page1.items,...page2.items].map(i=>i.id)).size!==52||page2.nextCursor!==null)throw new Error("Proposal pagination skipped or duplicated rows");
  expect(await api(`${basePath}/proposals?cursor=bad`,guest),422,"invalid proposal cursor");
  await admin.query("UPDATE app.maps SET proposals_enabled=false WHERE id=$1",[mapId]);
  expect(await api(`${basePath}/proposals`,guest),404,"disabled proposals hidden");
  expect(await api(`${basePath}/proposals`,guest,{method:"POST",key:randomUUID(),body:draft}),404,"disabled proposals create denied");
  const ecology=expect(await api("/api/v1/maps",owner,{method:"POST",key:randomUUID(),body:{themeKey:"ecology",themeVersion:1,title:"6단계 생태 검증",locationLabel:"합성 지역",visibility:"public",proposalsEnabled:false}}),201,"ecology create");extraMapIds.push(ecology.id);
  const ecologyPath=`/api/v1/maps/${ecology.id}`,ecologyTheme=expect(await api(`${ecologyPath}/configuration`,owner),200,"ecology config").theme;
  const ecoInput={configRevision:1,title:"검증용 나무",body:"생태 지도 합성 기록입니다.",locationLabel:"합성 지역",locationSource:"manual",location:{lat:37.5,lng:127},categoryKey:ecologyTheme.categories[0].key,emojiKey:ecologyTheme.categories[0].emojiOptions[0].key,ratingKey:null,answers:{}};
  for(const q of ecologyTheme.questions.filter(q=>q.required))ecoInput.answers[q.key]=[q.type==="text"?"합성 응답":q.type==="boolean"?"yes":q.options[0].key];
  expect(await api(`${ecologyPath}/observations`,owner,{method:"POST",key:randomUUID(),body:ecoInput}),201,"ecology observation");
  const ecoStats=expect(await api(`${ecologyPath}/analysis`,null),200,"ecology analysis");if(ecoStats.stats.total!==1||ecoStats.stats.byRating!==null||ecoStats.stats.ratedCount!==null)throw new Error("Ecology has rating statistics");
  expect(await api(`${ecologyPath}/analysis?filter=${encodeURIComponent(JSON.stringify({rating:"positive"}))}`,null),422,"ecology rating filter denied");
  expect(await api(`${ecologyPath}/proposals`,owner),404,"ecology disabled proposals");
  console.log("Phase 6 live checks passed: filters, denominators, CSV, revisions, moderation, evidence and private sharing.");
}finally{
  if(actors.length){await admin.query("BEGIN");try{await admin.query("SET CONSTRAINTS ALL DEFERRED");for(const cleanupMapId of [mapId,...extraMapIds].filter(Boolean))for(const table of ["app.proposal_versions","app.proposals","app.audit_events","app.reports","app.comments","app.observation_photos","app.observations","app.map_config_revisions","app.question_versions","app.questions","app.rating_options","app.rating_schemes","app.emoji_options","app.categories","app.map_members","app.maps"]){await admin.query(`DELETE FROM ${table} WHERE ${table==="app.maps"?"id":"map_id"}=$1`,[cleanupMapId]);}await admin.query("DELETE FROM app_private.idempotency_keys WHERE principal_id=ANY($1::uuid[])",[actors.map(value=>value.principal)]);await admin.query("DELETE FROM app_private.sessions WHERE principal_id=ANY($1::uuid[])",[actors.map(value=>value.principal)]);await admin.query("DELETE FROM app.principals WHERE id=ANY($1::uuid[])",[actors.map(value=>value.principal)]);await admin.query("COMMIT");console.log("Synthetic test data removed");}catch(error){await admin.query("ROLLBACK");throw error;}}
  await admin.end();
}
