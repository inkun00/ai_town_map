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
