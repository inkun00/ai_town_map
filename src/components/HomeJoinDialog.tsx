"use client";

import {useEffect,useId,useRef} from "react";
import {GameIcon} from "./AdventureArt";

export function HomeJoinDialog({open,onClose}:{open:boolean;onClose:()=>void}){
  const dialog=useRef<HTMLDialogElement>(null);
  const titleId=useId(),descriptionId=useId();

  useEffect(()=>{
    const element=dialog.current;
    if(!element||!open)return;
    const opener=document.activeElement instanceof HTMLElement?document.activeElement:null;
    if(!element.open)element.showModal();
    return()=>{
      if(element.open)element.close();
      if(opener?.isConnected)opener.focus();
    };
  },[open]);

  return <dialog ref={dialog} className="home-join-dialog" aria-labelledby={titleId} aria-describedby={descriptionId} onCancel={event=>{event.preventDefault();onClose();}} onClick={event=>{if(event.target===event.currentTarget)onClose();}}>
    <section className="home-join-dialog__content">
      <header className="home-join-dialog__header"><div><span className="home-join-dialog__kicker"><GameIcon name="key" size={21}/> 초대받은 탐험</span><h2 id={titleId}>코드로 참여하기</h2></div><button className="home-join-dialog__close" type="button" aria-label="참여 방식 선택 닫기" onClick={onClose}>×</button></header>
      <p id={descriptionId} className="home-join-dialog__description">어떤 코드를 받았나요? 참여할 곳을 골라 주세요.</p>
      <nav className="home-join-dialog__choices" aria-label="코드 참여 방식">
        <a href="/join" className="home-join-dialog__choice home-join-dialog__choice--map"><span className="home-join-dialog__icon"><GameIcon name="map" size={38}/></span><span className="home-join-dialog__copy"><strong>지도에 참여</strong><span>교사 인증코드</span><small>닉네임을 정하고 지도에 발견한 장소를 기록해요.</small></span><span className="home-join-dialog__arrow" aria-hidden="true">›</span></a>
        <a href="/games" className="home-join-dialog__choice home-join-dialog__choice--game"><span className="home-join-dialog__icon"><GameIcon name="flag" size={38}/></span><span className="home-join-dialog__copy"><strong>게임방에 참여</strong><span>게임방 코드</span><small>게임방에 들어가 미션을 해결하고 점수를 모아요.</small></span><span className="home-join-dialog__arrow" aria-hidden="true">›</span></a>
      </nav>
      <p className="home-join-dialog__tip"><GameIcon name="key" size={20}/><span>지도 인증코드와 게임방 코드는 서로 달라요.</span></p>
      <button className="home-join-dialog__cancel" type="button" onClick={onClose}>다음에 참여할게요</button>
    </section>
  </dialog>;
}
