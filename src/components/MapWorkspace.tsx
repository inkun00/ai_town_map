"use client";

import {useEffect,useMemo,useRef,useState,type ReactNode} from "react";
import {type ObservationFilter} from "@/domain/analysis";
import {emojiGroup,emptyWorkbench,formatDistance,noteColors,parseWorkbench,addConnection,connectionEdges,connectionSegments,removePointConnections,serializeWorkbench,toggleHidden,visiblePoint,workbenchKey,type MapNote,type WorkbenchState} from "@/domain/map-workbench";
import {pointDescription,pointRating} from "@/domain/point-presentation";
import {emojiLibrary,getPinColor,getPointEmoji,type DemoPoint,type Theme} from "@/lib/demo-data";
import KakaoMap,{type Coordinates,type MapFocus} from "./KakaoMap";
import {type GestureTool} from "./PointInteraction";
import {MapTools} from "./MapTools";
import {PointDialog} from "./PointDialog";
import {EmojiPicker} from "./EmojiPicker";
import {RatingLabel} from "./MapMeaning";

type Panel="display"|"notes"|"save";
type Mode="note"|null;
type Props={mapId:string;scope:string;theme:Theme;points:DemoPoint[];center?:Coordinates|null;live:boolean;selectedId:string|null;onSelect:(id:string|null)=>void;filter:ObservationFilter;onFilter:(filter:ObservationFilter)=>void;bounds?:ObservationFilter["bbox"];onBounds:(bounds:[number,number,number,number])=>void;showList:boolean;onToggleList:()=>void;loading:boolean;error:string;fallback:(points:DemoPoint[],onSelect:(id:string)=>void)=>ReactNode};

function Toggle({label,checked,onChange,disabled=false}:{label:string;checked:boolean;onChange:()=>void;disabled?:boolean}){
  return <button type="button" className="workbench-toggle" role="switch" aria-checked={checked} aria-label={label} disabled={disabled} onClick={onChange}><span>{label}</span><i aria-hidden="true">{checked?"보임":"숨김"}</i></button>;
}

