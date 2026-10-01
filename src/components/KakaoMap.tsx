"use client";

import Script from "next/script";
import {pinSvg,type RatingMeaning} from "@/domain/point-presentation";
import {PointDialog} from "./PointDialog";
import {groupMapPoints} from "@/domain/map-points";
import {formatDistance,routeSegments,type WorkbenchState} from "@/domain/map-workbench";
import { useEffect, useRef, useState } from "react";

export type Coordinates={lat:number;lng:number};
export type MapFocus={location:Coordinates;nonce:number;radiusMeters?:number;locations?:Coordinates[]};
export type MapPoint={id:string;title:string;emoji:string;color:string;description?:string;rating?:RatingMeaning|null;location:Coordinates};
type Props={center?:Coordinates|null;points?:MapPoint[];selectedId?:string|null;onSelectPoint?:(id:string)=>void;onBoundsChange?:(bounds:[number,number,number,number])=>void;onPick?:(location:Coordinates,source:"gps"|"search"|"manual",label?:string)=>void;chosen?:Coordinates|null;compact?:boolean;workbench?:WorkbenchState;anchorPoints?:MapPoint[];onCanvasPick?:(location:Coordinates)=>void;focus?:MapFocus|null};
type KakaoBounds={extend:(position:unknown)=>void};
type KakaoOverlay={setMap:(map:KakaoMapObject|null)=>void};
type KakaoApi={maps:{LatLngBounds:new()=>KakaoBounds;Circle:new(options:Record<string,unknown>)=>KakaoOverlay;Polyline:new(options:Record<string,unknown>)=>KakaoOverlay;CustomOverlay:new(options:Record<string,unknown>)=>KakaoOverlay;load:(callback:()=>void)=>void;LatLng:new(lat:number,lng:number)=>unknown;Map:new(element:HTMLElement,options:Record<string,unknown>)=>KakaoMapObject;Marker:new(options:Record<string,unknown>)=>KakaoMarker;MarkerImage:new(src:string,size:unknown,options?:Record<string,unknown>)=>unknown;Size:new(width:number,height:number)=>unknown;Point:new(x:number,y:number)=>unknown;MarkerClusterer:new(options:Record<string,unknown>)=>{addMarkers:(markers:KakaoMarker[])=>void;clear:()=>void};services:{Places:new()=>{keywordSearch:(term:string,callback:(result:{x:string;y:string;place_name:string}[],status:string)=>void)=>void};Status:{OK:string}};event:{addListener:(target:unknown,name:string,callback:(event?:{latLng?:{getLat:()=>number;getLng:()=>number}})=>void)=>void}}};
type KakaoMapObject={setBounds:(bounds:KakaoBounds,paddingTop?:number,paddingRight?:number,paddingBottom?:number,paddingLeft?:number)=>void;setCenter:(center:unknown)=>void;relayout:()=>void;getCenter:()=>{getLat:()=>number;getLng:()=>number};getBounds:()=>{getSouthWest:()=>{getLat:()=>number;getLng:()=>number};getNorthEast:()=>{getLat:()=>number;getLng:()=>number}};setLevel:(level:number)=>void};
type KakaoMarker={setMap:(map:KakaoMapObject|null)=>void};
declare global {interface Window {kakao?:KakaoApi}}

