import {getPointEmoji,type Theme,type DemoPoint} from "../lib/demo-data";
export type RatingMeaning={symbol:string;label:string;color:string};
export function pointRating(theme:Theme,point:Pick<DemoPoint,"ratingKey">):RatingMeaning|null{
  if(!theme.features.ratingEnabled||!theme.rating)return null;
  return theme.rating.options.find(option=>option.key===point.ratingKey)??{symbol:"?",label:"평가 없음",color:"#475569"};
}
export function pointDescription(theme:Theme,point:Pick<DemoPoint,"title"|"categoryKey"|"emojiKey"|"ratingKey">){
  const category=theme.categories.find(item=>item.key===point.categoryKey)?.label??"기록";
  const emoji=getPointEmoji(theme,point)?.label;
  const rating=pointRating(theme,point);
  return [point.title,category,emoji!==category?emoji:null,rating?`${theme.rating!.label}: ${rating.label}`:null].filter(Boolean).join(", ");
}
function escapeXml(value:string){return value.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;").replaceAll('"',"&quot;").replaceAll("'","&apos;");}
/** The group count replaces a representative rating to avoid implying group consensus. */
export function pinSvg(glyph:string,color:string,selected:boolean,symbol?:string,count=1){
  const safeColor=count>1?"#475569":/^#[0-9a-f]{6}$/i.test(color)?color:"#287554";
  const badge=count>1?(count>99?"99+":String(count)):symbol;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="68" viewBox="0 0 60 68"><path d="M26 63C18 52 2 39 2 27a24 24 0 1 1 48 0C50 39 34 52 26 63Z" fill="${safeColor}" stroke="${selected?"#173b28":"white"}" stroke-width="${selected?4:3}"/><circle cx="26" cy="27" r="18" fill="white"/><text x="26" y="35" text-anchor="middle" font-size="23">${escapeXml(glyph)}</text>${badge?`<circle cx="46" cy="46" r="12" fill="white" stroke="#111827" stroke-width="2"/><text x="46" y="52" text-anchor="middle" font-family="Arial,sans-serif" font-size="${count>1?13:20}" font-weight="700" fill="#111827">${escapeXml(badge)}</text>`:""}</svg>`;
}

export type PointSelectionState="selected"|"unselected";
/** A merge check is independent of the source map's rating or keyboard focus. */
export function selectionPinSvg(glyph:string,state:PointSelectionState|"mixed",focused=false,selectedCount=state==="selected"?1:0,total=1){
  const count=Number.isFinite(total)?Math.max(1,Math.floor(total)):1;
  const chosen=Number.isFinite(selectedCount)?Math.max(0,Math.min(count,Math.floor(selectedCount))):0;
  const blue="#1d4ed8",gray="#64748b",light="#f1f5f9";
  const fill=state==="selected"?blue:light;
  const outline=focused?"#0f172a":state==="unselected"?gray:blue;
  const pinPath="M26 63C18 52 2 39 2 27a24 24 0 1 1 48 0C50 39 34 52 26 63Z";
  const check='<path d="m40 47 4 4 8-9" fill="none" stroke="white" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>';
  const ratio=`${chosen}/${count}`;
  const grouped=count>1;
  const badgeFill=state==="selected"?blue:"white";
  const badgeColor=state==="selected"?"white":state==="mixed"?blue:gray;
  const badgeOutline=state==="unselected"?gray:blue;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="60" height="68" viewBox="0 0 60 68" data-selection-state="${state}"><path d="${pinPath}" fill="${fill}" stroke="${outline}" stroke-width="${focused?4:3}"${state==="unselected"?' stroke-dasharray="5 3"':""}/>${state==="mixed"?`<defs><clipPath id="pin-body"><path d="${pinPath}"/></clipPath></defs><path d="M0 0H26V68H0Z" fill="${blue}" clip-path="url(#pin-body)"/>`:""}<circle cx="26" cy="25" r="17" fill="white"/><text x="26" y="33" text-anchor="middle" font-size="22">${escapeXml(glyph)}</text>${grouped?`<rect x="2" y="45" width="56" height="20" rx="7" fill="${badgeFill}" stroke="${badgeOutline}" stroke-width="2"/><text x="30" y="59" text-anchor="middle" font-family="Arial,sans-serif" font-size="${ratio.length>7?10:ratio.length>5?12:14}" font-weight="700" fill="${badgeColor}">${ratio}</text>`:state==="selected"?`<circle cx="46" cy="46" r="12" fill="${blue}" stroke="white" stroke-width="2"/>${check}`:`<circle cx="46" cy="46" r="12" fill="white" stroke="${gray}" stroke-width="2"/><circle cx="46" cy="46" r="6" fill="none" stroke="${gray}" stroke-width="2"/>`}</svg>`;
}
