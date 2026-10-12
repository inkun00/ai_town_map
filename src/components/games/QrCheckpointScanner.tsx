"use client";

import {useCallback,useEffect,useId,useRef,useState,type FormEvent} from "react";
import {createPortal} from "react-dom";
import type QrScanner from "qr-scanner";
import {parseGameCheckpoint} from "@/lib/game-checkpoint";
import "./game-checkpoints.css";

type Props={onScan:(code:string)=>Promise<void>;onClose:()=>void};
let scannerModule:Promise<typeof import("qr-scanner")>|undefined;
function loadScanner(){return scannerModule??=import("qr-scanner").catch(error=>{scannerModule=undefined;throw error;});}

/** A scan is a checkpoint token, never a URL to follow. */
export function QrCheckpointScanner({onScan,onClose}:Props){
  const titleId=useId(),helpId=useId();
  const videoRef=useRef<HTMLVideoElement>(null),panelRef=useRef<HTMLDivElement>(null);
  const scannerRef=useRef<QrScanner|null>(null),mountedRef=useRef(false),busyRef=useRef(false),startingRef=useRef(false);
  const cameraAllowedRef=useRef(true),generationRef=useRef(0),lastCodeRef=useRef<string|null>(null),callbacksRef=useRef({onScan,onClose});
  const [camera,setCamera]=useState<"starting"|"ready"|"paused"|"unavailable">("starting");
  const [busy,setBusy]=useState(false),[error,setError]=useState(""),[manual,setManual]=useState("");
  callbacksRef.current={onScan,onClose};

  const stopCamera=useCallback(()=>{
    cameraAllowedRef.current=false;
    scannerRef.current?.stop();
    // Stop tracks immediately; qr-scanner's normal stop allows a short restart delay.
    const video=videoRef.current,stream=video?.srcObject as MediaStream|null;
    stream?.getTracks?.().forEach(track=>track.stop());
    if(video)video.srcObject=null;
  },[]);
  const close=useCallback(()=>{stopCamera();callbacksRef.current.onClose();},[stopCamera]);

  const submitCode=useCallback(async(raw:string,alreadyLocked=false)=>{
    if(!mountedRef.current||document.hidden||(!alreadyLocked&&busyRef.current)||raw===lastCodeRef.current)return;
    const generation=generationRef.current;
    busyRef.current=true;setBusy(true);lastCodeRef.current=raw;
    stopCamera();setCamera("paused");setError("");
    const code=parseGameCheckpoint(raw);
    if(!code){
      setError("이 게임의 보물찾기 QR이 아니에요. 선생님이 배치한 QR을 다시 확인해 주세요.");
      busyRef.current=false;setBusy(false);return;
    }
    try{
      await callbacksRef.current.onScan(code);
      if(mountedRef.current&&generation===generationRef.current&&!document.hidden)close();
    }catch(cause){
      if(mountedRef.current&&generation===generationRef.current)setError(cause instanceof Error?cause.message:"QR을 확인하지 못했어요. 다시 시도해 주세요.");
    }finally{
      if(generation===generationRef.current){busyRef.current=false;if(mountedRef.current)setBusy(false);}
    }
  },[close,stopCamera]);

  const startCamera=useCallback(async()=>{
    if(!mountedRef.current||document.hidden||busyRef.current||startingRef.current)return;
    const generation=generationRef.current;
    startingRef.current=true;cameraAllowedRef.current=true;lastCodeRef.current=null;
    setCamera("starting");setError("");
    try{
      if(!navigator.mediaDevices?.getUserMedia)throw new Error("camera unavailable");
      const {default:Scanner}=await loadScanner();
      if(!mountedRef.current||generation!==generationRef.current||!cameraAllowedRef.current||document.hidden||!videoRef.current)return;
      if(!scannerRef.current)scannerRef.current=new Scanner(videoRef.current,result=>{void submitCode(result.data);},{
        preferredCamera:"environment",maxScansPerSecond:8,highlightScanRegion:true,highlightCodeOutline:true,
        returnDetailedScanResult:true,onDecodeError:()=>{},
      });
      await scannerRef.current.start();
      if(generation!==generationRef.current)return;
      if(!mountedRef.current||!cameraAllowedRef.current||document.hidden){stopCamera();return;}
      setCamera("ready");
    }catch{
      if(mountedRef.current&&generation===generationRef.current&&cameraAllowedRef.current){
        stopCamera();setCamera("unavailable");
        setError("카메라를 열지 못했어요. 카메라 권한을 허용하거나 QR 사진·주소로 확인해 주세요.");
      }
    }finally{if(generation===generationRef.current)startingRef.current=false;}
  },[stopCamera,submitCode]);

  useEffect(()=>{
    generationRef.current++;mountedRef.current=true;
    const previousFocus=document.activeElement instanceof HTMLElement?document.activeElement:null;
    const previousOverflow=document.body.style.overflow;document.body.style.overflow="hidden";
    panelRef.current?.focus();void startCamera();
    function visibility(){if(document.hidden){stopCamera();setCamera("paused");}}
    function pageHide(){stopCamera();}
    function keydown(event:KeyboardEvent){
      if(event.key==="Escape"){event.preventDefault();close();return;}
      if(event.key!=="Tab")return;
      const elements=[...panelRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]),input:not([disabled]),textarea:not([disabled]),[href],[tabindex="0"]')??[]];
      const first=elements[0],last=elements.at(-1);if(!first)return;
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===panelRef.current)){event.preventDefault();last?.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
    document.addEventListener("visibilitychange",visibility);window.addEventListener("pagehide",pageHide);document.addEventListener("keydown",keydown);
    return()=>{
      generationRef.current++;mountedRef.current=false;startingRef.current=false;stopCamera();scannerRef.current?.destroy();scannerRef.current=null;
      document.removeEventListener("visibilitychange",visibility);window.removeEventListener("pagehide",pageHide);document.removeEventListener("keydown",keydown);
      document.body.style.overflow=previousOverflow;if(previousFocus?.isConnected)previousFocus.focus();
    };
  },[close,startCamera,stopCamera]);

  async function scanPhoto(file:File|undefined){
    if(!file||busyRef.current)return;
    if(file.size>10*1024*1024){setError("QR 사진은 10MB 이하로 골라 주세요.");return;}
    busyRef.current=true;setBusy(true);setError("");lastCodeRef.current=null;stopCamera();setCamera("paused");
    try{
      const {default:Scanner}=await loadScanner();
      const result=await Scanner.scanImage(file,{returnDetailedScanResult:true});
      if(mountedRef.current&&!document.hidden)await submitCode(result.data,true);
    }catch{
      if(mountedRef.current)setError("사진에서 QR을 찾지 못했어요. QR 전체가 선명하게 보이는 사진을 골라 주세요.");
    }finally{busyRef.current=false;if(mountedRef.current)setBusy(false);}
  }
  function submitManual(event:FormEvent){event.preventDefault();lastCodeRef.current=null;void submitCode(manual.trim());}

  if(typeof document==="undefined")return null;
  return createPortal(<div className="qr-scanner-backdrop" onClick={event=>{if(event.target===event.currentTarget)close();}}>
    <div ref={panelRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby={titleId} aria-describedby={helpId} className="qr-scanner-dialog">
      <header className="qr-scanner-header"><h2 id={titleId}>🔎 보물찾기 QR 스캔</h2><button type="button" onClick={close} aria-label="QR 스캔 닫기">×</button></header>
      <p id={helpId}>멈춰 선 뒤, 선생님이 배치한 QR을 네모 안에 비춰요.</p>
      <div className="qr-scanner-video"><video ref={videoRef} muted playsInline aria-label="QR 스캔 카메라"/>{camera!=="ready"&&<span>{camera==="starting"?"카메라를 여는 중…":busy?"QR을 확인하는 중…":"카메라가 멈춰 있어요"}</span>}</div>
      <p className="qr-scanner-status" role="status">{busy?"보물을 확인하고 있어요…":camera==="ready"?"QR을 찾으면 자동으로 확인해요.":"QR 사진이나 주소를 이용할 수도 있어요."}</p>
      {error&&<p className="qr-checkpoint-error" role="alert">{error}</p>}
      {camera!=="ready"&&<button className="button button--primary button--full" type="button" disabled={busy||camera==="starting"} onClick={()=>void startCamera()}>다시 스캔하기</button>}
      <label className="qr-photo-button">🖼️ QR 사진에서 찾기<input type="file" accept="image/*" disabled={busy} onChange={event=>{const file=event.target.files?.[0];event.target.value="";void scanPhoto(file);}}/></label>
      <details className="qr-manual"><summary>QR 주소·코드 직접 입력</summary><form onSubmit={submitManual}><label>QR 주소 또는 코드<textarea value={manual} onChange={event=>setManual(event.target.value)} maxLength={4096} rows={3} placeholder="QR에서 복사한 주소를 붙여 넣어요." autoComplete="off" spellCheck={false}/></label><button type="submit" className="button button--primary button--full" disabled={busy||!manual.trim()}>QR 확인하기</button></form></details>
    </div>
  </div>,document.body);
}
