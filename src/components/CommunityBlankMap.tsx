"use client";

import {useEffect,useMemo,useRef,useState,type ComponentProps,type PointerEvent as ReactPointerEvent} from "react";
import type KakaoMap from "./KakaoMap";
import type {Coordinates,MapPoint} from "./KakaoMap";
import {PointDialog} from "./PointDialog";
import {groupMapPoints} from "@/domain/map-points";
import {connectionSegments,distanceMeters,formatDistance,maximumRadiusMeters,snapPoint} from "@/domain/map-workbench";
import {communityProjection,panCommunityBounds,zoomCommunityBounds,type CommunityBounds} from "@/domain/community-blank-map";
import {placeWeatherBoundaryLabels,weatherBoundaryColors,weatherBoundaryPath,type WeatherBoundaryFeature} from "@/domain/weather-boundaries";
import {formatTravelDistance,formatTravelDuration,travelModeColor,travelModeLabel} from "@/domain/travel-route";
import "@/app/travel-route-map.css";

type Props=ComponentProps<typeof KakaoMap>&{bounds:CommunityBounds;features:WeatherBoundaryFeature[];onViewportChange:(bounds:CommunityBounds)=>void;loading?:boolean;error?:string;onRetry?:()=>void};
type Drag={pointerId:number;kind:"pan"|"gesture";start:{x:number;y:number};bounds:CommunityBounds;moved:boolean;targetId:string|null;meters:number;end:Coordinates};

