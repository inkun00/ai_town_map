import "server-only";
import {createHmac} from "node:crypto";
import {z} from "zod";
import type {AppSession} from "@/server/auth/session";
import {maximumTravelStops,supportsTravelPlanning,type TravelLeg,type TravelRouteResult} from "@/domain/travel-route";
import {query,withTransaction} from "@/server/db";
import {getServerConfig} from "@/server/env";
import {ApiError} from "@/server/http";
import {getTravelRouter} from "@/server/routing/kakao";
import {communityMap} from "./community-access";

export const travelRouteInput=z.strictObject({stops:z.array(z.strictObject({pointId:z.uuid(),mode:z.enum(["car","walk"])})).min(2).max(maximumTravelStops)}).refine(input=>new Set(input.stops.map(stop=>stop.pointId)).size===input.stops.length,{message:"같은 장소를 두 번 선택할 수 없어요."});
type Input=z.infer<typeof travelRouteInput>;
type Point={id:string;lat:number;lng:number};
type Routed=Awaited<ReturnType<ReturnType<typeof getTravelRouter>["route"]>>;
const cache=new Map<string,{value:Routed;expires:number;bytes:number;calculatedAt:number}>();
const cacheLifetime=2*60*1000,cacheBudget=4_000_000;
let cacheBytes=0;
function prune(){for(const [key,item] of cache)if(item.expires<=Date.now()){cache.delete(key);cacheBytes-=item.bytes;}}
function remember(key:string,value:Routed,calculatedAt:number){
  if(value.status!=="ready")return;
  const bytes=Buffer.byteLength(JSON.stringify(value));if(bytes>cacheBudget)return;
  const previous=cache.get(key);if(previous){cacheBytes-=previous.bytes;cache.delete(key);}
  while(cache.size>=120||cacheBytes+bytes>cacheBudget){const oldest=cache.keys().next().value;if(oldest===undefined)break;cacheBytes-=cache.get(oldest)!.bytes;cache.delete(oldest);}
  cache.set(key,{value,expires:Date.now()+cacheLifetime,bytes,calculatedAt});cacheBytes+=bytes;
}

async function sources(mapId:string,session:AppSession|null,input:Input):Promise<Point[]>{
  return withTransaction(async client=>{
    await client.query("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await communityMap(client,mapId,session);
    const map=(await client.query<{theme_key:string}>("SELECT theme_key FROM app.maps WHERE id=$1",[mapId])).rows[0];
    if(!map||!supportsTravelPlanning(map.theme_key))throw new ApiError(422,"TRAVEL_THEME_UNSUPPORTED","관광·문화유산 지도에서 이동 동선을 만들 수 있어요.");
    const points=(await client.query<Point>("SELECT id,lat,lng FROM app.observations WHERE map_id=$1 AND status='published' AND id=ANY($2::uuid[])",[mapId,input.stops.map(stop=>stop.pointId)])).rows;
    if(points.length!==input.stops.length)throw new ApiError(409,"TRAVEL_POINTS_CHANGED","선택한 기록 중 숨겨지거나 삭제된 장소가 있어요. 지도 기록을 다시 확인해 주세요.");
    const byId=new Map(points.map(point=>[point.id,point]));
    return input.stops.map(stop=>{
      const point=byId.get(stop.pointId)!;
      if(!Number.isFinite(point.lat)||!Number.isFinite(point.lng)||Math.abs(point.lat)>90||Math.abs(point.lng)>180)throw new ApiError(422,"TRAVEL_LOCATION_INVALID","장소의 위치를 확인하지 못했어요.");
      return point;
    });
  });
}

/** Durable, separately scoped limits also apply across serverless instances. */
async function reserveAttempt(mapId:string,session:AppSession|null,actor:string){
  const pepper=getServerConfig().invitePepper;
  const scopes:[string,number][]=[[session?`principal:${session.principalId}`:`visitor:${actor}`,session?30:240],[`map:${mapId}`,240],["all-maps",720]];
  for(const [scope,limit] of scopes){
    const hash=createHmac("sha256",pepper).update(`travel-route:${scope}`).digest();
    const rows=await query<{attempts:number}>(`INSERT INTO app_private.invite_attempts(actor_hash,window_start,attempts) VALUES($1,now(),1)
      ON CONFLICT(actor_hash) DO UPDATE SET
      attempts=CASE WHEN app_private.invite_attempts.window_start<=now()-interval '10 minutes' THEN 1 ELSE app_private.invite_attempts.attempts+1 END,
      window_start=CASE WHEN app_private.invite_attempts.window_start<=now()-interval '10 minutes' THEN now() ELSE app_private.invite_attempts.window_start END RETURNING attempts`,[hash]);
    if((rows[0]?.attempts??limit+1)>limit)throw new ApiError(429,"TRAVEL_RATE_LIMIT","동선 계산 요청이 많아요. 최대 10분 후 다시 시도해 주세요.");
  }
}

export async function calculateTravelRoute(mapId:string,session:AppSession|null,body:unknown,actor:string,requestSignal?:AbortSignal):Promise<TravelRouteResult>{
  const input=travelRouteInput.parse(body),points=await sources(mapId,session,input);
  const router=getTravelRouter();
  if(requestSignal?.aborted)throw new ApiError(499,"TRAVEL_CANCELLED","동선 계산을 취소했어요.");
  await reserveAttempt(mapId,session,actor);
  prune();
  const controller=new AbortController(),timeout=AbortSignal.timeout(25000);
  const signal=AbortSignal.any([controller.signal,timeout,...(requestSignal?[requestSignal]:[])]);
  const legs:TravelLeg[]=Array(input.stops.length-1);let cursor=0,calculatedAt=Infinity;
  try{
    // No database transaction or pool connection is held during provider calls.
    async function worker(){
      while(cursor<legs.length){
        const index=cursor++,from=points[index],to=points[index+1],mode=input.stops[index].mode;
        if(signal.aborted)throw new ApiError(requestSignal?.aborted?499:504,requestSignal?.aborted?"TRAVEL_CANCELLED":"TRAVEL_TIMEOUT",requestSignal?.aborted?"동선 계산을 취소했어요.":"동선 계산 시간이 길어지고 있어요. 잠시 후 다시 시도해 주세요.");
        const key=JSON.stringify([router.provider,from.lat,from.lng,to.lat,to.lng,mode]);
        const cached=cache.get(key),quoteTime=cached?.calculatedAt??Date.now();calculatedAt=Math.min(calculatedAt,quoteTime);
        let value=cached?.value;
        if(!value){value=await router.route({lat:from.lat,lng:from.lng},{lat:to.lat,lng:to.lng},mode,signal);remember(key,value,quoteTime);}
        legs[index]={...value,fromId:from.id,toId:to.id,mode};
      }
    }
    await Promise.all([worker(),worker()]);
    if(signal.aborted)throw new ApiError(requestSignal?.aborted?499:504,"TRAVEL_CANCELLED","동선 계산이 중단됐어요. 다시 시도해 주세요.");
    // A removed/private draft map or a hidden/moved point must not survive an in-flight calculation.
    const current=await sources(mapId,session,input);
    if(current.some((point,index)=>point.lat!==points[index].lat||point.lng!==points[index].lng))throw new ApiError(409,"TRAVEL_POINTS_CHANGED","계산 중 장소의 위치가 바뀌었어요. 다시 계산해 주세요.");
    return {legs,calculatedAt:new Date(calculatedAt).toISOString(),provider:router.provider,credit:router.credit};
  }finally{controller.abort();}
}
