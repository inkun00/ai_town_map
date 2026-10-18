"use client";

import dynamic from "next/dynamic";
import {useEffect,useMemo,useRef,useState} from "react";
import type {LiveMap} from "@/lib/map-directory";
import {getPinColor,getPointEmoji,type DemoPoint,type Theme} from "@/lib/demo-data";
import {pointDescription,pointRating} from "@/domain/point-presentation";
import type {MergePoint} from "@/domain/map-merge";
import {PointDialog} from "./PointDialog";
import type {MapFocus,MapPoint} from "./KakaoMap";

const ExplorerMap=dynamic(()=>import("./ExplorerMap"),{loading:()=> <p role="status">전체 지도를 불러오고 있어요…</p>});
type PreviewRecord=MergePoint&{status:"published"};
type Dataset={theme:Theme;points:DemoPoint[]};
const historyProperty="mapSourcePreview";

async function data<T>(response:Response):Promise<T>{
  const result=await response.json();
  if(!response.ok)throw new Error(result.error?.message??"지도 미리보기를 불러오지 못했어요.");
  return result.data as T;
}

/** A read-only layer; its history entry consumes Back before the parent's draft guard. */
export default function MapSourcePreview({map,onClose}:{map:LiveMap;onClose:()=>void}){
  const [dataset,setDataset]=useState<Dataset|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState(""),[attempt,setAttempt]=useState(0);
  const [selectedId,setSelectedId]=useState<string|null>(null),[showList,setShowList]=useState(false),[listLimit,setListLimit]=useState(80);
  const dialog=useRef<HTMLDialogElement>(null),closeRef=useRef(onClose),selectedRef=useRef(selectedId),historyId=useRef<string|null>(null);
  const cleanupTimer=useRef<ReturnType<typeof setTimeout>|null>(null),consumed=useRef(false),closing=useRef(false),popListener=useRef<((event:PopStateEvent)=>void)|null>(null);
  closeRef.current=onClose;selectedRef.current=selectedId;

  function consumeHistoryEntry(){
    const token=historyId.current;
    if(!token||window.history.state?.[historyProperty]!==token)return;
    const swallow=(event:PopStateEvent)=>{event.stopImmediatePropagation();window.removeEventListener("popstate",swallow,true);};
    window.addEventListener("popstate",swallow,true);
    window.history.back();
  }
  function close(){
    if(closing.current)return;closing.current=true;consumed.current=true;
    if(popListener.current)window.removeEventListener("popstate",popListener.current,true);
    consumeHistoryEntry();closeRef.current();
  }

  useEffect(()=>{
    if(cleanupTimer.current!==null){clearTimeout(cleanupTimer.current);cleanupTimer.current=null;}
    closing.current=false;consumed.current=false;
    const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
    dialog.current?.showModal();
    const token=historyId.current??=crypto.randomUUID(),url=window.location.href;
    const marker={...window.history.state,[historyProperty]:token};
    if(window.history.state?.[historyProperty]!==token)window.history.pushState(marker,"",url);
    const onPop=(event:PopStateEvent)=>{
      event.stopImmediatePropagation();
      if(selectedRef.current){window.history.pushState(marker,"",url);setSelectedId(null);return;}
      consumed.current=true;closing.current=true;closeRef.current();
    };
    popListener.current=onPop;window.addEventListener("popstate",onPop,true);
    return()=>{
      window.removeEventListener("popstate",onPop,true);popListener.current=null;
      dialog.current?.close();if(opener?.isConnected)opener.focus();
      // Strict Mode remount cancels this cleanup and reuses the same entry.
      cleanupTimer.current=setTimeout(()=>{if(!consumed.current)consumeHistoryEntry();},0);
    };
  },[]);

  useEffect(()=>{
    const controller=new AbortController();let active=true;setLoading(true);setError("");setDataset(null);setSelectedId(null);setListLimit(80);
    const options={cache:"no-store" as const,signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])};
    // Reading configuration after the records includes any just-added emoji keys.
    void (async()=>{
      const result=await data<{items:PreviewRecord[]}>(await fetch(`/api/v1/maps/${encodeURIComponent(map.id)}/analysis?filter=%7B%7D`,options));
      if(!active)return;
      const configuration=await data<{theme:Theme}>(await fetch(`/api/v1/maps/${encodeURIComponent(map.id)}/configuration`,options));
      if(!active)return;
      if(!configuration.theme||!Array.isArray(configuration.theme.categories))throw new Error("지도의 주제 정보를 불러오지 못했어요. 다시 불러와 주세요.");
      const points:DemoPoint[]=result.items.map(point=>({...point,x:50,y:50,date:new Date(point.createdAt).toLocaleDateString("ko-KR",{timeZone:"Asia/Seoul"}),rawAnswers:point.answers,answers:undefined,idea:point.improvementIdea??undefined,link:point.link??undefined}));
      setDataset({theme:configuration.theme,points});
    })().catch(cause=>{if(active)setError(cause instanceof Error&&cause.name==="TimeoutError"?"지도 응답이 늦어지고 있어요. 잠시 후 다시 불러와 주세요.":cause instanceof Error?cause.message:"지도 미리보기를 불러오지 못했어요.");}).finally(()=>{if(active)setLoading(false);});
    return()=>{active=false;controller.abort();};
  },[map.id,attempt]);

  const points=dataset?.points;
  const markers=useMemo<MapPoint[]>(()=>dataset?.points.map(point=>({id:point.id,title:point.title,emoji:getPointEmoji(dataset.theme,point)?.glyph??"📍",color:getPinColor(dataset.theme,point),rating:pointRating(dataset.theme,point),description:pointDescription(dataset.theme,point),location:point.location!}))??[],[dataset]);
  const focus=useMemo<MapFocus|null>(()=>points?.length?{location:points[0].location!,locations:points.map(point=>point.location!),nonce:attempt}:null,[points,attempt]);
  const selected=points?.find(point=>point.id===selectedId),theme=dataset?.theme;

  return <dialog ref={dialog} className="map-source-preview" aria-label={`${map.title} 전체 지도 미리보기`} onCancel={event=>{event.preventDefault();if(event.target===event.currentTarget)close();}}>
    <div className="map-source-preview__layout">
      <header className="map-source-preview__header"><div><small>🔍 전체 지도 미리보기</small><h2>{map.title}</h2></div><button type="button" aria-label="지도 미리보기 닫기" onClick={close}>×</button></header>
      <section className="map-source-preview__summary"><p>{map.description||"지도에 등록된 기록을 둘러보세요."}</p><div><strong>{loading?"기록 불러오는 중":dataset?`게시된 포인트 ${dataset.points.length}개`:"기록을 확인해 주세요"}</strong><span>{map.visibility==="invite_only"?"일부공개 · 인증 후 기록":"전체공개 · 누구나 기록"} · {map.location}</span></div></section>
      {loading?<div className="map-source-preview__message" role="status">지도의 모든 게시 기록을 불러오고 있어요…</div>:error?<div className="map-source-preview__message"><p className="map-merge-error" role="alert">{error}</p><button type="button" className="button button--light" onClick={()=>setAttempt(value=>value+1)}>미리보기 다시 불러오기</button></div>:dataset&&<>
        <div className="map-source-preview__map"><ExplorerMap title={map.title} subtitle={`지도 미리보기 · ${map.location}`} autoLocate={false} center={map.center??focus?.location} focus={focus} points={markers} selectedId={selectedId} onSelectPoint={setSelectedId}/></div>
        <footer className="map-source-preview__footer"><p>미리보기는 읽기 전용이에요. 합칠 지도 선택은 바뀌지 않아요.</p><button type="button" aria-expanded={showList} aria-controls="map-source-preview-records" onClick={()=>setShowList(value=>!value)}>{showList?"기록 목록 접기":"기록 목록 보기"}</button></footer>
        <section id="map-source-preview-records" className="map-source-preview__records" hidden={!showList} aria-label="미리보기 기록 목록" tabIndex={0}>{!points?.length?<p>아직 게시된 위치 기록이 없어요.</p>:points.slice(0,listLimit).map(point=><button type="button" key={point.id} onClick={()=>setSelectedId(point.id)}><span aria-hidden="true">{getPointEmoji(dataset.theme,point)?.glyph??"📍"}</span><span><strong>{point.title}</strong><small>{point.locationLabel}</small></span><span aria-hidden="true">›</span></button>)}{(points?.length??0)>listLimit&&<button type="button" onClick={()=>setListLimit(value=>value+80)}>기록 더 보기</button>}</section>
      </>}
    </div>
    {selected&&theme&&<PointDialog label={`${selected.title} 미리보기 기록`} onClose={()=>setSelectedId(null)}><button type="button" className="sheet-close" aria-label="미리보기 기록 닫기" onClick={()=>setSelectedId(null)}>×</button><div className="point-sheet__title"><span className="point-sheet__emoji" aria-hidden="true" style={{backgroundColor:getPinColor(theme,selected)}}>{getPointEmoji(theme,selected)?.glyph??"📍"}</span><div><small>{theme.categories.find(category=>category.key===selected.categoryKey)?.label} · 등록일 {selected.date}</small><h2>{selected.title}</h2></div></div>{pointRating(theme,selected)&&<p className="sheet-rating">{pointRating(theme,selected)!.symbol} {pointRating(theme,selected)!.label}</p>}<p className="sheet-body">{selected.body}</p>{selected.photoUrl&&<img className="sheet-photo" src={selected.photoUrl} alt={`${selected.title} 현장 사진`} loading="lazy" decoding="async"/>}{selected.link&&<a className="sheet-link" href={selected.link} target="_blank" rel="noopener noreferrer">🔗 관련 링크 열기</a>}{selected.rawAnswers&&Object.keys(selected.rawAnswers).length>0&&<div className="sheet-answers">{Object.entries(selected.rawAnswers).map(([key,values])=>{const question=theme.questions.find(item=>item.key===key),choices=question?.type==="boolean"?[{key:"yes",label:"있음"},{key:"no",label:"없음"}]:question?.options??[];return <span key={key}><b>{question?.label??key}</b>{values.map(value=>value==="unknown"?"확인 못함":value==="na"?"해당 없음":choices.find(choice=>choice.key===value)?.label??value).join(" · ")}</span>;})}</div>}{selected.idea&&<div className="sheet-idea"><strong>개선 아이디어</strong><p>{selected.idea}</p></div>}<p className="sheet-meta">기록한 사람 · {selected.author} · {selected.locationLabel}</p></PointDialog>}
  </dialog>;
}