const defaultCenter={lat:37.5665,lng:126.978};
const key=process.env.NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY;
function markerImage(kakao:KakaoApi,glyph:string,color:string,selected:boolean,symbol?:string,count=1) {
  const svg=pinSvg(glyph,color,selected,symbol,count);
  return new kakao.maps.MarkerImage(`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,new kakao.maps.Size(48,54),{offset:new kakao.maps.Point(21,50)});
}

export default function KakaoMap({center,points=[],selectedId,onSelectPoint,onBoundsChange,onPick,chosen,compact=false,workbench,anchorPoints=points,onCanvasPick,focus}:Props) {
  const elementRef=useRef<HTMLDivElement>(null);
  const mapRef=useRef<KakaoMapObject|null>(null);
  const pinRef=useRef<KakaoMarker[]>([]);
  const clusterRef=useRef<{clear:()=>void}|null>(null);
  const chosenRef=useRef<KakaoMarker|null>(null);
  const onPickRef=useRef(onPick); onPickRef.current=onPick;
  const canvasPickRef=useRef(onCanvasPick);canvasPickRef.current=onCanvasPick;
  const boundsRef=useRef(onBoundsChange);boundsRef.current=onBoundsChange;
  const [ready,setReady]=useState(false);
  const [error,setError]=useState("");
  const [search,setSearch]=useState("");
  const [searching,setSearching]=useState(false);
  const [overlapIds,setOverlapIds]=useState<string[]>([]);
  const overlapPoints=points.filter(point=>overlapIds.includes(point.id));
  const [gpsCandidate,setGpsCandidate]=useState<{location:Coordinates;accuracy:number}|null>(null);
  const [locating,setLocating]=useState(false);
  const lookupRef=useRef(0);
  const currentLocationRef=useRef<KakaoMarker|null>(null);
  const autoLocatedRef=useRef(false);
  const [currentLocation,setCurrentLocation]=useState<{location:Coordinates;accuracy:number}|null>(null);
  const viewing=!compact&&!onPick;

  useEffect(()=>{
    if(!ready || !elementRef.current || !window.kakao || mapRef.current) return;
    const kakao=window.kakao;
    const start=center??defaultCenter;
    const map=new kakao.maps.Map(elementRef.current,{center:new kakao.maps.LatLng(start.lat,start.lng),level:compact?4:5});
    mapRef.current=map;
    const reportBounds=()=>{const bounds=map.getBounds(),sw=bounds.getSouthWest(),ne=bounds.getNorthEast();boundsRef.current?.([sw.getLng(),sw.getLat(),ne.getLng(),ne.getLat()]);};
    kakao.maps.event.addListener(map,"idle",reportBounds);
    kakao.maps.event.addListener(map,"dragstart",()=>{lookupRef.current++;setLocating(false);});
    kakao.maps.event.addListener(map,"click",(event)=>{const latLng=event?.latLng;if(latLng&&(onPickRef.current||canvasPickRef.current)) {lookupRef.current++;setLocating(false);setSearching(false);setGpsCandidate(null);const location={lat:latLng.getLat(),lng:latLng.getLng()};onPickRef.current?.(location,"manual");canvasPickRef.current?.(location);}});
    const timer=window.setTimeout(()=>{map.relayout();reportBounds();},80);
    const observer=new ResizeObserver(()=>{map.relayout();reportBounds();});
    observer.observe(elementRef.current);
    return ()=>{window.clearTimeout(timer);observer.disconnect();lookupRef.current++;currentLocationRef.current?.setMap(null);currentLocationRef.current=null;mapRef.current=null;};
  },[ready,compact]);

  useEffect(()=>{const kakao=window.kakao;if(ready && kakao && mapRef.current && center) mapRef.current.setCenter(new kakao.maps.LatLng(center.lat,center.lng));},[ready,center?.lat,center?.lng]);

  useEffect(()=>{
    const kakao=window.kakao,map=mapRef.current;if(!ready||!kakao||!map||!focus)return;
    lookupRef.current++;setLocating(false);
    let positions=focus.locations;
    if(focus.radiusMeters){
      const deltaLat=focus.radiusMeters/111195.08,deltaLng=deltaLat/Math.max(.01,Math.cos(focus.location.lat*Math.PI/180));
      positions=[{lat:Math.max(-90,focus.location.lat-deltaLat),lng:Math.max(-180,focus.location.lng-deltaLng)},{lat:Math.min(90,focus.location.lat+deltaLat),lng:Math.min(180,focus.location.lng+deltaLng)}];
    }
    if(positions&&positions.length>1){const bounds=new kakao.maps.LatLngBounds();positions.forEach(position=>bounds.extend(new kakao.maps.LatLng(position.lat,position.lng)));map.setBounds(bounds,80,35,80,35);}
    else map.setCenter(new kakao.maps.LatLng(focus.location.lat,focus.location.lng));
  },[ready,focus]);

  useEffect(()=>{
    const kakao=window.kakao,map=mapRef.current;
    if(!ready||!kakao||!map||!workbench)return;
    const overlays:KakaoOverlay[]=[];
    const latLng=(location:Coordinates)=>new kakao.maps.LatLng(location.lat,location.lng);
    const label=(location:Coordinates,text:string,className="map-drawing-label",color?:string)=>{
      const content=document.createElement("div");content.className=className;content.textContent=text;
      if(color)content.style.backgroundColor=color;
      overlays.push(new kakao.maps.CustomOverlay({map,position:latLng(location),content,xAnchor:.5,yAnchor:1.1,zIndex:4}));
    };
    const lookup=new Map(anchorPoints.map(point=>[point.id,point]));
    if(workbench.layers.radii)for(const radius of workbench.radii){
      const point=lookup.get(radius.pointId);if(!point)continue;
      for(const meters of [...new Set(radius.meters)].sort((a,b)=>b-a)){
        overlays.push(new kakao.maps.Circle({map,center:latLng(point.location),radius:meters,strokeWeight:2,strokeColor:"#2563eb",strokeOpacity:.85,strokeStyle:"dash",fillColor:"#93c5fd",fillOpacity:.06,zIndex:1}));
        // Geographic north edge of each circle, with a distance label in meters.
        label({lat:Math.min(90,point.location.lat+meters/111195.08),lng:point.location.lng},`반경 ${formatDistance(meters)}`);
      }
    }
    if(workbench.layers.route){
      for(const segment of routeSegments(workbench.route,anchorPoints)){
        const from=segment.from.location!,to=segment.to.location!;
        overlays.push(new kakao.maps.Polyline({map,path:[latLng(from),latLng(to)],strokeWeight:4,strokeColor:"#9b43cc",strokeOpacity:.9,zIndex:2}));
        label({lat:(from.lat+to.lat)/2,lng:(from.lng+to.lng)/2},`${segment.index+1}구간 · ${formatDistance(segment.meters)}`);
      }
      workbench.route.forEach((id,index)=>{const point=lookup.get(id);if(point)label(point.location,String(index+1),"map-drawing-order");});
    }
    if(workbench.layers.notes)for(const note of workbench.notes)label(note.location,[note.emoji,note.text].filter(Boolean).join(" "),`map-drawing-note${note.text?"":" map-drawing-note--emoji"}`,note.color);
    return()=>{overlays.forEach(overlay=>overlay.setMap(null));};
  },[ready,workbench,anchorPoints]);

  useEffect(()=>{
    if(!ready||!mapRef.current||!viewing||autoLocatedRef.current)return;
    autoLocatedRef.current=true;
    locate();
  },[ready,viewing]);

  useEffect(()=>{
    const kakao=window.kakao,map=mapRef.current;
    if(!ready||!kakao||!map||!currentLocation)return;
    currentLocationRef.current?.setMap(null);
    const svg='<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32"><circle cx="16" cy="16" r="15" fill="#2563eb" fill-opacity=".18"/><circle cx="16" cy="16" r="8" fill="#2563eb" stroke="white" stroke-width="3"/></svg>';
    const marker=new kakao.maps.Marker({position:new kakao.maps.LatLng(currentLocation.location.lat,currentLocation.location.lng),image:new kakao.maps.MarkerImage(`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,new kakao.maps.Size(32,32),{offset:new kakao.maps.Point(16,16)}),title:"현재 위치",zIndex:5});
    marker.setMap(map);currentLocationRef.current=marker;
    return ()=>{marker.setMap(null);};
  },[ready,currentLocation]);

  useEffect(()=>{
    const kakao=window.kakao,map=mapRef.current;
    if(!ready || !kakao || !map) return;
    clusterRef.current?.clear(); pinRef.current.forEach((marker)=>marker.setMap(null));
    const markers=groupMapPoints(points).map((group)=>{
      const point=group.find(item=>item.id===selectedId)??group[0];
      const marker=new kakao.maps.Marker({position:new kakao.maps.LatLng(point.location.lat,point.location.lng),image:markerImage(kakao,point.emoji,point.color,point.id===selectedId,point.rating?.symbol,group.length),title:group.length>1?`같은 위치의 기록 ${group.length}개 · 개별 평가 확인`:(point.description??point.title)});
      kakao.maps.event.addListener(marker,"click",()=>{if(group.length>1)setOverlapIds(group.map(item=>item.id));else onSelectPoint?.(point.id);});
      return marker;
    });
    pinRef.current=markers;
    if(markers.length>20 && !compact) {const clusterer=new kakao.maps.MarkerClusterer({map,averageCenter:true,minLevel:6,disableClickZoom:false});clusterer.addMarkers(markers);clusterRef.current=clusterer;}
    else {markers.forEach((marker)=>marker.setMap(map));clusterRef.current=null;}
    return ()=>{clusterRef.current?.clear();markers.forEach((marker)=>marker.setMap(null));};
  },[ready,points,selectedId,onSelectPoint,compact]);

  useEffect(()=>{
    const kakao=window.kakao,map=mapRef.current;
    if(!ready || !kakao || !map) return;
    chosenRef.current?.setMap(null); chosenRef.current=null;
    const picked=gpsCandidate?.location??chosen;
    if(picked) {const marker=new kakao.maps.Marker({position:new kakao.maps.LatLng(picked.lat,picked.lng),image:markerImage(kakao,"📍","#267253",true)});marker.setMap(map);chosenRef.current=marker;map.setCenter(new kakao.maps.LatLng(picked.lat,picked.lng));}
  },[ready,chosen,gpsCandidate]);

  function locate() {
    if(!navigator.geolocation) {setError(viewing?"이 기기에서는 현재 위치를 확인할 수 없어요. 지도를 움직여 살펴보세요.":"위치 기능을 사용할 수 없습니다. 장소를 검색하거나 지도를 눌러주세요.");return;}
    setError("");setLocating(true);setSearching(false);setGpsCandidate(null);
    const lookup=++lookupRef.current;
    navigator.geolocation.getCurrentPosition(({coords})=>{
      if(lookup!==lookupRef.current)return;
      setLocating(false);
      const map=mapRef.current,kakao=window.kakao;if(!map||!kakao)return;
      const result={location:{lat:coords.latitude,lng:coords.longitude},accuracy:Math.ceil(coords.accuracy)};
      if(viewing){setCurrentLocation(result);map.setCenter(new kakao.maps.LatLng(result.location.lat,result.location.lng));}
      else setGpsCandidate(result);
      map.setLevel(4);
    },(failure)=>{
      if(lookup!==lookupRef.current)return;
      setLocating(false);
      setError(viewing?(failure.code===1?"위치 권한이 꺼져 있어요. 브라우저 설정에서 허용한 뒤 현재 위치 버튼을 눌러주세요.":"현재 위치를 확인하지 못했어요. 잠시 후 하단의 현재 위치 버튼으로 다시 시도해 주세요."):"현재 위치를 가져오지 못했습니다. 장소를 검색하거나 지도를 눌러주세요.");
    },{enableHighAccuracy:true,timeout:10000,maximumAge:30000});
  }
  function findPlace() {
    const kakao=window.kakao;if(!kakao || !search.trim()) return;
    setSearching(true);setLocating(false);setError("");setGpsCandidate(null);
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
    {viewing&&<button type="button" className="map-current-location" onClick={locate} disabled={!ready||locating} aria-label={locating?"현재 위치 확인 중":"현재 위치로 이동"}><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="12" cy="12" r="7"/><circle cx="12" cy="12" r="2.5"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></svg><span>{locating?"확인 중":"현재 위치"}</span></button>}
    {currentLocation&&<span className="sr-only" role="status">현재 위치를 파란 점으로 표시했어요. 예상 오차 약 {currentLocation.accuracy}m.</span>}
    {onPick && <div className="kakao-map-controls"><div className="kakao-map-search"><label className="sr-only" htmlFor={compact?"place-search-compact":"place-search-main"}>장소 검색</label><input id={compact?"place-search-compact":"place-search-main"} value={search} onChange={(event)=>setSearch(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter"){event.preventDefault();event.stopPropagation();if(!event.nativeEvent.isComposing) findPlace();}}} placeholder="장소 검색"/><button type="button" onClick={findPlace} disabled={!ready||searching}>{searching?"검색 중":"검색"}</button></div><button type="button" onClick={locate} disabled={!ready||locating}>{locating?"위치 확인 중":"◎ 현재 위치"}</button></div>}
    {gpsCandidate && <div className="gps-confirm" role="status"><span>현재 위치의 예상 오차는 약 {gpsCandidate.accuracy}m입니다. 핀을 확인하고, 다르면 지도를 눌러 조정해 주세요.</span><button type="button" onClick={()=>{onPickRef.current?.(gpsCandidate.location,"gps");setGpsCandidate(null);}}>이 위치 사용</button></div>}
    {overlapPoints.length>0 && <PointDialog label="같은 위치의 기록" onClose={()=>setOverlapIds([])}><h2>같은 위치의 기록 {overlapPoints.length}개</h2><p>살펴볼 기록을 선택해 주세요.</p><div className="overlap-records">{overlapPoints.map(point=><button type="button" key={point.id} aria-label={point.description??point.title} onClick={()=>{setOverlapIds([]);onSelectPoint?.(point.id);}}><span aria-hidden="true">{point.emoji}</span> <span>{point.title}{point.rating&&<small><span className="rating-symbol" aria-hidden="true">{point.rating.symbol}</span> {point.rating.label}</small>}</span></button>)}</div><button type="button" className="button button--light button--full" onClick={()=>setOverlapIds([])}>닫기</button></PointDialog>}
    {error && <div className={`kakao-map-error ${viewing?"kakao-map-error--viewing":""}`} role="status"><span>{error}</span><button type="button" aria-label="위치·지도 안내 닫기" onClick={()=>setError("")}>×</button></div>}
  </div>;
}
