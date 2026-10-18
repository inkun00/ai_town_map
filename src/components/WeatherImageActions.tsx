"use client";

import {useEffect,useMemo,useRef,useState} from "react";
import {copyWeatherPng,createWeatherPng,downloadWeatherPng,type WeatherImageOptions} from "@/lib/weather-image-export";

type Props={label:string;getSvg:()=>SVGSVGElement|null;options:WeatherImageOptions;filename:string;disabled?:boolean};
type Feedback={kind:"success"|"error";text:string};

/** Start clipboard access in the click event, before waiting for PNG generation. */
export function WeatherImageActions({label,getSvg,options,filename,disabled=false}:Props){
  const [busy,setBusy]=useState(false),[feedback,setFeedback]=useState<Feedback|null>(null);
  const busyRef=useRef(false),mounted=useRef(true),revision=useRef(0);
  const selectionKey=useMemo(()=>JSON.stringify(options),[options]);
  useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;revision.current++;};},[]);
  useEffect(()=>{revision.current++;setFeedback(null);},[selectionKey,filename]);

  function run(action:"copy"|"save"){
    if(disabled||busyRef.current)return;
    let svg:SVGSVGElement|null;
    try{svg=getSvg();}catch{svg=null;}
    if(!svg){setFeedback({kind:"error",text:`이미지로 만들 ${label}가 없어요. 자료를 먼저 불러와 주세요.`});return;}
    const snapshot:WeatherImageOptions={...options,details:options.details?[...options.details]:undefined,legend:options.legend?.map(item=>({...item})),footnotes:options.footnotes?[...options.footnotes]:undefined};
    const requestedFilename=filename,currentRevision=revision.current;
    busyRef.current=true;setBusy(true);setFeedback(null);
    let image:Promise<Blob>|undefined;
    const create=()=>image??=createWeatherPng(svg,snapshot).then(blob=>{
      if(!blob.size||blob.type!=="image/png")throw new Error("PNG image is empty or invalid");
      return blob;
    });
    let operation:Promise<void>;
    try{
      operation=action==="copy"?copyWeatherPng(create):create().then(blob=>{if(mounted.current)downloadWeatherPng(blob,requestedFilename);});
    }catch(error){operation=Promise.reject(error);}
    void operation.then(()=>{
      if(mounted.current&&revision.current===currentRevision)setFeedback({kind:"success",text:action==="copy"?"이미지를 복사했어요. 문서나 그림판에 붙여넣어 보세요.":"PNG 다운로드를 요청했어요. 브라우저의 다운로드 목록을 확인해 주세요."});
    }).catch(()=>{
      if(mounted.current&&revision.current===currentRevision)setFeedback({kind:"error",text:action==="copy"?"이미지를 복사하지 못했어요. 이 브라우저에서는 ‘PNG 저장’을 이용해 주세요.":"PNG 이미지를 만들지 못했어요. 다시 시도해 주세요."});
    }).finally(()=>{busyRef.current=false;if(mounted.current)setBusy(false);});
  }

  return <div className="weather-image-actions" role="group" aria-label={`${label} 이미지 내보내기`} aria-busy={busy}>
    <div className="weather-image-actions__buttons">
      <button type="button" disabled={disabled||busy} aria-label={`${label} 이미지 복사`} onClick={()=>run("copy")}>이미지 복사</button>
      <button type="button" disabled={disabled||busy} aria-label={`${label} PNG 저장`} onClick={()=>run("save")}>PNG 저장</button>
    </div>
    {busy?<p className="weather-image-actions__feedback" role="status">이미지를 만들고 있어요…</p>:feedback&&<p className="weather-image-actions__feedback" role={feedback.kind==="error"?"alert":"status"}>{feedback.text}</p>}
  </div>;
}
