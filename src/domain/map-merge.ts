import type {Category,EmojiOption,Question,RatingOption,Theme,ThemeKey} from "../lib/demo-data";

export type MergeCoordinates={lat:number;lng:number};
export type MergeSource={
  id:string;title:string;location:string;version:string;configRevision:number;theme:Theme;
  visibility:"public"|"invite_only";center:MergeCoordinates|null;themeKey?:ThemeKey;pointCount?:number;
};
export type MergePoint={
  id:string;mapId:string;title:string;body:string;locationLabel:string;locationSource:"gps"|"search"|"manual";
  location:MergeCoordinates;categoryKey:string;emojiKey:string;ratingKey:string|null;
  answers:Record<string,string[]>;improvementIdea:string|null;link:string|null;createdAt:string;
  author:string;photoUrl:string|null;version:string;emoji?:{key?:string;glyph:string;label:string};
};
export type MergePreviewPoint=Omit<MergePoint,"emoji">&{
  sourceTitle:string;categoryLabel:string;emoji:EmojiOption;pinColor:string;rating:RatingOption|null;
};
export type MergeCopy={
  /** The original point identifier is independent of its source map identifier. */
  sourceId:string;sourceMapId:string;original:MergePoint;
  categoryKey:string;emojiKey:string;ratingKey:null;answers:Record<string,string[]>;
};
export const mergeOriginQuestionKey="merge_origin";
export type MapMergeErrorCode="EMPTY_SELECTION"|"DUPLICATE_SOURCE"|"DUPLICATE_POINT"|"UNKNOWN_SOURCE"|"INVALID_CATEGORY"|"INVALID_EMOJI"|"INVALID_RATING"|"INVALID_ANSWER"|"INVALID_SCHEMA"|"INVALID_LOCATION"|"INVALID_DATE";
export class MapMergeError extends Error{
  constructor(public readonly code:MapMergeErrorCode,message:string){super(message);this.name="MapMergeError";}
}

type ResolvedPoint={point:MergePoint;source:MergeSource;sourceIndex:number;category:Category;categoryIndex:number;emoji:EmojiOption;emojiIndex:number;rating:RatingOption|null};
function clipped(value:string,maximum:number){let result="";for(const character of value){if(result.length+character.length>maximum)break;result+=character;}return result;}
function fail(code:MapMergeErrorCode,message:string):never{throw new MapMergeError(code,message);}
function distinct(values:string[],label:string){if(new Set(values).size!==values.length)fail("INVALID_SCHEMA",`${label} 식별자가 중복되어 지도를 합칠 수 없습니다.`);}
function validKey(value:string){return typeof value==="string"&&value.length>0&&value.length<=60;}

