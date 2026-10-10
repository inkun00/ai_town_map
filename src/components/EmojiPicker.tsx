"use client";
import {useId,useRef,useState} from "react";
import type {EmojiOption} from "@/lib/demo-data";
import {filterCatalog} from "@/lib/emoji-catalog";

type Choice=EmojiOption&{searchTerms?:string;groupKey?:string;groupLabel?:string};
export function EmojiPicker({options,selectedKeys,onChoose}:{options:Choice[];selectedKeys:string[];onChoose:(key:string)=>void}){
  const [search,setSearch]=useState("");
  const [group,setGroup]=useState("all");
  const [limit,setLimit]=useState(120);
  const scroller=useRef<HTMLDivElement>(null);
  const id=useId();
  const groups=Array.from(new Map(options.filter(e=>e.groupKey).map(e=>[e.groupKey!,e.groupLabel??"기타"]))).map(([key,label])=>({key,label}));
  const visible=filterCatalog(options,search,group);
  const shown=visible.slice(0,limit);
  const sections=Array.from(new Set(shown.map(e=>e.groupKey??"other"))).map(key=>({key,label:shown.find(e=>(e.groupKey??"other")===key)?.groupLabel,items:shown.filter(e=>(e.groupKey??"other")===key)}));
  function resetList(){setLimit(120);scroller.current?.scrollTo({top:0});}
  return <div className="emoji-catalog">
    <label className="emoji-catalog__search" htmlFor={id}>이모지 검색<input id={id} type="search" value={search} onChange={event=>{setSearch(event.target.value);setGroup("all");resetList();}} placeholder="예: 계단, 새, 음수대"/></label>
    {groups.length>0&&<label className="emoji-catalog__category" htmlFor={`${id}-category`}>카테고리<select id={`${id}-category`} value={group} onChange={event=>{setGroup(event.target.value);resetList();}}><option value="all">전체 이모지 ({options.length}개)</option>{groups.map(item=><option key={item.key} value={item.key}>{item.label} ({options.filter(e=>e.groupKey===item.key).length}개)</option>)}</select></label>}
    <small role="status">{visible.length}개 선택 가능 · {shown.length}개 표시</small>
    <div className="emoji-catalog__scroll" ref={scroller}>{sections.map(section=><section key={section.key}>
      {section.label&&<h3>{section.label}</h3>}
      <div className="emoji-picker emoji-picker--catalog" role="group" aria-label={section.label??"이모지 선택 목록"}>
        {section.items.map(emoji=><button type="button" key={emoji.key} className={selectedKeys.includes(emoji.key)?"selected":""} title={emoji.label} aria-label={`${emoji.label}${emoji.active===false?" · 기존 기록용":""}`} aria-pressed={selectedKeys.includes(emoji.key)} onClick={()=>onChoose(emoji.key)}><span aria-hidden="true">{emoji.glyph}</span><small>{emoji.label}{emoji.active===false?" · 기존 기록용":""}</small></button>)}
      </div>
    </section>)}
      {shown.length<visible.length&&<button className="button button--light button--full" type="button" onClick={()=>setLimit(value=>value+120)}>더 보기 · {visible.length-shown.length}개 남음</button>}
      {visible.length===0&&<p className="help-text">검색 결과가 없어요. 다른 단어를 입력해 주세요.</p>}
    </div>
  </div>;
}
