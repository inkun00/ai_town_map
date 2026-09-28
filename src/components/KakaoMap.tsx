"use client";

import Script from "next/script";
import {PointDialog} from "./PointDialog";
import {groupMapPoints} from "@/domain/map-points";
import { useEffect, useRef, useState } from "react";

export type Coordinates={lat:number;lng:number};
export type MapPoint={id:string;title:string;emoji:string;color:string;location:Coordinates};
type Props={center?:Coordinates|null;points?:MapPoint[];selectedId?:string|null;onSelectPoint?:(id:string)=>void;onBoundsChange?:(bounds:[number,number,number,number])=>void;onPick?:(location:Coordinates,source:"gps"|"search"|"manual",label?:string)=>void;chosen?:Coordinates|null;compact?:boolean};
type KakaoApi={maps:{load:(callback:()=>void)=>void;LatLng:new(lat:number,lng:number)=>unknown;Map:new(element:HTMLElement,options:Record<string,unknown>)=>KakaoMapObject;Marker:new(options:Record<string,unknown>)=>KakaoMarker;MarkerImage:new(src:string,size:unknown,options?:Record<string,unknown>)=>unknown;Size:new(width:number,height:number)=>unknown;Point:new(x:number,y:number)=>unknown;MarkerClusterer:new(options:Record<string,unknown>)=>{addMarkers:(markers:KakaoMarker[])=>void;clear:()=>void};services:{Places:new()=>{keywordSearch:(term:string,callback:(result:{x:string;y:string;place_name:string}[],status:string)=>void)=>void};Status:{OK:string}};event:{addListener:(target:unknown,name:string,callback:(event?:{latLng?:{getLat:()=>number;getLng:()=>number}})=>void)=>void}}};
type KakaoMapObject={setCenter:(center:unknown)=>void;relayout:()=>void;getCenter:()=>{getLat:()=>number;getLng:()=>number};getBounds:()=>{getSouthWest:()=>{getLat:()=>number;getLng:()=>number};getNorthEast:()=>{getLat:()=>number;getLng:()=>number}};setLevel:(level:number)=>void};
type KakaoMarker={setMap:(map:KakaoMapObject|null)=>void};
declare global {interface Window {kakao?:KakaoApi}}

const defaultCenter={lat:37.5665,lng:126.978};
const key=process.env.NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY;
function markerImage(kakao:KakaoApi,glyph:string,color:string,selected:boolean) {
  const safeGlyph=glyph.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;");
  const safeColor=/^#[0-9a-f]{6}$/i.test(color)?color:"#287554";
  const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="52" height="62" viewBox="0 0 52 62"><path d="M26 60C18 49 2 36 2 25a24 24 0 1 1 48 0C50 36 34 49 26 60Z" fill="${safeColor}" stroke="${selected?"#173b28":"white"}" stroke-width="${selected?4:3}"/><circle cx="26" cy="25" r="18" fill="white"/><text x="26" y="34" text-anchor="middle" font-size="23">${safeGlyph}</text></svg>`;
  return new kakao.maps.MarkerImage(`data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`,new kakao.maps.Size(42,50),{offset:new kakao.maps.Point(21,48)});
}

