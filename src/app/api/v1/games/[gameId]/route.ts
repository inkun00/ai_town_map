import {NextRequest} from "next/server";
import {getSession,requireSession,requireCsrf} from "@/server/auth/session";
import {failure,ok,readJson,requireUuid} from "@/server/http";
import {getGame,changeGame,changeGameSchema} from "@/server/services/exploration-games";
export const runtime="nodejs";
type Context={params:Promise<{gameId:string}>};
export async function GET(request:NextRequest,ctx:Context){try{return ok(await getGame(requireUuid((await ctx.params).gameId),await getSession(request)));}catch(e){return failure(e);}}
export async function POST(request:NextRequest,ctx:Context){try{const s=requireSession(await getSession(request));requireCsrf(request,s);return ok(await changeGame(requireUuid((await ctx.params).gameId),s,changeGameSchema.parse(await readJson(request))));}catch(e){return failure(e);}}
