import {NextRequest} from "next/server";
import {getSession,requireSession,requireCsrf} from "@/server/auth/session";
import {failure,ok,readJson,requireUuid} from "@/server/http";
import {getRoom,roomAction,roomActionSchema} from "@/server/services/exploration-games";
export const runtime="nodejs";
type Context={params:Promise<{roomId:string}>};
export async function GET(request:NextRequest,ctx:Context){try{return ok(await getRoom(requireUuid((await ctx.params).roomId),requireSession(await getSession(request))));}catch(e){return failure(e);}}
export async function POST(request:NextRequest,ctx:Context){try{const s=requireSession(await getSession(request));requireCsrf(request,s);return ok(await roomAction(requireUuid((await ctx.params).roomId),s,roomActionSchema.parse(await readJson(request))));}catch(e){return failure(e);}}
