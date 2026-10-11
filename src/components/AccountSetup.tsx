"use client";
import {useEffect,useRef,useState,type FormEvent} from "react";
import {accountRoleLabels,type AccountRole} from "@/domain/account";
import {GameShell,GameMessage,gameRequest,useGameSession} from "./games/GameShared";

const signupRoles=["teacher","student"] as const;
const roleDescriptions={teacher:"지도 만들기 · 탐험게임 운영",student:"지도 참여 · 관찰 기록 · 미션 수행"};

export default function AccountSetup({returnTo}:{returnTo:string}){
  const {session,ready,error:sessionError}=useGameSession();
  const [role,setRole]=useState<AccountRole|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState("");
  const submitting=useRef(false),active=useRef(false);
  const csrfMissing=ready&&session?.kind==="account"&&!session.csrfToken;
  const canRegister=ready&&!sessionError&&session?.kind==="account"&&!session.accountRole&&!csrfMissing;

  useEffect(()=>{active.current=true;return()=>{active.current=false;};},[]);
  async function submit(event:FormEvent){
    event.preventDefault();
    if(!role||busy||submitting.current||!canRegister)return;
    submitting.current=true;setBusy(true);setError("");
    try{
      await gameRequest("/api/v1/account",session.csrfToken,{role});
      if(active.current)window.location.assign(returnTo);
    }catch(cause){
      if(active.current){setError(cause instanceof Error?cause.message:"회원가입을 완료하지 못했어요.");setBusy(false);submitting.current=false;}
    }
  }

  return <GameShell title="회원 유형 선택" back="/" sectionLabel="회원가입">
    <section className="game-section">
      <span className="quest-tag">🧭 탐험대 회원가입</span><h1>어떤 탐험대원인가요?</h1>
      <p>교사는 지도를 만들고 탐험게임을 운영해요. 학생은 지도에 참여하고 기록과 미션을 함께해요.</p>
      <GameMessage error={error||sessionError||(csrfMissing?"현재 참여 정보를 확인하지 못했어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.":"")}/>
      {!ready&&!sessionError?<p role="status">회원 정보를 확인하고 있어요…</p>:ready&&session?.kind!=="account"?<div className="account-setup-entry">
        {signupRoles.map(item=><a key={item} className={`account-auth__rolechoice account-auth__rolechoice--${item}`} aria-label={`${accountRoleLabels[item]}${item==="teacher"?"로":"으로"} Google 회원가입`} href={`/api/v1/auth/google?role=${item}&returnTo=${encodeURIComponent(returnTo)}`}><span className="account-auth__role-emoji" aria-hidden="true">{item==="teacher"?"👩‍🏫":"🎒"}</span><span><strong>{accountRoleLabels[item]}{item==="teacher"?"로":"으로"} Google 회원가입</strong><small>{roleDescriptions[item]}</small></span><span aria-hidden="true">›</span></a>)}
        <a className="button button--light" href={`/account/register?returnTo=${encodeURIComponent(returnTo)}`}>학생 아이디로 가입</a>
      </div>:ready&&session?.accountRole?<><p className="game-tip">{accountRoleLabels[session.accountRole]}{session.accountRole==="teacher"?"로":"으로"} 가입되어 있어요. 가입한 회원 유형은 이 화면에서 변경할 수 없습니다.</p><a className="button button--primary" href={returnTo}>돌아가기</a></>:ready&&session?.kind==="account"?<form onSubmit={submit}>
        <fieldset disabled={busy||!canRegister}>
          <legend>회원 유형</legend>
          {signupRoles.map(item=><label className="game-choice" key={item}><input type="radio" required name="account-role" value={item} checked={role===item} onChange={()=>setRole(item)}/><span><strong>{item==="teacher"?"👩‍🏫":"🎒"} {accountRoleLabels[item]}</strong><small style={{display:"block",marginTop:6}}>{roleDescriptions[item]}</small></span></label>)}
          <p className="game-help">회원 유형은 가입할 때 한 번 선택합니다.</p>
          <button className="button button--primary button--full" disabled={!role||!canRegister}>{busy?"가입 정보를 저장 중…":"선택한 유형으로 회원가입 완료"}</button>
        </fieldset>
      </form>:null}
    </section>
  </GameShell>;
}
