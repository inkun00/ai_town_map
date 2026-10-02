"use client";
import {useState} from "react";
import type {GameSummary} from "@/domain/exploration-game";
import {gameRequest} from "./GameShared";
export default function GameOwnerDelete({game,csrfToken,onChanged}:{game:GameSummary;csrfToken:string|null;onChanged:()=>Promise<void>}){
 const [confirm,setConfirm]=useState(false),[busy,setBusy]=useState(false),[error,setError]=useState("");
 if(!game.canDelete||!csrfToken)return null;
 const deleted=game.status==="deleted",expired=!!game.deletedAt&&Date.now()-new Date(game.deletedAt).getTime()>=30*86400000;
 async function act(){if(busy||(!deleted&&!confirm))return;setBusy(true);setError("");try{
  await gameRequest(`/api/v1/games/${game.id}${deleted?"/restore":""}`,csrfToken,{version:game.version},deleted?"POST":"DELETE");
  if(deleted){setConfirm(false);await onChanged();}else location.assign("/games");
 }catch(e){setError(e instanceof Error?e.message:"변경하지 못했어요.");}finally{setBusy(false);}}
 return <section className="game-section"><h2>{deleted?"삭제한 게임맵 복구":"🗑️ 내가 만든 게임맵 삭제"}</h2><p>{deleted?"삭제일로부터 30일 이내 복구하면 보관 상태로 열립니다. 종료된 게임방은 다시 시작되지 않습니다.":"게임맵을 만든 사람만 삭제할 수 있어요. 진행 중인 게임방과 위치 공유는 종료되고 원본 지도는 유지됩니다. 삭제 후 30일 안에 복구할 수 있어요."}</p>{error&&<p className="game-error" role="alert">{error}</p>}{deleted?<button className="button button--primary" type="button" disabled={busy||expired} onClick={()=>void act()}>{expired?"복구 기간 만료":busy?"복구 중…":"보관 상태로 복구"}</button>:!confirm?<button className="button button--light" type="button" onClick={()=>setConfirm(true)}>게임맵 삭제</button>:<div className="game-actions"><button className="button button--light" type="button" disabled={busy} onClick={()=>setConfirm(false)}>취소</button><button className="button button--primary" type="button" disabled={busy} onClick={()=>void act()}>{busy?"삭제 중…":"게임맵 삭제 확인"}</button></div>}</section>;
}
