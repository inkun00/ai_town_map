"use client";

import {useEffect,useMemo,useRef,useState,type ComponentProps} from "react";
import KakaoMap,{type MapFocus} from "./KakaoMap";
import CommunityBlankMap from "./CommunityBlankMap";
import {WeatherImageActions} from "./WeatherImageActions";
import {weatherImageFilename} from "@/lib/weather-image-export";
import {centerCommunityBounds,initialCommunityBounds,pointWithinCommunityBounds,validCommunityBounds,type CommunityBounds} from "@/domain/community-blank-map";
import type {WeatherBoundaryResult} from "@/domain/weather-boundaries";
import {formatTravelDistance,formatTravelDuration,travelLegLabel,travelModeColor,travelModeLabel,travelRouteSummary} from "@/domain/travel-route";
import "@/app/explorer-map.css";

type Props=ComponentProps<typeof KakaoMap>&{title?:string;subtitle?:string};
type BoundaryResult=WeatherBoundaryResult&{level:"dong"|"district"};

/** Pickers remain the original SDK; every viewing map gains a personal white map. */
export default function ExplorerMap(props:Props){return props.onPick||props.compact?<KakaoMap {...props}/>:<ExplorerMapViewer {...props}/>;}
function ExplorerMapViewer(props:Props){
  const {title="탐험 지도",subtitle="",points=[],focus,center,onBoundsChange}=props;
  const [blank,setBlank]=useState(false),[bounds,setBounds]=useState<CommunityBounds>(()=>initialCommunityBounds(points,center,focus)),[restoreFocus,setRestoreFocus]=useState<MapFocus|null>(null);
  const [boundaries,setBoundaries]=useState<BoundaryResult|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState(""),[attempt,setAttempt]=useState(0);
  const host=useRef<HTMLDivElement>(null),blankRef=useRef(blank);blankRef.current=blank;
  const boundsCallback=useRef(onBoundsChange);boundsCallback.current=onBoundsChange;
  const previousViewport=useRef(bounds);
  useEffect(()=>{const changed=previousViewport.current!==bounds;previousViewport.current=bounds;if(blank&&changed)boundsCallback.current?.(bounds);},[bounds,blank]);
  const previousFocus=useRef(focus);
  const previousCenter=useRef(`${center?.lat??""}:${center?.lng??""}`);
  useEffect(()=>{
    const centerSignature=`${center?.lat??""}:${center?.lng??""}`,changedFocus=previousFocus.current!==focus,changedCenter=previousCenter.current!==centerSignature;
    previousFocus.current=focus;previousCenter.current=centerSignature;if(!changedFocus&&!changedCenter)return;setRestoreFocus(null);
    if(focus)setBounds(previous=>focus.locations?.length||focus.radiusMeters?initialCommunityBounds(points,center,focus):centerCommunityBounds(previous,focus.location));
    else if(center&&changedCenter)setBounds(previous=>centerCommunityBounds(previous,center));
  },[focus,points,center]);
  const signature=bounds.map(value=>value.toFixed(6)).join(",");
  useEffect(()=>{
    if(!blank)return;
    const controller=new AbortController();let active=true;setLoading(true);setError("");
    const timer=window.setTimeout(()=>{
      void fetch(`/api/v1/map-boundaries?${new URLSearchParams({bounds:signature})}`,{signal:AbortSignal.any([controller.signal,AbortSignal.timeout(20000)])}).then(async response=>{const body=await response.json();if(!response.ok)throw new Error(body.error?.message??"행정구역 경계를 불러오지 못했어요.");return body.data as BoundaryResult;}).then(data=>{if(active)setBoundaries(data);}).catch(cause=>{if(active)setError(cause instanceof Error?cause.message:"경계를 불러오지 못했어요.");}).finally(()=>{if(active)setLoading(false);});
    },350);
    return()=>{active=false;window.clearTimeout(timer);controller.abort();};
  },[blank,signature,attempt]);
  function viewport(value:CommunityBounds){if(!validCommunityBounds(value))return;setBounds(value);}
  function sdkBounds(value:CommunityBounds){if(blankRef.current||!validCommunityBounds(value))return;setBounds(previous=>previous.every((item,index)=>Math.abs(item-value[index])<1e-8)?previous:value);boundsCallback.current?.(value);}
  function toggle(){
    if(props.gestureTool)props.onGestureEnd?.(null);
    if(blank){setRestoreFocus({location:{lat:(bounds[1]+bounds[3])/2,lng:(bounds[0]+bounds[2])/2},locations:[{lat:bounds[1],lng:bounds[0]},{lat:bounds[3],lng:bounds[2]}],nonce:Date.now()});}
    setBlank(value=>!value);
  }
  const visible=useMemo(()=>points.filter(point=>pointWithinCommunityBounds(point.location,bounds)),[points,bounds]);
  const options=useMemo(()=>{
    const legend=new Map<string,{label:string;color:string}>();
    for(const point of visible){if(point.rating&&point.color.toLowerCase()===point.rating.color.toLowerCase()&&!point.selectionState)legend.set(point.rating.label,{label:point.rating.label,color:point.rating.color});if(point.selectionState)legend.set(point.selectionState,{label:point.selectionState==="selected"?"선택된 포인트":"선택하지 않은 포인트",color:point.selectionState==="selected"?"#1d4ed8":"#f1f5f9"});}
    const route=props.travelRoute,travelDetails:string[]=[],travelFootnotes:string[]=[];
    if(route){
      travelDetails.push(`여행 방문 순서: ${route.stops.slice(0,12).map((stop,index)=>`${index+1}. ${stop.title}`).join(" → ")}`);
      if(route.draft)travelDetails.push("여행 동선은 아직 계산하지 않았어요. 방문 순서만 표시합니다.");
      else{
        for(const [index,leg] of route.legs.slice(0,11).entries()){travelDetails.push(`${index+1}구간 · ${travelLegLabel(leg)}`);if(leg.status==="ready")legend.set(`travel:${leg.mode}`,{label:`${travelModeLabel(leg.mode)} (자동차 기준)`,color:travelModeColor(leg.mode)});}
        const total=travelRouteSummary(route);travelDetails.push(`${total.complete?"전체 구간 합계":"확인된 구간 합계"}: ${formatTravelDistance(total.distanceMeters)} · ${formatTravelDuration(total.durationSeconds)}`);
        if(route.calculatedAt){const date=new Date(route.calculatedAt);travelFootnotes.push(`동선 계산: ${Number.isNaN(date.getTime())?route.calculatedAt:new Intl.DateTimeFormat("ko-KR",{timeZone:"Asia/Seoul",dateStyle:"medium",timeStyle:"short"}).format(date)}`);}
        travelFootnotes.push(`동선 출처: ${route.credit??route.provider??"경로 제공자 정보 없음"} · 자동차 기준 실제 도로 경로의 예상시간이며 교통 상황에 따라 달라질 수 있습니다.`);
      }
    }
    return {title,subtitle:subtitle||"백지도 · 현재 표시 범위",details:[`표시된 위치포인트 ${visible.length}개`,...travelDetails],legend:[...legend.values()].slice(0,20),footnotes:[...(legend.size>20?[`범례 외 ${legend.size-20}종`]:[]),...(boundaries?.missingIds.length?[`일부 지역 경계 ${boundaries.missingIds.length}곳 없음`]:[]),boundaries?`경계: ${boundaries.source} · ${boundaries.updatedAt} · https://github.com/vuski/admdongkor`:"행정구역 경계 자료 없음",...(props.workbench?["반경·연결선·메모는 개인 분석 도구의 표시 상태입니다."]:[]),...travelFootnotes]};
  },[title,subtitle,visible,boundaries,props.workbench,props.travelRoute]);
  return <div className="explorer-map" ref={host}>
    <div className={`explorer-map-sdk${blank?" explorer-map-sdk--hidden":""}`} aria-hidden={blank} inert={blank}>
      <KakaoMap {...props} focus={restoreFocus??focus} onBoundsChange={sdkBounds} gestureTool={blank?null:props.gestureTool} contextPointId={blank?null:props.contextPointId} contextPopup={blank?null:props.contextPopup}/>
    </div>
    {blank&&<CommunityBlankMap {...props} bounds={bounds} onViewportChange={viewport} features={boundaries?.features??[]} loading={loading} error={error} onRetry={()=>setAttempt(value=>value+1)}/>}
    {blank&&boundaries&&<a className="community-map-attribution" href="https://github.com/vuski/admdongkor" target="_blank" rel="noopener noreferrer">경계: SGIS · vuski/admdongkor · CC BY 4.0</a>}
    {blank&&!!boundaries?.missingIds.length&&<p className="community-map-missing" role="status">일부 지역 경계 {boundaries.missingIds.length}곳 없음</p>}
    <div className={`explorer-map-tools${props.gestureTool?" explorer-map-tools--gesturing":""}`}>
      <button type="button" className="explorer-map-toggle" aria-label="백지도" aria-pressed={blank} onClick={toggle}>🗺️ 백지도</button>
      {blank&&<WeatherImageActions label="지도" getSvg={()=>host.current?.querySelector<SVGSVGElement>(".community-blank-map-canvas")??null} options={options} filename={weatherImageFilename(`${title}_백지도`,"","")} disabled={loading||!!error}/>}
    </div>
  </div>;
}
