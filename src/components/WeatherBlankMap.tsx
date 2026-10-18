"use client";

import {useEffect,useMemo,useRef,useState,type PointerEvent as ReactPointerEvent} from "react";
import type {MapPoint} from "./KakaoMap";
import {fitWeatherBoundaries,placeWeatherBoundaryLabels,weatherBoundaryColors,weatherBoundaryPath,type WeatherBoundaryFeature} from "@/domain/weather-boundaries";
import "@/app/weather-blank-map.css";

type Props={features:WeatherBoundaryFeature[];points:MapPoint[];selectedId?:string|null;onSelectPoint?:(id:string)=>void;loading?:boolean;error?:string;onRetry?:()=>void};
type View={zoom:number;x:number;y:number};
const initialView:View={zoom:1,x:0,y:0};
const clampZoom=(zoom:number)=>Math.max(1,Math.min(8,zoom));

export default function WeatherBlankMap({features,points,selectedId,onSelectPoint,loading=false,error,onRetry}:Props){
  const containerRef=useRef<HTMLDivElement>(null),svgRef=useRef<SVGSVGElement>(null);
  const [size,setSize]=useState({width:440,height:640}),[view,setView]=useState<View>(initialView),[dragging,setDragging]=useState(false);
  const drag=useRef<{pointerId:number;startX:number;startY:number;x:number;y:number}|null>(null),suppressClick=useRef(false);
  const featureIds=features.map(feature=>feature.id).join(",");
  useEffect(()=>{setView(initialView);},[featureIds]);
  useEffect(()=>{
    const element=containerRef.current;if(!element)return;
    const resize=()=>{const rect=element.getBoundingClientRect();if(rect.width>0&&rect.height>0)setSize({width:rect.width,height:rect.height});};resize();
    if(typeof ResizeObserver!=="undefined"){const observer=new ResizeObserver(resize);observer.observe(element);return()=>observer.disconnect();}
    window.addEventListener("resize",resize);return()=>window.removeEventListener("resize",resize);
  },[]);
  useEffect(()=>{
    const svg=svgRef.current;if(!svg)return;
    const wheel=(event:WheelEvent)=>{event.preventDefault();const rect=svg.getBoundingClientRect(),x=event.clientX-rect.left,y=event.clientY-rect.top;setView(previous=>{
      const zoom=clampZoom(previous.zoom*Math.exp(-event.deltaY*.002));if(zoom===previous.zoom)return previous;
      const ratio=zoom/previous.zoom;return {zoom,x:x-(x-previous.x)*ratio,y:y-(y-previous.y)*ratio};
    });};
    svg.addEventListener("wheel",wheel,{passive:false});return()=>svg.removeEventListener("wheel",wheel);
  },[]);
  const projection=useMemo(()=>fitWeatherBoundaries(features,size.width,size.height),[features,size]);
  const pointById=useMemo(()=>new Map(points.map(point=>[point.id,point])),[points]);
  const colors=useMemo(()=>weatherBoundaryColors(features.map(feature=>feature.id)),[features]);
  const renderedFeatures=useMemo(()=>features.map(feature=>({feature,path:weatherBoundaryPath(feature.geometry,projection),label:projection.project(feature.label)})),[features,projection]);
  const labelContent=useMemo(()=>new Map(features.map(feature=>{
    const text=(pointById.get(feature.id)?.label??`${feature.name} 자료 없음`).replace(/\s+/g," ").trim();
    const lines=text.startsWith(`${feature.name} `)?[feature.name,text.slice(feature.name.length).trim()]:[text];
    return [feature.id,{text,lines,width:Math.max(...lines.map(line=>[...line].reduce((sum,char)=>sum+(/[\u2e80-\uffff]/.test(char)?11:6.5),0)))+8,height:lines.length*14+4}] as const;
  })),[features,pointById]);
  const labels=useMemo(()=>placeWeatherBoundaryLabels(renderedFeatures.map(({feature,label})=>({id:feature.id,x:label.x*view.zoom+view.x,y:label.y*view.zoom+view.y,width:labelContent.get(feature.id)!.width,height:labelContent.get(feature.id)!.height})),{width:size.width,height:size.height,top:Math.min(160,size.height*.3),bottom:55}),[renderedFeatures,labelContent,view,size]);
  function zoomBy(factor:number){setView(previous=>{const zoom=clampZoom(previous.zoom*factor),ratio=zoom/previous.zoom;return {zoom,x:size.width/2-(size.width/2-previous.x)*ratio,y:size.height/2-(size.height/2-previous.y)*ratio};});}
  function pointerDown(event:ReactPointerEvent<SVGSVGElement>){
    if(event.button!==0&&event.pointerType!=="touch")return;
    suppressClick.current=false;drag.current={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,x:view.x,y:view.y};
  }
  function pointerMove(event:ReactPointerEvent<SVGSVGElement>){
    const active=drag.current;if(!active||active.pointerId!==event.pointerId)return;
    const dx=event.clientX-active.startX,dy=event.clientY-active.startY;if(Math.hypot(dx,dy)>4){
      if(!suppressClick.current){try{event.currentTarget.setPointerCapture(event.pointerId);}catch{/* Capture is optional in older embedded browsers. */}}
      suppressClick.current=true;setDragging(true);
    }
    if(suppressClick.current)setView(previous=>({...previous,x:active.x+dx,y:active.y+dy}));
  }
  function pointerUp(event:ReactPointerEvent<SVGSVGElement>){
    if(drag.current?.pointerId!==event.pointerId)return;drag.current=null;setDragging(false);
    try{event.currentTarget.releasePointerCapture(event.pointerId);}catch{/* Pointer may already have been released. */}
  }
  function choose(id:string){if(suppressClick.current){suppressClick.current=false;return;}onSelectPoint?.(id);}
  return <div className={`weather-blank-map${dragging?" is-dragging":""}`} ref={containerRef} aria-busy={loading}>
    <svg ref={svgRef} className="weather-blank-map-canvas" aria-label="지역별 백지도" viewBox={`0 0 ${size.width} ${size.height}`} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerCancel={pointerUp}>
      <rect width={size.width} height={size.height} fill="#fff"/>
      {!loading&&!error&&<g className="weather-blank-map-regions">{renderedFeatures.map(({feature,path})=>{
        const point=pointById.get(feature.id),text=(point?.label??`${feature.name} 자료 없음`).replace(/\s+/g," ").trim(),selected=feature.id===selectedId;
        return <g key={feature.id} role="button" tabIndex={0} aria-label={text} aria-pressed={selected} className={`weather-blank-region${selected?" is-selected":""}`} onClick={()=>choose(feature.id)} onKeyDown={event=>{if(event.key==="Enter"||event.key===" "){event.preventDefault();onSelectPoint?.(feature.id);}}}>
          <title>{text}</title>
          <path d={path} fill={colors.get(feature.id)} fillRule="evenodd" stroke={selected?"#173e51":"#718a88"} strokeWidth={selected?2.5:1} vectorEffect="non-scaling-stroke" transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}/>
        </g>;
      })}</g>}
      {!loading&&!error&&<g className="weather-blank-map-labels" aria-hidden="true">
        <g className="weather-blank-map-leaders">{labels.map(label=>Math.hypot(label.x-label.anchorX,label.y-label.anchorY)>8?<g key={label.id}><line className="weather-blank-label-leader" x1={label.anchorX} y1={label.anchorY} x2={label.x} y2={label.y}/><circle className="weather-blank-label-anchor" cx={label.anchorX} cy={label.anchorY} r="2.5" fill={colors.get(label.id)}/></g>:null)}</g>
        <g className="weather-blank-map-text">{labels.map(label=>{
          const {lines}=labelContent.get(label.id)!;
          return <text key={label.id} data-region-label={label.id} className={`weather-blank-region-label${label.id===selectedId?" is-selected":""}`} x={label.x} y={label.y} textAnchor="middle" dominantBaseline="central" onClick={()=>choose(label.id)}>{lines.map((line,index)=><tspan key={index} x={label.x} y={label.y+(index-(lines.length-1)/2)*14}>{index?" ":""}{line}</tspan>)}</text>;
        })}</g>
      </g>}
    </svg>
    <div className="weather-blank-map-zoom" aria-label="백지도 확대·축소">
      <button type="button" aria-label="백지도 확대" disabled={view.zoom>=8} onClick={()=>zoomBy(1.4)}>＋</button>
      <button type="button" aria-label="백지도 축소" disabled={view.zoom<=1} onClick={()=>zoomBy(1/1.4)}>−</button>
      <button type="button" aria-label="백지도 위치 초기화" onClick={()=>setView(initialView)}>↺</button>
    </div>
    {(loading||error||!features.length)&&<div className="weather-blank-map-status" role={error?"alert":"status"}>
      <p>{loading?"지역 경계를 불러오고 있어요.":error||"표시할 지역 경계가 없어요."}</p>
      {!loading&&onRetry&&<button type="button" onClick={onRetry}>경계 다시 불러오기</button>}
    </div>}
  </div>;
}
