"use client";

import {useEffect,useId,useLayoutEffect,useRef,useState,type CSSProperties,type KeyboardEvent,type PointerEvent,type ReactNode} from "react";
import {createPortal} from "react-dom";

type Position={left:number;top:number};
type Drag={pointerId:number;startX:number;startY:number;origin:Position;target:HTMLElement};
export type ResponsiveMapDialogProps={
  label:string;
  onClose:()=>void;
  children:ReactNode;
  className?:string;
  headerClassName?:string;
  bodyClassName?:string;
  closeLabel?:string;
};

const desktopQuery="(min-width:900px) and (pointer:fine)";
const inset=8;
let frontLayer=1200;

/** Desktop windows share the map's page; touch screens retain a native modal. */
export function ResponsiveMapDialog({label,onClose,children,className="",headerClassName="",bodyClassName="",closeLabel=`${label} 닫기`}:ResponsiveMapDialogProps){
  const [desktop,setDesktop]=useState<boolean|null>(null),[position,setPosition]=useState<Position|null>(null),[dragging,setDragging]=useState(false),[layer,setLayer]=useState(1200);
  const dialogRef=useRef<HTMLDialogElement>(null),dragRef=useRef<Drag|null>(null),positionRef=useRef<Position|null>(null);
  const openerRef=useRef<HTMLElement|null>(null),restoreFocusRef=useRef(false),closeRequested=useRef(false);
  const instructionsId=useId();

  function place(next:Position){positionRef.current=next;setPosition(next);}
  function clamp(next:Position):Position{
    const rect=dialogRef.current?.getBoundingClientRect();
    const width=Math.min(rect?.width??0,Math.max(0,window.innerWidth-inset*2));
    const height=Math.min(rect?.height??0,Math.max(0,window.innerHeight-inset*2));
    return {left:Math.max(inset,Math.min(next.left,window.innerWidth-width-inset)),top:Math.max(inset,Math.min(next.top,window.innerHeight-height-inset))};
  }
  function center(){
    const rect=dialogRef.current?.getBoundingClientRect();
    if(rect)place(clamp({left:(window.innerWidth-rect.width)/2,top:(window.innerHeight-rect.height)/2}));
  }
  function releaseDrag(){
    const drag=dragRef.current;dragRef.current=null;
    if(drag){try{if(drag.target.hasPointerCapture?.(drag.pointerId))drag.target.releasePointerCapture(drag.pointerId);}catch{/* A removed target already released capture. */}}
  }
  function endDrag(){releaseDrag();setDragging(false);}
  function requestClose(){if(!closeRequested.current){closeRequested.current=true;onClose();}}
  function raise(){if(desktop)setLayer(++frontLayer);}

  useEffect(()=>{
    openerRef.current=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const restore=()=>{if(restoreFocusRef.current&&openerRef.current?.isConnected)openerRef.current.focus();};
    if(typeof window.matchMedia!=="function"){setDesktop(false);return restore;}
    const media=window.matchMedia(desktopQuery);
    const update=()=>setDesktop(media.matches);
    update();media.addEventListener("change",update);
    return()=>{media.removeEventListener("change",update);restore();};
  },[]);

  useLayoutEffect(()=>{
    const dialog=dialogRef.current;if(desktop===null||!dialog)return;
    closeRequested.current=false;positionRef.current=null;setPosition(null);setDragging(false);
    if(desktop){dialog.show();center();setLayer(++frontLayer);}else dialog.showModal();
    const constrain=()=>{if(desktop&&positionRef.current)place(clamp(positionRef.current));};
    window.addEventListener("resize",constrain);
    const observer=typeof ResizeObserver!=="undefined"?new ResizeObserver(constrain):null;
    if(desktop)observer?.observe(dialog);
    return()=>{
      window.removeEventListener("resize",constrain);observer?.disconnect();releaseDrag();
      const active=document.activeElement;
      restoreFocusRef.current=dialog.contains(active);
      dialog.close();
      // Closing a nonmodal window must not pull focus away from a map control.
      if(!restoreFocusRef.current&&active instanceof HTMLElement&&active.isConnected&&document.activeElement!==active)active.focus();
    };
    // The mode owns the dialog lifecycle; event handlers read current refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  },[desktop]);

  function startDrag(event:PointerEvent<HTMLElement>){
    if(!desktop||event.button!==0||event.isPrimary===false||!(event.target instanceof Element)||event.target.closest("button,input,select,textarea,a,[contenteditable=true]"))return;
    const rect=dialogRef.current?.getBoundingClientRect();if(!rect)return;
    event.preventDefault();event.currentTarget.focus();
    dragRef.current={pointerId:event.pointerId,startX:event.clientX,startY:event.clientY,origin:positionRef.current??{left:rect.left,top:rect.top},target:event.currentTarget};
    try{event.currentTarget.setPointerCapture(event.pointerId);}catch{/* Capture can be unavailable after a cancelled pointer. */}
    setDragging(true);
  }
  function moveDrag(event:PointerEvent<HTMLElement>){
    const drag=dragRef.current;if(!drag||drag.pointerId!==event.pointerId)return;
    event.preventDefault();place(clamp({left:drag.origin.left+event.clientX-drag.startX,top:drag.origin.top+event.clientY-drag.startY}));
  }
  function moveWithKeyboard(event:KeyboardEvent<HTMLElement>){
    if(!desktop||event.target!==event.currentTarget)return;
    if(event.key==="Home"){event.preventDefault();center();return;}
    const offsets:Record<string,[number,number]>={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]};
    const offset=offsets[event.key];if(!offset)return;
    event.preventDefault();const rect=dialogRef.current?.getBoundingClientRect(),origin=positionRef.current??{left:rect?.left??inset,top:rect?.top??inset},step=event.shiftKey?40:10;
    place(clamp({left:origin.left+offset[0]*step,top:origin.top+offset[1]*step}));
  }

  if(desktop===null)return null;
  const style:CSSProperties|undefined=desktop&&position?{left:position.left,top:position.top,zIndex:layer}:undefined;
  return createPortal(<dialog ref={dialogRef} className={`responsive-map-dialog ${desktop?"responsive-map-dialog--desktop":"responsive-map-dialog--mobile"} ${className}`} data-desktop={desktop} data-dragging={dragging||undefined} style={style} aria-label={label} onFocusCapture={raise} onPointerDownCapture={raise} onCancel={event=>{event.preventDefault();requestClose();}} onKeyDown={event=>{if(event.key==="Escape"&&!event.defaultPrevented){event.preventDefault();event.stopPropagation();requestClose();}}} onClick={event=>{if(desktop||event.target!==event.currentTarget)return;const rect=event.currentTarget.getBoundingClientRect();if(event.clientX<rect.left||event.clientX>rect.right||event.clientY<rect.top||event.clientY>rect.bottom)requestClose();}}>
    <header className={`responsive-map-dialog__header ${headerClassName}`} tabIndex={desktop?0:undefined} role={desktop?"group":undefined} aria-label={desktop?`${label} 창 이동`:undefined} aria-describedby={desktop?instructionsId:undefined} onPointerDown={startDrag} onPointerMove={moveDrag} onPointerUp={event=>{if(dragRef.current?.pointerId===event.pointerId)endDrag();}} onPointerCancel={endDrag} onLostPointerCapture={endDrag} onKeyDown={moveWithKeyboard}>
      <div className="responsive-map-dialog__title"><h2>{label}</h2>{desktop&&<span className="responsive-map-dialog__move-hint" aria-hidden="true"><span>⠿</span> 끌어서 이동</span>}</div>
      <div className="responsive-map-dialog__actions">{desktop&&<button type="button" className="responsive-map-dialog__reset" aria-label="창 위치 초기화" title="창 위치 초기화" onClick={center}>↺</button>}<button type="button" aria-label={closeLabel} onClick={requestClose}>×</button></div>
    </header>
    {desktop&&<span id={instructionsId} className="responsive-map-dialog__sr-only">방향키로 창을 이동합니다. Shift와 방향키로 더 빠르게 이동하고 Home 키로 위치를 초기화합니다.</span>}
    <div className={`responsive-map-dialog__body ${bodyClassName}`}>{children}</div>
  </dialog>,document.body);
}
