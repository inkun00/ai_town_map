import "server-only";
import {createHash} from "node:crypto";
import type {PoolClient} from "pg";
import {z} from "zod";
import {filterSchema,type AnalysisStats,type ObservationFilter} from "@/domain/analysis";
import type {AppSession} from "@/server/auth/session";
import {withTransaction} from "@/server/db";
import {ApiError} from "@/server/http";
import {audit,communityMap,isAdmin,requireAdmin,requireMember,type CommunityMap} from "./community-access";
import {readDataset} from "./analysis";

export const proposalInput=z.strictObject({title:z.string().trim().min(1).max(120),problem:z.string().trim().max(3000),solution:z.string().trim().max(3000),expectedEffect:z.string().trim().max(1500),responsibleParty:z.string().trim().max(500),followUp:z.string().trim().max(1500),evidenceIds:z.array(z.uuid()).max(30).refine(v=>new Set(v).size===v.length),filter:filterSchema});
type Input=z.infer<typeof proposalInput>;
type Snapshot={stats:AnalysisStats;filter:ObservationFilter;dataRevision:string;generatedAt:string;filterFingerprint:string};
type Evidence={id:string;version:string};
type ProposalRow={id:string;map_id:string;author_member_id:string;latest_revision:number;published_revision:number|null;version:string;deleted_at:Date|null;request_hash:Buffer};
type VersionRow={revision:number;status:"draft"|"in_review"|"published"|"archived";content:Omit<Input,"evidenceIds"|"filter">;evidence:Evidence[];snapshot:Snapshot;review_reason:string|null};

