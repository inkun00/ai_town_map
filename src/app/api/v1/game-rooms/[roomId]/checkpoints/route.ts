import {NextRequest} from "next/server";
import {getSession,requireSession,requireCsrf} from "@/server/auth/session";
import {failure,ok,readJson,requireUuid} from "@/server/http";
import {scanCheckpointSchema} from "@/domain/exploration-game";
import {scanCheckpoint,getRoomCheckpoints} from "@/server/services/exploration-games";
export const runtime="nodejs";
export async function GET(request:NextRequest,ctx:{params:Promise<{roomId:string}>}){try{return ok(await getRoomCheckpoints(requireUuid((await ctx.params).roomId),requireSession(await getSession(request))));}catch(e){return failure(e);}}
export async function POST(request:NextRequest,ctx:{params:Promise<{roomId:string}>}){try{const s=requireSession(await getSession(request));requireCsrf(request,s);return ok(await scanCheckpoint(requireUuid((await ctx.params).roomId),s,scanCheckpointSchema.parse(await readJson(request))));}catch(e){return failure(e);}}