export function MapWorkspace({mapId,scope,theme,points,center,live,selectedId,onSelect,filter,onFilter,bounds,onBounds,showList,onToggleList,loading,error,fallback}:Props){
  const [state,setState]=useState<WorkbenchState>(emptyWorkbench);
  const [loaded,setLoaded]=useState(false),[dirty,setDirty]=useState(false);
  const [storageError,setStorageError]=useState("");
  const [panel,setPanel]=useState<Panel|null>(null),[mode,setMode]=useState<Mode>(null);
  const [message,setMessage]=useState("");
  const [pointSearch,setPointSearch]=useState(""),[pointPage,setPointPage]=useState(1);
  const [contextId,setContextId]=useState<string|null>(null),[gestureTool,setGestureTool]=useState<GestureTool|null>(null);
  const [noteText,setNoteText]=useState(""),[noteEmoji,setNoteEmoji]=useState(""),[noteColor,setNoteColor]=useState<MapNote["color"]>(noteColors[0]);
  const [editingNote,setEditingNote]=useState<string|null>(null),[showEmojis,setShowEmojis]=useState(false);
  const [focus,setFocus]=useState<MapFocus|null>(null);
  const [imported,setImported]=useState<WorkbenchState|null>(null),[fileError,setFileError]=useState("");
  const fileGeneration=useRef(0);
  const noteReady=!!(noteText.trim()||noteEmoji.trim());
  const storageKey=workbenchKey(scope,mapId);
  useEffect(()=>{
    try{const saved=localStorage.getItem(storageKey);if(saved)setState(parseWorkbench(saved,mapId));}
    catch{setStorageError("이 기기의 저장 내용을 읽지 못했어요. 변경 내용은 공유 파일로 저장해 주세요.");}
    setLoaded(true);
  },[storageKey,mapId]);
  useEffect(()=>{
    if(!loaded||!dirty)return;
    try{localStorage.setItem(storageKey,serializeWorkbench(mapId,state));setStorageError("");}
    catch{setStorageError("기기 저장 공간을 사용할 수 없어요. 공유 파일로 저장하면 내용을 보관할 수 있어요.");}
  },[state,dirty,loaded,storageKey,mapId]);
  useEffect(()=>()=>{fileGeneration.current++;},[]);
  function change(update:(previous:WorkbenchState)=>WorkbenchState){setDirty(true);setState(update);setMessage("");}
  const visible=points.filter(point=>visiblePoint(point,state));
  const anchorPoints=useMemo(()=>points.filter(point=>point.location).map(point=>({id:point.id,title:point.title,emoji:getPointEmoji(theme,point)?.glyph??"📍",description:pointDescription(theme,point),rating:pointRating(theme,point),color:getPinColor(theme,point),location:point.location!})),[points,theme]);
  const visibleIds=new Set(visible.map(point=>point.id));
  const mapPoints=anchorPoints.filter(point=>visibleIds.has(point.id));
  const segments=connectionSegments(state,anchorPoints);
  const total=segments.reduce((sum,segment)=>sum+segment.meters,0);
  const searchTerm=pointSearch.trim().toLocaleLowerCase();
  const searchedPoints=points.filter(point=>`${point.title} ${getPointEmoji(theme,point)?.label??""}`.toLocaleLowerCase().includes(searchTerm));
  const context=mapPoints.find(point=>point.id===contextId);
  useEffect(()=>{if(contextId&&!visibleIds.has(contextId))setContextId(null);if(gestureTool&&!visibleIds.has(gestureTool.pointId))setGestureTool(null);},[points,state,contextId,gestureTool]);
  useEffect(()=>{const point=points.find(point=>point.id===selectedId);if(!showList&&point&&!visiblePoint(point,state))onSelect(null);},[state,selectedId,points,onSelect,showList]);
  function moveTo(location:Coordinates){setFocus({location,nonce:Date.now()});}
  function selectPoint(id:string){
    if(mode==="note"){const point=anchorPoints.find(point=>point.id===id);if(point)placeNote(point.location);return;}
    setGestureTool(null);setMessage("");onSelect(null);setContextId(id);
  }
  function stopInteraction(){setGestureTool(null);setContextId(null);setMode(null);}
  function arm(kind:GestureTool["kind"]){if(!context)return;setGestureTool({kind,pointId:context.id});setContextId(null);setMessage("");}
  function gestureEnd(result:{pointId:string;meters?:number;targetId?:string}|null){
    setGestureTool(null);
    if(!result){setMessage("조작을 취소했어요. 포인트를 눌러 다시 시작하세요.");return;}
    if(result.meters!==undefined){
      if(state.radii.length>=12&&!state.radii.some(radius=>radius.pointId===result.pointId)){setMessage("반경 중심은 최대 12곳까지 지정할 수 있어요.");return;}
      change(previous=>({...previous,radii:[...previous.radii.filter(radius=>radius.pointId!==result.pointId),{pointId:result.pointId,meters:[result.meters!]}],layers:{...previous.layers,radii:true}}));
      setMessage(`반경 ${formatDistance(result.meters)}를 저장했어요.`);
    }else if(result.targetId){
      const next=addConnection(state,result.pointId,result.targetId);
      if(next===state){setMessage(connectionEdges(state).length>=100?"연결선은 최대 100개까지 그릴 수 있어요.":"이미 연결된 포인트예요.");return;}
      change(()=>next);setMessage("두 포인트를 연결했어요. 선 위에 직선 거리가 표시돼요.");
    }
  }
  function placeNote(location:Coordinates){
    if(!noteReady)return;
    if(state.notes.length>=100&&!editingNote){setMessage("메모는 최대 100개까지 남길 수 있어요.");setMode(null);return;}
    const note:MapNote={id:editingNote??crypto.randomUUID(),text:noteText.trim(),emoji:noteEmoji.trim(),color:noteColor,location};
    change(previous=>({...previous,notes:editingNote?previous.notes.map(item=>item.id===editingNote?note:item):[...previous.notes,note],layers:{...previous.layers,notes:true}}));
    setEditingNote(null);setNoteText("");setNoteEmoji("");setMode(null);setMessage("지도 위에 메모를 남겼어요. 메모를 누르면 수정하거나 지울 수 있어요.");
  }
  function startMode(value:Mode){stopInteraction();setMode(value);setPanel(null);setMessage("");if(showList)onToggleList();onSelect(null);}
  function download(){
    try{const blob=new Blob([serializeWorkbench(mapId,state)],{type:"application/json"}),url=URL.createObjectURL(blob),link=document.createElement("a");link.href=url;link.download=`탐험지도-${mapId}-도구.json`;link.click();window.setTimeout(()=>URL.revokeObjectURL(url),1000);setMessage("공유 파일을 저장했어요. 같은 지도의 참여자에게 파일을 전달해 주세요.");}
    catch{setFileError("파일을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.");}
  }
  async function readFile(file:File|undefined){
    const generation=++fileGeneration.current;setImported(null);setFileError("");if(!file)return;
    try{if(file.size>2_000_000)throw new Error("공유 파일은 2MB 이하만 불러올 수 있어요.");const next=parseWorkbench(await file.text(),mapId);if(generation!==fileGeneration.current)return;setImported(next);}
    catch(error){if(generation===fileGeneration.current)setFileError(error instanceof Error?error.message:"파일을 읽지 못했어요.");}
  }
  const searchField=<label className="workbench-field">포인트 검색<input type="search" value={pointSearch} placeholder="이름으로 찾아보기" onChange={event=>{setPointSearch(event.target.value);setPointPage(1);}}/></label>;
  return <div className="workspace-body workspace-body--map">
    <MapTools theme={theme} points={points} filter={filter} onChange={onFilter} bounds={bounds} showList={showList} onBeforeAction={stopInteraction} onToggleList={()=>{stopInteraction();onToggleList();}} loading={loading} error={error} visibleCount={visible.length} onOpenWorkbench={()=>{stopInteraction();setPanel("display");}}/>
    {showList?<div className="point-list">{points.length?points.map(point=><button type="button" className="point-row" key={point.id} onClick={()=>onSelect(point.id)}><span className="point-row__emoji" style={{background:getPinColor(theme,point)}}>{getPointEmoji(theme,point)?.glyph??"📍"}</span><span><strong>{point.title}</strong><small>{theme.categories.find(category=>category.key===point.categoryKey)?.label} · {point.date}{!visiblePoint(point,state)&&" · 지도에서 숨김"}</small><RatingLabel theme={theme} point={point}/></span></button>):<p className="help-text">이 조건의 기록이 없어요. 조건을 바꾸거나 새 기록을 남겨 주세요.</p>}</div>:<div className="map-canvas">{live?<KakaoMap center={center} points={mapPoints} anchorPoints={anchorPoints} workbench={state} focus={focus} onSelectNote={id=>{const note=state.notes.find(note=>note.id===id);if(!note)return;stopInteraction();setEditingNote(id);setNoteText(note.text);setNoteEmoji(note.emoji);setNoteColor(note.color);setPanel("notes");}} selectedId={gestureTool?.pointId??contextId??selectedId} onSelectPoint={selectPoint} contextPointId={contextId} onCloseContext={()=>setContextId(null)} gestureTool={gestureTool} onGestureEnd={gestureEnd} contextPopup={context&&<><header><strong>{context.emoji} {context.title}</strong><button type="button" aria-label="포인트 도구 닫기" onClick={()=>setContextId(null)}>×</button></header><div className="point-tool-primary"><button type="button" onClick={()=>arm("radius")}>⭕<span>반경</span></button><button type="button" onClick={()=>arm("connect")}>🔗<span>연결</span></button><button type="button" onClick={()=>{stopInteraction();setPanel("notes");}}>✏️<span>메모</span></button></div><p className="point-tool-tip">반경·연결을 누르고 이 핀에서 드래그하세요.</p><div className="point-tool-secondary"><button type="button" onClick={()=>{stopInteraction();onSelect(context.id);}}>기록 보기</button><button type="button" onClick={()=>{change(previous=>({...previous,hiddenPoints:toggleHidden(previous.hiddenPoints,context.id)}));setContextId(null);}}>핀 숨김</button><button type="button" onClick={()=>{stopInteraction();setPanel("save");}}>저장·공유</button></div>{state.radii.some(radius=>radius.pointId===context.id)&&<button type="button" className="point-tool-remove" onClick={()=>change(previous=>({...previous,radii:previous.radii.filter(radius=>radius.pointId!==context.id)}))}>반경 지우기 · {state.radii.find(radius=>radius.pointId===context.id)!.meters.map(formatDistance).join(" · ")}</button>}{connectionEdges(state).some(edge=>edge.fromId===context.id||edge.toId===context.id)&&<button type="button" className="point-tool-remove" onClick={()=>change(previous=>removePointConnections(previous,context.id))}>이 핀의 연결선 지우기</button>}</>} onBoundsChange={onBounds} onCanvasPick={mode==="note"?placeNote:undefined}/>:fallback(visible,selectPoint)}
      {(mode||message)&&<div className="map-tool-action" role="status"><span>{mode==="note"?"텍스트·이모지를 놓을 지도 위치를 눌러 주세요.":message}</span><button type="button" onClick={()=>{setMode(null);setMessage("");}}>닫기</button></div>}
    </div>}
    {panel&&<PointDialog label={panel==="display"?"지도 표시 설정":panel==="notes"?"지도 메모":"저장·공유"} onClose={()=>setPanel(null)}><div className="map-menu-sheet workbench"><header><h2>{panel==="display"?"👁️ 필요한 정보만 보기":panel==="notes"?"✏️ 지도 메모":"💾 저장·공유"}</h2><button type="button" className="round-icon" aria-label="팝업 닫기" onClick={()=>setPanel(null)}>×</button></header>
      <p className="workbench-help">{storageError||"내 설정은 이 기기에 지도·사용자별로 자동 저장돼요. 원래 기록과 통계는 바뀌지 않아요."}</p>
      {panel==="display"&&<><h3>필요한 포인트만 보기</h3><p className="workbench-counter" role="status">총 {points.length}개 중 <b>{visible.length}개 보임</b> · {points.length-visible.length}개 숨김</p><p className="workbench-help">현재 조회 조건에 맞는 기록의 개수예요. 종류·이모지·개별 표시가 모두 켜져야 지도에 보여요. 숨긴 기록도 목록에서 볼 수 있어요.</p><div className="workbench-actions"><button type="button" onClick={()=>change(previous=>({...previous,hiddenCategories:[],hiddenEmojis:[],hiddenPoints:[]}))}>모두 보이기</button><button type="button" onClick={()=>change(previous=>({...previous,hiddenPoints:points.map(point=>point.id)}))}>모두 숨기기</button></div>
        {theme.categories.map(category=>{const grouped=points.filter(point=>point.categoryKey===category.key);return <details key={category.key} className="workbench-group"><summary>{category.emojiOptions.find(emoji=>emoji.key===category.defaultEmojiKey)?.glyph} {category.label} · {grouped.length}개</summary><Toggle label={`${category.label} 전체 · ${grouped.length}개`} checked={!state.hiddenCategories.includes(category.key)} onChange={()=>change(previous=>({...previous,hiddenCategories:toggleHidden(previous.hiddenCategories,category.key)}))}/>{[...new Set(grouped.map(point=>point.emojiKey))].map(key=>{const emoji=category.emojiOptions.find(emoji=>emoji.key===key),count=grouped.filter(point=>point.emojiKey===key).length;return <Toggle key={key} label={`${emoji?.glyph??"📍"} ${emoji?.label??"기존 이모지"} · ${count}개`} checked={!state.hiddenEmojis.includes(emojiGroup(category.key,key))} disabled={state.hiddenCategories.includes(category.key)} onChange={()=>change(previous=>({...previous,hiddenEmojis:toggleHidden(previous.hiddenEmojis,emojiGroup(category.key,key))}))}/>;})}</details>;})}
        <details className="workbench-group"><summary>개별 포인트 · {points.length}개</summary>{searchField}{searchedPoints.slice(0,pointPage*50).map(point=><Toggle key={point.id} label={`${getPointEmoji(theme,point)?.glyph??"📍"} ${point.title}`} checked={!state.hiddenPoints.includes(point.id)} disabled={state.hiddenCategories.includes(point.categoryKey)||state.hiddenEmojis.includes(emojiGroup(point.categoryKey,point.emojiKey))} onChange={()=>change(previous=>({...previous,hiddenPoints:toggleHidden(previous.hiddenPoints,point.id)}))}/>) }{searchedPoints.length>pointPage*50&&<button type="button" className="button button--light" onClick={()=>setPointPage(page=>page+1)}>50개 더 보기</button>}</details>
        <h3>내 그림 표시 · 직선 거리 {formatDistance(total)}</h3>{(["radii","route","notes"] as const).map((key,index)=><Toggle key={key} label={["반경","연결선","텍스트·이모지"][index]} checked={state.layers[key]} onChange={()=>change(previous=>({...previous,layers:{...previous.layers,[key]:!previous.layers[key]}}))}/>)}</>}
      {panel==="notes"&&<><h3>{editingNote?"지도 메모 수정":"텍스트·이모지 붙이기"}</h3><label className="workbench-field">지도 위 텍스트<input value={noteText} maxLength={120} placeholder="예: 여기서 만나자!" onChange={event=>setNoteText(event.target.value)}/><small>{noteText.length}/120자</small></label><label className="workbench-field">이모지<input value={noteEmoji} maxLength={16} placeholder="예: ⭐ 🏁 🌳" onChange={event=>setNoteEmoji(event.target.value)}/></label><button type="button" className="button button--light button--full" aria-expanded={showEmojis} onClick={()=>setShowEmojis(value=>!value)}>{showEmojis?"이모지 목록 접기":"다양한 이모지에서 고르기"}</button>{showEmojis&&<EmojiPicker options={emojiLibrary} selectedKeys={emojiLibrary.filter(emoji=>emoji.glyph===noteEmoji).map(emoji=>emoji.key)} onChoose={key=>{setNoteEmoji(emojiLibrary.find(emoji=>emoji.key===key)?.glyph??"");setShowEmojis(false);}}/>}<div className="workbench-colors" role="group" aria-label="메모 배경색">{noteColors.map((color,index)=><button type="button" key={color} style={{background:color}} aria-label={["노랑","초록","파랑","분홍"][index]} aria-pressed={noteColor===color} onClick={()=>setNoteColor(color)}>{noteColor===color?"✓":""}</button>)}</div>{editingNote&&<button type="button" className="button button--light button--full" disabled={!noteReady} onClick={()=>{const note=state.notes.find(note=>note.id===editingNote);if(note)placeNote(note.location);}}>내용만 수정하기</button>}<button type="button" className="button button--primary button--full" disabled={!live||!noteReady||(!editingNote&&state.notes.length>=100)} onClick={()=>startMode("note")}>{editingNote?"지도에서 새 위치 고르기":"지도에서 붙일 위치 고르기"}</button>{editingNote&&<button type="button" className="button button--light button--full" onClick={()=>{setEditingNote(null);setNoteText("");setNoteEmoji("");}}>수정 취소</button>}<h3>내 메모 · {state.notes.length}개</h3>{state.notes.map(note=><div className="workbench-item" key={note.id}><button type="button" className="workbench-item__text" aria-label={`${note.text||note.emoji} 위치 보기`} onClick={()=>{moveTo(note.location);setPanel(null);if(showList)onToggleList();}}>{note.emoji} {note.text}</button><button type="button" aria-label={`${note.text||note.emoji} 메모 수정`} onClick={()=>{setEditingNote(note.id);setNoteText(note.text);setNoteEmoji(note.emoji);setNoteColor(note.color);}}>수정</button><button type="button" aria-label={`${note.text||note.emoji} 메모 삭제`} onClick={()=>{change(previous=>({...previous,notes:previous.notes.filter(item=>item.id!==note.id)}));if(editingNote===note.id){setEditingNote(null);setNoteText("");setNoteEmoji("");}}}>삭제</button></div>)}</>}
      {panel==="save"&&<><h3>내 도구 저장·공유</h3><p className="workbench-help">설정은 이 브라우저에 자동 저장돼요. 다른 기기나 친구에게 옮기려면 공유 파일을 저장해 전달하고, 같은 지도에서 불러와 주세요. 공유 파일에는 메모 내용과 위치가 포함돼요. 지도 접근 권한은 별도로 필요해요.</p><button type="button" className="button button--primary button--full" onClick={download}>공유 파일 저장</button><label className="workbench-field">공유 파일 불러오기<input type="file" accept=".json,application/json" onChange={event=>{void readFile(event.target.files?.[0]);event.target.value="";}}/></label>{fileError&&<p className="workbench-error" role="alert">{fileError}</p>}{imported&&<div className="workbench-import"><strong>불러오기 미리보기</strong><p>반경 {imported.radii.length}곳 · 연결선 {connectionEdges(imported).length}개 · 메모 {imported.notes.length}개</p><p>숨김 종류 {imported.hiddenCategories.length}개 · 이모지 {imported.hiddenEmojis.length}개 · 포인트 {imported.hiddenPoints.length}개</p><p>적용하면 현재 내 도구 설정을 바꿔요. 기존 설정은 먼저 공유 파일로 저장할 수 있어요.</p><button type="button" className="button button--primary button--full" onClick={()=>{change(()=>imported);setImported(null);stopInteraction();setEditingNote(null);setNoteText("");setNoteEmoji("");setMessage("공유 파일을 내 지도 도구에 적용했어요.");}}>내 도구에 적용</button><button type="button" className="button button--light button--full" onClick={()=>setImported(null)}>불러오기 취소</button></div>}</>}
      <button type="button" className="button button--light button--full" onClick={()=>setPanel(panel==="save"?"display":"save")}>{panel==="save"?"표시 설정":"설정·그림 저장 및 공유"}</button>{message&&<p role="status" className="workbench-help">{message}</p>}<button type="button" className="button button--light button--full" onClick={()=>setPanel(null)}>지도 보기</button>
    </div></PointDialog>}
  </div>;
}
