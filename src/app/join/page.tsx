"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { inviteFeedback, validInviteInput } from "@/lib/invite-feedback";
import {GameIcon} from "@/components/AdventureArt";

export default function JoinPage() {
  const [code, setCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const submitting = useRef(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const initial = params.get("code");
    if (initial) setCode(initial);
    window.history.replaceState(null, "", "/join");
  }, []);

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting.current) return;
    if (!validInviteInput(code, nickname)) { setMessage("12자리 초대 코드와 2~20자 닉네임을 확인해 주세요. 공백만 있는 닉네임은 사용할 수 없어요."); return; }
    submitting.current = true;
    setBusy(true); setMessage("");
    try {
      const sessionResponse = await fetch("/api/v1/session", { cache: "no-store", signal: AbortSignal.timeout(15000) });
      if (!sessionResponse.ok) throw new Error("session unavailable");
      const sessionPayload = await sessionResponse.json();
      const csrfToken = sessionPayload.data?.csrfToken as string | undefined;
      const response = await fetch("/api/v1/invites/redeem", { method: "POST", headers: { "Content-Type": "application/json", ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}) }, body: JSON.stringify({ code: code.trim().toUpperCase().replaceAll("-", "").replaceAll(" ", ""), nickname: nickname.trim() }), signal: AbortSignal.timeout(20000) });
      const payload = await response.json();
      if (!response.ok) { setMessage(inviteFeedback(payload.error?.code, response.headers.get("Retry-After"))); return; }
      window.location.assign(`/?map=${encodeURIComponent(payload.data.mapId)}`);
    } catch { setMessage("연결을 확인한 뒤 다시 시도해 주세요."); }
    finally { submitting.current = false; setBusy(false); }
  }

  return <main className="join-page"><div className="join-card"><a href="/" className="join-back">← 모두의 지도</a><div className="join-adventure"><span className="quest-tag"><GameIcon name="key" size={19}/> 탐험대 초대장</span><img src="/adventure/explorer-fox.webp" width="90" height="108" alt="손을 흔들며 반기는 여우 탐험대장"/></div><h1>친구들과 함께<br/>탐험을 시작해요!</h1><p>친구나 선생님에게 받은 초대 코드를 입력하고, 탐험에 사용할 닉네임을 정해 주세요.</p><form onSubmit={join}><label>초대 코드<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX" autoComplete="off" required /></label><label>닉네임<input value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="2~20자 닉네임" minLength={2} maxLength={20} required /></label>{message && <div role="alert" className="join-error">{message}</div>}<button disabled={busy} type="submit">{busy ? "입장 중..." : "지도에 참여하기"}</button></form><small>참여 세션은 7일 후 만료됩니다. 쿠키를 지우거나 기기를 바꾸면 이전 기록의 작성 권한은 복구되지 않습니다.</small></div></main>;
}
