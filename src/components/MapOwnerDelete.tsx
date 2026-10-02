"use client";
import {useState} from "react";
export default function MapOwnerDelete({mapId,version,csrfToken,onNotice,onDeleted}:{mapId:string;version:string;csrfToken:string;onNotice:(s:string)=>void;onDeleted:()=>void}){
 const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false);
 async function remove(){if(!confirm||busy)return;setBusy(true);try{
  const r=await fetch(`/api/v1/maps/${mapId}`,{method:"DELETE",headers:{"X-CSRF-Token":csrfToken,"X-Resource-Version":`"${version}"`}});
  if(!r.ok){const p=await r.json();throw new Error(p.error?.message??"지도를 삭제하지 못했어요.");}onDeleted();
 }catch(e){onNotice(e instanceof Error?e.message:"삭제하지 못했어요.");}finally{setBusy(false);}}
 return <section className="game-launch-card"><strong>🗑️ 내가 만든 지도 삭제</strong><p>개설자만 삭제할 수 있어요. 연결된 게임방은 종료됩니다. 삭제 후 30일 안에 메인 ‘삭제한 지도’에서 복구할 수 있어요.</p>{!confirm?<button className="button button--light button--full" type="button" onClick={()=>setConfirm(true)}>지도 삭제</button>:<div className="game-actions"><button className="button button--light" type="button" disabled={busy} onClick={()=>setConfirm(false)}>취소</button><button className="button button--primary" type="button" disabled={busy} onClick={()=>void remove()}>{busy?"삭제 중…":"지도 삭제 확인"}</button></div>}</section>;
}
