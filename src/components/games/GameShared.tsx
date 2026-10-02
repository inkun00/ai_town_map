"use client";
import {useEffect,useState,type ReactNode} from "react";
import {GameIcon} from "@/components/AdventureArt";
export type GameSession={kind:"account"|"guest";accountRole:import("@/domain/account").AccountRole|null;canCreateMap:boolean;csrfToken:string|null};
export async function gameRequest<T>(url:string,csrf:string|null=null,body?:unknown,method:"POST"|"DELETE"="POST"):Promise<T>{
  const response=await fetch(url,{cache:"no-store",...(body===undefined?{}:{method,headers:{"Content-Type":"application/json",...(csrf?{"X-CSRF-Token":csrf}:{})},body:JSON.stringify(body)})});
  const payload=await response.json();if(!response.ok)throw new Error(payload.error?.message??"요청을 처리하지 못했어요.");return payload.data as T;
}
export function useGameSession(){const [session,setSession]=useState<GameSession|null>(null),[ready,setReady]=useState(false),[error,setError]=useState("");useEffect(()=>{let active=true;void gameRequest<GameSession|null>("/api/v1/session").then(s=>{if(active){setSession(s);setReady(true);}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);return {session,ready,error};}
export function GameShell({title,back="/games",sectionLabel="탐험게임",children}:{title:string;back?:string;sectionLabel?:string;children:ReactNode}){return <main className="game-shell"><header className="game-header"><a className="game-back" href={back} aria-label="이전 화면으로">‹</a><span><small>🧭 모두의 지도 · {sectionLabel}</small><strong>{title}</strong></span><GameIcon name="flag" size={33}/></header>{children}</main>;}
export function GameMessage({error,notice}:{error?:string;notice?:string}){return <>{error&&<p className="game-error" role="alert">{error}</p>}{notice&&<p className="game-notice" role="status">{notice}</p>}</>;}
