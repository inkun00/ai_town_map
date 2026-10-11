"use client";

import Image from "next/image";
import questScene from "@/assets/adventure/neighborhood-quest.webp";
import {GameIcon} from "./AdventureArt";

export function StartScreen({onGuestStart,authError=false}:{onGuestStart:()=>void;authError?:boolean}){
  return <section className="start-screen" aria-label="시작 페이지">
    <div className="start-screen__scene">
      <Image src={questScene} fill sizes="(min-height: 700px) 960px, 640px" alt="지도를 들고 우리 동네를 탐험하는 여우" loading="eager" fetchPriority="high"/>
      <div className="start-screen__brand"><span aria-hidden="true"><GameIcon name="compass" size={36}/></span><div><h1>모두의 지도</h1><p>우리 동네 탐험대</p></div></div>
    </div>
    <nav className="start-screen__actions" aria-label="시작 방법">
      {authError&&<p role="alert" className="start-screen__error">로그인을 완료하지 못했어요. 다시 시도해 주세요.</p>}
      <a className="start-screen__button start-screen__button--login" href="/account/login?returnTo=%2F">로그인</a>
      <a className="start-screen__button start-screen__button--signup" href="/account/register?returnTo=%2F">회원가입</a>
      <button className="start-screen__button start-screen__button--guest" type="button" onClick={onGuestStart}>계정 없이 시작</button>
    </nav>
  </section>;
}
