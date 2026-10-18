import * as z from "zod";
import type {MapPoint} from "@/components/KakaoMap";

export type TravelMode="car";
export type TravelRouteProvider="Kakao";
export type TravelPlan={stops:{pointId:string;mode:TravelMode}[]};
export type TravelLeg={fromId:string;toId:string;mode:TravelMode;status:"ready"|"unavailable";paths:{lat:number;lng:number}[][];distanceMeters:number|null;durationSeconds:number|null;message?:string};
export type TravelRouteResult={legs:TravelLeg[];calculatedAt:string;provider:TravelRouteProvider;credit?:string};
export type TravelRouteOverlay={stops:{id:string;title:string;emoji:string;location:{lat:number;lng:number}}[];legs:TravelLeg[];calculatedAt?:string;draft?:boolean;provider?:TravelRouteProvider;credit?:string};
export const maximumTravelStops=12;
const identifier=z.string().min(1).max(150);
const planSchema=z.object({stops:z.array(z.object({pointId:identifier,mode:z.literal("car")})).max(maximumTravelStops)}).refine(plan=>new Set(plan.stops.map(stop=>stop.pointId)).size===plan.stops.length);
const fileSchema=z.object({format:z.literal("town-travel-route"),version:z.literal(1),mapId:identifier,plan:planSchema});
const importedPlanSchema=z.object({stops:z.array(z.object({pointId:identifier,mode:z.enum(["car","walk"])})).max(maximumTravelStops)}).transform(plan=>({stops:plan.stops.map(stop=>({pointId:stop.pointId,mode:"car" as const}))})).pipe(planSchema);
const importedFileSchema=fileSchema.extend({plan:importedPlanSchema});
export function emptyTravelPlan():TravelPlan{return {stops:[]};}
export function travelPlanKey(scope:string,mapId:string){return `town-travel-route:v1:${encodeURIComponent(scope)}:${encodeURIComponent(mapId)}`;}
export function serializeTravelPlan(mapId:string,plan:TravelPlan):string{return JSON.stringify(fileSchema.parse({format:"town-travel-route",version:1,mapId,plan}),null,2);}
export function parseTravelPlan(text:string,mapId:string):TravelPlan{
  if(text.length>100_000)throw new Error("여행 동선 파일은 100KB 이하만 불러올 수 있어요.");
  let file:z.infer<typeof fileSchema>;
  try{file=importedFileSchema.parse(JSON.parse(text));}catch{throw new Error("올바른 여행 동선 파일이 아니에요. 앱에서 저장한 동선 파일을 선택해 주세요.");}
  if(file.mapId!==mapId)throw new Error("다른 지도의 동선이에요. 동선을 만든 지도에 먼저 입장해 주세요.");
  return file.plan;
}
/** Captions and hidden/filter state do not invalidate a real road calculation. */
export function travelRequestKey(plan:TravelPlan,points:MapPoint[]):string|null{
  const valid=planSchema.safeParse(plan);if(!valid.success||valid.data.stops.length<2)return null;
  const lookup=new Map(points.map(point=>[point.id,point]));
  const stops=[];
  for(const [index,stop] of valid.data.stops.entries()){
    const location=lookup.get(stop.pointId)?.location;
    if(!location||!Number.isFinite(location.lat)||!Number.isFinite(location.lng)||Math.abs(location.lat)>90||Math.abs(location.lng)>180)return null;
    stops.push([stop.pointId,location.lat,location.lng,index<valid.data.stops.length-1?stop.mode:null]);
  }
  return JSON.stringify(stops);
}
export function formatTravelDuration(seconds:number|null):string{
  if(seconds===null||!Number.isFinite(seconds)||seconds<0)return "시간 확인 불가";
  if(seconds===0)return "0분";if(seconds<60)return "1분 미만";
  const minutes=Math.ceil(seconds/60),hours=Math.floor(minutes/60),rest=minutes%60;
  return hours?`${hours}시간${rest?` ${rest}분`:""}`:`${minutes}분`;
}
export function formatTravelDistance(meters:number|null):string{
  if(meters===null||!Number.isFinite(meters)||meters<0)return "거리 확인 불가";
  return meters>=1000?`${new Intl.NumberFormat("ko-KR",{maximumFractionDigits:2}).format(meters/1000)} km`:`${Math.round(meters)} m`;
}
export function supportsTravelPlanning(themeKey:string):boolean{return themeKey==="tourism"||themeKey==="heritage";}
export function travelModeLabel(_mode:TravelMode):string{return "길찾기";}
export function travelModeColor(_mode:TravelMode):string{return "#2563eb";}
export function travelLegLabel(leg:TravelLeg):string{return `${travelModeLabel(leg.mode)} (자동차 기준) · ${formatTravelDistance(leg.status==="ready"?leg.distanceMeters:null)} · ${formatTravelDuration(leg.status==="ready"?leg.durationSeconds:null)}`;}
export function travelRouteSummary(route:TravelRouteOverlay){
  const valid=(value:number|null):value is number=>typeof value==="number"&&Number.isFinite(value)&&value>=0;
  const ready=route.draft?[]:route.legs.filter(leg=>leg.status==="ready"),distances=ready.map(leg=>leg.distanceMeters).filter(valid),durations=ready.map(leg=>leg.durationSeconds).filter(valid);
  const totalLegCount=Math.max(0,route.stops.length-1),complete=!route.draft&&totalLegCount>0&&route.legs.length===totalLegCount&&ready.length===totalLegCount&&distances.length===totalLegCount&&durations.length===totalLegCount;
  return {complete,distanceMeters:distances.length?distances.reduce((sum,value)=>sum+value,0):null,durationSeconds:durations.length?durations.reduce((sum,value)=>sum+value,0):null,readyLegCount:ready.length,totalLegCount};
}
