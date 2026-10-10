"use client";

import {useId,useRef,useState,type ReactNode} from "react";

/** Open inputs only on request, then preserve drafts when a panel is folded. */
export function PointDetailPanels({edit,comments,management}:{edit?:ReactNode;comments?:ReactNode;management?:ReactNode}) {
  const id=useId();
  const [opened,setOpened]=useState({edit:false,comments:false});
  const [visited,setVisited]=useState({edit:false,comments:false,management:false});
  const panels=useRef<Partial<Record<"edit"|"comments",HTMLElement|null>>>({});

  function toggle(kind:"edit"|"comments") {
    const next=!opened[kind];
    setOpened(current=>({...current,[kind]:next}));
    if(next){
      setVisited(current=>({...current,[kind]:true}));
      requestAnimationFrame(()=>panels.current[kind]?.scrollIntoView?.({block:"nearest"}));
    }
  }

  if(!edit&&!comments&&!management)return null;
  return <div className="point-detail-actions">
    {(edit||comments)&&<div className="point-detail-actions__buttons" aria-label="기록 상세 기능">
      {edit&&<button type="button" className={`button button--light${opened.edit?" point-detail-action--open":""}`} aria-expanded={opened.edit} aria-controls={`${id}-edit`} onClick={()=>toggle("edit")}><span aria-hidden="true">✏️</span> 기록 수정 <span className="point-detail-actions__arrow" aria-hidden="true">{opened.edit?"▴":"▾"}</span></button>}
      {comments&&<button type="button" className={`button button--light${opened.comments?" point-detail-action--open":""}`} aria-expanded={opened.comments} aria-controls={`${id}-comments`} onClick={()=>toggle("comments")}><span aria-hidden="true">💬</span> 댓글 <span className="point-detail-actions__arrow" aria-hidden="true">{opened.comments?"▴":"▾"}</span></button>}
    </div>}
    {edit&&<section ref={element=>{panels.current.edit=element;}} id={`${id}-edit`} className="point-detail-panel" role="region" aria-label="기록 수정" hidden={!opened.edit}>{visited.edit&&edit}</section>}
    {comments&&<section ref={element=>{panels.current.comments=element;}} id={`${id}-comments`} className="point-detail-panel" role="region" aria-label="댓글" hidden={!opened.comments}>{visited.comments&&comments}</section>}
    {management&&<details className="point-detail-management" onToggle={event=>{if(event.currentTarget.open)setVisited(current=>({...current,management:true}));}}><summary>기록 관리</summary>{visited.management&&management}</details>}
  </div>;
}
