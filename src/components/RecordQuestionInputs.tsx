"use client";

import {useId} from "react";
import type {Question} from "@/lib/demo-data";

const questionIcons:Record<string,string>={mobility:"♿",information:"ℹ️",audio_guidance:"🔊",rest_area:"🪑",safety:"🛡️",risk_reasons:"⚠️",lighting:"💡",condition:"🛠️",organism_name:"🔎",habitat:"🌿",characteristics:"📝",reason:"☀️",shade:"🌳",drainage:"💧",shelter:"🏠"};

export function answerChoices(question:Question){
  const options=question.type==="boolean"?[{key:"yes",label:"있음"},{key:"no",label:"없음"}]:question.options??[];
  return [...options,...(question.allowUnknown?[{key:"unknown",label:"확인 못함"}]:[]),...(question.allowNotApplicable?[{key:"na",label:"해당 없음"}]:[])];
}

export function RecordQuestionInputs({questions,answers,onChange}:{questions:Question[];answers:Record<string,string[]>;onChange:(key:string,values:string[])=>void}){
  const id=useId();
  return <div className="question-list"><div className="question-list__heading"><strong>이 주제에서 살펴볼 항목</strong><small>모르는 항목은 ‘확인 못함’을 선택할 수 있어요.</small></div>{questions.map(question=>{
    const selected=answers[question.key]??[];
    return <div className="question-item" key={question.key}><div className="question-item__title" id={`${id}-${question.key}`}><span aria-hidden="true">{questionIcons[question.key]??"📝"}</span><strong>{question.label} {question.required&&<b>*</b>}</strong></div>{question.type==="text"?<input aria-labelledby={`${id}-${question.key}`} value={selected[0]??""} maxLength={question.maxLength??500} onChange={event=>onChange(question.key,event.target.value?[event.target.value]:[])} placeholder={`${question.label}을(를) 적어주세요`}/>:<div className="answer-choices" role="group" aria-labelledby={`${id}-${question.key}`}>{answerChoices(question).map(option=><button type="button" key={option.key} className={selected.includes(option.key)?"selected":""} aria-pressed={selected.includes(option.key)} onClick={()=>{
      if(question.type!=="multi"){onChange(question.key,[option.key]);return;}
      if(option.key==="unknown"||option.key==="na"){onChange(question.key,selected.includes(option.key)?[]:[option.key]);return;}
      const ordinary=selected.filter(key=>key!=="unknown"&&key!=="na");
      onChange(question.key,ordinary.includes(option.key)?ordinary.filter(key=>key!==option.key):[...ordinary,option.key]);
    }}>{option.label}</button>)}</div>}</div>;
  })}</div>;
}
