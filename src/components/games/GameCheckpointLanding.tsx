"use client";

import {useEffect,useRef,useState} from "react";
import type {RoomState} from "@/domain/exploration-game";
import {getRememberedGameRoom,parseGameCheckpoint,savePendingCheckpoint} from "@/lib/game-checkpoint";
import {GameJoinForm} from "./GameJoinForm";
import {GameMessage,GameShell,gameRequest,useGameSession} from "./GameShared";

export default function GameCheckpointLanding(){
  const {session,ready,error:sessionError}=useGameSession();
  const capturedCode=useRef<string|null|undefined>(undefined);
  const [checking,setChecking]=useState(true),[valid,setValid]=useState(false),[error,setError]=useState("");
  useEffect(()=>{
    let active=true;
    const code=capturedCode.current===undefined?parseGameCheckpoint(window.location.href):capturedCode.current;
    capturedCode.current=code;
    // A printed QR contains only the checkpoint; it never signs a student in.
    window.history.replaceState(window.history.state,"","/games/checkpoint");
    if(!code){setError("이 앱의 보물 QR이 아니에요. 교사가 나눠 준 QR을 다시 확인해 주세요.");setChecking(false);return;}
    savePendingCheckpoint(code);setValid(true);
    const roomId=getRememberedGameRoom();
    if(!roomId){setChecking(false);return;}
    void gameRequest<RoomState>(`/api/v1/game-rooms/${roomId}`).then(state=>{
      if(!active)return;
      if(state.me&&(state.room.status==="running"||state.room.status==="lobby")){
        window.location.replace(`/games/rooms/${roomId}`);
      }else setChecking(false);
    }).catch(()=>{if(active)setChecking(false);});
    return()=>{active=false;};
  },[]);
  return <GameShell title="QR 보물 찾기"><div className="game-content">
    {checking?<p role="status">🗝️ 보물 QR을 확인하고 게임방으로 이동하고 있어요…</p>:<>
      <GameMessage error={error||sessionError}/>
      {valid?<><h1>🗝️ 보물 QR을 찾았어요!</h1><p className="game-help">먼저 교사가 알려 준 게임방 코드로 입장해 주세요. 게임이 시작되면 이 QR의 미션이 열려요.</p><GameJoinForm session={session} ready={ready}/></>:<a className="button button--primary button--full" href="/games">탐험게임으로 돌아가기</a>}
    </>}
  </div></GameShell>;
}
