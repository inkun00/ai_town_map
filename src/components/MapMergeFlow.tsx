"use client";

import dynamic from "next/dynamic";
import {useEffect,useMemo,useRef,useState,type FormEvent} from "react";
import {GameIcon} from "./AdventureArt";
import {PointDialog} from "./PointDialog";
import {MapPager,mapListUrl,type LiveMap,type PageState} from "@/lib/map-directory";
import {themes,themeByKey,type ThemeKey} from "@/lib/demo-data";
import {resolveMergePreview,type MergeSource,type MergePoint,type MergePreviewPoint} from "@/domain/map-merge";
import {attachUnsavedRecordGuard,unsavedRecordMessage} from "@/lib/unsaved-record-guard";
import type {MapFocus,MapPoint} from "./KakaoMap";

const KakaoMap=dynamic(()=>import("./KakaoMap"),{loading:()=> <p role="status">합칠 포인트의 지도를 불러오고 있어요…</p>});
const MapSourcePreview=dynamic(()=>import("./MapSourcePreview"),{loading:()=> <p role="status">지도 미리보기를 준비하고 있어요…</p>});
type Session={kind:"account"|"guest";accountRole:string|null;canCreateMap:boolean;csrfToken:string|null};
type MergePreview={sources:MergeSource[];points:MergePreviewPoint[]};
type Creation={map:Pick<LiveMap,"id">;copiedPoints:number;repeated:boolean};
const maxSelectedPoints=1000;
const symbols:Record<ThemeKey,string>={ecology:"🌳",safety:"🚸",universal_design:"♿",weather_life:"☀️",custom:"✨"};

class MergeError extends Error {constructor(message:string,readonly status:number){super(message);}}
async function readResponse<T>(response:Response):Promise<T>{
  const payload=await response.json();
  if(!response.ok)throw new MergeError(payload.error?.message??"요청을 처리하지 못했어요. 다시 시도해 주세요.",response.status);
  return payload.data as T;
}

function MapChoices({scope,query,themeKey,selected,onToggle,onPreview,disabled}:{scope:"public"|"mine";query:string;themeKey:string;selected:Map<string,LiveMap>;onToggle:(map:LiveMap)=>void;onPreview:(map:LiveMap)=>void;disabled:boolean}){
  const [page,setPage]=useState<PageState<LiveMap>>({items:[],nextCursor:null,busy:true,error:"",loaded:false});
  const pager=useRef<MapPager<LiveMap>|null>(null);
  useEffect(()=>{
    const current=new MapPager<LiveMap>(async(cursor,signal)=>readResponse<{items:LiveMap[];nextCursor:string|null}>(await fetch(mapListUrl(scope,query,themeKey,cursor),{cache:"no-store",signal:AbortSignal.any([signal,AbortSignal.timeout(15000)])})),setPage);
    pager.current=current;void current.load();return()=>current.dispose();
  },[scope,query,themeKey]);
  return <div id="map-merge-directory-panel" role="tabpanel" aria-labelledby={`map-merge-directory-tab-${scope}`}><div className="map-merge-directory" role="region" aria-label="합칠 지도 목록" aria-busy={page.busy} tabIndex={0}>
    {page.items.map(map=><article className={`map-merge-choice${selected.has(map.id)?" is-selected":""}`} key={map.id}><label>
      <input type="checkbox" checked={selected.has(map.id)} disabled={disabled||map.status!=="active"||(!selected.has(map.id)&&selected.size>=10)} onChange={()=>onToggle(map)}/>
      <span className="map-merge-choice__emoji" aria-hidden="true">{symbols[map.themeKey]}</span><span><strong>{map.title}</strong><small>{themeByKey[map.themeKey].label} · {map.location}</small><small>{map.status!=="active"?"보관 중 · 선택할 수 없어요":map.visibility==="invite_only"?"초대 전용 지도":"공개 지도"}</small></span>
    </label><button type="button" className="map-merge-source-preview" aria-label={`${map.title} 미리보기`} disabled={disabled} onClick={()=>onPreview(map)}><span aria-hidden="true">🔍</span><span>미리보기</span></button></article>)}
    <p className="map-merge-help" role="status">{page.busy?"지도를 불러오고 있어요…":page.loaded&&!page.items.length?"조건에 맞는 지도가 없어요.":page.loaded?`${page.items.length}개 표시${page.nextCursor?" · 더 불러올 지도가 있어요":" · 마지막 목록이에요"}`:""}</p>
    {page.error&&<p className="map-merge-error" role="alert">{page.error}</p>}
    {(page.error||page.nextCursor)&&<button className="button button--light button--full" type="button" disabled={disabled||page.busy} onClick={()=>void pager.current?.load()}>{page.error?"지도 다시 불러오기":"지도 더 보기"}</button>}
  </div></div>;
}

