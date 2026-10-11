"use client";

import {useCallback,useEffect,useId,useRef,useState} from "react";
import {
  aiSectionKeys,aiSectionLabels,aiSuggestionSectionsSchema,studentAnalysisInputSchema,
  type AiAvailability,type AiSectionKey,type AiSuggestions,type StudentAnalysisReport,
} from "@/domain/ai-analysis";
import {filterLabel,type ObservationFilter} from "@/domain/analysis";
import type {DemoPoint,Theme} from "@/lib/demo-data";
import {attachUnsavedRecordGuard} from "@/lib/unsaved-record-guard";

type Writing = {title:string;analysis:string;proposal:string;reasoning:string;followUp:string;evidenceIds:string[];status:"draft"|"final"};
type Judgment = "agree"|"different"|"need_check";
const emptyWriting = ():Writing => ({title:"",analysis:"",proposal:"",reasoning:"",followUp:"",evidenceIds:[],status:"draft"});
const writingOf = (report:StudentAnalysisReport|null):Writing => report ? {
  title:report.title,analysis:report.analysis,proposal:report.proposal,reasoning:report.reasoning,
  followUp:report.followUp,evidenceIds:[...report.evidenceIds],status:report.status,
} : emptyWriting();
const serialize = (value:Writing) => JSON.stringify(value);
const sectionIcons:Record<AiSectionKey,string> = {discoveries:"🔎",groups:"🧩",perspectives:"👥",questions:"🧭",improvements:"💡"};
const fieldInfo = [
  {key:"title",label:"내 글의 제목",hint:"예: 우리 학교 앞길을 더 편리하게 만드는 방법",limit:200},
  {key:"analysis",label:"내가 분석한 내용",hint:"기록에서 무엇을 발견했나요? 비슷한 점, 다른 점과 조사하지 못한 부분도 적어보세요.",limit:10000},
  {key:"proposal",label:"내가 제안하는 개선 방법",hint:"무엇을 어떻게 바꾸면 좋을까요? 내가 할 수 있는 일과 함께 해야 할 일을 생각해보세요.",limit:10000},
  {key:"reasoning",label:"이렇게 판단한 이유",hint:"어떤 기록이 근거인가요? AI 제안에 동의하거나 다르게 생각한 이유도 자신의 말로 적어보세요.",limit:10000},
  {key:"followUp",label:"다음에 더 확인할 것",hint:"아직 확실하지 않은 점과 다음 탐험에서 확인할 질문을 적어보세요.",limit:5000},
] as const;

class WorkspaceError extends Error {
  constructor(message:string,readonly status:number,readonly code?:string){super(message);}
}
async function api<T>(url:string,options:RequestInit={}):Promise<T> {
  const response=await fetch(url,{cache:"no-store",...options});
  const payload=await response.json();
  if(!response.ok)throw new WorkspaceError(payload.error?.message??"요청을 처리하지 못했어요. 잠시 뒤 다시 시도해 주세요.",response.status,payload.error?.code);
  return payload.data as T;
}
const errorMessage=(error:unknown,fallback:string)=>error instanceof Error?error.message:fallback;
const isAborted=(error:unknown)=>error instanceof Error&&error.name==="AbortError";

export type AiAnalysisWorkspaceProps = {
  mapId:string;theme:Theme;points:DemoPoint[];filter:ObservationFilter;dataRevision?:string;
  csrfToken?:string|null;isMember:boolean;active:boolean;dataReady:boolean;
  onShowPoint:(id:string)=>void;onNotice:(message:string)=>void;
  onDirtyChange?:(dirty:boolean)=>void;onBusyChange?:(busy:boolean)=>void;
  manageNavigationGuard?:boolean;isGuest?:boolean;
};

