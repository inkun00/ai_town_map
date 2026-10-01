"use client";

import {useState} from "react";
import {filterLabel,type ObservationFilter} from "@/domain/analysis";
import type {DemoPoint,Theme} from "@/lib/demo-data";
import {AnalysisFilters} from "./AnalysisControls";
import {MapLegend} from "./MapMeaning";
import {PointDialog} from "./PointDialog";

const shortCount=(count:number)=>count>=1000?`${Number((count/1000).toFixed(1))}천`:String(count);

export function MapTools({theme,points,filter,onChange,bounds,showList,onToggleList,loading,error,onOpenWorkbench,visibleCount}:{theme:Theme;points:DemoPoint[];filter:ObservationFilter;onChange:(filter:ObservationFilter)=>void;bounds?:ObservationFilter["bbox"];showList:boolean;onToggleList:()=>void;loading:boolean;error:string;onOpenWorkbench?:()=>void;visibleCount?:number}){
  const [panel,setPanel]=useState<"filters"|"legend"|null>(null);
  const hasFilter=Object.keys(filter).length>0;
  return <>
    <div className={`map-tools ${showList?"map-tools--list":""}`}>
      <div className="map-tools__buttons" aria-label="지도 보기 도구">
        {onOpenWorkbench&&<button type="button" className="map-tools__workbench" onClick={onOpenWorkbench} aria-label={`지도 도구 · ${visibleCount??points.length}/${points.length}개 표시`} aria-haspopup="dialog"><span aria-hidden="true">🧰</span>도구 <b>{shortCount(visibleCount??points.length)}/{shortCount(points.length)}</b></button>}
        <button type="button" onClick={()=>setPanel("filters")} aria-label={hasFilter?`지도 조건 변경 · ${filterLabel(filter,theme)}`:"지도 조건 선택"} aria-haspopup="dialog"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M4 5h16l-6 7v6l-4 2v-8z"/></svg>조건{hasFilter&&<span className="map-tools__dot" aria-hidden="true"/>}</button>
        <button type="button" className="map-tools__legend" onClick={()=>setPanel("legend")} aria-label={`지도 범례 보기 · 기록 ${points.length}개`} aria-haspopup="dialog"><span aria-hidden="true">◉</span>범례 <b>{shortCount(points.length)}</b></button>
        <button type="button" onClick={onToggleList} aria-label={showList?"지도로 보기":"기록 목록 보기"}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">{showList?<><path d="m3 6 6-2 6 2 6-2v14l-6 2-6-2-6 2z"/><path d="M9 4v14M15 6v14"/></>:<path d="M4 6h16M4 12h16M4 18h16"/>}</svg>{showList?"지도":"목록"}</button>
      </div>
      {(loading||error)&&<p className="map-tools__notice" role={error?"alert":"status"}>{error||"기록을 불러오는 중…"}</p>}
    </div>
    {panel&&<PointDialog label={panel==="filters"?"지도 조건 선택":"지도 범례"} onClose={()=>setPanel(null)}><div className="map-menu-sheet"><header><h2>{panel==="filters"?"지도 조건":"이모지와 핀 색상"}</h2><button type="button" className="round-icon" aria-label="지도 도구 닫기" onClick={()=>setPanel(null)}>×</button></header>{panel==="filters"?<AnalysisFilters theme={theme} filter={filter} onChange={onChange} bounds={bounds} expanded/>:<MapLegend theme={theme} points={points}/>}<button type="button" className="button button--primary button--full" onClick={()=>setPanel(null)}>지도 보기</button></div></PointDialog>}
  </>;
}
