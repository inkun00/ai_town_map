"use client";

import {useEffect,useRef,type ReactNode} from "react";

/** Native modality keeps keyboard focus inside and restores it to the opener. */
export function PointDialog({label,onClose,children}:{label:string;onClose:()=>void;children:ReactNode}) {
  const ref=useRef<HTMLDialogElement>(null);
  useEffect(()=>{
    const dialog=ref.current;
    const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
    dialog?.showModal();
    return ()=>{dialog?.close();if(opener?.isConnected)opener.focus();};
  },[]);
  return <dialog ref={ref} className="point-dialog" aria-label={label} onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===event.currentTarget)onClose();}}><section className="point-sheet">{children}</section></dialog>;
}
