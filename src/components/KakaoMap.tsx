"use client";

import Script from "next/script";
import {pinSvg,selectionPinSvg,type PointSelectionState,type RatingMeaning} from "@/domain/point-presentation";
import {PointDialog} from "./PointDialog";
import {groupMapPoints} from "@/domain/map-points";
import {formatDistance,connectionSegments,type WorkbenchState} from "@/domain/map-workbench";
import {PointInteraction,type GestureTool} from "./PointInteraction";
import {acquirePrecisePosition,GeolocationMeasurementError,type LocationFix} from "@/lib/geolocation";
import { useEffect, useRef, useState } from "react";

export type Coordinates={lat:number;lng:number};
export type MapFocus={location:Coordinates;nonce:number;radiusMeters?:number;locations?:Coordinates[]};
export type MapPoint={id:string;title:string;emoji:string;color:string;description?:string;rating?:RatingMeaning|null;selectionState?:PointSelectionState;location:Coordinates};
type Props={autoLocate?:boolean;center?:Coordinates|null;points?:MapPoint[];selectedId?:string|null;onSelectPoint?:(id:string)=>void;onBoundsChange?:(bounds:[number,number,number,number])=>void;onPick?:(location:Coordinates,source:"gps"|"search"|"manual",label?:string)=>void;chosen?:Coordinates|null;compact?:boolean;workbench?:WorkbenchState;anchorPoints?:MapPoint[];onCanvasPick?:(location:Coordinates)=>void;focus?:MapFocus|null;contextPointId?:string|null;contextPopup?:React.ReactNode;onCloseContext?:()=>void;gestureTool?:GestureTool|null;onSelectNote?:(id:string)=>void;onGestureEnd?:(result:{pointId:string;meters?:number;targetId?:string}|null)=>void};
type KakaoBounds={extend:(position:unknown)=>void};
export type KakaoOverlay={setMap:(map:KakaoMapObject|null)=>void;setRadius?:(radius:number)=>void;setPath?:(path:unknown[])=>void};
export type KakaoApi={maps:{LatLngBounds:new()=>KakaoBounds;Circle:new(options:Record<string,unknown>)=>KakaoOverlay;Polyline:new(options:Record<string,unknown>)=>KakaoOverlay;CustomOverlay:new(options:Record<string,unknown>)=>KakaoOverlay;load:(callback:()=>void)=>void;LatLng:new(lat:number,lng:number)=>unknown;Map:new(element:HTMLElement,options:Record<string,unknown>)=>KakaoMapObject;Marker:new(options:Record<string,unknown>)=>KakaoMarker;MarkerImage:new(src:string,size:unknown,options?:Record<string,unknown>)=>unknown;Size:new(width:number,height:number)=>unknown;Point:new(x:number,y:number)=>unknown;MarkerClusterer:new(options:Record<string,unknown>)=>{addMarkers:(markers:KakaoMarker[])=>void;clear:()=>void};services:{Places:new()=>{keywordSearch:(term:string,callback:(result:{x:string;y:string;place_name:string}[],status:string)=>void)=>void};Status:{OK:string}};event:{removeListener:(target:unknown,name:string,callback:()=>void)=>void;addListener:(target:unknown,name:string,callback:(event?:{latLng?:{getLat:()=>number;getLng:()=>number}})=>void)=>void}}};
export type KakaoMapObject={getDraggable:()=>boolean;setDraggable:(value:boolean)=>void;getZoomable:()=>boolean;setZoomable:(value:boolean)=>void;getProjection:()=>{containerPointFromCoords:(position:unknown)=>{x:number;y:number};coordsFromContainerPoint:(point:unknown)=>{getLat:()=>number;getLng:()=>number}};setBounds:(bounds:KakaoBounds,paddingTop?:number,paddingRight?:number,paddingBottom?:number,paddingLeft?:number)=>void;setCenter:(center:unknown)=>void;relayout:()=>void;getCenter:()=>{getLat:()=>number;getLng:()=>number};getBounds:()=>{getSouthWest:()=>{getLat:()=>number;getLng:()=>number};getNorthEast:()=>{getLat:()=>number;getLng:()=>number}};setLevel:(level:number)=>void};
type KakaoMarker={setMap:(map:KakaoMapObject|null)=>void};
declare global {interface Window {kakao?:KakaoApi}}

