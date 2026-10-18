import {NextRequest} from "next/server";
import {getSession} from "@/server/auth/session";
import {ApiError,failure,ok,readJson,requireSameOrigin,requireUuid} from "@/server/http";
import {inviteAttemptActor} from "@/server/policies/invite-attempts";
import {calculateTravelRoute} from "@/server/services/travel-route";

export const runtime="nodejs";
export const maxDuration=40;

export async function POST(request:NextRequest,{params}:{params:Promise<{mapId:string}>}){
  try{
    requireSameOrigin(request);
    const {mapId}=await params,session=await getSession(request);
    const actor=inviteAttemptActor(request.headers,process.env);
    if(!session&&actor===undefined)throw new ApiError(503,"TRAVEL_LIMIT_NOT_CONFIGURED","동선 계산 연결 설정이 필요합니다.");
    return ok(await calculateTravelRoute(requireUuid(mapId),session,await readJson(request),actor??"account",request.signal));
  }catch(error){return failure(error);}
}
