import {NextRequest} from "next/server";
import {getSession,requireCsrf,setSessionCookies} from "@/server/auth/session";
import {failure,ok,readJson,requireSameOrigin} from "@/server/http";
import {joinGameSchema} from "@/domain/exploration-game";
import {joinRoom,gameJoinAttempt} from "@/server/services/exploration-games";
export const runtime="nodejs";
export async function POST(request:NextRequest){try{requireSameOrigin(request);await gameJoinAttempt(request.headers);const s=await getSession(request);if(s)requireCsrf(request,s);const joined=await joinRoom(joinGameSchema.parse(await readJson(request)),s);const response=ok({roomId:joined.roomId});if(joined.session)setSessionCookies(response,joined.session);return response;}catch(e){return failure(e);}}
