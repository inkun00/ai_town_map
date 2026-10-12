"use client";

import {useEffect,useRef,useState} from "react";
import {createPortal} from "react-dom";
import {gameRequest} from "./GameShared";
import "./game-checkpoints.css";

type Checkpoint={pointId:string;title:string;emoji:string;code:string};
type Card=Checkpoint&{image:string};
type Props={gameId:string;roomId?:string;csrfToken?:string|null};

export function QrCheckpointCards({gameId,roomId,csrfToken=null}:Props){
  const [cards,setCards]=useState<Card[]>([]),[busy,setBusy]=useState(true),[error,setError]=useState("");
  const [revision,setRevision]=useState(0),[printing,setPrinting]=useState(false);
  const printRef=useRef<HTMLDivElement>(null);

  useEffect(()=>{
    const controller=new AbortController();let active=true;
    setBusy(true);setError("");setCards([]);
    void (async()=>{
      try{
        const endpoint=roomId?`/api/v1/game-rooms/${roomId}/checkpoints`:`/api/v1/games/${gameId}/checkpoints`;
        const payload=await gameRequest<{items:Checkpoint[]}>(endpoint,csrfToken,undefined,"POST",controller.signal);
        const {default:QRCode}=await import("qrcode");
        const generated=await Promise.all(payload.items.map(async item=>{
          const url=new URL("/games/checkpoint",window.location.origin);url.hash=new URLSearchParams({code:item.code}).toString();
          const svg=await QRCode.toString(url.href,{type:"svg",errorCorrectionLevel:"M",margin:4,width:360});
          return {...item,image:`data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`};
        }));
        if(active)setCards(generated);
      }catch(cause){if(active)setError(cause instanceof Error?cause.message:"QR을 준비하지 못했어요.");}
      finally{if(active)setBusy(false);}
    })();
    return()=>{active=false;controller.abort();};
  },[gameId,roomId,csrfToken,revision]);

  useEffect(()=>{
    if(!printing)return;
    document.body.classList.add("qr-checkpoint-printing");
    const previousOverflow=document.body.style.overflow;document.body.style.overflow="hidden";
    const previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    printRef.current?.focus();
    const frame=requestAnimationFrame(()=>window.print());
    function escape(event:KeyboardEvent){
      if(event.key==="Escape"){setPrinting(false);return;}
      if(event.key!=="Tab")return;
      const elements=[...printRef.current?.querySelectorAll<HTMLButtonElement>("button")??[]],first=elements[0],last=elements.at(-1);
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===printRef.current)){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&(document.activeElement===last||document.activeElement===printRef.current)){event.preventDefault();first?.focus();}
    }
    document.addEventListener("keydown",escape);
    return()=>{cancelAnimationFrame(frame);document.body.classList.remove("qr-checkpoint-printing");document.body.style.overflow=previousOverflow;document.removeEventListener("keydown",escape);if(previousFocus?.isConnected)previousFocus.focus();};
  },[printing]);

  function cardList(print=false){return <div className={`qr-checkpoint-grid${print?" qr-checkpoint-grid--print":""}`}>{cards.map((item,index)=><article className="qr-checkpoint-card" key={item.pointId}><h3><span>{item.emoji}</span> {item.title}</h3><small>보물 장소 {index+1}</small>{/* SVG is generated locally; no third-party QR service sees checkpoint codes. */}<img src={item.image} alt={`${item.title} 보물찾기 QR`} width={360} height={360}/><p>게임방에 들어온 뒤 QR을 스캔해요.</p></article>)}</div>;}
  return <section className="qr-checkpoints" aria-label="보물찾기 QR 인쇄">
    <div className="qr-checkpoints-title"><h2>🗺️ 보물찾기 QR 카드</h2><button type="button" className="button button--primary" disabled={busy||!cards.length} onClick={()=>setPrinting(true)}>🖨️ QR 인쇄</button></div>
    <p>카드를 인쇄해서 각 카드 이름에 해당하는 미션 장소에 배치해 주세요. 학생은 게임방에 입장한 뒤 QR을 스캔해서 해당 장소의 미션을 열어요.</p>
    {busy&&<p role="status">보물찾기 QR을 준비하고 있어요…</p>}
    {error&&<><p className="qr-checkpoint-error" role="alert">{error}</p><button type="button" className="button" onClick={()=>setRevision(value=>value+1)}>다시 불러오기</button></>}
    {!busy&&!error&&!cards.length&&<p className="game-empty">아직 QR 방식의 미션이 없어요. 미션의 장소 확인 방식을 ‘QR 스캔’으로 설정하고 저장해 주세요.</p>}
    {!busy&&!!cards.length&&cardList()}
    {printing&&createPortal(<div ref={printRef} className="qr-checkpoint-print-root" tabIndex={-1} role="dialog" aria-modal="true" aria-label="보물찾기 QR 인쇄 미리보기"><header className="qr-print-controls"><strong>보물찾기 QR 인쇄 미리보기</strong><div><button type="button" onClick={()=>window.print()}>인쇄하기</button><button type="button" onClick={()=>setPrinting(false)}>닫기</button></div></header><h1 className="qr-print-heading">모두의 지도 · 보물찾기 QR</h1>{cardList(true)}</div>,document.body)}
  </section>;
}
