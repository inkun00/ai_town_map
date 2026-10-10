"use client";

import {useEffect,useMemo,useRef,useState,type ChangeEvent,type FormEvent} from "react";
import type {DemoPoint,Theme} from "@/lib/demo-data";
import {recordEmojiOptions} from "@/lib/emoji-catalog";
import {preparePhoto,uploadPreparedPhoto,UploadError} from "@/lib/photo-upload";
import type {Coordinates} from "./KakaoMap";
import {EmojiPicker} from "./EmojiPicker";
import {RecordLocationPicker} from "./RecordLocationPicker";
import {RecordQuestionInputs} from "./RecordQuestionInputs";

export type InlineObservation={id:string;mapId:string;title:string;body:string;locationLabel:string;locationSource:"gps"|"search"|"manual";location:Coordinates;categoryKey:string;emojiKey:string;ratingKey:string|null;answers:Record<string,string[]>;improvementIdea:string|null;link:string|null;status:"pending"|"published"|"hidden"|"deleted";version:string;createdAt:string;author:string;canEdit:boolean;canDelete:boolean;photoUrl:string|null};
type Draft={title:string;body:string;locationLabel:string;location:Coordinates|null;locationSource:"gps"|"search"|"manual";categoryKey:string;emojiKey:string;ratingKey:string;answers:Record<string,string[]>;idea:string;link:string};
type Payload=Omit<Draft,"idea"|"link"|"ratingKey"|"location">&{configRevision:number;location:Coordinates;ratingKey:string|null;improvementIdea?:string;link?:string};
type PendingRequest={payload:Payload;version:string};
export type InlineRecordEditorProps={point:DemoPoint;theme:Theme;mapId:string;configRevision:number;csrfToken:string;center?:Coordinates|null;onSaved:(point:unknown)=>void;onNotice:(message:string)=>void;onDirtyChange?:(dirty:boolean)=>void;onBusyChange?:(busy:boolean)=>void};

function initialDraft(point:DemoPoint):Draft{return {title:point.title,body:point.body,locationLabel:point.locationLabel??"",location:point.location??null,locationSource:point.locationSource??"manual",categoryKey:point.categoryKey,emojiKey:point.emojiKey,ratingKey:point.ratingKey??"",answers:structuredClone(point.rawAnswers??{}),idea:point.idea??"",link:point.link??""};}
function stable(value:unknown):string{
  if(Array.isArray(value))return `[${value.map(stable).join(",")}]`;
  if(value&&typeof value==="object")return "{"+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>`${JSON.stringify(key)}:${stable(item)}`).join(",")+"}";
  return JSON.stringify(value)??"null";
}
function matchesSaved(record:InlineObservation,payload:Payload){return stable({title:record.title,body:record.body,locationLabel:record.locationLabel,locationSource:record.locationSource,location:record.location,categoryKey:record.categoryKey,emojiKey:record.emojiKey,ratingKey:record.ratingKey,answers:record.answers,improvementIdea:record.improvementIdea||null,link:record.link||null})===stable({title:payload.title,body:payload.body,locationLabel:payload.locationLabel,locationSource:payload.locationSource,location:payload.location,categoryKey:payload.categoryKey,emojiKey:payload.emojiKey,ratingKey:payload.ratingKey,answers:payload.answers,improvementIdea:payload.improvementIdea||null,link:payload.link||null});}

