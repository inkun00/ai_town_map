import {NextRequest} from "next/server";
import {getSession,requireSession} from "@/server/auth/session";
import {failure,ok,requireUuid} from "@/server/http";
import {getGameCheckpoints} from "@/server/services/exploration-games";
export const runtime="nodejs";
export async function GET(request:NextRequest,ctx:{params:Promise<{gameId:string}>}){try{return ok(await getGameCheckpoints(requireUuid((await ctx.params).gameId),requireSession(await getSession(request))));}catch(e){return failure(e);}}