const defaultCenter={lat:37.5665,lng:126.978};
const key=process.env.NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY;
function markerImage(kakao:KakaoApi,glyph:string,color:string,selected:boolean,symbol?:string,count=1) {
  const svg=pinSvg(glyph,color,selected,symbol,count);
  return new kakao.maps.MarkerImage(`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,new kakao.maps.Size(48,54),{offset:new kakao.maps.Point(21,50)});
}
function selectionMarkerImage(kakao:KakaoApi,glyph:string,state:PointSelectionState|"mixed",focused:boolean,selectedCount:number,count:number){
  const svg=selectionPinSvg(glyph,state,focused,selectedCount,count);
  return new kakao.maps.MarkerImage(`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,new kakao.maps.Size(48,54),{offset:new kakao.maps.Point(21,50)});
}
function fixCoordinates(fix:LocationFix):Coordinates{return {lat:fix.lat,lng:fix.lng};}
function measurementAge(observedAt:string,now:number){
  const seconds=Math.max(0,Math.floor((now-Date.parse(observedAt))/1000));
  return seconds<5?"방금 측정":seconds<60?`${seconds}초 전 측정`:`${Math.floor(seconds/60)}분 전 측정`;
}

export default function KakaoMap({center,points=[],selectedId,onSelectPoint,onBoundsChange,onPick,chosen,compact=false,workbench,anchorPoints=points,onCanvasPick,focus,contextPointId,contextPopup,onCloseContext,gestureTool,onGestureEnd,onSelectNote,autoLocate=true}:Props) {
  const elementRef=useRef<HTMLDivElement>(null);
  const mapRef=useRef<KakaoMapObject|null>(null);
  const pinRef=useRef<KakaoMarker[]>([]);
  const clusterRef=useRef<{clear:()=>void}|null>(null);
  const chosenRef=useRef<KakaoMarker|null>(null);
  const onPickRef=useRef(onPick); onPickRef.current=onPick;
  const noteSelectRef=useRef(onSelectNote);noteSelectRef.current=onSelectNote;
  const closeContextRef=useRef(onCloseContext);closeContextRef.current=onCloseContext;
  const canvasPickRef=useRef(onCanvasPick);canvasPickRef.current=onCanvasPick;
  const boundsRef=useRef(onBoundsChange);boundsRef.current=onBoundsChange;
  const [ready,setReady]=useState(false);
  const [error,setError]=useState("");
  const [search,setSearch]=useState("");
  const [searching,setSearching]=useState(false);
  const [overlapIds,setOverlapIds]=useState<string[]>([]);
  const overlapPoints=points.filter(point=>overlapIds.includes(point.id));
  const [gpsCandidate,setGpsCandidate]=useState<LocationFix|null>(null);
  const [locating,setLocating]=useState(false);
  const [sampleCount,setSampleCount]=useState(0);
  const [measurementFailed,setMeasurementFailed]=useState(false);
  const [clock,setClock]=useState(()=>Date.now());
  const locateControllerRef=useRef<AbortController|null>(null);
  const lookupRef=useRef(0);
  const currentLocationRef=useRef<KakaoMarker|null>(null);
  const autoLocatedRef=useRef(false);
  const [currentLocation,setCurrentLocation]=useState<LocationFix|null>(null);
  const viewing=!compact&&!onPick;
  const displayedFix=viewing?currentLocation:gpsCandidate;

  // Aborting and invalidating are both necessary: a callback already queued by a
  // browser must not replace a place the user has picked while GPS was measuring.
  function stopLocating(){
    lookupRef.current++;
    locateControllerRef.current?.abort();
    locateControllerRef.current=null;
    setLocating(false);
  }

  useEffect(()=>{
    if(!displayedFix)return;
    setClock(Date.now());
    const timer=window.setInterval(()=>setClock(Date.now()),1000);
    return()=>window.clearInterval(timer);
  },[displayedFix]);

  useEffect(()=>{
    if(!ready || !elementRef.current || !window.kakao || mapRef.current) return;
    const kakao=window.kakao;
    const start=center??defaultCenter;
    const map=new kakao.maps.Map(elementRef.current,{center:new kakao.maps.LatLng(start.lat,start.lng),level:compact?4:5});
    mapRef.current=map;
    const reportBounds=()=>{const bounds=map.getBounds(),sw=bounds.getSouthWest(),ne=bounds.getNorthEast();boundsRef.current?.([sw.getLng(),sw.getLat(),ne.getLng(),ne.getLat()]);};
    kakao.maps.event.addListener(map,"idle",reportBounds);
    const cancelForInteraction=()=>{stopLocating();setGpsCandidate(null);setSearching(false);};
    const pickOnMap=(event?:{latLng?:{getLat:()=>number;getLng:()=>number}})=>{const latLng=event?.latLng;closeContextRef.current?.();cancelForInteraction();if(latLng&&(onPickRef.current||canvasPickRef.current)) {const location={lat:latLng.getLat(),lng:latLng.getLng()};onPickRef.current?.(location,"manual");canvasPickRef.current?.(location);}};
    kakao.maps.event.addListener(map,"dragstart",cancelForInteraction);
    kakao.maps.event.addListener(map,"click",pickOnMap);
    const element=elementRef.current;
    element.addEventListener("pointerdown",cancelForInteraction);
    element.addEventListener("wheel",cancelForInteraction,{passive:true});
    const timer=window.setTimeout(()=>{map.relayout();reportBounds();},80);
    const observer=new ResizeObserver(()=>{map.relayout();reportBounds();});
    observer.observe(elementRef.current);
    return ()=>{window.clearTimeout(timer);observer.disconnect();lookupRef.current++;locateControllerRef.current?.abort();locateControllerRef.current=null;element.removeEventListener("pointerdown",cancelForInteraction);element.removeEventListener("wheel",cancelForInteraction);kakao.maps.event.removeListener(map,"idle",reportBounds);kakao.maps.event.removeListener(map,"dragstart",cancelForInteraction);kakao.maps.event.removeListener(map,"click",pickOnMap);currentLocationRef.current?.setMap(null);currentLocationRef.current=null;mapRef.current=null;};
  },[ready,compact]);

  useEffect(()=>{const kakao=window.kakao;if(ready && kakao && mapRef.current && center){stopLocating();setGpsCandidate(null);mapRef.current.setCenter(new kakao.maps.LatLng(center.lat,center.lng));}},[ready,center?.lat,center?.lng]);

  useEffect(()=>{
    const kakao=window.kakao,map=mapRef.current;if(!ready||!kakao||!map||!focus)return;
    stopLocating();setGpsCandidate(null);
    let positions=focus.locations;
    if(focus.radiusMeters){
      const deltaLat=focus.radiusMeters/111195.08,deltaLng=deltaLat/Math.max(.01,Math.cos(focus.location.lat*Math.PI/180));
      positions=[{lat:Math.max(-90,focus.location.lat-deltaLat),lng:Math.max(-180,focus.location.lng-deltaLng)},{lat:Math.min(90,focus.location.lat+deltaLat),lng:Math.min(180,focus.location.lng+deltaLng)}];
    }
    if(positions&&positions.length>1){const bounds=new kakao.maps.LatLngBounds();positions.forEach(position=>bounds.extend(new kakao.maps.LatLng(position.lat,position.lng)));map.setBounds(bounds,80,35,80,35);}
    else map.setCenter(new kakao.maps.LatLng(focus.location.lat,focus.location.lng));
  },[ready,focus]);

  useEffect(()=>{if(gestureTool){stopLocating();setGpsCandidate(null);}},[gestureTool]);

  const chosenSignature=chosen?`${chosen.lat}:${chosen.lng}`:"";
  const previousChosenRef=useRef(chosenSignature);
  useEffect(()=>{
    if(previousChosenRef.current!==chosenSignature){stopLocating();setGpsCandidate(null);}
    previousChosenRef.current=chosenSignature;
  },[chosenSignature]);

  useEffect(()=>{
    const kakao=window.kakao,map=mapRef.current;
    if(!ready||!kakao||!map||!workbench)return;
    const overlays:KakaoOverlay[]=[];
    const latLng=(location:Coordinates)=>new kakao.maps.LatLng(location.lat,location.lng);
    const label=(location:Coordinates,text:string,className="map-drawing-label",color?:string,noteId?:string)=>{
      const content=document.createElement(noteId?"button":"div");content.className=className;content.textContent=text;
      if(noteId){content.setAttribute("type","button");content.setAttribute("aria-label",`${text} 메모 수정`);content.addEventListener("click",event=>{event.stopPropagation();noteSelectRef.current?.(noteId);});}
      if(color)content.style.backgroundColor=color;
      overlays.push(new kakao.maps.CustomOverlay({map,position:latLng(location),content,clickable:!!noteId,xAnchor:.5,yAnchor:1.1,zIndex:4}));
    };
    const lookup=new Map(anchorPoints.map(point=>[point.id,point]));
    if(workbench.layers.radii)for(const radius of workbench.radii){
      const point=lookup.get(radius.pointId);if(!point||gestureTool?.kind==="radius"&&gestureTool.pointId===point.id)continue;
      for(const meters of [...new Set(radius.meters)].sort((a,b)=>b-a)){
        overlays.push(new kakao.maps.Circle({map,center:latLng(point.location),radius:meters,strokeWeight:2,strokeColor:"#2563eb",strokeOpacity:.85,strokeStyle:"dash",fillColor:"#93c5fd",fillOpacity:.06,zIndex:1}));
        // Geographic north edge of each circle, with a distance label in meters.
        label({lat:Math.min(90,point.location.lat+meters/111195.08),lng:point.location.lng},`반경 ${formatDistance(meters)}`);
      }
    }
    if(workbench.layers.route){
      for(const segment of connectionSegments(workbench,anchorPoints)){
        const from=segment.from.location!,to=segment.to.location!;
        overlays.push(new kakao.maps.Polyline({map,path:[latLng(from),latLng(to)],strokeWeight:4,strokeColor:"#9b43cc",strokeOpacity:.9,zIndex:2}));
        label({lat:(from.lat+to.lat)/2,lng:(from.lng+to.lng)/2},`${segment.index+1}구간 · ${formatDistance(segment.meters)}`);
      }
      workbench.route.forEach((id,index)=>{const point=lookup.get(id);if(point)label(point.location,String(index+1),"map-drawing-order");});
    }
    if(workbench.layers.notes)for(const note of workbench.notes)label(note.location,[note.emoji,note.text].filter(Boolean).join(" "),`map-drawing-note${note.text?"":" map-drawing-note--emoji"}`,note.color,note.id);
    return()=>{overlays.forEach(overlay=>overlay.setMap(null));};
  },[ready,workbench,anchorPoints,gestureTool]);

  useEffect(()=>{
    if(!ready||!mapRef.current||!viewing||!autoLocate||autoLocatedRef.current)return;
    autoLocatedRef.current=true;
    locate();
  },[ready,viewing,autoLocate]);

  useEffect(()=>{
    const kakao=window.kakao,map=mapRef.current;
    if(!ready||!kakao||!map||!currentLocation||!viewing)return;
    currentLocationRef.current?.setMap(null);
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="15" fill="#2563eb" fill-opacity=".18"/><circle cx="16" cy="16" r="8" fill="#2563eb" stroke="white" stroke-width="3"/></svg>';
    const marker=new kakao.maps.Marker({position:new kakao.maps.LatLng(currentLocation.lat,currentLocation.lng),image:new kakao.maps.MarkerImage(`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,new kakao.maps.Size(32,32),{offset:new kakao.maps.Point(16,16)}),title:"최근 측정 위치",zIndex:5});
    marker.setMap(map);currentLocationRef.current=marker;
    return ()=>{marker.setMap(null);};
  },[ready,currentLocation,viewing]);

  useEffect(()=>{
    const kakao=window.kakao,map=mapRef.current;
    if(!ready||!kakao||!map||!displayedFix)return;
    // This solid blue area is the device's measured uncertainty, separate from
    // the dashed radius drawings in a personal analysis map.
    const circle=new kakao.maps.Circle({map,center:new kakao.maps.LatLng(displayedFix.lat,displayedFix.lng),radius:displayedFix.accuracy,strokeWeight:1,strokeColor:"#2563eb",strokeOpacity:.65,strokeStyle:"solid",fillColor:"#60a5fa",fillOpacity:.15,zIndex:0});
    return()=>circle.setMap(null);
  },[ready,displayedFix]);

  useEffect(()=>{
    const kakao=window.kakao,map=mapRef.current;
    if(!ready || !kakao || !map) return;
    clusterRef.current?.clear(); pinRef.current.forEach((marker)=>marker.setMap(null));
    const hasSelection=points.some(point=>point.selectionState!==undefined);
    const markers=groupMapPoints(points).map((group)=>{
      const point=group.find(item=>item.id===selectedId)??group[0];
      const selectable=group.some(item=>item.selectionState!==undefined);
      const selectedCount=group.filter(item=>item.selectionState==="selected").length;
      const state:PointSelectionState|"mixed"=selectedCount===group.length?"selected":selectedCount===0?"unselected":"mixed";
      const selectionLabel=state==="selected"?"선택됨":state==="unselected"?"선택 안 됨":"일부 선택됨";
      const marker=new kakao.maps.Marker({position:new kakao.maps.LatLng(point.location.lat,point.location.lng),image:selectable?selectionMarkerImage(kakao,point.emoji,state,point.id===selectedId,selectedCount,group.length):markerImage(kakao,point.emoji,point.color,point.id===selectedId,point.rating?.symbol,group.length),zIndex:selectable?(point.id===selectedId?9:selectedCount>0?8:6):point.id===selectedId?7:6,clickable:true,title:selectable?group.length>1?`같은 위치의 포인트 ${group.length}개 · ${selectedCount}개 선택 · ${selectionLabel}`:`${point.description??point.title} · ${selectionLabel} · 누르면 ${state==="selected"?"선택 해제":"선택"}`:group.length>1?`같은 위치의 기록 ${group.length}개 · 개별 평가 확인`:(point.description??point.title)});
      kakao.maps.event.addListener(marker,"click",()=>{stopLocating();setGpsCandidate(null);if(group.length>1)setOverlapIds(group.map(item=>item.id));else onSelectPoint?.(point.id);});
      return marker;
    });
    pinRef.current=markers;
    if(markers.length>20 && !compact && !hasSelection) {const clusterer=new kakao.maps.MarkerClusterer({map,averageCenter:true,minLevel:6,disableClickZoom:false});clusterer.addMarkers(markers);clusterRef.current=clusterer;}
    else {markers.forEach((marker)=>marker.setMap(map));clusterRef.current=null;}
    return ()=>{clusterRef.current?.clear();markers.forEach((marker)=>marker.setMap(null));};
  },[ready,points,selectedId,onSelectPoint,compact]);

  useEffect(()=>{
    const kakao=window.kakao,map=mapRef.current;
    if(!ready || !kakao || !map) return;
    chosenRef.current?.setMap(null); chosenRef.current=null;
    const picked=gpsCandidate?fixCoordinates(gpsCandidate):chosen;
    if(picked) {const marker=new kakao.maps.Marker({position:new kakao.maps.LatLng(picked.lat,picked.lng),image:markerImage(kakao,"📍","#267253",true)});marker.setMap(map);chosenRef.current=marker;if(!gpsCandidate)map.setCenter(new kakao.maps.LatLng(picked.lat,picked.lng));}
    return()=>{chosenRef.current?.setMap(null);chosenRef.current=null;};
  },[ready,chosen,gpsCandidate]);

  function locate() {
    stopLocating();
    setError("");setMeasurementFailed(false);setLocating(true);setSampleCount(0);setSearching(false);
    const controller=new AbortController();locateControllerRef.current=controller;
    const lookup=++lookupRef.current;
    void acquirePrecisePosition({signal:controller.signal,onProgress:progress=>{
      if(controller.signal.aborted||lookup!==lookupRef.current)return;
      setSampleCount(progress.sampleCount);
      if(progress.fix){if(viewing)setCurrentLocation(progress.fix);else setGpsCandidate(progress.fix);}
    }}).then(result=>{
      if(controller.signal.aborted||lookup!==lookupRef.current)return;
      locateControllerRef.current=null;setLocating(false);setClock(Date.now());
      const map=mapRef.current,kakao=window.kakao;if(!map||!kakao)return;
      if(viewing)setCurrentLocation(result);else setGpsCandidate(result);
      map.setCenter(new kakao.maps.LatLng(result.lat,result.lng));map.setLevel(4);
    }).catch(failure=>{
      if(controller.signal.aborted||lookup!==lookupRef.current)return;
      locateControllerRef.current=null;setLocating(false);setMeasurementFailed(true);
      if(failure instanceof GeolocationMeasurementError&&failure.code==="permission-denied")setGpsCandidate(null);
      setError(failure instanceof Error?failure.message:"위치를 측정하지 못했어요. 다시 찾거나 지도를 눌러 직접 조정해 주세요.");
    });
  }
  function findPlace() {
    const kakao=window.kakao;if(!kakao || !search.trim()) return;
    stopLocating();setSearching(true);setError("");setGpsCandidate(null);
    const lookup=++lookupRef.current;
    new kakao.maps.services.Places().keywordSearch(search.trim(),(results,status)=>{
      if(lookup!==lookupRef.current)return;
      setSearching(false);
      if(status!==kakao.maps.services.Status.OK || !results.length) {setError("장소를 찾지 못했습니다. 다른 이름을 검색하거나 지도를 눌러주세요.");return;}
      const location={lat:Number(results[0].y),lng:Number(results[0].x)};
      mapRef.current?.setCenter(new kakao.maps.LatLng(location.lat,location.lng));mapRef.current?.setLevel(4);
      onPickRef.current?.(location,"search",results[0].place_name);
    });
  }
  if(!key) return <div className={`kakao-map-shell ${compact?"kakao-map-shell--compact":""}`}><div className="kakao-map-unavailable"><strong>지도를 준비하고 있습니다.</strong><span>잠시 후 다시 접속해 주세요. 기존 기록은 목록에서 확인할 수 있어요.</span></div></div>;
  return <div className={`kakao-map-shell ${compact?"kakao-map-shell--compact":""}`}>
    <Script src={`https://dapi.kakao.com/v2/maps/sdk.js?appkey=${encodeURIComponent(key)}&autoload=false&libraries=services,clusterer`} strategy="afterInteractive" onReady={()=>window.kakao?.maps.load(()=>setReady(true))} onError={()=>setError("지도를 불러오지 못했습니다. 연결 상태를 확인하고 새로고침해 주세요. 기존 기록은 목록에서 볼 수 있어요.")}/>
    <div className="kakao-map" ref={elementRef} role="region" aria-label="카카오 지도"/>
    {viewing&&ready&&mapRef.current&&window.kakao&&<PointInteraction map={mapRef.current} kakao={window.kakao} points={points} tool={gestureTool??null} contextId={contextPointId??null} popup={contextPopup} onEnd={onGestureEnd} onClose={onCloseContext} onArm={()=>{stopLocating();setGpsCandidate(null);}}/>}
    {viewing&&<button type="button" className="map-current-location" onClick={locate} disabled={!ready||locating||!!gestureTool} aria-label={locating?"정밀 위치 측정 중":"정밀하게 다시 찾기 · 현재 위치로 이동"}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg><span>{locating?"정밀 측정 중":"정밀하게 다시 찾기"}</span></button>}
    {(error||displayedFix||locating)&&<div className={`map-location-messages${viewing?" map-location-messages--viewing":""}`}>
      {error&&<div className="kakao-map-error" role="status"><span>{error}</span><button type="button" aria-label="위치·지도 안내 닫기" onClick={()=>setError("")}>×</button></div>}
      {viewing&&(displayedFix||locating)&&<div className="map-location-quality" role="status"><strong>{locating?`정밀 측정 중${sampleCount?` · ${sampleCount}회 확인`:" · 최대 15초"}`:measurementFailed?"이전 측정 위치":"최근 측정 위치"}</strong>{displayedFix&&<span>예상 오차 약 {Math.ceil(displayedFix.accuracy)}m · {measurementAge(displayedFix.observedAt,clock)}</span>}{displayedFix&&displayedFix.accuracy>50&&<small>오차가 커요. 건물 밖에서 다시 찾거나 지도를 직접 확인해 주세요.</small>}</div>}
      {onPick&&(gpsCandidate||locating)&&<div className="gps-confirm map-location-quality--picker" role="status"><span>{locating?`정밀 측정 중 · ${sampleCount?`${sampleCount}회 확인`:"최대 15초"}`:measurementFailed?"이전 측정 위치":"최근 측정 위치"}{gpsCandidate&&<> · 예상 오차 약 {Math.ceil(gpsCandidate.accuracy)}m<br/>{measurementAge(gpsCandidate.observedAt,clock)}. {gpsCandidate.accuracy>50?"오차가 커요. 지도에서 핀을 직접 조정해 주세요.":"핀을 확인하고, 다르면 지도를 눌러 조정해 주세요."}</>}</span>{gpsCandidate&&<button type="button" onClick={()=>{stopLocating();onPickRef.current?.(fixCoordinates(gpsCandidate),"gps");setGpsCandidate(null);}}>이 위치 사용</button>}</div>}
    </div>}
    {onPick && <div className="kakao-map-controls"><div className="kakao-map-search"><label className="sr-only" htmlFor={compact?"place-search-compact":"place-search-main"}>장소 검색</label><input id={compact?"place-search-compact":"place-search-main"} value={search} onFocus={()=>{stopLocating();setGpsCandidate(null);setSearching(false);}} onChange={(event)=>setSearch(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter"){event.preventDefault();event.stopPropagation();if(!event.nativeEvent.isComposing) findPlace();}}} placeholder="장소 검색"/><button type="button" onClick={findPlace} disabled={!ready||searching}>{searching?"검색 중":"검색"}</button></div><button type="button" onClick={locate} disabled={!ready||locating}>{locating?"정밀 측정 중":gpsCandidate?"◎ 다시 찾기":"◎ 현재 위치"}</button></div>}
    {overlapPoints.length>0 && <PointDialog label="같은 위치의 기록" onClose={()=>setOverlapIds([])}><h2>같은 위치의 기록 {overlapPoints.length}개</h2><p>{overlapPoints.some(point=>point.selectionState!==undefined)?"새 지도에 담을 포인트를 선택하거나 해제해 주세요.":"살펴볼 기록을 선택해 주세요."}</p><div className="overlap-records">{overlapPoints.map(point=><button type="button" key={point.id} className={point.selectionState?`overlap-record--${point.selectionState}`:undefined} aria-pressed={point.selectionState?point.selectionState==="selected":undefined} aria-label={point.selectionState?`${point.description??point.title} · ${point.selectionState==="selected"?"선택됨 · 선택 해제":"선택 안 됨 · 선택"}`:point.description??point.title} onClick={()=>{setOverlapIds([]);onSelectPoint?.(point.id);}}><span aria-hidden="true">{point.emoji}</span> <span>{point.title}{point.selectionState&&<strong className="overlap-selection-state">{point.selectionState==="selected"?"✓ 선택됨":"○ 선택 안 됨"}</strong>}{point.rating&&<small><span className="rating-symbol" aria-hidden="true">{point.rating.symbol}</span> {point.rating.label}</small>}</span></button>)}</div><button type="button" className="button button--light button--full" onClick={()=>setOverlapIds([])}>닫기</button></PointDialog>}
  </div>;
}