/** This editor stays inside the existing detail sheet; only the location picker opens full screen. */
export function InlineRecordEditor({point,theme,mapId,configRevision,csrfToken,center,onSaved,onNotice,onDirtyChange,onBusyChange}:InlineRecordEditorProps){
  const [draft,setDraft]=useState<Draft>(()=>initialDraft(point));
  const [baseline,setBaseline]=useState(()=>stable(initialDraft(point)));
  const [editorTheme,setEditorTheme]=useState(theme);
  const [saving,setSaving]=useState(false),[preparing,setPreparing]=useState(false);
  const [photo,setPhoto]=useState<File|null>(null),[photoName,setPhotoName]=useState(""),[photoInfo,setPhotoInfo]=useState("");
  const [savedPhotoRecord,setSavedPhotoRecord]=useState<InlineObservation|null>(null);
  const [uncertain,setUncertain]=useState(false),[conflict,setConflict]=useState(false),[latest,setLatest]=useState<InlineObservation|null>(null);
  const [error,setError]=useState(""),[progress,setProgress]=useState<number|null>(null),[locationOpen,setLocationOpen]=useState(false);
  const versionRef=useRef(point.version??""),revisionRef=useRef(configRevision),requestRef=useRef<PendingRequest|null>(null);
  const busyRef=useRef(false),selection=useRef(0),mounted=useRef(true);
  const callbacks=useRef({onSaved,onNotice,onDirtyChange,onBusyChange});callbacks.current={onSaved,onNotice,onDirtyChange,onBusyChange};
  const busy=saving||preparing;
  const dirty=stable(draft)!==baseline||!!photo||uncertain;
  const selectedCategory=editorTheme.categories.find(category=>category.key===draft.categoryKey);
  const emojiOptions=useMemo(()=>recordEmojiOptions(selectedCategory?.emojiOptions??[],draft.categoryKey===point.categoryKey?point.emojiKey:undefined),[selectedCategory,point.categoryKey,point.emojiKey,draft.categoryKey]);
  useEffect(()=>{if(configRevision>=revisionRef.current){revisionRef.current=configRevision;setEditorTheme(theme);}},[configRevision,theme]);
  useEffect(()=>{callbacks.current.onDirtyChange?.(dirty);},[dirty]);
  useEffect(()=>{callbacks.current.onBusyChange?.(busy);},[busy]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;selection.current++;callbacks.current.onDirtyChange?.(false);callbacks.current.onBusyChange?.(false);};},[]);
  function change<K extends keyof Draft>(key:K,value:Draft[K]){setDraft(previous=>({...previous,[key]:value}));setError("");}
  function startBusy(){busyRef.current=true;setSaving(true);setError("");setProgress(null);}
  function endBusy(){busyRef.current=false;if(mounted.current){setSaving(false);setProgress(null);}}
  function clearPhoto(){selection.current++;setPhoto(null);setPhotoName("");setPhotoInfo("");setSavedPhotoRecord(null);setError("");if(savedPhotoRecord)callbacks.current.onNotice("본문 수정은 저장됐고, 사진 재전송을 취소했어요.");}
  async function choosePhoto(event:ChangeEvent<HTMLInputElement>){
    const file=event.target.files?.[0];event.target.value="";if(!file||busyRef.current)return;
    const generation=++selection.current;busyRef.current=true;setPreparing(true);setError("");
    try{const prepared=await preparePhoto(file);if(!mounted.current||generation!==selection.current)return;setPhoto(prepared);setPhotoName(file.name);setPhotoInfo(`${(file.size/1024/1024).toFixed(1)}MB → ${(prepared.size/1024/1024).toFixed(2)}MB · 전송 준비 완료`);}
    catch(reason){if(mounted.current&&generation===selection.current)setError(reason instanceof Error?reason.message:"사진을 준비하지 못했습니다.");}
    finally{if(generation===selection.current){busyRef.current=false;if(mounted.current)setPreparing(false);}}
  }
  function payload():Payload|null{
    if(!point.canEdit||!versionRef.current||!csrfToken){setError("이 기록을 수정할 권한을 확인해 주세요.");return null;}
    if(!draft.title.trim()||!draft.locationLabel.trim()||!draft.location||!draft.categoryKey||!draft.emojiKey||draft.body.trim().length<10||(editorTheme.features.ratingEnabled&&!draft.ratingKey)||editorTheme.questions.some(question=>question.required&&!(draft.answers[question.key]?.[0]??"").trim())){setError("장소 이름, 제목, 유형, 관찰 내용과 필수 질문을 확인해 주세요.");return null;}
    if(draft.link.trim()){try{const url=new URL(draft.link.trim());if(!["http:","https:"].includes(url.protocol)||url.username||url.password)throw new Error();}catch{setError("링크는 아이디·비밀번호가 없는 http 또는 https 주소로 입력해 주세요.");return null;}}
    const answers=Object.fromEntries(editorTheme.questions.map(question=>[question.key,draft.answers[question.key]??[]]));
    return {configRevision:revisionRef.current,title:draft.title.trim(),body:draft.body.trim(),locationLabel:draft.locationLabel.trim(),locationSource:draft.locationSource,location:draft.location,categoryKey:draft.categoryKey,emojiKey:draft.emojiKey,ratingKey:editorTheme.features.ratingEnabled?draft.ratingKey:null,answers,improvementIdea:editorTheme.features.ideasEnabled?draft.idea.trim():undefined,link:draft.link.trim()||undefined};
  }
  async function finishSaved(record:InlineObservation){
    if(!mounted.current)return;
    requestRef.current=null;setUncertain(false);setConflict(false);setLatest(null);versionRef.current=record.version;
    setBaseline(stable(draft));callbacks.current.onSaved(record);
    if(photo){
      setSavedPhotoRecord(record);
      try{const result=await uploadPreparedPhoto(`/api/v1/maps/${encodeURIComponent(mapId)}/observations/${encodeURIComponent(record.id)}/photo`,photo,csrfToken,value=>{if(mounted.current)setProgress(value);});if(!mounted.current)return;const updated={...record,...result};versionRef.current=updated.version;callbacks.current.onSaved(updated);setPhoto(null);setPhotoName("");setPhotoInfo("");setSavedPhotoRecord(null);callbacks.current.onNotice(updated.status==="pending"?"수정 내용과 사진이 제출됐어요. 검수 후 공개됩니다.":"수정 내용과 사진이 저장됐어요.");}
      catch(reason){if(mounted.current)setError(`본문 수정은 저장됐습니다. ${reason instanceof Error?reason.message:"사진 교체를 다시 시도해 주세요."}`);}
    }else callbacks.current.onNotice(record.status==="pending"?"수정한 기록이 제출됐어요. 검수 후 공개됩니다.":"수정한 기록이 저장됐어요.");
  }
  async function save(event:FormEvent<HTMLFormElement>){
    event.preventDefault();if(busyRef.current||savedPhotoRecord||uncertain||conflict||locationOpen)return;
    const input=payload();if(!input)return;
    startBusy();const request={payload:input,version:versionRef.current};requestRef.current=request;
    try{const response=await fetch(`/api/v1/maps/${encodeURIComponent(mapId)}/observations/${encodeURIComponent(point.id)}`,{method:"PATCH",headers:{"Content-Type":"application/json","X-CSRF-Token":csrfToken,"X-Resource-Version":`"${request.version}"`},body:JSON.stringify(input),signal:AbortSignal.timeout(30000)});const result=await response.json();
      if(!response.ok){if(response.status<500)requestRef.current=null;if(response.status===409||response.status===412)setConflict(true);throw new UploadError(result.error?.message??"수정 내용을 저장하지 못했습니다.",response.status);}
      await finishSaved(result.data as InlineObservation);
    }catch(reason){if(mounted.current){if(requestRef.current)setUncertain(true);setError(reason instanceof Error?reason.message:"저장 결과를 확인하지 못했습니다. 입력 내용을 유지했어요.");}}
    finally{endBusy();}
  }
  async function retryPhoto(){if(!savedPhotoRecord||!photo||busyRef.current)return;startBusy();try{await finishSaved(savedPhotoRecord);}finally{endBusy();}}
  async function checkLatest(){
    if(busyRef.current)return;startBusy();
    try{const base=`/api/v1/maps/${encodeURIComponent(mapId)}`;const responses=await Promise.all([fetch(`${base}/observations/${encodeURIComponent(point.id)}`,{cache:"no-store"}),fetch(`${base}/configuration`,{cache:"no-store"})]);const [recordPayload,configuration]=await Promise.all(responses.map(response=>response.json()));
      if(!responses[0].ok||!responses[1].ok)throw new UploadError(recordPayload.error?.message??configuration.error?.message??"최신 기록을 확인하지 못했습니다.",!responses[0].ok?responses[0].status:responses[1].status);
      if(!mounted.current)return;const record=recordPayload.data as InlineObservation;const request=requestRef.current;
      revisionRef.current=configuration.data.configRevision;setEditorTheme(configuration.data.theme as Theme);
      if(request&&record.version!==request.version&&matchesSaved(record,request.payload)){await finishSaved(record);return;}
      requestRef.current=null;setUncertain(false);
      if(record.version===versionRef.current){setConflict(false);setError("");callbacks.current.onNotice("입력 내용을 유지하고 최신 지도 설정을 확인했어요. 다시 저장해 주세요.");}
      else{setConflict(true);setLatest(record);setError("다른 곳에서 기록이 변경됐어요. 아래 최신 기록을 확인해 주세요. 작성한 입력은 유지했습니다.");}
    }catch(reason){if(mounted.current)setError(reason instanceof Error?reason.message:"최신 내용을 확인하지 못했습니다.");}
    finally{endBusy();}
  }
  function loadLatest(){if(!latest||busyRef.current)return;if(dirty&&!window.confirm("작성한 수정 내용을 버리고 최신 기록을 불러올까요?"))return;const next:Draft={title:latest.title,body:latest.body,locationLabel:latest.locationLabel,location:latest.location,locationSource:latest.locationSource,categoryKey:latest.categoryKey,emojiKey:latest.emojiKey,ratingKey:latest.ratingKey??"",answers:structuredClone(latest.answers),idea:latest.improvementIdea??"",link:latest.link??""};setDraft(next);setBaseline(stable(next));versionRef.current=latest.version;setPhoto(null);setPhotoName("");setPhotoInfo("");setConflict(false);setLatest(null);setError("");callbacks.current.onSaved(latest);}
  const blocked=busy||!!savedPhotoRecord||uncertain;
  return <><form className="inline-record-editor" aria-label="등록 기록 수정" onSubmit={save}>
    <header className="inline-record-editor__heading"><h3>✏️ 기록 수정</h3><p>이 창에서 내용을 바꾸고 저장해요.</p></header>
    {savedPhotoRecord&&<p className="info-card" role="status">본문 수정은 저장됐습니다. 사진만 다시 전송하거나 사진 교체를 취소해 주세요.</p>}
    {uncertain&&<p className="info-card" role="status">저장 응답을 확인하지 못했어요. 다시 보내기 전에 저장 결과를 확인해 주세요.</p>}
    <fieldset className="record-fields" disabled={blocked}>
      <label className="field"><span>기록 제목 <b>*</b></span><input value={draft.title} maxLength={60} required onChange={event=>change("title",event.target.value)}/></label>
      <label className="field"><span>위치 또는 장소 이름 <b>*</b></span><input value={draft.locationLabel} maxLength={120} required onChange={event=>change("locationLabel",event.target.value)}/></label>
      <button type="button" className="record-location-launch" onClick={()=>setLocationOpen(true)}><span aria-hidden="true">🗺️</span><span><strong>전체 화면 지도에서 위치 변경</strong><small>{draft.location?`${draft.location.lat.toFixed(5)}, ${draft.location.lng.toFixed(5)}`:"위치를 골라 주세요"}</small></span></button>
      <div className="field"><span>관찰 유형 <b>*</b></span><div className="category-picker" role="group" aria-label="관찰 유형">{editorTheme.categories.map(category=><button key={category.key} type="button" className={draft.categoryKey===category.key?"selected":""} aria-pressed={draft.categoryKey===category.key} onClick={()=>setDraft(previous=>({...previous,categoryKey:category.key,emojiKey:category.defaultEmojiKey}))}><span aria-hidden="true">{category.emojiOptions[0]?.glyph??"📍"}</span>{category.label}</button>)}</div></div>
      <div className="field"><span>이모지 선택</span><EmojiPicker key={draft.categoryKey} options={emojiOptions} selectedKeys={[draft.emojiKey]} onChoose={key=>change("emojiKey",key)}/></div>
      {editorTheme.features.ratingEnabled&&editorTheme.rating&&<div className="field"><span>{editorTheme.rating.label} <b>*</b></span><div className="rating-picker" role="group" aria-label={editorTheme.rating.label}>{editorTheme.rating.options.map(option=><button key={option.key} type="button" className={draft.ratingKey===option.key?"selected":""} aria-pressed={draft.ratingKey===option.key} onClick={()=>change("ratingKey",option.key)}><i className="rating-symbol" aria-hidden="true">{option.symbol}</i>{option.label}</button>)}</div></div>}
      <label className="field"><span>관찰한 내용 <b>*</b></span><textarea value={draft.body} rows={4} minLength={10} maxLength={2000} required onChange={event=>change("body",event.target.value)}/><small>{draft.body.length}/2,000 · 10자 이상</small></label>
      {editorTheme.questions.length>0&&<RecordQuestionInputs questions={editorTheme.questions} answers={draft.answers} onChange={(key,values)=>change("answers",{...draft.answers,[key]:values})}/>}
      {editorTheme.features.ideasEnabled&&<label className="field"><span>개선 아이디어</span><textarea value={draft.idea} rows={3} maxLength={1000} onChange={event=>change("idea",event.target.value)}/></label>}
      <label className="field"><span>관련 링크 (선택)</span><input type="url" value={draft.link} maxLength={2000} placeholder="https://example.com" onChange={event=>change("link",event.target.value)}/></label>
    </fieldset>
    <fieldset className="record-fields" disabled={busy}>
      <label className="photo-picker"><span aria-hidden="true">📷</span><strong>{photoName||"사진 교체 (선택)"}</strong><small>기존 사진은 새 사진 저장에 성공하면 교체됩니다. 원본 최대 20MB.</small><input type="file" aria-label="교체할 사진 선택" accept="image/jpeg,image/png,image/webp,image/heic,image/heif,.heic,.heif" onChange={event=>void choosePhoto(event)}/></label>
      {photoInfo&&<p role="status">{photoInfo}</p>}{photo&&<button type="button" className="button button--light button--full" onClick={clearPhoto}>사진 교체 취소</button>}
    </fieldset>
    {error&&<p className="inline-record-editor__error" role="alert">{error}</p>}
    {busy&&<p role="status">{preparing?"사진 크기를 줄이고 있어요…":progress===null?"수정 내용을 저장하고 있어요…":progress===100?"서버에서 사진을 저장하고 있어요…":`사진 전송 중 ${progress}%`}</p>}
    {progress!==null&&<progress value={progress} max={100} aria-label="사진 전송 진행률"/>}
    {(uncertain||conflict)&&<button type="button" className="button button--light button--full" disabled={busy} onClick={()=>void checkLatest()}>{uncertain?"저장 결과 확인":"최신 기록·설정 확인"}</button>}
    {latest&&<aside className="inline-record-editor__conflict"><strong>현재 저장된 제목: {latest.title}</strong><p>{latest.body}</p><button type="button" className="button button--light button--full" disabled={busy} onClick={loadLatest}>최신 내용을 불러오기</button></aside>}
    {savedPhotoRecord?<button type="button" className="button button--primary button--full" disabled={busy||!photo} onClick={()=>void retryPhoto()}>사진 교체 다시 시도</button>:<button type="submit" className="button button--primary button--full" disabled={busy||uncertain||conflict||!dirty||!point.canEdit}>수정 저장</button>}
  </form>{locationOpen&&!blocked&&<RecordLocationPicker center={center} chosen={draft.location} label={draft.locationLabel} onPick={(location,locationSource)=>setDraft(previous=>({...previous,location,locationSource}))} onLabelChange={value=>change("locationLabel",value)} onClose={()=>setLocationOpen(false)}/>}</>;
}
