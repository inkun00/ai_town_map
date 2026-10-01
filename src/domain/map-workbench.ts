import {z} from "zod";

export const radiusOptions=[50,100,250,500,1000,2000] as const;
export const maximumRadiusMeters=20000;
export const noteColors=["#fff1a8","#d6f3e7","#ddebff","#ffe0e8"] as const;
const id=z.string().min(1).max(150);
const location=z.object({lat:z.number().min(-90).max(90),lng:z.number().min(-180).max(180)});
const stateSchema=z.object({
  hiddenCategories:z.array(id).max(100),hiddenEmojis:z.array(id).max(1000),hiddenPoints:z.array(id).max(10000),
  radii:z.array(z.object({pointId:id,meters:z.array(z.number().min(1).max(maximumRadiusMeters)).min(1).max(6)})).max(12),
  route:z.array(id).max(50),
  connections:z.array(z.object({fromId:id,toId:id}).refine(edge=>edge.fromId!==edge.toId)).max(100).default([]),
  notes:z.array(z.object({id,text:z.string().max(120),emoji:z.string().max(16),location,color:z.enum(noteColors)}).refine(note=>!!(note.text.trim()||note.emoji.trim()))).max(100),
  layers:z.object({radii:z.boolean(),route:z.boolean(),notes:z.boolean()})
}).refine(state=>Math.max(0,state.route.length-1)+state.connections.length<=100);
const fileSchema=z.object({format:z.literal("town-map-tools"),version:z.literal(1),mapId:id,state:stateSchema});
export type WorkbenchState=z.infer<typeof stateSchema>;
export type MapNote=WorkbenchState["notes"][number];
export type GeoPoint={id:string;location?:{lat:number;lng:number}};
export const emptyWorkbench=():WorkbenchState=>({hiddenCategories:[],hiddenEmojis:[],hiddenPoints:[],radii:[],route:[],connections:[],notes:[],layers:{radii:true,route:true,notes:true}});
export function emojiGroup(categoryKey:string,emojiKey:string){return JSON.stringify([categoryKey,emojiKey]);}
export function visiblePoint(point:{id:string;categoryKey:string;emojiKey:string},state:WorkbenchState){return !state.hiddenCategories.includes(point.categoryKey)&&!state.hiddenEmojis.includes(emojiGroup(point.categoryKey,point.emojiKey))&&!state.hiddenPoints.includes(point.id);}
export function toggleHidden(values:string[],key:string){return values.includes(key)?values.filter(value=>value!==key):[...values,key];}
export function distanceMeters(a:{lat:number;lng:number},b:{lat:number;lng:number}){
  const rad=Math.PI/180,dLat=(b.lat-a.lat)*rad,dLng=(b.lng-a.lng)*rad;
  const h=Math.sin(dLat/2)**2+Math.cos(a.lat*rad)*Math.cos(b.lat*rad)*Math.sin(dLng/2)**2;
  return 6371008.8*2*Math.asin(Math.sqrt(Math.max(0,Math.min(1,h))));
}
export function formatDistance(meters:number){return meters>=1000?`${(meters/1000).toFixed(2)} km`:`${Math.round(meters)} m`;}
/** Never bridge a missing/unauthorized anchor into a new segment. */
export function routeSegments(route:string[],points:GeoPoint[]){
  const lookup=new Map(points.map(point=>[point.id,point]));
  return route.slice(1).flatMap((toId,index)=>{
    const from=lookup.get(route[index]),to=lookup.get(toId);
    return from?.location&&to?.location?[{from,to,index,meters:distanceMeters(from.location,to.location)}]:[];
  });
}
export function connectionEdges(state:WorkbenchState){return [...state.route.slice(1).map((toId,index)=>({fromId:state.route[index],toId})),...state.connections];}
export function connectionSegments(state:WorkbenchState,points:GeoPoint[]){
  return connectionEdges(state).flatMap((edge,index)=>routeSegments([edge.fromId,edge.toId],points).map(segment=>({...segment,index})));
}
export function addConnection(state:WorkbenchState,fromId:string,toId:string):WorkbenchState{
  const edges=connectionEdges(state);
  if(fromId===toId||edges.length>=100||edges.some(edge=>(edge.fromId===fromId&&edge.toId===toId)||(edge.fromId===toId&&edge.toId===fromId)))return state;
  return {...state,route:[],connections:[...edges,{fromId,toId}],layers:{...state.layers,route:true}};
}
export function removePointConnections(state:WorkbenchState,pointId:string):WorkbenchState{return {...state,route:[],connections:connectionEdges(state).filter(edge=>edge.fromId!==pointId&&edge.toId!==pointId)};}
export type ScreenPoint={id:string;x:number;y:number};
/** CSS-pixel hit regions include both the marker body and its geographic tip. */
export function snapPoint(cursor:{x:number;y:number},points:ScreenPoint[],sourceId:string,previousId:string|null=null):string|null{
  const distance=(point:ScreenPoint)=>Math.min(Math.hypot(cursor.x-point.x,cursor.y-point.y),Math.hypot(cursor.x-point.x,cursor.y-(point.y-25)));
  const eligible=points.filter(point=>point.id!==sourceId);
  const previous=eligible.find(point=>point.id===previousId);
  const nearest=eligible.map(point=>({point,distance:distance(point)})).sort((a,b)=>a.distance-b.distance)[0];
  // Keep a target steady at its edge, but allow a closer neighbouring pin to win.
  if(previous&&distance(previous)<=44&&!(nearest&&nearest.distance<=32&&nearest.distance+8<distance(previous)))return previous.id;
  return nearest&&nearest.distance<=32?nearest.point.id:null;
}
export function workbenchKey(scope:string,mapId:string){return `town-map-tools:v1:${encodeURIComponent(scope)}:${encodeURIComponent(mapId)}`;}
export function serializeWorkbench(mapId:string,state:WorkbenchState){return JSON.stringify(fileSchema.parse({format:"town-map-tools",version:1,mapId,state}),null,2);}
export function parseWorkbench(text:string,mapId:string):WorkbenchState{
  if(text.length>2_000_000)throw new Error("공유 파일은 2MB 이하만 불러올 수 있어요.");
  let value:z.infer<typeof fileSchema>;
  try{value=fileSchema.parse(JSON.parse(text));}catch{throw new Error("올바른 지도 도구 파일이 아니에요. 앱에서 저장한 JSON 파일을 선택해 주세요.");}
  if(value.mapId!==mapId)throw new Error("다른 지도의 도구 파일이에요. 파일을 만든 지도에 먼저 입장해 주세요.");
  if(new Set(value.state.notes.map(note=>note.id)).size!==value.state.notes.length)throw new Error("메모 식별자가 중복된 파일이에요.");
  if(new Set(value.state.radii.map(radius=>radius.pointId)).size!==value.state.radii.length)throw new Error("반경 중심이 중복된 파일이에요.");
  return value.state;
}
