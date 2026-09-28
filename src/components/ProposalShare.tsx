"use client";
import {useEffect,useState} from "react";
import type {Theme} from "@/lib/demo-data";
import {ProposalDocument,type ProposalDetail} from "./ProposalWorkspace";
export default function ProposalShare({mapId,id}:{mapId:string;id:string}){
  const [data,setData]=useState<{proposal:ProposalDetail;theme:Theme}|null>(null),[error,setError]=useState("");
  useEffect(()=>{let cancelled=false;void Promise.all([fetch(`/api/v1/maps/${mapId}/proposals/${id}?view=published`,{cache:"no-store"}),fetch(`/api/v1/maps/${mapId}/configuration`,{cache:"no-store"})]).then(async responses=>{const payloads=await Promise.all(responses.map(r=>r.json()));if(responses.some(r=>!r.ok))throw new Error("공유된 제안서를 열 수 없습니다. 초대 전용 지도는 참여한 계정이나 브라우저로 열어 주세요.");if(!cancelled)setData({proposal:payloads[0].data,theme:payloads[1].data.theme});}).catch(e=>{if(!cancelled)setError(e.message);});return()=>{cancelled=true;};},[mapId,id]);
  return <main className="proposal-share"><nav className="no-print"><a href={`/?map=${mapId}`}>← 지도로</a>{data&&<button type="button" onClick={()=>window.print()}>인쇄·PDF 저장</button>}</nav>{error?<div role="alert"><h1>제안서를 열 수 없어요</h1><p>{error}</p><a href={`/api/v1/auth/google?returnTo=${encodeURIComponent(`/maps/${mapId}/proposals/${id}`)}`}>Google 로그인</a></div>:data?<ProposalDocument proposal={data.proposal} theme={data.theme}/>:<p role="status">제안서를 불러오는 중…</p>}</main>;
}
