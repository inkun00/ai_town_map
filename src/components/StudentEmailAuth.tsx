"use client";

import {useEffect,useId,useRef,useState,type FormEvent} from "react";
import {GameIcon} from "./AdventureArt";
import {GameShell,useGameSession} from "./games/GameShared";

export type StudentEmailAuthProps={
  mode:"login"|"signup";
  returnTo:string;
  confirmed?:boolean;
  confirmationError?:boolean;
};
type EmailAction="signup"|"login"|"resend";
type AuthData={needsConfirmation?:boolean;message?:string;returnTo?:string};
function validEmail(value:string){return value.length<=254&&/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);}

/** Passwords remain local to the form and are sent only in the POST body. */
export function StudentEmailAuth({mode,returnTo,confirmed=false,confirmationError=false}:StudentEmailAuthProps){
  const signup=mode==="signup",id=useId();
  const {session,ready,error:sessionError}=useGameSession();
  const sessionCsrfMissing=ready&&session!==null&&!session.csrfToken;
  const authReady=ready&&!sessionError&&!sessionCsrfMissing;
  const [email,setEmail]=useState(""),[password,setPassword]=useState(""),[repeatPassword,setRepeatPassword]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState(confirmationError?"이메일 인증을 완료하지 못했어요. 새 확인 메일을 받아 다시 인증해 주세요.":"");
  const [notice,setNotice]=useState(confirmed?"이메일 인증을 마쳤어요. 학생 이메일과 비밀번호로 로그인해 주세요.":"");
  const [needsConfirmation,setNeedsConfirmation]=useState(confirmationError),[cooldownUntil,setCooldownUntil]=useState(0),[remaining,setRemaining]=useState(0);
  const submitting=useRef(false),active=useRef(false),request=useRef<AbortController|null>(null);
  const signupReturnTo=`/account/setup?returnTo=${encodeURIComponent(returnTo)}`;
  const googleHref=`/api/v1/auth/google?returnTo=${encodeURIComponent(signup?signupReturnTo:returnTo)}`;
  const otherHref=`/account/${signup?"login":"register"}?returnTo=${encodeURIComponent(returnTo)}`;

  useEffect(()=>{active.current=true;return()=>{active.current=false;request.current?.abort();};},[]);
  useEffect(()=>{
    if(!cooldownUntil){setRemaining(0);return;}
    const update=()=>setRemaining(Math.max(0,Math.ceil((cooldownUntil-Date.now())/1000)));
    update();const timer=setInterval(update,1000);return()=>clearInterval(timer);
  },[cooldownUntil]);

  function clearPasswords(){setPassword("");setRepeatPassword("");}
  async function perform(action:EmailAction){
    if(busy||submitting.current||(action==="resend"&&remaining>0))return;
    if(!authReady){setError("현재 참여 정보를 확인하지 못했어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.");return;}
    const address=email.trim();
    if(!validEmail(address)){setError("사용할 이메일 주소를 정확하게 입력해 주세요.");return;}
    if(action!=="resend"&&(password.length<8||password.length>128)){setError("비밀번호를 8~128자로 입력해 주세요.");return;}
    if(action==="signup"&&password!==repeatPassword){setError("비밀번호와 비밀번호 확인이 같지 않아요.");return;}
    const controller=new AbortController();request.current=controller;submitting.current=true;setBusy(true);setError("");setNotice("");let navigating=false;
    try{
      const response=await fetch("/api/v1/auth/email",{
        method:"POST",headers:{"Content-Type":"application/json",...(session?.csrfToken?{"X-CSRF-Token":session.csrfToken}:{})},
        body:JSON.stringify({action,email:address,...(action!=="resend"?{password}:{}),returnTo}),
        signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]),
      });
      const result=await response.json() as {data?:AuthData;error?:{code?:string;message?:string}};
      if(!active.current||controller.signal.aborted||request.current!==controller)return;
      if(!response.ok){
        if(result.error?.code==="EMAIL_NOT_CONFIRMED"){setNeedsConfirmation(true);clearPasswords();}
        if(action==="resend"&&response.status===429){setCooldownUntil(Date.now()+60000);setRemaining(60);}
        throw new Error(result.error?.message??"요청을 완료하지 못했어요. 잠시 후 다시 시도해 주세요.");
      }
      clearPasswords();
      if(action==="login"&&!result.data?.needsConfirmation){
        // This value is sanitized by the server page before being passed here.
        window.location.assign(returnTo);navigating=true;
      }else{
        setNeedsConfirmation(true);setCooldownUntil(Date.now()+60000);setRemaining(60);
        setNotice(result.data?.message??"확인 메일을 요청했어요. 이메일에서 인증 링크를 누른 뒤 로그인해 주세요.");
      }
    }catch(cause){
      if(active.current&&!controller.signal.aborted&&request.current===controller)setError(cause instanceof Error&&cause.name==="TimeoutError"?"응답이 늦어지고 있어요. 연결을 확인한 뒤 다시 시도해 주세요.":cause instanceof Error?cause.message:"연결을 확인한 뒤 다시 시도해 주세요.");
    }finally{
      if(request.current===controller){request.current=null;submitting.current=false;if(active.current&&!navigating)setBusy(false);}
    }
  }
  function submit(event:FormEvent){event.preventDefault();void perform(mode);}

  return <GameShell title={signup?"회원가입":"로그인"} back="/" sectionLabel="회원 계정">
    <div className="account-auth">
      <header className="account-auth__intro"><span className="quest-tag"><GameIcon name="backpack" size={22}/> 나의 탐험 계정</span><h1>{signup?"탐험대원이 되어 봐요!":"다시 탐험을 시작해요!"}</h1><p>{signup?"Google 계정으로 가입하거나, 학생 이메일로 가입해 주세요.":"Google 계정 또는 학생 이메일로 로그인해 주세요."}</p></header>
      <section className="account-auth__google" aria-label="Google 계정으로 시작"><a className="button button--light button--full" href={googleHref}>{signup?"Google로 회원가입":"Google로 로그인"}</a><p>{signup?"교사·학생·일반회원은 Google 가입 후 회원 유형을 선택해요.":"Google로 가입한 교사·학생·일반회원은 위 버튼을 눌러 주세요."}</p></section>
      <div className="account-auth__separator"><span>또는 학생 이메일로</span></div>
      <section className="account-auth__email" aria-labelledby={`${id}-email-heading`}>
        <h2 id={`${id}-email-heading`}>{signup?"학생 이메일 회원가입":"학생 이메일로 로그인"}</h2>
        {signup&&<p className="account-auth__help">이메일로 가입하면 학생 회원으로 등록돼요.</p>}
        {!ready&&!sessionError&&<p className="account-auth__help" role="status">현재 참여 정보를 확인하고 있어요…</p>}
        {(sessionError||sessionCsrfMissing)&&<p className="account-auth__error" role="alert">현재 참여 정보를 확인하지 못했어요. 페이지를 새로고침한 뒤 다시 시도해 주세요.</p>}
        {notice&&<p className="account-auth__notice" role="status">{notice}</p>}
        {error&&<p className="account-auth__error" role="alert">{error}</p>}
        {(!signup||!needsConfirmation)&&<form onSubmit={submit} aria-busy={busy}>
          <fieldset disabled={busy||!authReady}>
            <label className="account-auth__field" htmlFor={`${id}-email`}>이메일<input id={`${id}-email`} type="email" required maxLength={254} value={email} onChange={event=>setEmail(event.target.value)} autoComplete="email" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="이메일 주소를 입력해 주세요"/></label>
            <label className="account-auth__field" htmlFor={`${id}-password`}>비밀번호<input id={`${id}-password`} type="password" required minLength={8} maxLength={128} value={password} onChange={event=>setPassword(event.target.value)} autoComplete={signup?"new-password":"current-password"} aria-describedby={`${id}-password-help`} placeholder="8자 이상 비밀번호"/><small id={`${id}-password-help`}>8~128자로 입력해 주세요.</small></label>
            {signup&&<label className="account-auth__field" htmlFor={`${id}-repeat`}>비밀번호 확인<input id={`${id}-repeat`} type="password" required minLength={8} maxLength={128} value={repeatPassword} onChange={event=>setRepeatPassword(event.target.value)} autoComplete="new-password" placeholder="비밀번호를 한 번 더 입력해 주세요"/></label>}
            <button className="button button--primary button--full" type="submit">{busy?"확인하는 중…":signup?"학생 회원가입":"학생 이메일 로그인"}</button>
          </fieldset>
        </form>}
        {needsConfirmation&&<section className="account-auth__confirmation" aria-label="이메일 인증 안내">
          <strong>이메일에서 확인 메일을 열어 주세요.</strong>
          {signup&&<p className="account-auth__address">{email.trim()}</p>}
          <p>인증 링크를 누른 뒤 이메일과 비밀번호로 로그인하면 돼요. 메일이 보이지 않으면 스팸함도 확인해 주세요.</p>
          <button className="account-auth__resend" type="button" disabled={busy||!authReady||remaining>0||!validEmail(email.trim())} onClick={()=>void perform("resend")}>{remaining>0?`확인 메일 다시 보내기 · ${remaining}초 후`:busy?"메일 요청 중…":"확인 메일 다시 보내기"}</button>
          {signup&&<><a className="account-auth__confirmation-login" href={otherHref}>인증을 마쳤어요 · 로그인하기</a><button className="account-auth__change-email" type="button" disabled={busy} onClick={()=>{setNeedsConfirmation(false);setNotice("");setError("");}}>이메일 다시 입력하기</button></>}
        </section>}
      </section>
      <nav className="account-auth__switch" aria-label="계정 화면 이동"><span>{signup?"이미 가입한 계정이 있나요?":"아직 계정이 없나요?"}</span><a href={otherHref}>{signup?"로그인":"회원가입"}</a><a href="/">시작 화면으로</a></nav>
    </div>
  </GameShell>;
}