async function access(client:PoolClient,mapId:string,session:AppSession|null,write=false){
  const map=await communityMap(client,mapId,session);
  const setting=(await client.query<{proposals_enabled:boolean}>("SELECT proposals_enabled FROM app.maps WHERE id=$1",[mapId])).rows[0];
  if(!setting.proposals_enabled)throw new ApiError(404,"FEATURE_DISABLED","이 지도에서는 제안서를 사용하지 않습니다.");
  if(write){requireMember(map);if(map.status!=="active")throw new ApiError(403,"MAP_ARCHIVED","보관된 지도에서는 제안서를 바꿀 수 없습니다.");}
  return map;
}
async function rowOf(client:PoolClient,mapId:string,id:string,lock=false){const row=(await client.query<ProposalRow>(`SELECT * FROM app.proposals WHERE map_id=$1 AND id=$2 AND deleted_at IS NULL${lock?" FOR UPDATE":""}`,[mapId,id])).rows[0];if(!row)throw new ApiError(404,"NOT_FOUND","제안서를 찾을 수 없습니다.");return row;}
function isAuthor(row:ProposalRow,map:CommunityMap){return map.member_status==="active"&&row.author_member_id===map.member_id;}
function matchVersion(row:ProposalRow,version:string){if(row.version!==version)throw new ApiError(412,"VERSION_CHANGED","제안서가 다른 곳에서 바뀌었습니다. 다시 열어 주세요.");}
async function versionOf(client:PoolClient,row:ProposalRow,revision:number){return (await client.query<VersionRow>("SELECT * FROM app.proposal_versions WHERE proposal_id=$1 AND revision=$2",[row.id,revision])).rows[0];}
async function evidenceState(client:PoolClient,mapId:string,evidence:Evidence[]){
  const rows=(await client.query("SELECT o.id,o.title,o.body,o.version,o.status,p.id AS photo_id FROM app.observations o LEFT JOIN app.observation_photos p ON p.observation_id=o.id WHERE o.map_id=$1 AND o.id=ANY($2::uuid[])",[mapId,evidence.map(e=>e.id)])).rows;
  return evidence.map(e=>{const r=rows.find(r=>r.id===e.id);return !r||r.status!=="published"?{id:e.id,state:"unavailable" as const,title:null,body:null,photoUrl:null}:{id:e.id,state:r.version===e.version?"current" as const:"changed" as const,title:r.title as string,body:r.body as string,photoUrl:r.photo_id?`/api/v1/maps/${mapId}/observations/${e.id}/photo`:null};});
}
async function detail(client:PoolClient,row:ProposalRow,map:CommunityMap,session:AppSession|null,publishedOnly=false){
  const manager=isAdmin(map,session),author=isAuthor(row,map);
  const revision=(!publishedOnly&&(manager||author))?row.latest_revision:row.published_revision;
  if(revision===null)throw new ApiError(404,"NOT_FOUND","공유된 제안서를 찾을 수 없습니다.");
  const v=await versionOf(client,row,revision);
  const evidence=await evidenceState(client,row.map_id,v.evidence);
  const current=(await client.query<{data_revision:string}>("SELECT data_revision FROM app.maps WHERE id=$1",[row.map_id])).rows[0];
  return {id:row.id,mapId:row.map_id,version:row.version,revision,status:v.status,publishedRevision:row.published_revision,content:v.content,evidence,snapshot:v.snapshot,reviewReason:v.review_reason,statsChanged:current.data_revision!==v.snapshot.dataRevision,canEdit:author&&map.status==="active"&&v.status!=="in_review",canSubmit:author&&map.status==="active"&&v.status==="draft",canReview:manager&&map.status==="active"&&v.status==="in_review",canUnpublish:manager&&map.status==="active"&&row.published_revision!==null,canDelete:map.status==="active"&&(author||manager)};
}
async function prepare(client:PoolClient,mapId:string,session:AppSession,input:Input){
  const dataset=await readDataset(client,mapId,session,input.filter);
  const evidence=input.evidenceIds.map(id=>{const item=dataset.items.find(i=>i.id===id);if(!item)throw new ApiError(409,"EVIDENCE_UNAVAILABLE","근거가 현재 필터에서 보이지 않습니다. 기록과 필터를 다시 선택해 주세요.");return {id,version:item.version};});
  const {evidenceIds,filter,...content}=input;void evidenceIds;void filter;
  const snapshot:Snapshot={stats:dataset.stats,filter:dataset.filter,dataRevision:dataset.dataRevision,generatedAt:dataset.generatedAt,filterFingerprint:dataset.filterFingerprint};
  return {content,evidence,snapshot};
}
async function validateReady(client:PoolClient,row:ProposalRow,v:VersionRow){
  if(!v.content.problem.trim()||!v.content.solution.trim()||!v.evidence.length)throw new ApiError(422,"PROPOSAL_INCOMPLETE","문제·개선 제안과 근거 기록 1개 이상이 필요합니다.");
  const evidence=await evidenceState(client,row.map_id,v.evidence);
  const current=(await client.query<{data_revision:string}>("SELECT data_revision FROM app.maps WHERE id=$1",[row.map_id])).rows[0];
  if(evidence.some(e=>e.state!=="current")||current.data_revision!==v.snapshot.dataRevision)throw new ApiError(409,"EVIDENCE_CHANGED","기록이나 집계가 바뀌었습니다. 초안을 다시 저장해 근거를 확인해 주세요.");
}
export async function listProposals(mapId:string,session:AppSession|null,scope:"published"|"mine"|"review"|"archive",cursor?:string){
  return withTransaction(async client=>{const map=await access(client,mapId,session);if(scope==="mine")requireMember(map);if(scope==="review"||scope==="archive"){if(!session)throw new ApiError(401,"LOGIN_REQUIRED","로그인이 필요합니다.");requireAdmin(map,session);}
    let after:{at:string;id:string}|null=null;
    if(cursor){try{if(cursor.length>512)throw new Error();after=z.strictObject({at:z.iso.datetime(),id:z.uuid()}).parse(JSON.parse(Buffer.from(cursor,"base64url").toString("utf8")));}catch{throw new ApiError(422,"INVALID_CURSOR","제안서 목록을 다시 열어 주세요.");}}
    const rows=(await client.query(`SELECT p.id,p.version,p.latest_revision,p.published_revision,v.content->>'title' AS title,v.status,v.revision,p.updated_at,to_char(p.updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor_at
      FROM app.proposals p JOIN app.proposal_versions v ON v.proposal_id=p.id AND v.revision=CASE WHEN $2='published' THEN p.published_revision ELSE p.latest_revision END
      WHERE p.map_id=$1 AND p.deleted_at IS NULL AND (($2='published' AND p.published_revision IS NOT NULL) OR ($2='mine' AND p.author_member_id=$3) OR ($2='review' AND v.status='in_review') OR ($2='archive' AND p.published_revision IS NULL AND v.status='archived')) AND ($4::timestamptz IS NULL OR (p.updated_at,p.id)<($4,$5::uuid)) ORDER BY p.updated_at DESC,p.id DESC LIMIT 51`,[mapId,scope,map.member_id,after?.at??null,after?.id??null])).rows;
    return {items:rows.slice(0,50).map(r=>({id:r.id,title:r.title,status:r.status,version:r.version,revision:r.revision,publishedRevision:r.published_revision})),nextCursor:rows.length>50?Buffer.from(JSON.stringify({at:rows[49].cursor_at,id:rows[49].id})).toString("base64url"):null};
  });
}
export async function getProposal(mapId:string,id:string,session:AppSession|null,publishedOnly=false){return withTransaction(async client=>{await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");const map=await access(client,mapId,session);return detail(client,await rowOf(client,mapId,id),map,session,publishedOnly);});}
export async function createProposal(mapId:string,session:AppSession,key:string,input:Input){
  return withTransaction(async client=>{await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");const map=await access(client,mapId,session,true);const hash=createHash("sha256").update(JSON.stringify(input)).digest();
    const inserted=(await client.query<ProposalRow>("INSERT INTO app.proposals(map_id,author_member_id,request_key,request_hash) VALUES($1,$2,$3,$4) ON CONFLICT(map_id,author_member_id,request_key) DO NOTHING RETURNING *",[mapId,map.member_id,key,hash])).rows[0];
    if(!inserted){const previous=(await client.query<ProposalRow>("SELECT * FROM app.proposals WHERE map_id=$1 AND author_member_id=$2 AND request_key=$3",[mapId,map.member_id,key])).rows[0];if(!previous||previous.deleted_at||!previous.request_hash.equals(hash))throw new ApiError(409,"IDEMPOTENCY_CONFLICT","같은 요청 키의 제안서가 이미 있습니다.");return {proposal:await detail(client,previous,map,session),repeated:true};}
    const data=await prepare(client,mapId,session,input);
    await client.query("INSERT INTO app.proposal_versions(map_id,proposal_id,revision,status,content,evidence,snapshot) VALUES($1,$2,1,'draft',$3,$4,$5)",[mapId,inserted.id,JSON.stringify(data.content),JSON.stringify(data.evidence),JSON.stringify(data.snapshot)]);
    return {proposal:await detail(client,inserted,map,session),repeated:false};
  });
}
export async function updateProposal(mapId:string,id:string,session:AppSession,version:string,input:Input){
  return withTransaction(async client=>{await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");const map=await access(client,mapId,session,true);const row=await rowOf(client,mapId,id,true);matchVersion(row,version);if(!isAuthor(row,map))throw new ApiError(403,"AUTHOR_REQUIRED","작성자만 초안을 수정할 수 있습니다.");
    const previous=await versionOf(client,row,row.latest_revision);if(previous.status==="in_review")throw new ApiError(409,"IN_REVIEW","검토 중인 초안입니다. 관리자의 검토를 기다려 주세요.");
    const data=await prepare(client,mapId,session,input);
    if(previous.status!=="draft"){
      row.latest_revision++;
      await client.query("INSERT INTO app.proposal_versions(map_id,proposal_id,revision,status,content,evidence,snapshot) VALUES($1,$2,$3,'draft',$4,$5,$6)",[mapId,id,row.latest_revision,JSON.stringify(data.content),JSON.stringify(data.evidence),JSON.stringify(data.snapshot)]);
    }else await client.query("UPDATE app.proposal_versions SET content=$3,evidence=$4,snapshot=$5,review_reason=NULL WHERE proposal_id=$1 AND revision=$2",[id,row.latest_revision,JSON.stringify(data.content),JSON.stringify(data.evidence),JSON.stringify(data.snapshot)]);
    await client.query("UPDATE app.proposals SET latest_revision=$2,version=version+1,updated_at=now() WHERE id=$1",[id,row.latest_revision]);
    return detail(client,await rowOf(client,mapId,id),map,session);
  });
}
export const proposalAction=z.strictObject({action:z.enum(["submit","approve","request_changes","unpublish"]),reason:z.string().trim().max(500).optional()});
export async function actOnProposal(mapId:string,id:string,session:AppSession,version:string,action:z.infer<typeof proposalAction>){
  return withTransaction(async client=>{
    // Serialize against observation writers (which increment maps.data_revision).
    await client.query("SELECT id FROM app.maps WHERE id=$1 FOR UPDATE",[mapId]);
    const map=await access(client,mapId,session,true);const row=await rowOf(client,mapId,id,true);matchVersion(row,version);const v=await versionOf(client,row,row.latest_revision);
    if(action.action==="submit"){if(!isAuthor(row,map))throw new ApiError(403,"AUTHOR_REQUIRED","작성자만 검토를 요청할 수 있습니다.");if(v.status!=="draft")throw new ApiError(409,"STATUS_CHANGED","초안 상태를 확인해 주세요.");await validateReady(client,row,v);await client.query("UPDATE app.proposal_versions SET status='in_review' WHERE proposal_id=$1 AND revision=$2",[id,row.latest_revision]);}
    else {requireAdmin(map,session);
      if(action.action==="unpublish"){
        if(!row.published_revision)throw new ApiError(409,"STATUS_CHANGED","확정된 제안서가 없습니다.");if(!action.reason)throw new ApiError(422,"REASON_REQUIRED","공유 중단 사유를 입력해 주세요.");
        await client.query("UPDATE app.proposal_versions SET status='archived' WHERE proposal_id=$1 AND revision=$2",[id,row.published_revision]);await client.query("UPDATE app.proposals SET published_revision=NULL WHERE id=$1",[id]);
      }else{
        if(v.status!=="in_review")throw new ApiError(409,"STATUS_CHANGED","검토 요청 상태를 확인해 주세요.");
        if(action.action==="approve"){
          await validateReady(client,row,v);
          await client.query("UPDATE app.proposal_versions SET status='archived' WHERE proposal_id=$1 AND status='published'",[id]);
          await client.query("UPDATE app.proposal_versions SET status='published',review_reason=NULL WHERE proposal_id=$1 AND revision=$2",[id,row.latest_revision]);await client.query("UPDATE app.proposals SET published_revision=latest_revision WHERE id=$1",[id]);
        }else{if(!action.reason)throw new ApiError(422,"REASON_REQUIRED","수정 요청 사유를 입력해 주세요.");await client.query("UPDATE app.proposal_versions SET status='draft',review_reason=$3 WHERE proposal_id=$1 AND revision=$2",[id,row.latest_revision,action.reason]);}
      }
    }
    await client.query("UPDATE app.proposals SET version=version+1,updated_at=now() WHERE id=$1",[id]);await audit(client,mapId,session,`proposal_${action.action}`,"proposal",id,action.reason);
    return detail(client,await rowOf(client,mapId,id),map,session);
  });
}
export async function deleteProposal(mapId:string,id:string,session:AppSession,version:string){return withTransaction(async client=>{const map=await access(client,mapId,session,true);const row=await rowOf(client,mapId,id,true);matchVersion(row,version);if(!isAuthor(row,map)&&!isAdmin(map,session))throw new ApiError(403,"AUTHOR_REQUIRED","작성자 또는 관리자만 삭제할 수 있습니다.");await client.query("UPDATE app.proposals SET deleted_at=now(),published_revision=NULL,version=version+1 WHERE id=$1",[id]);await audit(client,mapId,session,"proposal_delete","proposal",id);});}
