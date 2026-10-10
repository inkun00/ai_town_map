"use client";

import {useEffect,useRef,useState,type FormEvent} from "react";
import {PointDialog} from "./PointDialog";
import "@/app/map-participation.css";

export type MapParticipationJoinProps={
  mapId:string;
  title:string;
  visibility:"public"|"invite_only";
  passwordEnabled?:boolean;
  csrfToken:string|null;
  onJoined:()=>void|Promise<void>;
  onClose:()=>void;
  onNotice?:(message:string)=>void;
};

/** Reading a map stays public; joining here grants permission to add records. */
export function MapParticipationJoin({mapId,title,visibility,passwordEnabled=false,csrfToken,onJoined,onClose,onNotice}:MapParticipationJoinProps){
  const [nickname,setNickname]=useState("");
  const [method,setMethod]=useState<"password"|"code">(passwordEnabled?"password":"code");
  const [password,setPassword]=useState(""),[code,setCode]=useState("");
  const [busy,setBusy]=useState(false),[error,setError]=useState("");
  const active=useRef(false),request=useRef<AbortController|null>(null),submitting=useRef(false);
  const callbacks=useRef({onJoined,onClose,onNotice});callbacks.current={onJoined,onClose,onNotice};
  const partial=visibility==="invite_only";

  useEffect(()=>{
    active.current=true;setNickname("");setPassword("");setCode("");setError("");setBusy(false);submitting.current=false;setMethod(passwordEnabled?"password":"code");
    return()=>{active.current=false;request.current?.abort();request.current=null;};
  },[mapId,passwordEnabled,visibility]);

  function choose(next:"password"|"code"){
    if(busy)return;setMethod(next);setPassword("");setCode("");setError("");
  }

  async function join(event:FormEvent){
    event.preventDefault();if(submitting.current)return;
    const name=nickname.trim();
    if(name.length<2||name.length>20){setError("닉네임을 2~20자로 입력해 주세요.");return;}
    if(partial&&method==="password"&&(password.length<4||password.length>100)){setError("지도 비밀번호를 4~100자로 입력해 주세요.");return;}
    if(partial&&method==="code"&&(code.trim().length<12||code.trim().length>20)){setError("교사에게 받은 인증코드를 확인해 주세요.");return;}
    const controller=new AbortController();request.current=controller;submitting.current=true;setBusy(true);setError("");
    try{
      const response=await fetch(`/api/v1/maps/${encodeURIComponent(mapId)}/join`,{
        method:"POST",
        headers:{"Content-Type":"application/json",...(csrfToken?{"X-CSRF-Token":csrfToken}:{})},
        body:JSON.stringify({nickname:name,...(partial?method==="password"?{password}:{code:code.trim()}:{})}),
        signal:AbortSignal.any([controller.signal,AbortSignal.timeout(30000)]),
      });
      const result=await response.json();
      if(!active.current||controller.signal.aborted||request.current!==controller)return;
      if(!response.ok)throw new Error(result.error?.message??"지도에 참여하지 못했어요. 다시 시도해 주세요.");
      setPassword("");setCode("");
      await callbacks.current.onJoined();
      if(!active.current||controller.signal.aborted||request.current!==controller)return;
      callbacks.current.onNotice?.("이제 이 지도에 위치포인트를 등록할 수 있어요.");
      callbacks.current.onClose();
    }catch(cause){
      if(active.current&&!controller.signal.aborted&&request.current===controller)setError(cause instanceof Error&&cause.name==="TimeoutError"?"응답이 늦어지고 있어요. 잠시 후 다시 시도해 주세요.":cause instanceof Error?cause.message:"지도에 참여하지 못했어요.");
    }finally{
      if(request.current===controller){request.current=null;submitting.current=false;if(active.current)setBusy(false);}
    }
  }

  return <PointDialog label="위치포인트 등록 참여" onClose={onClose}>
    <div className="map-participation">
      <header><div><small>🗺️ 지도에 발견을 더해요</small><h2>위치포인트 등록 참여</h2></div><button className="sheet-close" type="button" aria-label="참여 창 닫기" onClick={onClose}>×</button></header>
      <strong className="map-participation__title">{title}</strong>
      <p>{partial?"이 지도는 일부공개예요. 비밀번호 또는 교사의 인증코드로 참여하면 위치포인트를 등록할 수 있어요.":"이 지도는 전체공개예요. 닉네임을 정하면 누구나 위치포인트를 등록할 수 있어요."}</p>
      <p className="map-participation__reading">지도와 등록된 기록은 누구나 볼 수 있어요.</p>
      <form onSubmit={join} aria-busy={busy}>
        <fieldset disabled={busy}>
          <label className="map-participation__field">닉네임<input autoFocus required minLength={2} maxLength={20} value={nickname} onChange={event=>setNickname(event.target.value)} autoComplete="off" placeholder="예: 용감한 탐험대"/></label>
          {partial&&<>
            {passwordEnabled?<div className="map-participation__methods" role="tablist" aria-label="참여 인증 방식">
              <button id="participation-password-tab" type="button" role="tab" aria-selected={method==="password"} aria-controls="participation-password-panel" onClick={()=>choose("password")}>🔒 지도 비밀번호</button>
              <button id="participation-code-tab" type="button" role="tab" aria-selected={method==="code"} aria-controls="participation-code-panel" onClick={()=>choose("code")}>🔑 교사 인증코드</button>
            </div>:<p className="map-participation__code-help">교사에게 지도 참여 인증코드를 받아 입력해 주세요.</p>}
            {method==="password"&&passwordEnabled?<div id="participation-password-panel" role="tabpanel" aria-labelledby="participation-password-tab"><label className="map-participation__field">지도 비밀번호<input required type="password" minLength={4} maxLength={100} value={password} onChange={event=>setPassword(event.target.value)} autoComplete="off" placeholder="교사가 알려 준 지도 비밀번호"/></label></div>:<div id="participation-code-panel" role={passwordEnabled?"tabpanel":undefined} aria-labelledby={passwordEnabled?"participation-code-tab":undefined}><label className="map-participation__field">교사 인증코드<input required minLength={12} maxLength={20} value={code} onChange={event=>setCode(event.target.value.toUpperCase())} autoComplete="off" autoCapitalize="characters" autoCorrect="off" spellCheck={false} placeholder="예: ABCD-EFGH-JKLM"/></label></div>}
          </>}
          {error&&<p className="map-participation__error" role="alert">{error}</p>}
          <button className="button button--primary button--full" type="submit">{busy?"참여 확인 중…":"지도 참여하기"}</button>
        </fieldset>
      </form>
      <button className="map-participation__read-button" type="button" onClick={onClose}>지금은 지도만 볼게요</button>
    </div>
  </PointDialog>;
}
