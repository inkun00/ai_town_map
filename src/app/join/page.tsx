"use client";

import { FormEvent, useEffect, useState } from "react";

export default function JoinPage() {
  const [code, setCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const params = new URLSearchParams(window.location.hash.slice(1));
    const initial = params.get("code");
    if (initial) setCode(initial);
    window.history.replaceState(null, "", "/join");
  }, []);

  async function join(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setMessage("");
    try {
      const sessionResponse = await fetch("/api/v1/session", { cache: "no-store" });
      if (!sessionResponse.ok) throw new Error("session unavailable");
      const sessionPayload = await sessionResponse.json();
      const csrfToken = sessionPayload.data?.csrfToken as string | undefined;
      const response = await fetch("/api/v1/invites/redeem", { method: "POST", headers: { "Content-Type": "application/json", ...(csrfToken ? { "X-CSRF-Token": csrfToken } : {}) }, body: JSON.stringify({ code, nickname }) });
      const payload = await response.json();
      if (!response.ok) { setMessage(payload.error?.message ?? "초대 코드를 확인해 주세요."); return; }
      window.location.assign(`/?map=${encodeURIComponent(payload.data.mapId)}`);
    } catch { setMessage("연결을 확인한 뒤 다시 시도해 주세요."); }
    finally { setBusy(false); }
  }

  return <main className="join-page"><div className="join-card"><a href="/" className="join-back">← 모두의 지도</a><span className="join-emoji" aria-hidden="true">🗺️</span><h1>친구들과 함께<br />지도를 채워요</h1><p>초대 코드와 닉네임으로 참여할 수 있어요. 같은 닉네임을 써도 참여 권한은 각자의 기기에 발급된 세션으로 구분됩니다.</p><form onSubmit={join}><label>초대 코드<input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} placeholder="XXXX-XXXX-XXXX" autoComplete="off" required /></label><label>닉네임<input value={nickname} onChange={(event) => setNickname(event.target.value)} placeholder="2~20자 닉네임" minLength={2} maxLength={20} required /></label>{message && <div role="alert" className="join-error">{message}</div>}<button disabled={busy} type="submit">{busy ? "입장 중..." : "지도에 참여하기"}</button></form><small>참여 세션은 7일 후 만료됩니다. 쿠키를 지우거나 기기를 바꾸면 이전 기록의 작성 권한은 복구되지 않습니다.</small></div></main>;
}
