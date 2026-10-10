"use client";

import {useId} from "react";
import styles from "./MapSharingSettings.module.css";

export type MapSharingVisibility="public"|"invite_only";
export type MapSharingSettingsProps={
  visibility:MapSharingVisibility;
  password:string;
  onVisibilityChange:(value:MapSharingVisibility)=>void;
  onPasswordChange:(value:string)=>void;
  passwordEnabled?:boolean;
  disabled?:boolean;
};

/** Sharing controls record participation. Every generated map remains publicly viewable. */
export function MapSharingSettings({visibility,password,onVisibilityChange,onPasswordChange,passwordEnabled=false,disabled=false}:MapSharingSettingsProps){
  const id=useId();
  const invalid=password.length>0&&(password.length<4||password.length>100);
  return <fieldset className={styles.settings} disabled={disabled} aria-describedby={`${id}-help`}>
    <legend>공유 설정</legend>
    <p className={styles.help} id={`${id}-help`}>모든 지도는 누구나 볼 수 있어요. 공유 설정은 <strong>포인트를 등록할 수 있는 사람</strong>을 정해요.</p>
    <div className={styles.choices}>
      <label className={`${styles.choice}${visibility==="public"?` ${styles.selected}`:""}`}>
        <input type="radio" name={`${id}-visibility`} value="public" checked={visibility==="public"} onChange={()=>onVisibilityChange("public")}/>
        <span><strong>🌍 전체공개</strong><small>누구나 입장해서 포인트를 등록할 수 있어요.</small></span>
      </label>
      <label className={`${styles.choice}${visibility==="invite_only"?` ${styles.selected}`:""}`}>
        <input type="radio" name={`${id}-visibility`} value="invite_only" checked={visibility==="invite_only"} onChange={()=>onVisibilityChange("invite_only")}/>
        <span><strong>🔑 일부공개</strong><small>지도 비밀번호 또는 교사의 인증코드로 입장한 사람이 등록할 수 있어요.</small></span>
      </label>
    </div>
    {visibility==="invite_only"&&<div className={styles.password}>
      <label htmlFor={`${id}-password`}>지도 비밀번호 <span>(선택)</span></label>
      <input id={`${id}-password`} type="password" autoComplete="new-password" minLength={4} maxLength={100} value={password} onChange={event=>onPasswordChange(event.target.value)} placeholder={passwordEnabled?"새 비밀번호를 설정하려면 입력해 주세요":"4~100자로 입력해 주세요"} aria-invalid={invalid} aria-describedby={`${id}-password-help${invalid?` ${id}-password-error`:""}`}/>
      <small id={`${id}-password-help`}>{passwordEnabled?"비워 두면 현재 비밀번호를 유지해요. 교사의 인증코드로도 입장할 수 있어요.":"비밀번호를 비워 두면 교사가 발급한 인증코드로만 포인트를 등록할 수 있어요."}</small>
      {invalid&&<p id={`${id}-password-error`} className={styles.error} role="alert">비밀번호는 4~100자로 입력해 주세요.</p>}
    </div>}
  </fieldset>;
}