/** AI cards stay separate from the author's own writing; no suggestion is copied into a report. */
export function AiAnalysisWorkspace({mapId,theme,points,filter,dataRevision,csrfToken,isMember,active,dataReady,onShowPoint,onNotice,onDirtyChange,onBusyChange,manageNavigationGuard=false,isGuest=false}:AiAnalysisWorkspaceProps) {
  const id=useId();
  const [tab,setTab]=useState<"suggestions"|"writing">("suggestions");
  const [availability,setAvailability]=useState<AiAvailability|null>(null),[availabilityError,setAvailabilityError]=useState("");
  const [result,setResult]=useState<AiSuggestions|null>(null),[aiBusy,setAiBusy]=useState(false),[aiError,setAiError]=useState("");
  const resultRef=useRef(result);resultRef.current=result;
  const [stale,setStale]=useState(false);
  const [judgments,setJudgments]=useState<Record<string,Judgment>>({});
  const [form,setForm]=useState<Writing>(emptyWriting),[baseline,setBaseline]=useState(()=>serialize(emptyWriting()));
  const formRef=useRef(form);formRef.current=form;
  const [report,setReport]=useState<StudentAnalysisReport|null>(null),[loaded,setLoaded]=useState(false),[reportLoading,setReportLoading]=useState(false);
  const [saving,setSaving]=useState(false),[reportError,setReportError]=useState(""),[conflict,setConflict]=useState(false);
  const [latest,setLatest]=useState<StudentAnalysisReport|null|undefined>(undefined),[checking,setChecking]=useState(false);
  const mounted=useRef(false),reportSequence=useRef(0),aiSequence=useRef(0),saveBusy=useRef(false),aiBusyRef=useRef(false);
  const reportAbort=useRef<AbortController|null>(null),aiAbort=useRef<AbortController|null>(null),saveAbort=useRef<AbortController|null>(null),availabilityAbort=useRef<AbortController|null>(null);
  const callbacks=useRef({onNotice,onDirtyChange,onBusyChange});
  callbacks.current={onNotice,onDirtyChange,onBusyChange};
  const filterKey=JSON.stringify(filter),context=`${mapId}:${csrfToken??""}:${filterKey}:${dataRevision??""}`;
  const contextRef=useRef(context);contextRef.current=context;
  const base=`/api/v1/maps/${mapId}`;
  const published=points.filter(point=>!point.status||point.status==="published");
  const dirty=loaded&&serialize(form)!==baseline;
  const canWrite=isMember&&active&&!!csrfToken;

  useEffect(()=>{
    mounted.current=true;
    return ()=>{mounted.current=false;reportAbort.current?.abort();aiAbort.current?.abort();saveAbort.current?.abort();availabilityAbort.current?.abort();callbacks.current.onDirtyChange?.(false);callbacks.current.onBusyChange?.(false);};
  },[]);
  useEffect(()=>{callbacks.current.onDirtyChange?.(dirty);},[dirty]);
  useEffect(()=>{callbacks.current.onBusyChange?.(saving);},[saving]);
  useEffect(()=>{if(!manageNavigationGuard&&(dirty||saving))return attachUnsavedRecordGuard(window);},[dirty,saving,manageNavigationGuard]);

  const loadReport=useCallback(async()=>{
    const sequence=++reportSequence.current;
    reportAbort.current?.abort();const controller=new AbortController();reportAbort.current=controller;
    setReportLoading(true);setReportError("");
    try {
      const next=await api<StudentAnalysisReport|null>(`${base}/student-analysis`,{signal:controller.signal});
      if(!mounted.current||controller.signal.aborted||sequence!==reportSequence.current)return;
      const nextWriting=writingOf(next);
      setReport(next);setForm(nextWriting);setBaseline(serialize(nextWriting));setLoaded(true);setConflict(false);setLatest(undefined);
    } catch(error) {
      if(!mounted.current||controller.signal.aborted||sequence!==reportSequence.current||isAborted(error))return;
      setReportError(errorMessage(error,"저장한 글을 불러오지 못했어요."));setLoaded(false);
    } finally {if(mounted.current&&!controller.signal.aborted&&sequence===reportSequence.current)setReportLoading(false);}
  },[base]);

  useEffect(()=>{
    reportSequence.current++;reportAbort.current?.abort();saveAbort.current?.abort();saveBusy.current=false;
    setForm(emptyWriting());setBaseline(serialize(emptyWriting()));setReport(null);setLoaded(false);setReportError("");setConflict(false);setLatest(undefined);setSaving(false);setChecking(false);
    if(isMember)void loadReport();else setReportLoading(false);
  },[mapId,isMember,csrfToken,loadReport]);

  const loadAvailability=useCallback(async()=>{
    availabilityAbort.current?.abort();const controller=new AbortController();availabilityAbort.current=controller;
    setAvailability(null);setAvailabilityError("");
    try {
      const next=await api<AiAvailability>(`${base}/ai-suggestions`,{signal:controller.signal});
      if(mounted.current&&!controller.signal.aborted)setAvailability(next);
    } catch(error) {
      if(mounted.current&&!controller.signal.aborted&&!isAborted(error))setAvailabilityError(errorMessage(error,"AI 연결 상태를 확인하지 못했어요."));
    }
  },[base]);
  useEffect(()=>{if(isMember)void loadAvailability();else{availabilityAbort.current?.abort();setAvailability(null);setAvailabilityError("");}},[isMember,csrfToken,loadAvailability]);
  useEffect(()=>{
    aiSequence.current++;aiAbort.current?.abort();aiBusyRef.current=false;setAiBusy(false);setAiError("");setJudgments({});
    if(resultRef.current)setStale(true);setResult(null);
  },[context]);

  async function generate() {
    if(aiBusyRef.current||!canWrite||!dataReady||!availability?.ready||!published.length)return;
    const sequence=++aiSequence.current,requestContext=context;
    aiAbort.current?.abort();const controller=new AbortController();aiAbort.current=controller;
    aiBusyRef.current=true;setAiBusy(true);setAiError("");
    try {
      const next=await api<AiSuggestions>(`${base}/ai-suggestions`,{
        method:"POST",signal:controller.signal,headers:{"Content-Type":"application/json","X-CSRF-Token":csrfToken??""},
        body:JSON.stringify({filter}),
      });
      if(!mounted.current||controller.signal.aborted||sequence!==aiSequence.current||contextRef.current!==requestContext)return;
      aiSuggestionSectionsSchema.parse(next.sections);
      if(dataRevision&&next.dataRevision!==dataRevision){setStale(true);setResult(null);setAiError("제안 생성 중 지도 기록이 바뀌었어요. 통계를 새로고침한 뒤 다시 제안을 받아주세요.");return;}
      setResult(next);setJudgments({});setStale(false);callbacks.current.onNotice("AI 참고 제안이 준비됐어요. 원본 기록을 보고 직접 판단해 주세요.");
    } catch(error) {
      if(mounted.current&&!controller.signal.aborted&&sequence===aiSequence.current&&!isAborted(error))setAiError(errorMessage(error,"AI 제안을 받아오지 못했어요."));
    } finally {if(mounted.current&&!controller.signal.aborted&&sequence===aiSequence.current){aiBusyRef.current=false;setAiBusy(false);}}
  }

  async function save(status:"draft"|"final") {
    if(saveBusy.current||!canWrite||!loaded||conflict||!dataReady)return;
    const body={...form,status,expectedVersion:report?.version??0};
    const parsed=studentAnalysisInputSchema.safeParse(body);
    if(!parsed.success){setReportError("최종 글에는 제목, 내 분석, 개선 방법, 판단 이유와 근거 기록을 모두 작성해 주세요.");return;}
    saveBusy.current=true;setSaving(true);setReportError("");
    const controller=new AbortController();saveAbort.current=controller;
    const sequence=reportSequence.current;
    try {
      const next=await api<StudentAnalysisReport>(`${base}/student-analysis`,{method:"PUT",signal:controller.signal,headers:{"Content-Type":"application/json","X-CSRF-Token":csrfToken??""},body:JSON.stringify(parsed.data)});
      if(!mounted.current||controller.signal.aborted||sequence!==reportSequence.current)return;
      const nextWriting=writingOf(next);setReport(next);setForm(nextWriting);setBaseline(serialize(nextWriting));setLatest(undefined);
      callbacks.current.onNotice(status==="final"?"내가 판단하고 작성한 최종 글을 저장했어요. 나에게만 보이는 글이에요.":"나의 분석 글 초안을 저장했어요.");
    } catch(error) {
      if(!mounted.current||controller.signal.aborted||sequence!==reportSequence.current||isAborted(error))return;
      const uncertain=!(error instanceof WorkspaceError)||error.status>=500;
      if(uncertain||(error instanceof WorkspaceError&&error.code==="VERSION_CHANGED"))setConflict(true);
      setReportError(uncertain?"저장 결과를 확인하지 못했어요. 작성한 글은 그대로 있어요. 최신 저장본을 확인한 뒤 다시 진행해 주세요.":errorMessage(error,"글을 저장하지 못했어요."));
    } finally {if(mounted.current&&!controller.signal.aborted&&sequence===reportSequence.current){saveBusy.current=false;setSaving(false);}}
  }

  async function checkLatest() {
    if(checking||saving)return;setChecking(true);setReportError("");
    const sequence=reportSequence.current;reportAbort.current?.abort();const controller=new AbortController();reportAbort.current=controller;
    try {
      const next=await api<StudentAnalysisReport|null>(`${base}/student-analysis`,{signal:controller.signal});
      if(!mounted.current||controller.signal.aborted||sequence!==reportSequence.current)return;
      setLatest(next);
      // If the server already saved this exact text, resolve a lost response without another write.
      if(next&&serialize(writingOf(next))===serialize({...formRef.current,status:next.status})){const nextWriting=writingOf(next);setReport(next);setForm(nextWriting);setBaseline(serialize(nextWriting));setConflict(false);setLatest(undefined);callbacks.current.onNotice("작성한 글이 이미 저장된 것을 확인했어요.");}
    } catch(error) {if(mounted.current&&!controller.signal.aborted&&sequence===reportSequence.current&&!isAborted(error))setReportError(errorMessage(error,"최신 저장본을 확인하지 못했어요."));}
    finally {if(mounted.current&&!controller.signal.aborted&&sequence===reportSequence.current)setChecking(false);}
  }
  function useLatest() {
    if(latest===undefined||saving)return;
    if(dirty&&!window.confirm("지금 작성한 내용을 버리고 최신 저장본을 불러올까요? 필요하면 먼저 내 글을 파일로 저장해 주세요."))return;
    const next=writingOf(latest);setForm(next);setBaseline(serialize(next));setReport(latest);setConflict(false);setLatest(undefined);setReportError("");
  }
  function toggleEvidence(pointId:string,checked:boolean) {setForm(current=>({...current,evidenceIds:checked?[...current.evidenceIds,pointId]:current.evidenceIds.filter(value=>value!==pointId),status:"draft"}));}
  function exportWriting() {
    const text=[form.title||"나의 분석 글",...fieldInfo.filter(field=>field.key!=="title").flatMap(field=>["",field.label,form[field.key]]),"","근거 기록",...form.evidenceIds.map(pointId=>{const point=points.find(item=>item.id===pointId);return `${point?.title??"현재 목록 밖의 근거"} (${pointId})`;}),"","이 글은 내가 직접 판단하고 작성한 내용입니다."].join("\n");
    const url=URL.createObjectURL(new Blob([text],{type:"text/plain;charset=utf-8"}));const link=document.createElement("a");link.href=url;link.download="나의-분석-글.txt";link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }

  return <section className="ai-workspace" aria-labelledby={`${id}-heading`}>
    <header className="ai-workspace__heading"><span aria-hidden="true">🧠</span><div><h2 id={`${id}-heading`}>AI와 생각을 넓히고, 내 글로 정리해요</h2><p>AI가 제안하고, 내가 확인하고 판단해요.</p></div></header>
    <div className="ai-workspace__tabs" role="tablist" aria-label="AI 참고와 나의 글">
      <button type="button" role="tab" id={`${id}-suggestions-tab`} aria-controls={`${id}-suggestions-panel`} aria-selected={tab==="suggestions"} tabIndex={tab==="suggestions"?0:-1} onKeyDown={event=>{if(event.key==="ArrowRight"||event.key==="ArrowLeft"){event.preventDefault();setTab("writing");document.getElementById(`${id}-writing-tab`)?.focus();}}} onClick={()=>setTab("suggestions")}>💡 AI 참고 제안</button>
      <button type="button" role="tab" id={`${id}-writing-tab`} aria-controls={`${id}-writing-panel`} aria-selected={tab==="writing"} tabIndex={tab==="writing"?0:-1} onKeyDown={event=>{if(event.key==="ArrowRight"||event.key==="ArrowLeft"){event.preventDefault();setTab("suggestions");document.getElementById(`${id}-suggestions-tab`)?.focus();}}} onClick={()=>setTab("writing")}>✏️ 나의 최종 글{dirty&&<span aria-label="저장하지 않은 내용"> ●</span>}</button>
    </div>
    {!isMember?<p className="ai-workspace__notice">지도에 참여하면 AI 참고 제안과 나만의 분석 글을 이용할 수 있어요. 지도 참여 버튼으로 먼저 입장해 주세요.</p>:<>
      <div role="tabpanel" id={`${id}-suggestions-panel`} aria-labelledby={`${id}-suggestions-tab`} hidden={tab!=="suggestions"}>
        <p className="ai-workspace__notice"><strong>AI 내용은 결론이나 정답이 아닌 참고 제안이에요.</strong> 원본 기록과 실제 상황을 확인하고, 마지막 분석과 개선 글은 내가 직접 작성해요. 제안은 내 글에 자동으로 들어가지 않아요.</p>
        <p className="ai-workspace__scope">{theme.label} · {filterLabel(filter,theme)}</p>
        <p className="help-text">사용자가 작성한 텍스트와 선택한 평가·응답을 바탕으로 현재 조건의 최신 기록 최대 50건을 살펴봐요. 더 오래된 기록은 날짜 조건을 바꿔서 살펴볼 수 있어요.</p>
        {!active&&<p className="ai-workspace__notice">활동이 종료된 지도에서는 새로운 AI 제안을 만들거나 글을 저장할 수 없어요. 저장한 글은 확인할 수 있어요.</p>}
        {availabilityError&&<div className="ai-workspace__error" role="alert"><p>{availabilityError}</p><button type="button" onClick={()=>void loadAvailability()}>연결 상태 다시 확인</button></div>}
        {!availability&&!availabilityError&&<p role="status">AI 연결 상태를 확인하고 있어요…</p>}
        {availability&&!availability.ready&&<p className="ai-workspace__notice" role="status"><strong>AI 연결 준비 중</strong><br/>{availability.reason} 나의 글은 직접 작성하고 저장할 수 있어요.</p>}
        {aiError&&<p className="ai-workspace__error" role="alert">{aiError}</p>}
        {stale&&<p className="ai-workspace__notice" role="status">지도 기록이나 분석 조건이 바뀌어 이전 AI 제안을 숨겼어요. 현재 조건으로 다시 받아주세요.</p>}
        {!dataReady&&<p role="status">현재 조건의 기록을 불러오고 있어요…</p>}
        {dataReady&&!published.length&&<p className="help-text">현재 조건에 맞는 게시 기록이 없어요. 조건을 바꾸거나 관찰 기록을 먼저 모아주세요.</p>}
        <button type="button" className="button button--primary button--full" disabled={aiBusy||!canWrite||!dataReady||!availability?.ready||!published.length} onClick={()=>void generate()}>{aiBusy?"AI가 참고 제안을 준비하고 있어요…":result?"현재 기록으로 제안 다시 받기":"AI 참고 제안 받기"}</button>
        {result?<><p className="ai-workspace__scope" role="status">현재 조건의 {result.totalRecords}건 중 {result.analyzedRecords}건을 참고했어요. 등록된 기록의 제안이며 동네 전체의 결론이 아니에요.</p><div className="ai-workspace__sections">{aiSectionKeys.map(section=><details key={section} className="ai-workspace__section" open={section==="discoveries"}><summary><span aria-hidden="true">{sectionIcons[section]}</span>{aiSectionLabels[section]}<span>{result.sections[section].length}개</span></summary>{result.sections[section].map((card,index)=>{const cardKey=`${section}-${index}`;return <article className="ai-workspace__card" key={cardKey}><span className="ai-workspace__badge">AI의 참고 제안</span><h3>{card.title}</h3><p>{card.suggestion}</p><div className="ai-workspace__sources"><strong>근거 확인</strong>{card.evidenceIds.map(pointId=><button key={pointId} type="button" onClick={()=>onShowPoint(pointId)}>{points.find(point=>point.id===pointId)?.title??"원본 기록 보기"} ↗</button>)}</div><p className="ai-workspace__question"><strong>직접 확인할 질문</strong><br/>{card.checkQuestion}</p><fieldset className="ai-workspace__judgment"><legend>이 제안에 대한 내 생각 <small>선택 사항 · 아직 최종 글이 아니에요</small></legend>{([{key:"agree",label:"동의해요"},{key:"different",label:"다르게 생각해요"},{key:"need_check",label:"더 확인할래요"}] as const).map(choice=><label key={choice.key}><input type="radio" name={`${id}-${cardKey}`} value={choice.key} checked={judgments[cardKey]===choice.key} onChange={()=>setJudgments(current=>({...current,[cardKey]:choice.key}))}/>{choice.label}</label>)}</fieldset></article>})}</details>)}</div><p className="help-text">제안 카드에 표시한 내 생각은 이번 화면에서만 유지돼요. 중요한 판단과 이유는 나의 최종 글에 직접 적어주세요.</p><button type="button" className="button button--light button--full" onClick={()=>setTab("writing")}>제안을 참고해 내 글 직접 쓰기</button></>:<div className="ai-workspace__feature-list" aria-label="AI가 제안하는 내용">{aiSectionKeys.map(section=><span key={section}>{sectionIcons[section]} {aiSectionLabels[section]}</span>)}</div>}
      </div>
      <div role="tabpanel" id={`${id}-writing-panel`} aria-labelledby={`${id}-writing-tab`} hidden={tab!=="writing"}>
        <p className="ai-workspace__notice"><strong>나의 판단과 나의 말로 작성해요.</strong> AI 제안과 원본 기록을 참고할 수 있지만, 아래 글은 내가 직접 작성해야 해요. 저장한 글은 나에게만 보이고 전체 지도와 다른 사람의 기록을 바꾸지 않아요.</p>
        {isGuest&&<p className="ai-workspace__notice">계정 없이 참여한 글은 현재 브라우저의 참여 정보로만 다시 열 수 있어요. 다른 기기에서도 내 글을 이어 쓰려면 회원 계정으로 로그인한 뒤 작성해 주세요. 지금 글은 텍스트 파일로 보관할 수도 있어요.</p>}
        {reportLoading&&<p role="status">내가 저장한 글을 확인하고 있어요…</p>}
        {reportError&&<p className="ai-workspace__error" role="alert">{reportError}</p>}
        {!loaded&&!reportLoading&&<button type="button" className="button button--light" onClick={()=>void loadReport()}>저장한 글 다시 불러오기</button>}
        {report&&<p className="ai-workspace__scope">{report.status==="final"?"내가 작성한 최종 글":"작성 중인 초안"} · {new Date(report.updatedAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}{dataRevision&&report.dataRevision!==dataRevision&&" · 저장 뒤 지도 기록이 바뀌었어요. 근거를 다시 확인해 주세요."}</p>}
        <form className="ai-workspace__writing" aria-label="나의 최종 분석 글" onSubmit={event=>{event.preventDefault();void save("draft");}}>
          <fieldset disabled={!loaded||saving||!canWrite}>
            {fieldInfo.map(field=><label className="field" key={field.key}><span>{field.label}{field.key!=="followUp"&&<small> · 최종 저장 시 필요</small>}</span>{field.key==="title"?<input value={form.title} maxLength={field.limit} placeholder={field.hint} onChange={event=>setForm(current=>({...current,title:event.target.value,status:"draft"}))}/>:<textarea rows={5} value={form[field.key]} maxLength={field.limit} placeholder={field.hint} onChange={event=>setForm(current=>({...current,[field.key]:event.target.value,status:"draft"}))}/>}</label>)}
            <h3>내 판단의 근거 기록 <small>{form.evidenceIds.length}/30</small></h3><p className="help-text">현재 분석 조건의 기록 중 내 글의 근거를 골라요. 원본 내용을 읽고 판단해 주세요.</p>
            <div className="ai-workspace__evidence">{published.map(point=><div key={point.id}><label><input type="checkbox" checked={form.evidenceIds.includes(point.id)} disabled={!form.evidenceIds.includes(point.id)&&form.evidenceIds.length>=30} onChange={event=>toggleEvidence(point.id,event.target.checked)}/><span>{point.title}<small>등록일 {point.date}</small></span></label><button type="button" onClick={()=>onShowPoint(point.id)}>원본 보기</button></div>)}{!published.length&&<p className="help-text">현재 조건에 보이는 게시 기록이 없어요.</p>}</div>
            {form.evidenceIds.filter(pointId=>!published.some(point=>point.id===pointId)).map(pointId=><div className="ai-workspace__notice" key={pointId}>현재 조건에서 보이지 않는 선택 근거가 있어요. 삭제하지 않고 유지했어요.<button type="button" onClick={()=>toggleEvidence(pointId,false)}>이 근거 해제</button></div>)}
          </fieldset>
          {conflict&&<div className="ai-workspace__notice"><p>다른 곳에서 저장됐거나 저장 결과가 확인되지 않았어요. 내가 입력한 글을 유지하고 있어요. 최신 저장본을 확인해 주세요.</p><button type="button" disabled={checking||saving} onClick={()=>void checkLatest()}>{checking?"최신 저장본 확인 중…":"최신 저장본 확인"}</button>{latest!==undefined&&<><p>{latest?`최신 저장본: ${latest.title||"제목 없는 초안"} · ${new Date(latest.updatedAt).toLocaleString("ko-KR",{timeZone:"Asia/Seoul"})}`:"서버에 저장된 글이 없어요."}</p><button type="button" onClick={useLatest}>최신 저장본으로 바꾸기</button></>}</div>}
          <div className="ai-workspace__save-actions"><button type="submit" className="button button--light" disabled={!canWrite||!loaded||saving||conflict||!dataReady}>초안 저장</button><button type="button" className="button button--primary" disabled={!canWrite||!loaded||saving||conflict||!dataReady} onClick={()=>void save("final")}>{saving?"저장 중…":"내 최종 글 저장"}</button></div>
          <button type="button" className="ai-workspace__download" disabled={!loaded} onClick={exportWriting}>내 글을 텍스트 파일로 저장</button>
        </form>
      </div>
    </>}
  </section>;
}