function validateSource(source:MergeSource){
  const theme=source.theme;
  if(!source.id||!theme||!Array.isArray(theme.categories)||!Array.isArray(theme.questions))fail("INVALID_SCHEMA","원본 지도 설정을 확인해 주세요.");
  distinct(theme.categories.map(category=>category.key),"관찰 유형");
  distinct(theme.questions.map(question=>question.key),"질문");
  for(const category of theme.categories){
    if(!validKey(category.key)||!category.label||!/^#[0-9a-fA-F]{6}$/.test(category.color)||!Array.isArray(category.emojiOptions))fail("INVALID_SCHEMA","원본 관찰 유형 설정을 확인해 주세요.");
    distinct(category.emojiOptions.map(emoji=>emoji.key),"이모지");
  }
  for(const question of theme.questions){
    if(!validKey(question.key)||!question.label||!["rating3","boolean","single","multi","text"].includes(question.type))fail("INVALID_SCHEMA","원본 질문 설정을 확인해 주세요.");
    if(question.options){
      distinct(question.options.map(option=>option.key),"질문 선택지");
      if(question.options.some(option=>!validKey(option.key)||!option.label))fail("INVALID_SCHEMA","원본 질문 선택지를 확인해 주세요.");
    }
  }
  if(theme.features.ratingEnabled){
    if(!theme.rating?.options.length)fail("INVALID_SCHEMA","원본 종합평가 설정을 확인해 주세요.");
    distinct(theme.rating.options.map(option=>option.key),"종합평가");
    if(theme.rating.options.some(option=>!validKey(option.key)||!option.label))fail("INVALID_SCHEMA","원본 종합평가 선택지를 확인해 주세요.");
  }
}

function validateAnswers(point:MergePoint,theme:Theme){
  const known=new Map(theme.questions.map(question=>[question.key,question]));
  for(const [key,values] of Object.entries(point.answers)){
    const question=known.get(key);
    if(!question)fail("INVALID_ANSWER",`‘${point.title}’에 원본 지도에서 찾을 수 없는 답변 항목이 있습니다.`);
    if(!Array.isArray(values)||values.length>10||values.some(value=>typeof value!=="string"||value.length>500))fail("INVALID_ANSWER",`‘${point.title}’의 답변은 항목당 500자 이내로 확인해 주세요.`);
    if(question.type!=="multi"&&values.length>1)fail("INVALID_ANSWER",`‘${point.title}’의 단일 답변 항목을 확인해 주세요.`);
    if(question.type==="text"){
      if(values.some(value=>value.length>(question.maxLength??500)))fail("INVALID_ANSWER",`‘${point.title}’의 글자 수 제한을 확인해 주세요.`);
      continue;
    }
    const allowed=new Set([
      ...(question.type==="boolean"?["yes","no"]:question.options?.map(option=>option.key)??[]),
      ...(question.allowUnknown?["unknown"]:[]),...(question.allowNotApplicable?["na"]:[]),
    ]);
    if(values.some(value=>!allowed.has(value))||(values.length>1&&values.some(value=>value==="unknown"||value==="na")))fail("INVALID_ANSWER",`‘${point.title}’에 원본 질문의 선택지와 다른 답변이 있습니다.`);
  }
}

function resolvePoints(sources:MergeSource[],points:MergePoint[]):ResolvedPoint[]{
  if(new Set(sources.map(source=>source.id)).size!==sources.length)fail("DUPLICATE_SOURCE","같은 원본 지도가 여러 번 선택됐습니다.");
  sources.forEach(validateSource);
  const lookup=new Map(sources.map((source,index)=>[source.id,{source,index}]));
  const ids=new Set<string>();
  return points.map(point=>{
    const identity=JSON.stringify([point.mapId,point.id]);
    if(ids.has(identity))fail("DUPLICATE_POINT","같은 위치 기록이 여러 번 선택됐습니다.");
    ids.add(identity);
    const found=lookup.get(point.mapId);
    if(!found)fail("UNKNOWN_SOURCE",`‘${point.title}’의 원본 지도를 찾을 수 없습니다.`);
    const {source,index:sourceIndex}=found;
    const categoryIndex=source.theme.categories.findIndex(category=>category.key===point.categoryKey);
    if(categoryIndex<0)fail("INVALID_CATEGORY",`‘${point.title}’의 원본 관찰 유형을 찾을 수 없습니다.`);
    const category=source.theme.categories[categoryIndex];
    const emojiIndex=category.emojiOptions.findIndex(emoji=>emoji.key===point.emojiKey);
    if(emojiIndex<0)fail("INVALID_EMOJI",`‘${point.title}’의 원본 이모지를 찾을 수 없습니다.`);
    const emoji=category.emojiOptions[emojiIndex];
    if(!emoji.glyph||Array.from(emoji.glyph).length>16||!emoji.label||Array.from(emoji.label).length>60)fail("INVALID_EMOJI",`‘${point.title}’의 이모지 표시를 확인해 주세요.`);
    const rating=source.theme.features.ratingEnabled?source.theme.rating?.options.find(option=>option.key===point.ratingKey)??null:null;
    if(source.theme.features.ratingEnabled?!rating:point.ratingKey!==null)fail("INVALID_RATING",`‘${point.title}’의 원본 종합평가를 확인해 주세요.`);
    if(!point.location||!Number.isFinite(point.location.lat)||!Number.isFinite(point.location.lng)||Math.abs(point.location.lat)>90||Math.abs(point.location.lng)>180)fail("INVALID_LOCATION",`‘${point.title}’의 위치를 확인해 주세요.`);
    if(!Number.isFinite(Date.parse(point.createdAt)))fail("INVALID_DATE",`‘${point.title}’의 등록일을 확인해 주세요.`);
    validateAnswers(point,source.theme);
    return {point,source,sourceIndex,category,categoryIndex,emoji,emojiIndex,rating};
  });
}

/** Preview pins retain each source map's meaning before any combined schema is built. */
export function resolveMergePreview(sources:MergeSource[],points:MergePoint[]):MergePreviewPoint[]{
  return resolvePoints(sources,points).map(({point,source,category,emoji,rating})=>({
    ...structuredClone(point),sourceTitle:source.title,categoryLabel:category.label,emoji:structuredClone(emoji),
    pinColor:source.theme.pin.mode==="rating"?rating?.color??"#475569":source.theme.pin.mode==="category"?category.color:"#285943",
    rating:rating?structuredClone(rating):null,
  }));
}

function sourceLabel(source:MergeSource,index:number,label:string,limit:number){
  const budget=limit-label.length-3;
  return budget>=3?`${clipped(`${index+1}. ${source.title}`,budget)} · ${label}`:clipped(`${index+1}. ${label}`,limit);
}
const categoryKey=(row:ResolvedPoint)=>`s${row.sourceIndex+1}_c${row.categoryIndex+1}`;
const emojiKey=(row:ResolvedPoint)=>`${categoryKey(row)}_e${row.emojiIndex+1}`;
const questionKey=(sourceIndex:number,questionIndex:number)=>`s${sourceIndex+1}_q${questionIndex+1}`;
const ratingQuestionKey=(sourceIndex:number)=>`s${sourceIndex+1}_rating`;
function origin(source:MergeSource,point:MergePoint){
  const korea=new Date(Date.parse(point.createdAt)+9*60*60*1000).toISOString();
  return clipped(`원본 지도: ${clipped(source.title,180)}\n기록한 사람: ${clipped(point.author,180)}\n원래 등록일: ${korea.slice(0,10)} ${korea.slice(11,19)} (한국 시간)`,500);
}

/** Copy a selected subset into a new schema without changing any source object or pin meaning. */
export function buildMergedTheme(sources:MergeSource[],selectedPoints:MergePoint[]):{theme:Theme;copies:MergeCopy[]}{
  if(!selectedPoints.length)fail("EMPTY_SELECTION","합칠 위치 기록을 하나 이상 선택해 주세요.");
  const resolved=resolvePoints(sources,selectedPoints);
  const selectedSources=new Set(resolved.map(row=>row.sourceIndex));
  const categories:Category[]=[];
  const questions:Question[]=[];
  sources.forEach((source,sourceIndex)=>{
    if(!selectedSources.has(sourceIndex))return;
    source.theme.categories.forEach((category,categoryIndex)=>{
      const rows=resolved.filter(row=>row.sourceIndex===sourceIndex&&row.categoryIndex===categoryIndex);
      if(!rows.length)return;
      const selectedEmojis=new Set(rows.map(row=>row.emojiIndex));
      const emojiOptions=category.emojiOptions.flatMap((emoji,emojiIndex)=>selectedEmojis.has(emojiIndex)?[{...structuredClone(emoji),key:`s${sourceIndex+1}_c${categoryIndex+1}_e${emojiIndex+1}`,active:true}]:[]);
      categories.push({key:categoryKey(rows[0]),label:sourceLabel(source,sourceIndex,category.label,40),color:category.color,defaultEmojiKey:emojiOptions[0].key,emojiOptions});
    });
    source.theme.questions.forEach((question,questionIndex)=>questions.push({...structuredClone(question),key:questionKey(sourceIndex,questionIndex),label:sourceLabel(source,sourceIndex,question.label,60),required:false}));
    if(source.theme.features.ratingEnabled&&source.theme.rating){
      questions.push({key:ratingQuestionKey(sourceIndex),label:sourceLabel(source,sourceIndex,`원본 ${source.theme.rating.label}`,60),type:"single",required:false,allowUnknown:false,allowNotApplicable:false,options:source.theme.rating.options.map(option=>({key:option.key,label:option.label}))});
    }
  });
  questions.push({key:mergeOriginQuestionKey,label:"원본 기록 정보",type:"text",required:false,allowUnknown:false,allowNotApplicable:false,maxLength:500});
  const copies=resolved.map((row):MergeCopy=>{
    const answers:Record<string,string[]>={};
    row.source.theme.questions.forEach((question,index)=>{if(Object.hasOwn(row.point.answers,question.key))answers[questionKey(row.sourceIndex,index)]=[...row.point.answers[question.key]];});
    if(row.rating)answers[ratingQuestionKey(row.sourceIndex)]=[row.rating.key];
    answers[mergeOriginQuestionKey]=[origin(row.source,row.point)];
    return {sourceId:row.point.id,sourceMapId:row.point.mapId,original:structuredClone(row.point),categoryKey:categoryKey(row),emojiKey:emojiKey(row),ratingKey:null,answers};
  });
  return {theme:{key:"custom",label:"합친 지도",version:1,requiresConfiguration:false,features:{ratingEnabled:false,ideasEnabled:resolved.some(row=>row.source.theme.features.ideasEnabled||!!row.point.improvementIdea),proposalsEnabled:true,commentsEnabled:true},pin:{mode:"category"},rating:null,categories,questions},copies};
}