export function MapMergeFlow({onNavigate}:{onNavigate?:(href:string)=>void}={}){
  const [session,setSession]=useState<Session|null|undefined>(undefined),[sessionError,setSessionError]=useState(""),[sessionAttempt,setSessionAttempt]=useState(0);
  const [step,setStep]=useState<0|1|2>(0),[scope,setScope]=useState<"public"|"mine">("public"),[input,setInput]=useState(""),[query,setQuery]=useState(""),[themeKey,setThemeKey]=useState("");
  const [maps,setMaps]=useState<Map<string,LiveMap>>(new Map()),[preview,setPreview]=useState<MergePreview|null>(null),[selected,setSelected]=useState<Set<string>>(new Set());
  const [sourceFilter,setSourceFilter]=useState(""),[listLimit,setListLimit]=useState(80),[inspectedId,setInspectedId]=useState<string|null>(null);
  const [title,setTitle]=useState(""),[locationLabel,setLocationLabel]=useState(""),[description,setDescription]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[stale,setStale]=useState(false),[completed,setCompleted]=useState(false);
  const [focusNonce,setFocusNonce]=useState(0);
  const [sourcePreview,setSourcePreview]=useState<LiveMap|null>(null);
  const request=useRef<{payload:string;key:string}|null>(null),guard=useRef<(()=>void)|null>(null),busyRef=useRef(false);
  const allowed=session?.kind==="account"&&!!session.canCreateMap&&!!session.csrfToken;
  const dirty=maps.size>0||selected.size>0||!!(title||locationLabel||description);

  useEffect(()=>{let active=true;setSessionError("");void fetch("/api/v1/session",{cache:"no-store"}).then(readResponse<Session|null>).then(value=>{if(active)setSession(value);}).catch(cause=>{if(active)setSessionError(cause instanceof Error?cause.message:"로그인 상태를 확인하지 못했어요.");});return()=>{active=false;};},[sessionAttempt]);
  useEffect(()=>{const timer=setTimeout(()=>setQuery(input.trim()),300);return()=>clearTimeout(timer);},[input]);
  useEffect(()=>{
    if((dirty||busy)&&!completed){const dispose=attachUnsavedRecordGuard(window);guard.current=dispose;return()=>{dispose();if(guard.current===dispose)guard.current=null;};}
  },[dirty,busy,completed]);
  const filteredPoints=useMemo(()=>preview?.points.filter(point=>!sourceFilter||point.mapId===sourceFilter)??[],[preview,sourceFilter]);
  const mapPoints=useMemo<MapPoint[]>(()=>filteredPoints.map(point=>({id:point.id,title:point.title,location:point.location,emoji:point.emoji.glyph,color:selected.has(point.id)?"#2563eb":"#808b94",rating:point.rating,description:`${selected.has(point.id)?"선택됨":"선택 안 됨"} · ${point.title}`})),[filteredPoints,selected]);
  const focus=useMemo<MapFocus|null>(()=>preview?.points.length?{location:preview.points[0].location,locations:preview.points.map(point=>point.location),nonce:focusNonce}:null,[preview,focusNonce]);
  const inspected=preview?.points.find(point=>point.id===inspectedId);
  const inspectedSource=preview?.sources.find(source=>source.id===inspected?.mapId);
  const allFilteredSelected=filteredPoints.length>0&&filteredPoints.every(point=>selected.has(point.id));
  const proposedAllCount=new Set([...selected,...filteredPoints.map(point=>point.id)]).size;
  const allPointsSelected=!!preview?.points.length&&preview.points.every(point=>selected.has(point.id));
  const allPointsExceedLimit=(preview?.points.length??0)>maxSelectedPoints;

  function navigate(href:string){guard.current?.();guard.current=null;(onNavigate??(url=>window.location.assign(url)))(href);}
  function cancel(){if(busyRef.current)return;if(dirty&&!window.confirm(unsavedRecordMessage))return;navigate("/");}
  function toggleMap(map:LiveMap){if(busyRef.current)return;setMaps(current=>{const next=new Map(current);if(next.has(map.id))next.delete(map.id);else if(next.size<10)next.set(map.id,map);return next;});setError("");}
  function togglePoint(id:string){
    if(busyRef.current)return;
    if(!selected.has(id)&&selected.size>=maxSelectedPoints){setError("한 번에 합칠 수 있는 포인트는 1,000개예요. 먼저 다른 포인트의 선택을 해제해 주세요.");return;}
    setSelected(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});setError("");
  }
  function selectAll(){if(busyRef.current)return;if(proposedAllCount>maxSelectedPoints){setError("한 번에 1,000개까지 선택할 수 있어요. 원본 지도 필터나 목록에서 필요한 포인트를 골라 주세요.");return;}setSelected(current=>new Set([...current,...filteredPoints.map(point=>point.id)]));setError("");}
  function selectEveryPoint(){if(busyRef.current||!preview)return;if(preview.points.length>maxSelectedPoints){setError("한 번에 1,000개까지 선택할 수 있어요. 원본 지도 필터나 목록에서 필요한 포인트를 골라 주세요.");return;}setSelected(new Set(preview.points.map(point=>point.id)));setError("");}
  function clearEveryPoint(){if(busyRef.current)return;setSelected(new Set());setError("");}
  function clearFiltered(){if(busyRef.current)return;const ids=new Set(filteredPoints.map(point=>point.id));setSelected(current=>new Set([...current].filter(id=>!ids.has(id))));setError("");}
  async function buildPreview(retain=true){
    if(busyRef.current||!session?.csrfToken||maps.size<2||maps.size>10)return;
    busyRef.current=true;setBusy(true);setError("");
    try{
      const raw=await readResponse<{sources:MergeSource[];points:MergePoint[]}>(await fetch("/api/v1/maps/merge/preview",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":session.csrfToken},body:JSON.stringify({mapIds:[...maps.keys()]}),signal:AbortSignal.timeout(30000)}));
      const result:MergePreview={sources:raw.sources,points:resolveMergePreview(raw.sources,raw.points)};
      const oldSources=preview?.sources.map(source=>source.id).sort().join(","),newSources=result.sources.map(source=>source.id).sort().join(",");
      const ids=new Set(result.points.map(point=>point.id));
      setSelected(current=>retain&&oldSources===newSources?new Set([...current].filter(id=>ids.has(id))):new Set());
      setPreview(result);setSourceFilter("");setListLimit(80);setInspectedId(null);setStale(false);setFocusNonce(value=>value+1);setStep(1);request.current=null;
    }catch(cause){setError(cause instanceof Error?cause.message:"미리보기를 만들지 못했어요. 선택한 지도는 그대로 남아 있어요.");}
    finally{busyRef.current=false;setBusy(false);}
  }
  async function finish(event:FormEvent){
    event.preventDefault();if(busyRef.current||!preview||!session?.csrfToken||stale||!selected.size||!title.trim()||!locationLabel.trim())return;
    const chosen=preview.points.filter(point=>selected.has(point.id));
    const payload=JSON.stringify({mapIds:preview.sources.map(source=>source.id),title:title.trim(),description:description.trim(),locationLabel:locationLabel.trim(),pointIds:chosen.map(point=>point.id),pointVersions:Object.fromEntries(chosen.map(point=>[point.id,point.version])),sourceVersions:Object.fromEntries(preview.sources.map(source=>[source.id,source.version]))});
    if(request.current?.payload!==payload)request.current={payload,key:crypto.randomUUID()};
    busyRef.current=true;setBusy(true);setError("");
    try{
      const result=await readResponse<Creation>(await fetch("/api/v1/maps/merge",{method:"POST",headers:{"Content-Type":"application/json","X-CSRF-Token":session.csrfToken,"Idempotency-Key":request.current.key},body:request.current.payload,signal:AbortSignal.timeout(30000)}));
      setCompleted(true);navigate(`/?map=${encodeURIComponent(result.map.id)}`);
    }catch(cause){if(cause instanceof MergeError&&cause.status===409){setStale(true);setError("원본 지도나 기록이 변경됐어요. 미리보기를 새로 확인한 뒤 완료해 주세요. 새 지도 이름과 소개는 유지됩니다.");}else setError(cause instanceof Error?cause.message:"지도를 만들지 못했어요. 입력과 선택을 유지했으니 다시 완료를 눌러 주세요.");}
    finally{busyRef.current=false;setBusy(false);}
  }

  return <main className="map-merge-shell">
    <header className="map-merge-header"><button className="map-merge-back" type="button" aria-label="지도 합치기 취소" disabled={busy} onClick={cancel}>‹</button><div><small>🧭 모두의 지도 · 새로운 탐험</small><h1>지도 합치기</h1></div><GameIcon name="map" size={30}/></header>
    {sessionError?<section className="map-merge-section"><p className="map-merge-error" role="alert">{sessionError}</p><button type="button" className="button button--light" onClick={()=>{setSession(undefined);setSessionAttempt(value=>value+1);}}>로그인 다시 확인</button></section>:session===undefined?<p className="map-merge-section" role="status">로그인을 확인하고 있어요…</p>:!allowed?<section className="map-merge-section"><h2>교사 회원이 지도를 합칠 수 있어요</h2><p>여러 지도의 기록을 골라 새 탐험지도를 만들어요.</p>{!session||session.kind!=="account"?<a className="button button--primary" href="/api/v1/auth/google?returnTo=%2Fmaps%2Fmerge">Google 로그인</a>:!session.accountRole?<a className="button button--primary" href="/account/setup?returnTo=%2Fmaps%2Fmerge">회원 유형 선택하기</a>:<p className="map-merge-help">현재 회원은 참여용 계정입니다. 교사 회원으로 접속해 주세요.</p>}</section>:<>
      <ol className="map-merge-progress" aria-label="지도 합치기 단계">{["지도 선택","포인트 고르기","새 지도 완성"].map((label,index)=><li key={label} className={step===index?"is-current":step>index?"is-done":""} aria-current={step===index?"step":undefined}><span>{index+1}</span>{label}</li>)}</ol>
      {(error||stale)&&<div className="map-merge-section map-merge-error-box"><p className="map-merge-error" role="alert">{error||"원본 지도나 기록이 변경됐어요. 미리보기를 새로 확인해 주세요."}</p>{stale&&<button className="button button--light button--full" type="button" disabled={busy||maps.size<2} onClick={()=>void buildPreview(true)}>미리보기 새로 확인</button>}</div>}
      {step===0&&<section className="map-merge-section"><h2>합칠 지도를 골라 주세요</h2><p className="map-merge-help">운영 중인 지도 2~10개를 선택해요. 게시된 위치 기록을 모아 임시 지도로 보여드려요.</p><div className="map-merge-filters"><label><span className="sr-only">합칠 지도 검색</span><input type="search" maxLength={100} value={input} onChange={event=>setInput(event.target.value)} placeholder="지도 이름이나 지역 검색" disabled={busy}/></label><label><span className="sr-only">합칠 지도 주제</span><select aria-label="합칠 지도 주제" value={themeKey} onChange={event=>setThemeKey(event.target.value)} disabled={busy}><option value="">모든 주제</option>{themes.map(theme=><option key={theme.key} value={theme.key}>{symbols[theme.key]} {theme.label}</option>)}</select></label></div><div className="map-merge-tabs" role="tablist" aria-label="지도 목록 종류">{(["public","mine"] as const).map(item=><button type="button" id={`map-merge-directory-tab-${item}`} role="tab" aria-selected={scope===item} aria-controls="map-merge-directory-panel" tabIndex={scope===item?0:-1} key={item} disabled={busy} onClick={()=>setScope(item)} onKeyDown={event=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(event.key))return;event.preventDefault();const next=event.key==="Home"?"public":event.key==="End"?"mine":item==="public"?"mine":"public";setScope(next);document.getElementById(`map-merge-directory-tab-${next}`)?.focus();}}>{item==="public"?"공개 지도":"내가 참여한 지도"}</button>)}</div><MapChoices scope={scope} query={query} themeKey={themeKey} selected={maps} onToggle={toggleMap} onPreview={setSourcePreview} disabled={busy}/>{maps.size>0&&<div className="map-merge-selected" aria-label="선택한 지도">{[...maps.values()].map(map=><button type="button" disabled={busy} key={map.id} onClick={()=>toggleMap(map)} aria-label={`${map.title} 선택 해제`}>{symbols[map.themeKey]} {map.title} <span aria-hidden="true">×</span></button>)}</div>}</section>}
      {step===1&&preview&&<><section className="map-merge-section map-merge-preview-heading"><h2>새 지도에 담을 포인트를 골라요</h2><p className="map-merge-help">핀을 눌러 선택하거나 해제해요. 목록의 ‘정보’ 버튼에서 사진과 설명을 확인할 수 있어요. 파란 핀은 선택한 기록, 회색 핀은 아직 선택하지 않은 기록이에요.</p><div className="map-merge-global-selection" role="group" aria-label="모든 지도 포인트 선택"><button type="button" disabled={busy||!preview.points.length||allPointsSelected||allPointsExceedLimit} onClick={selectEveryPoint}>모든 포인트 선택</button><button type="button" disabled={busy||!selected.size} onClick={clearEveryPoint}>전체 선택 해제</button></div><p className="map-merge-help map-merge-global-selection-status" role="status">전체 {preview.points.length}개 중 {selected.size}개 선택{allPointsExceedLimit&&" · 한 번에 1,000개까지 담을 수 있어요. 원본 지도별로 필요한 포인트를 골라 주세요."}</p><label className="map-merge-source-filter">원본 지도<select aria-label="포인트 원본 지도" value={sourceFilter} disabled={busy} onChange={event=>{setSourceFilter(event.target.value);setListLimit(80);}}><option value="">모든 지도 · {preview.points.length}개</option>{preview.sources.map(source=><option key={source.id} value={source.id}>{source.title} · {source.pointCount??preview.points.filter(point=>point.mapId===source.id).length}개</option>)}</select></label></section><div className="map-merge-map"><KakaoMap autoLocate={false} points={mapPoints} focus={focus} center={focus?.location} selectedId={inspectedId} onSelectPoint={togglePoint}/></div><section className="map-merge-section"><div className="map-merge-selection-tools"><button type="button" disabled={busy||!filteredPoints.length||allFilteredSelected||proposedAllCount>maxSelectedPoints} onClick={selectAll}>표시된 포인트 전체 선택</button><button type="button" disabled={busy||!filteredPoints.some(point=>selected.has(point.id))} onClick={clearFiltered}>표시된 포인트 선택 해제</button></div>{!preview.points.length&&<p className="map-merge-help">이 지도들에는 게시된 위치 기록이 없어요. 다른 지도를 선택해 주세요.</p>}{proposedAllCount>maxSelectedPoints&&<p className="map-merge-help">1,000개까지 담을 수 있어요. 원본 지도별로 필요한 기록을 선택해 주세요.</p>}<div className="map-merge-point-list" role="region" aria-label="합칠 위치 포인트 목록" tabIndex={0}>{filteredPoints.slice(0,listLimit).map(point=><article key={point.id} className={selected.has(point.id)?"is-selected":""}><label><input type="checkbox" checked={selected.has(point.id)} disabled={busy||(!selected.has(point.id)&&selected.size>=maxSelectedPoints)} onChange={()=>togglePoint(point.id)}/><span aria-hidden="true">{point.emoji.glyph}</span><span><strong>{point.title}</strong><small>{preview.sources.find(source=>source.id===point.mapId)?.title} · {point.locationLabel}</small></span></label><button type="button" aria-label={`${point.title} 정보 보기`} onClick={()=>setInspectedId(point.id)}>정보</button></article>)}{filteredPoints.length>listLimit&&<button type="button" className="button button--light button--full" onClick={()=>setListLimit(value=>value+80)}>포인트 더 보기</button>}</div></section></>}
      {step===2&&preview&&<section className="map-merge-section"><h2>새 지도의 이름을 정해 주세요</h2><div className="map-merge-summary"><strong>지도 {preview.sources.length}개에서 포인트 {selected.size}개</strong><p>선택한 기록을 새 지도로 복사해요. 원본 지도와 댓글은 그대로 유지돼요.</p><p>합친 지도는 분류별 색으로 표시해요. 원본 지도의 평가는 기록 항목으로 남겨요.</p><p>새 지도는 <b>초대 전용</b>으로 만들어져요. 지도 정보를 확인한 뒤 공개 범위를 바꿀 수 있어요.</p></div><form id="map-merge-finish" onSubmit={finish}><label className="map-merge-field">새 지도 이름<input required minLength={2} maxLength={60} value={title} disabled={busy} onChange={event=>setTitle(event.target.value)} placeholder="예: 우리학교 함께 걷는 안전지도"/></label><label className="map-merge-field">지역 또는 장소<input required maxLength={120} value={locationLabel} disabled={busy} onChange={event=>setLocationLabel(event.target.value)} placeholder="예: 학교와 마을 주변"/></label><label className="map-merge-field">지도 소개<textarea rows={4} maxLength={300} value={description} disabled={busy} onChange={event=>setDescription(event.target.value)} placeholder="어떤 기록을 모은 지도인지 알려주세요."/></label></form></section>}
      <footer className="map-merge-footer"><div role="status"><strong>{step===0?`지도 ${maps.size}개 선택`:`포인트 ${selected.size}개 선택`}</strong><small>{step===0?"2~10개를 골라 주세요":step===1?"필요한 기록만 새 지도에 담아요":"완료를 누르면 새 지도가 저장돼요"}</small></div>{step>0&&<button type="button" className="map-merge-step-back" disabled={busy} onClick={()=>{setStep(step===2?1:0);setError("");}}>이전</button>}{step===0?<button type="button" className="button button--primary" disabled={busy||maps.size<2} onClick={()=>void buildPreview(true)}>{busy?"미리보기 만드는 중…":"만들기"}</button>:step===1?<button type="button" className="button button--primary" disabled={busy||!selected.size||stale} onClick={()=>{setStep(2);setError("");}}>다음</button>:<button type="submit" form="map-merge-finish" className="button button--primary" disabled={busy||stale||!selected.size||title.trim().length<2||!locationLabel.trim()}>{busy?"지도 저장 중…":"완료"}</button>}</footer>
    </>}
    {inspected&&step===1&&<PointDialog label={`${inspected.title} 합칠 기록 정보`} onClose={()=>setInspectedId(null)}><button className="sheet-close" type="button" aria-label="합칠 기록 정보 닫기" onClick={()=>setInspectedId(null)}>×</button><div className="point-sheet__title"><span className="point-sheet__emoji" aria-hidden="true">{inspected.emoji.glyph}</span><div><small>{inspectedSource?.title} · {new Date(inspected.createdAt).toLocaleDateString("ko-KR",{timeZone:"Asia/Seoul"})}</small><h2>{inspected.title}</h2></div></div><p className="sheet-meta">{inspected.categoryLabel}{inspected.rating&&` · ${inspected.rating.symbol} ${inspected.rating.label}`}</p><p className="sheet-body">{inspected.body}</p>{inspected.photoUrl&&<img className="sheet-photo" src={inspected.photoUrl} alt={`${inspected.title} 현장 사진`} loading="lazy" decoding="async"/>}{inspected.link&&<a className="sheet-link" href={inspected.link} target="_blank" rel="noopener noreferrer">🔗 관련 링크 열기</a>}{inspectedSource&&Object.keys(inspected.answers).length>0&&<div className="sheet-answers">{Object.entries(inspected.answers).map(([key,values])=>{const question=inspectedSource.theme.questions.find(item=>item.key===key);const choices=question?.type==="boolean"?[{key:"yes",label:"있음"},{key:"no",label:"없음"}]:question?.options??[];return <span key={key}><b>{question?.label??key}</b>{values.map(value=>value==="unknown"?"확인 못함":value==="na"?"해당 없음":choices.find(choice=>choice.key===value)?.label??value).join(" · ")}</span>;})}</div>}{inspected.improvementIdea&&<div className="sheet-idea"><strong>개선 아이디어</strong><p>{inspected.improvementIdea}</p></div>}<p className="sheet-meta">기록한 사람 · {inspected.author} · {inspected.locationLabel}</p><button type="button" className="button button--primary button--full" aria-pressed={selected.has(inspected.id)} disabled={busy||(!selected.has(inspected.id)&&selected.size>=maxSelectedPoints)} onClick={()=>togglePoint(inspected.id)}>{selected.has(inspected.id)?"이 포인트 선택 해제":"이 포인트 선택"}</button></PointDialog>}
    {sourcePreview&&<MapSourcePreview key={sourcePreview.id} map={sourcePreview} onClose={()=>setSourcePreview(null)}/> }
  </main>;
}