/** Real administrative boundaries with the same observation callbacks as the SDK. */
export default function CommunityBlankMap({bounds,features,onViewportChange,points=[],anchorPoints=points,selectedId,onSelectPoint,workbench,onCanvasPick,contextPointId,contextPopup,onCloseContext,gestureTool,onGestureEnd,onSelectNote,loading=false,error,onRetry,travelRoute}:Props){
  const host=useRef<HTMLDivElement>(null),svg=useRef<SVGSVGElement>(null),popup=useRef<HTMLDivElement>(null),drag=useRef<Drag|null>(null),suppressClick=useRef(false);
  const [size,setSize]=useState({width:440,height:640}),[overlapIds,setOverlapIds]=useState<string[]>([]),[preview,setPreview]=useState<{meters:number;targetId:string|null;end:Coordinates}|null>(null),[keyboardMeters,setKeyboardMeters]=useState(100),[keyboardTarget,setKeyboardTarget]=useState("");
  const callbacks=useRef({onGestureEnd,onCloseContext,onViewportChange});callbacks.current={onGestureEnd,onCloseContext,onViewportChange};
  const currentBounds=useRef(bounds);currentBounds.current=bounds;
  const initialBounds=useRef(bounds);
  const currentTool=useRef(gestureTool);currentTool.current=gestureTool;
  const projection=useMemo(()=>communityProjection(bounds,size.width,size.height),[bounds,size]);
  const project=(location:Coordinates)=>projection.project([location.lng,location.lat]);
  const source=points.find(point=>point.id===gestureTool?.pointId),context=points.find(point=>point.id===contextPointId);
  const grouped=useMemo(()=>groupMapPoints(points),[points]),lookup=useMemo(()=>new Map(anchorPoints.map(point=>[point.id,point])),[anchorPoints]);
  const colors=useMemo(()=>weatherBoundaryColors(features.map(feature=>feature.id)),[features]);
  const labels=useMemo(()=>placeWeatherBoundaryLabels(features.map(feature=>{const position=projection.project(feature.label);return {id:feature.id,...position,width:[...feature.name].length*10+6,height:17};}),{width:size.width,height:size.height,top:70,bottom:135}),[features,projection,size]);
  const featuresById=useMemo(()=>new Map(features.map(feature=>[feature.id,feature])),[features]);
  const travelLabels=useMemo(()=>{
    if(!travelRoute)return [];
    const content=new Map<string,{lines:string[];title:string;anchor:{x:number;y:number};color:string;kind:"stop"|"leg"}>();
    const add=(id:string,location:Coordinates,lines:string[],title:string,offset:number,color:string,kind:"stop"|"leg")=>{
      const anchor=projection.project([location.lng,location.lat]);if(anchor.x<0||anchor.x>size.width||anchor.y<0||anchor.y>size.height)return null;
      content.set(id,{lines,title,anchor,color,kind});return {id,x:anchor.x,y:Math.max(0,Math.min(size.height,anchor.y+offset)),width:Math.min(size.width-16,Math.max(...lines.map(line=>Array.from(line).reduce((sum,char)=>sum+(/[\u2e80-\uffff]/.test(char)?11:6.5),0)))+10),height:lines.length*14+6};
    };
    const anchors=[];
    for(const [index,stop] of travelRoute.stops.slice(0,12).entries()){
      const chars=Array.from(stop.title),limit=Math.max(8,Math.min(21,Math.floor((size.width-64)/11))),short=chars.length>limit?`${chars.slice(0,limit-1).join("")}…`:stop.title;
      const item=add(`0-stop:${stop.id}`,stop.location,[`${index+1}. ${stop.emoji} ${short}`],`${index+1}. ${stop.emoji} ${stop.title}`,-60,"#173e51","stop");if(item)anchors.push(item);
    }
    if(!travelRoute.draft)for(const [index,leg] of travelRoute.legs.slice(0,11).entries()){
      const path=leg.status==="ready"?leg.paths.reduce<Coordinates[]>((best,part)=>part.length>best.length?part:best,[]):[],location=path[Math.floor(path.length/2)]??travelRoute.stops.find(stop=>stop.id===leg.fromId)?.location;
      if(!location)continue;const lines=[`${index+1}구간 · ${travelModeLabel(leg.mode)} (자동차 기준)`,`${formatTravelDistance(leg.status==="ready"?leg.distanceMeters:null)} · ${formatTravelDuration(leg.status==="ready"?leg.durationSeconds:null)}`];
      const item=add(`1-leg:${index}`,location,lines,lines.join(" · "),leg.status==="ready"?-12:30,travelModeColor(leg.mode),"leg");if(item)anchors.push(item);
    }
    const placements=placeWeatherBoundaryLabels(anchors,{width:size.width,height:size.height,top:70,bottom:135}),placed=new Set(placements.map(item=>item.id));
    // If a very short viewport cannot fit every caption, keep them inside the image;
    // full names and measurements remain available in the exported caption above it.
    for(const anchor of anchors)if(!placed.has(anchor.id))placements.push({...anchor,x:Math.max(8+anchor.width/2,Math.min(size.width-8-anchor.width/2,anchor.x)),y:Math.max(anchor.height/2+8,Math.min(size.height-8-anchor.height/2,anchor.y)),anchorX:anchor.x,anchorY:anchor.y});
    return placements.map(label=>({...label,...content.get(label.id)!}));
  },[travelRoute,projection,size]);
  useEffect(()=>{
    const element=host.current;if(!element)return;
    const resize=()=>{const rect=element.getBoundingClientRect();if(rect.width>0&&rect.height>0)setSize({width:rect.width,height:rect.height});};resize();
    if(typeof ResizeObserver!=="undefined"){const observer=new ResizeObserver(resize);observer.observe(element);return()=>observer.disconnect();}
    window.addEventListener("resize",resize);return()=>window.removeEventListener("resize",resize);
  },[]);
  useEffect(()=>{
    const element=svg.current;if(!element)return;
    const wheel=(event:WheelEvent)=>{event.preventDefault();if(currentTool.current)return;const rect=element.getBoundingClientRect();callbacks.current.onViewportChange(zoomCommunityBounds(currentBounds.current,Math.exp(Math.max(-1,Math.min(1,-event.deltaY*.002))),event.clientX-rect.left,event.clientY-rect.top,Math.max(1,rect.width),Math.max(1,rect.height)));};
    element.addEventListener("wheel",wheel,{passive:false});return()=>element.removeEventListener("wheel",wheel);
  },[]);
  function finish(result:{pointId:string;meters?:number;targetId?:string}|null){
    const active=drag.current;drag.current=null;setPreview(null);
    if(active){try{svg.current?.releasePointerCapture(active.pointerId);}catch{/* Already released. */}}
    callbacks.current.onGestureEnd?.(result);
  }
  useEffect(()=>{
    if(!gestureTool)return;
    if(!source){callbacks.current.onGestureEnd?.(null);return;}
    setKeyboardTarget("");setPreview(null);svg.current?.focus({preventScroll:true});
    const cancel=()=>{if(drag.current?.kind==="gesture"||currentTool.current)finish(null);};
    const escape=(event:KeyboardEvent)=>{if(event.key==="Escape"){event.preventDefault();cancel();}};
    const visibility=()=>{if(document.hidden)cancel();};
    window.addEventListener("keydown",escape);window.addEventListener("blur",cancel);window.addEventListener("resize",cancel);document.addEventListener("visibilitychange",visibility);
    return()=>{drag.current=null;window.removeEventListener("keydown",escape);window.removeEventListener("blur",cancel);window.removeEventListener("resize",cancel);document.removeEventListener("visibilitychange",visibility);};
  },[gestureTool?.kind,gestureTool?.pointId,source?.id]);
  useEffect(()=>{if(context&&!gestureTool)popup.current?.querySelector<HTMLButtonElement>("button")?.focus({preventScroll:true});},[context?.id,gestureTool]);
  const local=(event:ReactPointerEvent<SVGSVGElement>)=>{const rect=event.currentTarget.getBoundingClientRect();return {x:(event.clientX-rect.left)*size.width/Math.max(1,rect.width||size.width),y:(event.clientY-rect.top)*size.height/Math.max(1,rect.height||size.height),inside:event.clientX>=rect.left&&event.clientX<=rect.left+(rect.width||size.width)&&event.clientY>=rect.top&&event.clientY<=rect.top+(rect.height||size.height)};};
  function pointerDown(event:ReactPointerEvent<SVGSVGElement>){
    if(event.button!==0&&event.pointerType!=="touch"||drag.current)return;
    const cursor=local(event);suppressClick.current=false;
    if(gestureTool){if(!source)return;const origin=project(source.location);if(Math.min(Math.hypot(cursor.x-origin.x,cursor.y-origin.y),Math.hypot(cursor.x-origin.x,cursor.y-origin.y+28))>44)return;event.preventDefault();try{event.currentTarget.setPointerCapture(event.pointerId);}catch{/* Embedded browser fallback. */}}
    drag.current={pointerId:event.pointerId,kind:gestureTool?"gesture":"pan",start:cursor,bounds:[...bounds],moved:false,targetId:null,meters:1,end:projection.unproject(cursor.x,cursor.y)};
  }
  function pointerMove(event:ReactPointerEvent<SVGSVGElement>){
    const active=drag.current;if(!active||active.pointerId!==event.pointerId)return;
    const cursor=local(event),dx=cursor.x-active.start.x,dy=cursor.y-active.start.y;
    if(Math.hypot(dx,dy)>=4){active.moved=true;suppressClick.current=true;try{event.currentTarget.setPointerCapture(event.pointerId);}catch{/* Embedded browser fallback. */}}
    if(active.kind==="pan"){if(active.moved)onViewportChange(panCommunityBounds(active.bounds,dx,dy,size.width,size.height));return;}
    if(!source||!gestureTool)return;const location=projection.unproject(cursor.x,cursor.y);
    if(gestureTool.kind==="radius"){active.meters=Math.max(1,Math.min(maximumRadiusMeters,Math.round(distanceMeters(source.location,location))));active.end=location;}
    else{active.targetId=cursor.inside?snapPoint(cursor,points.map(point=>({id:point.id,...project(point.location)})).filter(point=>point.x>=0&&point.x<=size.width&&point.y>=0&&point.y<=size.height+28),source.id,active.targetId):null;active.end=points.find(point=>point.id===active.targetId)?.location??location;active.meters=distanceMeters(source.location,active.end);}
    setPreview({meters:active.meters,targetId:active.targetId,end:active.end});
  }
  function pointerUp(event:ReactPointerEvent<SVGSVGElement>){
    const active=drag.current;if(!active||active.pointerId!==event.pointerId)return;
    if(active.kind==="gesture"){
      pointerMove(event);const valid=active.moved&&local(event).inside;
      finish(valid&&gestureTool?.kind==="radius"&&source?{pointId:source.id,meters:active.meters}:valid&&source&&active.targetId?{pointId:source.id,targetId:active.targetId}:null);
    }else{drag.current=null;try{event.currentTarget.releasePointerCapture(event.pointerId);}catch{/* Already released. */}}
  }
  function choose(group:MapPoint[]){if(suppressClick.current||gestureTool)return;if(group.length>1)setOverlapIds(group.map(point=>point.id));else onSelectPoint?.(group[0].id);}
  function canvasClick(event:React.MouseEvent<SVGSVGElement>){if(suppressClick.current){suppressClick.current=false;return;}if(gestureTool)return;onCloseContext?.();const rect=event.currentTarget.getBoundingClientRect();onCanvasPick?.(projection.unproject(event.clientX-rect.left,event.clientY-rect.top));}
  function radiusGraphic(point:MapPoint,meters:number,key:string,previewing=false){
    const origin=project(point.location),north=project({lat:Math.min(85,point.location.lat+meters/111195.08),lng:point.location.lng}),east=project({lat:point.location.lat,lng:point.location.lng+meters/(111195.08*Math.max(.01,Math.cos(point.location.lat*Math.PI/180)))});
    return <g key={key} data-radius={meters}><ellipse cx={origin.x} cy={origin.y} rx={Math.abs(east.x-origin.x)} ry={Math.abs(north.y-origin.y)} fill="#93c5fd" fillOpacity=".09" stroke={previewing?"#d97706":"#2563eb"} strokeWidth="2" strokeDasharray="5 4"/><text x={north.x} y={north.y-5} textAnchor="middle" className="community-drawing-label">반경 {formatDistance(meters)}</text></g>;
  }
  const contextPixel=context&&project(context.location),sourcePixel=source&&project(source.location),target=points.find(point=>point.id===preview?.targetId),targetPixel=target&&project(target.location);
  const popupWidth=Math.min(280,size.width-24),popupHeight=popup.current?.offsetHeight??235;
  return <div className="community-blank-map" ref={host} aria-busy={loading}>
    <svg ref={svg} className="community-blank-map-canvas" viewBox={`0 0 ${size.width} ${size.height}`} aria-label={gestureTool&&source?`${gestureTool.kind==="radius"?"반경":"연결"} 드래그 영역 · ${source.title}`:"탐험 백지도"} tabIndex={gestureTool?0:undefined} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={()=>{if(drag.current?.kind==="gesture")finish(null);else drag.current=null;}} onLostPointerCapture={()=>{if(drag.current?.kind==="gesture")finish(null);else drag.current=null;}} onClick={canvasClick}>
      <rect width={size.width} height={size.height} fill="#fff"/>
      <g className="community-boundaries">{features.map(feature=><path key={feature.id} d={weatherBoundaryPath(feature.geometry,projection)} fill={colors.get(feature.id)} fillOpacity=".7" fillRule="evenodd" stroke="#839791" strokeWidth="1" vectorEffect="non-scaling-stroke"/>)}</g>
      <g aria-hidden="true" pointerEvents="none">{labels.map(label=><g key={label.id}>{Math.hypot(label.x-label.anchorX,label.y-label.anchorY)>8&&<line x1={label.anchorX} y1={label.anchorY} x2={label.x} y2={label.y} stroke="#718a88" strokeWidth="1" strokeOpacity=".7"/>}<text x={label.x} y={label.y} textAnchor="middle" className="community-boundary-label">{featuresById.get(label.id)?.name}</text></g>)}</g>
      {!travelRoute?.draft&&travelRoute?.legs.map((leg,index)=>leg.status==="ready"?<g key={index} data-travel-leg={index} data-travel-mode={leg.mode} pointerEvents="none">{leg.paths.filter(path=>path.length>1&&path.every(location=>Number.isFinite(location.lat)&&Number.isFinite(location.lng)&&Math.abs(location.lat)<=90&&Math.abs(location.lng)<=180)).map((path,pathIndex)=><polyline key={pathIndex} points={path.map(location=>{const pixel=project(location);return `${pixel.x},${pixel.y}`;}).join(" ")} fill="none" stroke={travelModeColor(leg.mode)} strokeWidth="5" vectorEffect="non-scaling-stroke"/>)}</g>:null)}
      {workbench?.layers.radii&&workbench.radii.flatMap(radius=>{const point=lookup.get(radius.pointId);return !point||gestureTool?.kind==="radius"&&gestureTool.pointId===point.id?[]:radius.meters.map(meters=>radiusGraphic(point,meters,`${point.id}:${meters}`));})}
      {workbench?.layers.route&&connectionSegments(workbench,anchorPoints).map(segment=>{const from=project(segment.from.location!),to=project(segment.to.location!);return <g key={segment.index} data-connection={segment.index}><line x1={from.x} y1={from.y} x2={to.x} y2={to.y} stroke="#9b43cc" strokeWidth="4"/><text x={(from.x+to.x)/2} y={(from.y+to.y)/2-5} textAnchor="middle" className="community-drawing-label">{segment.index+1}구간 · {formatDistance(segment.meters)}</text></g>;})}
      {preview&&source&&(gestureTool?.kind==="radius"?radiusGraphic(source,preview.meters,"preview",true):<line x1={sourcePixel!.x} y1={sourcePixel!.y} x2={project(preview.end).x} y2={project(preview.end).y} stroke="#9b43cc" strokeWidth="4" strokeDasharray="6 4"/>)}
      {grouped.map(group=>{
        const point=group.find(item=>item.id===selectedId)??group[0],position=project(point.location),selected=group.some(item=>item.id===selectedId),selectable=group.some(item=>!!item.selectionState),chosen=group.filter(item=>item.selectionState==="selected").length,state=chosen===group.length?"selected":chosen?"mixed":"unselected",color=selectable?state==="unselected"?"#f1f5f9":"#1d4ed8":point.color;
        const description=group.length>1?`같은 위치의 기록 ${group.length}개${selectable?` · ${chosen}개 선택`:""}`:`${point.description??point.title}${selectable?point.selectionState==="selected"?" · 선택됨 · 선택 해제":" · 선택 안 됨 · 선택":""}`;
        return <g key={group[0].id} data-marker={point.id} data-selection-state={selectable?state:undefined} transform={`translate(${position.x} ${position.y})`} role="button" tabIndex={gestureTool?-1:0} aria-label={description} aria-pressed={selectable?chosen===group.length:selected} onClick={event=>{event.stopPropagation();choose(group);}} onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();choose(group);}}}>
          <title>{description}</title><path d="M0 0L-12-19A18 18 0 1 1 12-19Z" fill={color} stroke={selected?"#173e51":selectable&&state==="unselected"?"#64748b":"white"} strokeWidth={selected?3.5:2} strokeDasharray={selectable&&state==="unselected"?"4 3":undefined}/><circle cx="0" cy="-31" r="14" fill="white"/><text x="0" y="-25" textAnchor="middle" fontSize="19" fontFamily="system-ui, sans-serif">{point.emoji}</text>
          {(selectable||group.length>1||point.rating)&&<g><rect x="7" y="-19" width={group.length>1&&selectable?35:22} height="19" rx="9" fill={selectable&&chosen?"#1d4ed8":"white"} stroke="#475569"/><text x={group.length>1&&selectable?24.5:18} y="-6" textAnchor="middle" fontSize="11" fontWeight="700" fill={selectable&&chosen?"white":"#173e51"}>{selectable?group.length>1?`${chosen}/${group.length}`:chosen?"✓":"○":group.length>1?group.length:point.rating?.symbol}</text></g>}
          {point.label&&<text x="0" y="15" textAnchor="middle" className="community-drawing-label">{point.label}</text>}
        </g>;
      })}
      {workbench?.layers.route&&workbench.route.map((id,index)=>{const point=lookup.get(id);if(!point)return null;const position=project(point.location);return <text key={`${id}:${index}`} x={position.x-17} y={position.y-40} fontSize="14" fontWeight="800" className="community-drawing-label">{index+1}</text>;})}
      {workbench?.layers.notes&&workbench.notes.map(note=>{const position=project(note.location),text=[note.emoji,note.text].filter(Boolean).join(" "),lines=Array.from(text).reduce<string[]>((all,char,index)=>{if(index%24===0)all.push("");all[all.length-1]+=char;return all;},[]),width=Math.min(290,Math.max(34,Math.min(24,Array.from(text).length)*11+14));return <g key={note.id} data-note={note.id} transform={`translate(${position.x} ${position.y})`} role="button" tabIndex={gestureTool?-1:0} aria-label={`${text} 메모 수정`} onClick={event=>{event.stopPropagation();if(!suppressClick.current&&!gestureTool)onSelectNote?.(note.id);}} onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();onSelectNote?.(note.id);}}}><rect x={-width/2} y={-lines.length*18-8} width={width} height={lines.length*18+10} rx="6" fill={note.color} stroke="#839791"/><text textAnchor="middle" fontSize="12" fill="#173e51">{lines.map((line,index)=><tspan key={index} x="0" y={-(lines.length-index-1)*18-8}>{line}</tspan>)}</text></g>;})}
      {travelRoute&&<g className="community-travel-overlay" pointerEvents="none" aria-label={travelRoute.draft?"여행 동선 · 아직 계산하지 않음":`여행 동선 · ${travelRoute.provider??"도로 경로"} 계산 결과`}>
        <g>{travelLabels.map(label=>Math.hypot(label.x-label.anchor.x,label.y-label.anchor.y)>20?<line key={label.id} x1={label.anchor.x} y1={label.anchor.y} x2={label.x} y2={label.y} stroke={label.color} strokeWidth="1" strokeOpacity=".65"/>:null)}</g>
        {travelRoute.stops.slice(0,12).map((stop,index)=>{const position=project(stop.location);return <g key={stop.id} data-travel-stop={stop.id}><circle cx={position.x-18} cy={position.y-43} r="10" fill="#173e51" stroke="white" strokeWidth="2"/><text x={position.x-18} y={position.y-39} textAnchor="middle" fontSize="11" fontWeight="800" fill="white">{index+1}</text></g>;})}
        <g>{travelLabels.map(label=><g key={label.id} data-travel-label={label.id} data-label-x={label.x} data-label-y={label.y} data-label-width={label.width} data-label-height={label.height}><title>{label.title}</title><text textAnchor="middle" className={label.kind==="stop"?"community-travel-stop-title":"community-travel-label"}>{label.lines.map((line,index)=><tspan key={index} x={label.x} y={label.y+(index-(label.lines.length-1)/2)*14}>{index?" ":""}{line}</tspan>)}</text></g>)}</g>
      </g>}
      {gestureTool&&[sourcePixel,targetPixel].filter(Boolean).map((position,index)=><circle key={index} cx={position!.x} cy={position!.y-29} r="26" fill="none" stroke={index?"#9b43cc":"#2563eb"} strokeWidth="3" strokeDasharray="5 3" pointerEvents="none"/>)}
    </svg>
    <div className="community-blank-zoom" aria-label="백지도 확대·축소"><button type="button" aria-label="백지도 확대" disabled={!!gestureTool} onClick={()=>onViewportChange(zoomCommunityBounds(bounds,1.5,size.width/2,size.height/2,size.width,size.height))}>＋</button><button type="button" aria-label="백지도 축소" disabled={!!gestureTool} onClick={()=>onViewportChange(zoomCommunityBounds(bounds,1/1.5,size.width/2,size.height/2,size.width,size.height))}>−</button><button type="button" aria-label="백지도 위치 초기화" disabled={!!gestureTool} onClick={()=>onViewportChange(initialBounds.current)}>↺</button></div>
    {(loading||error||!features.length)&&<div className="community-boundary-status" role={error?"alert":"status"}>{loading?"지역 경계를 불러오는 중…":error||"이 범위의 지역 경계 자료가 없어요."}{!loading&&onRetry&&<button type="button" onClick={onRetry}>경계 다시 불러오기</button>}</div>}
    {context&&contextPixel&&!gestureTool&&<div className="point-tool-popup community-point-popup" ref={popup} role="dialog" aria-label={`포인트 도구 · ${context.title}`} style={{width:popupWidth,left:Math.max(12,Math.min(contextPixel.x-popupWidth/2,size.width-popupWidth-12)),top:Math.max(66,Math.min(contextPixel.y-popupHeight-55,size.height-popupHeight-68))}} onKeyDown={event=>{if(event.key==="Escape"){event.stopPropagation();onCloseContext?.();}}}>{contextPopup}</div>}
    {gestureTool&&source&&<><div className="point-gesture-hint"><span>{gestureTool.kind==="radius"?preview?`반경 ${formatDistance(preview.meters)} · 손을 떼면 저장`:`${source.title} 핀에서 바깥으로 드래그하세요`:target?`${target.title} · 연결 준비 · 손을 떼면 연결`:preview?`직선 ${formatDistance(preview.meters)} · 다른 핀으로 이동하세요`:`${source.title} 핀에서 다른 핀까지 드래그하세요`}</span><button type="button" onClick={()=>finish(null)}>취소</button></div><details className="point-keyboard-controls"><summary>드래그 대신 직접 입력</summary>{gestureTool.kind==="radius"?<label>반경(m)<input type="number" min={1} max={maximumRadiusMeters} value={keyboardMeters} onChange={event=>setKeyboardMeters(Number(event.target.value))}/></label>:<label>연결할 포인트<select value={keyboardTarget} onChange={event=>setKeyboardTarget(event.target.value)}><option value="">선택하세요</option>{points.filter(point=>point.id!==source.id).map(point=><option key={point.id} value={point.id}>{point.emoji} {point.title}</option>)}</select></label>}<button type="button" disabled={gestureTool.kind==="radius"?!(keyboardMeters>=1&&keyboardMeters<=maximumRadiusMeters):!points.some(point=>point.id===keyboardTarget&&point.id!==source.id)} onClick={()=>finish(gestureTool.kind==="radius"?{pointId:source.id,meters:Math.round(keyboardMeters)}:{pointId:source.id,targetId:keyboardTarget})}>적용</button></details></>}
    {!!overlapIds.length&&<PointDialog label="같은 위치의 기록" onClose={()=>setOverlapIds([])}><h2>같은 위치의 기록 {overlapIds.length}개</h2><div className="overlap-records">{points.filter(point=>overlapIds.includes(point.id)).map(point=><button type="button" key={point.id} aria-label={`${point.title}${point.selectionState?point.selectionState==="selected"?" · 선택됨 · 선택 해제":" · 선택 안 됨 · 선택":""}`} onClick={()=>{setOverlapIds([]);onSelectPoint?.(point.id);}}>{point.emoji} {point.title} {point.selectionState?(point.selectionState==="selected"?"✓ 선택됨":"○ 선택 안 됨"):point.rating?.label}</button>)}</div><button type="button" onClick={()=>setOverlapIds([])}>닫기</button></PointDialog>}
  </div>;
}
