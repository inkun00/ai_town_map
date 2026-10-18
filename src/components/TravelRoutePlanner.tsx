"use client";

import {useEffect,useId,useMemo,useRef,useState,type ComponentProps} from "react";
import ExplorerMap from "./ExplorerMap";
import type {MapFocus} from "./KakaoMap";
import {emptyTravelPlan,formatTravelDistance,formatTravelDuration,maximumTravelStops,parseTravelPlan,serializeTravelPlan,supportsTravelPlanning,travelPlanKey,travelRequestKey,type TravelMode,type TravelPlan,type TravelRouteOverlay,type TravelRouteResult} from "@/domain/travel-route";
import "@/app/travel-route-planner.css";

type Props=ComponentProps<typeof ExplorerMap>&{mapId:string;scope:string;themeKey:string;onBeginPlanning?:()=>void};
type Answer={key:string;data:TravelRouteResult};
const routeFreshnessMs=2*60*1000;
function calculationTime(value:string){const date=new Date(value);return Number.isNaN(date.getTime())?"시각 확인 불가":new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit",second:"2-digit"}).format(date);}

/** Travel plans are private; all other themes retain the original map behavior. */
export default function TravelRoutePlanner(props:Props){
  if(!supportsTravelPlanning(props.themeKey))return <ExplorerMap {...props}/>;
  return <Planner key={`${props.scope}:${props.mapId}`} {...props}/>;
}

function Planner({mapId,scope,themeKey:_themeKey,onBeginPlanning,...mapProps}:Props){
  const storageKey=travelPlanKey(scope,mapId),sheetId=useId();
  const [plan,setPlan]=useState<TravelPlan>(emptyTravelPlan),[loaded,setLoaded]=useState(false),[storageMessage,setStorageMessage]=useState("");
  const [planning,setPlanning]=useState(false),[expanded,setExpanded]=useState(false),[pickedId,setPickedId]=useState<string|null>(null),[notice,setNotice]=useState("");
  const [answer,setAnswer]=useState<Answer|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(""),[retry,setRetry]=useState(0),[routeFocus,setRouteFocus]=useState<MapFocus|null>(null);
  const [clock,setClock]=useState(()=>Date.now());
  const dirty=useRef(false),generation=useRef(0),previousFocus=useRef(mapProps.focus);
  const source=mapProps.anchorPoints??mapProps.points??[],available=mapProps.points??[];
  const lookup=useMemo(()=>new Map(source.map(point=>[point.id,point])),[source]);
  const missing=plan.stops.filter(stop=>!lookup.has(stop.pointId));
  const requestKey=loaded?travelRequestKey(plan,source):null;

  useEffect(()=>{
    try{const saved=localStorage.getItem(storageKey);if(saved)setPlan(parseTravelPlan(saved,mapId));}
    catch{setStorageMessage("저장한 동선을 읽지 못했어요. 이 화면에서 새 동선을 만들 수 있어요.");}
    setLoaded(true);
    return()=>{generation.current++;};
  },[storageKey,mapId]);
  useEffect(()=>{
    if(!loaded||!dirty.current)return;
    try{localStorage.setItem(storageKey,serializeTravelPlan(mapId,plan));setStorageMessage("");}
    catch{setStorageMessage("이 기기에 동선을 저장하지 못했어요. 화면을 닫기 전에 동선을 확인해 주세요.");}
  },[loaded,plan,storageKey,mapId]);
  useEffect(()=>{if(previousFocus.current!==mapProps.focus){previousFocus.current=mapProps.focus;setRouteFocus(null);}},[mapProps.focus]);
  useEffect(()=>{if(mapProps.gestureTool){setExpanded(false);setPlanning(false);setPickedId(null);}},[mapProps.gestureTool?.kind,mapProps.gestureTool?.pointId]);
  useEffect(()=>{
    const current=++generation.current;
    if(!loaded||!requestKey||missing.length){setLoading(false);setAnswer(null);setError("");return;}
    const controller=new AbortController();let active=true;setLoading(true);setAnswer(null);setError("");
    const timer=window.setTimeout(()=>{
      void fetch(`/api/v1/maps/${encodeURIComponent(mapId)}/travel-route`,{method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"},body:JSON.stringify({stops:plan.stops}),signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)])}).then(async response=>{
        const body=await response.json();if(!response.ok)throw new Error(body.error?.message??"실제 도로의 이동 정보를 불러오지 못했어요.");
        if(!body.data||!Array.isArray(body.data.legs))throw new Error("이동 정보를 확인하지 못했어요. 다시 계산해 주세요.");
        return body.data as TravelRouteResult;
      }).then(data=>{if(active&&generation.current===current)setAnswer({key:requestKey,data});}).catch(cause=>{
        if(active&&generation.current===current)setError(cause instanceof Error?cause.message:"이동 정보를 불러오지 못했어요. 다시 시도해 주세요.");
      }).finally(()=>{if(active&&generation.current===current)setLoading(false);});
    },500);
    return()=>{active=false;window.clearTimeout(timer);controller.abort();};
  },[loaded,requestKey,retry,mapId,missing.length]);

  function change(next:TravelPlan){dirty.current=true;setPlan(next);setNotice("");}
  function begin(){onBeginPlanning?.();mapProps.onCloseContext?.();setPlanning(true);setExpanded(true);setPickedId(null);setNotice("지도의 등록 포인트를 방문할 순서대로 눌러 주세요.");}
  function pick(id:string){
    if(!planning){setExpanded(false);mapProps.onSelectPoint?.(id);return;}
    const point=available.find(item=>item.id===id);if(!point)return;
    if(plan.stops.some(stop=>stop.pointId===id)){setNotice("이미 동선에 넣은 장소예요. 아래 목록에서 순서를 바꿀 수 있어요.");return;}
    if(plan.stops.length>=maximumTravelStops){setNotice(`한 동선에는 최대 ${maximumTravelStops}곳까지 넣을 수 있어요.`);return;}
    change({stops:[...plan.stops,{pointId:id,mode:"car"}]});setPickedId(id);setNotice(`${plan.stops.length+1}번째 장소로 ${point.title}을 넣었어요.`);
  }
  function reorder(index:number,direction:-1|1){const stops=[...plan.stops],target=index+direction;if(target<0||target>=stops.length)return;[stops[index],stops[target]]=[stops[target],stops[index]];change({stops});}
  function mode(index:number,value:TravelMode){change({stops:plan.stops.map((stop,position)=>position===index?{...stop,mode:value}:stop)});}
  const result=answer?.key===requestKey?answer.data:null;
  useEffect(()=>{
    const refresh=()=>setClock(Date.now()),visible=()=>{if(!document.hidden)refresh();};
    refresh();const calculated=Date.parse(result?.calculatedAt??""),remaining=calculated+routeFreshnessMs-Date.now();
    const timer=Number.isFinite(calculated)&&remaining>0?window.setTimeout(refresh,remaining):undefined;
    window.addEventListener("focus",refresh);window.addEventListener("pageshow",refresh);document.addEventListener("visibilitychange",visible);
    return()=>{if(timer!==undefined)window.clearTimeout(timer);window.removeEventListener("focus",refresh);window.removeEventListener("pageshow",refresh);document.removeEventListener("visibilitychange",visible);};
  },[result?.calculatedAt,requestKey]);
  const calculatedAt=Date.parse(result?.calculatedAt??""),outdated=!!result&&(!Number.isFinite(calculatedAt)||clock-calculatedAt>=routeFreshnessMs);
  const overlay=useMemo<TravelRouteOverlay|undefined>(()=>{
    if(!loaded||!plan.stops.length||missing.length)return undefined;
    return {stops:plan.stops.map(stop=>{const point=lookup.get(stop.pointId)!;return {id:point.id,title:point.title,emoji:point.emoji,location:point.location};}),legs:result?.legs??[],calculatedAt:result?.calculatedAt,provider:result?.provider,credit:result?.credit,draft:!result};
  },[loaded,plan,missing.length,lookup,result]);
  const expected=Math.max(0,plan.stops.length-1),confirmed=result?.legs.filter(leg=>leg.status==="ready"&&leg.distanceMeters!==null&&leg.durationSeconds!==null)??[];
  const allConfirmed=expected>0&&confirmed.length===expected;
  const totalDistance=confirmed.reduce((total,leg)=>total+leg.distanceMeters!,0),totalDuration=confirmed.reduce((total,leg)=>total+leg.durationSeconds!,0);
  function showRoute(){
    if(!overlay)return;
    const locations=[...overlay.stops.map(stop=>stop.location),...overlay.legs.flatMap(leg=>leg.paths.flat())];if(!locations.length)return;
    setRouteFocus({location:locations[0],locations,nonce:Date.now()});
  }
  const selectedId=planning?pickedId:mapProps.selectedId;
  return <div className="travel-route-planner">
    <div className="travel-route-planner__map"><ExplorerMap {...mapProps} selectedId={selectedId} onSelectPoint={pick} focus={routeFocus??mapProps.focus} travelRoute={overlay} contextPointId={planning?null:mapProps.contextPointId} contextPopup={planning?null:mapProps.contextPopup} gestureTool={planning?null:mapProps.gestureTool} onCanvasPick={planning?undefined:mapProps.onCanvasPick} onSelectNote={planning?undefined:id=>{setExpanded(false);mapProps.onSelectNote?.(id);}}/></div>
    {outdated&&!expanded&&<p className="travel-route-planner__outdated" role="status">계산한 지 오래됐어요. 이전 결과가 표시돼요. 동선을 열어 다시 계산해 주세요.</p>}
    <div className="travel-route-planner__bar">
      <button type="button" aria-label="이동 동선 짜기" aria-expanded={expanded} aria-controls={sheetId} disabled={!loaded} onClick={()=>plan.stops.length?setExpanded(value=>!value):begin()}><span aria-hidden="true">🧭</span> 이동 동선 짜기 <small>{plan.stops.length}곳</small></button>
      {planning&&<button type="button" className="travel-route-planner__done" onClick={()=>{setPlanning(false);setPickedId(null);setNotice("장소 선택을 마쳤어요. 동선은 지도에 계속 표시돼요.");}}>선택 완료</button>}
    </div>
    {expanded&&<section className="travel-route-planner__sheet" id={sheetId} aria-label="여행 동선">
      <header><strong>나의 이동 동선</strong><button type="button" aria-label="동선 패널 접기" onClick={()=>setExpanded(false)}>⌄</button></header>
      <p className="travel-route-planner__help">이 기기에 나만의 동선으로 저장돼요.</p>
      {outdated&&<p className="travel-route-planner__notice" role="status">계산한 지 오래됐어요. 지도에는 이전 결과가 표시돼요. 다시 계산해 주세요.</p>}
      {notice&&<p className="travel-route-planner__notice" role="status">{notice}</p>}
      {storageMessage&&<p className="travel-route-planner__notice" role="status">{storageMessage}</p>}
      <div className="travel-route-planner__actions"><button type="button" onClick={planning?()=>{setPlanning(false);setPickedId(null);setNotice("");}:begin}>{planning?"장소 선택 완료":"장소 더 선택"}</button><button type="button" disabled={!overlay} onClick={showRoute}>전체 동선 보기</button><button type="button" disabled={!plan.stops.length} onClick={()=>{change(emptyTravelPlan());setPlanning(false);setPickedId(null);setRouteFocus(null);}}>동선 비우기</button></div>
      {!plan.stops.length?<p className="travel-route-planner__help">지도에서 첫 번째 방문 장소를 골라 주세요.</p>:<ol className="travel-route-planner__stops">{plan.stops.map((stop,index)=>{
        const point=lookup.get(stop.pointId),leg=result?.legs.find(item=>item.fromId===stop.pointId&&item.toId===plan.stops[index+1]?.pointId&&item.mode===stop.mode);
        return <li key={stop.pointId}><div className="travel-route-planner__stop"><b aria-hidden="true">{index+1}</b><span>{point?`${point.emoji} ${point.title}`:"현재 조건에서 숨겨진 장소"}</span><div><button type="button" aria-label={`${index+1}번 장소 위로 이동`} disabled={index===0} onClick={()=>reorder(index,-1)}>↑</button><button type="button" aria-label={`${index+1}번 장소 아래로 이동`} disabled={index===plan.stops.length-1} onClick={()=>reorder(index,1)}>↓</button><button type="button" aria-label={`${index+1}번 장소 동선에서 삭제`} onClick={()=>change({stops:plan.stops.filter((_,position)=>position!==index)})}>×</button></div></div>
          {index<plan.stops.length-1&&<div className="travel-route-planner__leg"><label>{index+1} → {index+2}<select aria-label={`${index+1}→${index+2} 구간 이동 수단`} value={stop.mode} onChange={event=>mode(index,event.target.value as TravelMode)}><option value="car">🚗 자동차</option><option value="walk">🚶 도보 · 승인 후 이용</option></select></label><span>{leg?.status==="ready"?`${formatTravelDistance(leg.distanceMeters)} · 약 ${formatTravelDuration(leg.durationSeconds)}`:leg?.message??(missing.length?"숨겨진 장소를 다시 표시하면 계산할 수 있어요.":loading?"실제 도로의 이동 정보 계산 중…":"이동 정보 확인 전")}</span></div>}
        </li>;
      })}</ol>}
      {missing.length>0&&<p className="travel-route-planner__notice" role="status">현재 조건에서 보이지 않는 장소가 {missing.length}곳 있어요. 선택한 순서는 보관하며 조건을 바꾸면 다시 계산해요.</p>}
      {error&&<p className="travel-route-planner__error" role="alert">{error}</p>}
      {loading&&<p className="travel-route-planner__help" role="status">이동 동선을 계산하고 있어요…</p>}
      {confirmed.length>0&&<p className="travel-route-planner__total">{allConfirmed?"총 이동":"확인된 "+confirmed.length+"개 구간"} · {formatTravelDistance(totalDistance)} · 약 {formatTravelDuration(totalDuration)}</p>}
      {expected>0&&!loading&&!allConfirmed&&<p className="travel-route-planner__help">확인하지 못한 구간은 전체 거리·시간에 포함하지 않아요.</p>}
      {expected>0&&<button type="button" className="travel-route-planner__retry" disabled={loading||!requestKey||!!missing.length} onClick={()=>setRetry(value=>value+1)}>다시 계산</button>}
      {result&&<p className="travel-route-planner__help">계산 시각: {calculationTime(result.calculatedAt)}<br/>조회 시점의 예상시간이며 장소 체류시간은 제외돼요.{result.credit&&<><br/>{result.credit}</>}</p>}
    </section>}
  </div>;
}
