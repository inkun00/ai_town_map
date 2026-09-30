"use client";
import {useId,useState} from "react";
import type {EmojiOption} from "@/lib/demo-data";

export function EmojiPicker({options,selectedKeys,onChoose}:{options:(EmojiOption&{searchTerms?:string})[];selectedKeys:string[];onChoose:(key:string)=>void}){
  const [search,setSearch]=useState("");
  const id=useId();
  const term=search.trim().toLocaleLowerCase().replace(/\s/g,"");
  const visible=options.filter(emoji=>`${emoji.glyph} ${emoji.label} ${emoji.searchTerms??""}`.toLocaleLowerCase().replace(/\s/g,"").includes(term));
  return <div className="emoji-catalog"><label className="emoji-catalog__search" htmlFor={id}>이모지 검색<input id={id} type="search" value={search} onChange={event=>setSearch(event.target.value)} placeholder="예: 계단, 새, 음수대"/></label><small role="status">{visible.length}개 선택 가능{term&&` · 전체 ${options.length}개`}</small><div className="emoji-picker emoji-picker--catalog" role="group" aria-label="이모지 선택 목록">{visible.map(emoji=><button type="button" key={emoji.key} className={selectedKeys.includes(emoji.key)?"selected":""} title={emoji.label} aria-label={`${emoji.label}${emoji.active===false?" · 기존 기록용":""}`} aria-pressed={selectedKeys.includes(emoji.key)} onClick={()=>onChoose(emoji.key)}><span aria-hidden="true">{emoji.glyph}</span><small>{emoji.label}{emoji.active===false?" · 기존 기록용":""}</small></button>)}</div>{visible.length===0&&<p className="help-text">검색 결과가 없어요. 다른 단어를 입력해 주세요.</p>}</div>;
}
