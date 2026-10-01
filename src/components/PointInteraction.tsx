"use client";

import {useEffect,useRef,useState,type PointerEvent,type ReactNode} from "react";
import {distanceMeters,formatDistance,maximumRadiusMeters,snapPoint} from "@/domain/map-workbench";
import type {KakaoApi,KakaoMapObject,KakaoOverlay,MapPoint,Coordinates} from "./KakaoMap";

export type GestureTool={kind:"radius"|"connect";pointId:string};
type Result={pointId:string;meters?:number;targetId?:string};
type Props={map:KakaoMapObject;kakao:KakaoApi;points:MapPoint[];tool:GestureTool|null;contextId:string|null;popup?:ReactNode;onEnd?:(result:Result|null)=>void;onClose?:()=>void;onArm:()=>void};
type Drag={pointerId:number;start:{x:number;y:number};moved:boolean;targetId:string|null;meters:number;overlay:KakaoOverlay};

/** Pointer capture keeps one gesture alive without moving the observation itself. */
export function PointInteraction({map,kakao,points,tool,contextId,popup,onEnd,onClose,onArm}:Props){
  const host=useRef<HTMLDivElement>(null),plane=useRef<HTMLDivElement>(null),popupRef=useRef<HTMLDivElement>(null);
  const drag=useRef<Drag|null>(null);
  const callbacks=useRef({onEnd,onClose,onArm});callbacks.current={onEnd,onClose,onArm};
  const [revision,setRevision]=useState(0),[preview,setPreview]=useState<{meters:number;targetId:string|null}|null>(null);
  const [keyboardMeters,setKeyboardMeters]=useState(100),[keyboardTarget,setKeyboardTarget]=useState("");
  const source=points.find(point=>point.id===tool?.pointId),context=points.find(point=>point.id===contextId);
  const project=(location:Coordinates)=>{const p=map.getProjection().containerPointFromCoords(new kakao.maps.LatLng(location.lat,location.lng));return {x:p.x,y:p.y};};
  function clearDrag(){const active=drag.current;drag.current=null;active?.overlay.setMap(null);if(active&&plane.current?.hasPointerCapture(active.pointerId))plane.current.releasePointerCapture(active.pointerId);setPreview(null);}
  function finish(result:Result|null){clearDrag();callbacks.current.onEnd?.(result);}
  useEffect(()=>{
    const refresh=()=>setRevision(value=>value+1);
    kakao.maps.event.addListener(map,"idle",refresh);
    const observer=new ResizeObserver(refresh);if(host.current)observer.observe(host.current);
    return()=>{observer.disconnect();kakao.maps.event.removeListener(map,"idle",refresh);};
  },[map,kakao]);
  useEffect(()=>{
    if(!tool)return;
    if(!source){callbacks.current.onEnd?.(null);return;}
    callbacks.current.onArm();setPreview(null);setKeyboardTarget("");
    const draggable=map.getDraggable(),zoomable=map.getZoomable();
    map.setDraggable(false);map.setZoomable(false);
    plane.current?.focus({preventScroll:true});
    const cancel=()=>{clearDrag();callbacks.current.onEnd?.(null);};
    const keyboard=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();cancel();}};
    const visibility=()=>{if(document.hidden)cancel();};
    window.addEventListener("keydown",keyboard);window.addEventListener("blur",cancel);window.addEventListener("resize",cancel);document.addEventListener("visibilitychange",visibility);
    return()=>{clearDrag();map.setDraggable(draggable);map.setZoomable(zoomable);window.removeEventListener("keydown",keyboard);window.removeEventListener("blur",cancel);window.removeEventListener("resize",cancel);document.removeEventListener("visibilitychange",visibility);};
  },[tool?.kind,tool?.pointId,source?.id,source?.location.lat,source?.location.lng,map,kakao]);
  useEffect(()=>{if(contextId&&!tool)popupRef.current?.querySelector<HTMLButtonElement>("button")?.focus({preventScroll:true});},[contextId,tool]);
  const local=(event:PointerEvent<HTMLDivElement>)=>{const rect=event.currentTarget.getBoundingClientRect();return {x:event.clientX-rect.left,y:event.clientY-rect.top,inside:event.clientX>=rect.left&&event.clientX<=rect.right&&event.clientY>=rect.top&&event.clientY<=rect.bottom};};
  function move(event:PointerEvent<HTMLDivElement>){
    const active=drag.current;if(!active||active.pointerId!==event.pointerId||!source||!tool)return;
    const cursor=local(event),projection=map.getProjection(),latlng=projection.coordsFromContainerPoint(new kakao.maps.Point(cursor.x,cursor.y));
    const location={lat:latlng.getLat(),lng:latlng.getLng()};
    active.moved ||= Math.hypot(cursor.x-active.start.x,cursor.y-active.start.y)>=4;
    if(tool.kind==="radius"){
      active.meters=Math.max(1,Math.min(maximumRadiusMeters,Math.round(distanceMeters(source.location,location))));active.overlay.setRadius?.(active.meters);
    }else{
      active.targetId=cursor.inside?snapPoint(cursor,points.map(point=>({id:point.id,...project(point.location)})).filter(point=>{const rect=host.current?.getBoundingClientRect();return !!rect&&point.x>=0&&point.x<=rect.width&&point.y>=0&&point.y<=rect.height+25;}),source.id,active.targetId):null;
      const target=points.find(point=>point.id===active.targetId),end=target?.location??location;
      active.meters=distanceMeters(source.location,end);active.overlay.setPath?.([new kakao.maps.LatLng(source.location.lat,source.location.lng),new kakao.maps.LatLng(end.lat,end.lng)]);
    }
    setPreview({meters:active.meters,targetId:active.targetId});
  }
  function start(event:PointerEvent<HTMLDivElement>){
    if(!event.isPrimary||event.button!==0||drag.current||!source||!tool)return;
    const cursor=local(event),origin=project(source.location);
    if(Math.min(Math.hypot(cursor.x-origin.x,cursor.y-origin.y),Math.hypot(cursor.x-origin.x,cursor.y-origin.y+25))>44)return;
    event.preventDefault();event.currentTarget.setPointerCapture(event.pointerId);
    const position=new kakao.maps.LatLng(source.location.lat,source.location.lng);
    const overlay=tool.kind==="radius"?new kakao.maps.Circle({map,center:position,radius:1,strokeWeight:3,strokeColor:"#2563eb",fillColor:"#60a5fa",fillOpacity:.15,zIndex:8}):new kakao.maps.Polyline({map,path:[position,position],strokeWeight:5,strokeColor:"#9b43cc",strokeStyle:"shortdash",zIndex:8});
    drag.current={pointerId:event.pointerId,start:cursor,moved:false,targetId:null,meters:1,overlay};move(event);
  }
  function release(event:PointerEvent<HTMLDivElement>){
    const active=drag.current;if(!active||active.pointerId!==event.pointerId||!source||!tool)return;
    move(event);const valid=active.moved&&local(event).inside;
    finish(valid&&tool.kind==="radius"?{pointId:source.id,meters:active.meters}:valid&&active.targetId?{pointId:source.id,targetId:active.targetId}:null);
  }
  const target=points.find(point=>point.id===preview?.targetId),sourcePixel=source&&project(source.location),targetPixel=target&&project(target.location);
  const contextPixel=context&&project(context.location),rect=host.current?.getBoundingClientRect();
  const popupHeight=popupRef.current?.offsetHeight??235,width=Math.min(280,Math.max(0,(rect?.width??320)-24));
  const popupLeft=contextPixel?Math.max(12,Math.min(contextPixel.x-width/2,(rect?.width??320)-width-12)):12;
  const popupTop=contextPixel?Math.max(66,Math.min(contextPixel.y-55-popupHeight,(rect?.height??600)-popupHeight-68)):66;
  void revision;
  return <div className="point-interaction" ref={host}>
    {context&&!tool&&<div className="point-tool-popup" ref={popupRef} role="dialog" aria-label={`포인트 도구 · ${context.title}`} style={{left:popupLeft,top:popupTop,width}} onKeyDown={event=>{if(event.key==="Escape"){event.stopPropagation();onClose?.();}}}>{popup}</div>}
    {tool&&source&&<>
      <div className="point-gesture-plane" ref={plane} tabIndex={0} role="region" aria-label={`${tool.kind==="radius"?"반경":"연결"} 드래그 영역 · ${source.title}`} onPointerDown={start} onPointerMove={move} onPointerUp={release} onPointerCancel={()=>finish(null)} onLostPointerCapture={()=>{if(drag.current)finish(null);}}/>
      {sourcePixel&&<div className="point-drag-halo" style={{left:sourcePixel.x,top:sourcePixel.y-25}} aria-hidden="true"/>}
      {targetPixel&&<div className="point-drag-halo point-drag-halo--ready" style={{left:targetPixel.x,top:targetPixel.y-25}} aria-hidden="true"/>}
      <div className="point-gesture-hint"><span>{tool.kind==="radius"?(preview?`반경 ${formatDistance(preview.meters)} · 손을 떼면 저장`:`${source.title} 핀에서 바깥으로 드래그하세요`):target?`${target.title} · 연결 준비 · 손을 떼면 연결`:preview?`직선 ${formatDistance(preview.meters)} · 다른 핀으로 이동하세요`:`${source.title} 핀에서 다른 핀까지 드래그하세요`}</span><button type="button" onClick={()=>finish(null)}>취소</button></div>
      <span className="sr-only" role="status">{target?`${target.title} 연결 준비`:"핀에서 드래그하세요. 취소하려면 Escape 키를 누르세요."}</span>
      <details className="point-keyboard-controls"><summary>드래그 대신 직접 입력</summary>{tool.kind==="radius"?<label>반경(m)<input type="number" min={1} max={maximumRadiusMeters} value={keyboardMeters} onChange={event=>setKeyboardMeters(Number(event.target.value))}/></label>:<label>연결할 포인트<select value={keyboardTarget} onChange={event=>setKeyboardTarget(event.target.value)}><option value="">선택하세요</option>{points.filter(point=>point.id!==source.id).map(point=><option key={point.id} value={point.id}>{point.emoji} {point.title}</option>)}</select></label>}<button type="button" disabled={tool.kind==="radius"?!(keyboardMeters>=1&&keyboardMeters<=maximumRadiusMeters):!points.some(point=>point.id===keyboardTarget&&point.id!==source.id)} onClick={()=>finish(tool.kind==="radius"?{pointId:source.id,meters:Math.round(keyboardMeters)}:{pointId:source.id,targetId:keyboardTarget})}>적용</button></details>
    </>}
  </div>;
}