export default function KakaoMap({center,points=[],selectedId,onSelectPoint,onBoundsChange,onPick,chosen,compact=false}:Props) {
  const elementRef=useRef<HTMLDivElement>(null);
  const mapRef=useRef<KakaoMapObject|null>(null);
  const pinRef=useRef<KakaoMarker[]>([]);
  const clusterRef=useRef<{clear:()=>void}|null>(null);
  const chosenRef=useRef<KakaoMarker|null>(null);
  const onPickRef=useRef(onPick); onPickRef.current=onPick;
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

  useEffect(()=>{
    if(!ready || !elementRef.current || !window.kakao || mapRef.current) return;
    const kakao=window.kakao;
    const start=center??defaultCenter;
    const map=new kakao.maps.Map(elementRef.current,{center:new kakao.maps.LatLng(start.lat,start.lng),level:compact?4:5});
    mapRef.current=map;
    const reportBounds=()=>{const bounds=map.getBounds(),sw=bounds.getSouthWest(),ne=bounds.getNorthEast();boundsRef.current?.([sw.getLng(),sw.getLat(),ne.getLng(),ne.getLat()]);};
    kakao.maps.event.addListener(map,"idle",reportBounds);
    if(onPickRef.current) kakao.maps.event.addListener(map,"click",(event)=>{const latLng=event?.latLng;if(latLng) {lookupRef.current++;setLocating(false);setSearching(false);setGpsCandidate(null);onPickRef.current?.({lat:latLng.getLat(),lng:latLng.getLng()},"manual");}});
    const timer=window.setTimeout(()=>{map.relayout();reportBounds();},80);
    return ()=>{window.clearTimeout(timer);lookupRef.current++;mapRef.current=null;};
  },[ready,compact]);

  useEffect(()=>{const kakao=window.kakao;if(ready && kakao && mapRef.current && center) mapRef.current.setCenter(new kakao.maps.LatLng(center.lat,center.lng));},[ready,center]);

  useEffect(()=>{
    const kakao=window.kakao,map=mapRef.current;
    if(!ready || !kakao || !map) return;
    clusterRef.current?.clear(); pinRef.current.forEach((marker)=>marker.setMap(null));
    const markers=groupMapPoints(points).map((group)=>{
      const point=group.find(item=>item.id===selectedId)??group[0];
      const marker=new kakao.maps.Marker({position:new kakao.maps.LatLng(point.location.lat,point.location.lng),image:markerImage(kakao,point.emoji,point.color,point.id===selectedId),title:group.length>1?`${point.title} 외 ${group.length-1}개 기록`:point.title});
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
    if(!navigator.geolocation) {setError("위치 기능을 사용할 수 없습니다. 장소를 검색하거나 지도를 눌러주세요.");return;}
    setError("");setLocating(true);setSearching(false);setGpsCandidate(null);
    const lookup=++lookupRef.current;
    navigator.geolocation.getCurrentPosition(({coords})=>{if(lookup!==lookupRef.current)return;setLocating(false);if(!mapRef.current)return;setGpsCandidate({location:{lat:coords.latitude,lng:coords.longitude},accuracy:Math.ceil(coords.accuracy)});mapRef.current.setLevel(4);},()=>{if(lookup!==lookupRef.current)return;setLocating(false);setError("현재 위치를 가져오지 못했습니다. 장소를 검색하거나 지도를 눌러주세요.");},{enableHighAccuracy:true,timeout:10000,maximumAge:30000});
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
    {onPick && <div className="kakao-map-controls"><div className="kakao-map-search"><label className="sr-only" htmlFor={compact?"place-search-compact":"place-search-main"}>장소 검색</label><input id={compact?"place-search-compact":"place-search-main"} value={search} onChange={(event)=>setSearch(event.target.value)} onKeyDown={(event)=>{if(event.key==="Enter"){event.preventDefault();event.stopPropagation();if(!event.nativeEvent.isComposing) findPlace();}}} placeholder="장소 검색"/><button type="button" onClick={findPlace} disabled={!ready||searching}>{searching?"검색 중":"검색"}</button></div><button type="button" onClick={locate} disabled={!ready||locating}>{locating?"위치 확인 중":"◎ 현재 위치"}</button></div>}
    {gpsCandidate && <div className="gps-confirm" role="status"><span>현재 위치의 예상 오차는 약 {gpsCandidate.accuracy}m입니다. 핀을 확인하고, 다르면 지도를 눌러 조정해 주세요.</span><button type="button" onClick={()=>{onPickRef.current?.(gpsCandidate.location,"gps");setGpsCandidate(null);}}>이 위치 사용</button></div>}
    {overlapPoints.length>0 && <PointDialog label="같은 위치의 기록" onClose={()=>setOverlapIds([])}><h2>같은 위치의 기록 {overlapPoints.length}개</h2><p>살펴볼 기록을 선택해 주세요.</p><div className="overlap-records">{overlapPoints.map(point=><button type="button" key={point.id} onClick={()=>{setOverlapIds([]);onSelectPoint?.(point.id);}}><span aria-hidden="true">{point.emoji}</span> {point.title}</button>)}</div><button type="button" className="button button--light button--full" onClick={()=>setOverlapIds([])}>닫기</button></PointDialog>}
    {error && <div className="kakao-map-error" role="status">{error}</div>}
  </div>;
}
