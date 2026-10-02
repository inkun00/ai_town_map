import {NextRequest} from "next/server";
import {getSession,requireSession,requireCsrf} from "@/server/auth/session";
import {failure,ok,readJson,requireUuid} from "@/server/http";
import {createRoomSchema} from "@/domain/exploration-game";
import {createRoom} from "@/server/services/exploration-games";
export const runtime="nodejs";
export async function POST(request:NextRequest,ctx:{params:Promise<{gameId:string}>}){try{const s=requireSession(await getSession(request));requireCsrf(request,s);return ok(await createRoom(requireUuid((await ctx.params).gameId),s,createRoomSchema.parse(await readJson(request))),201);}catch(e){return failure(e);}}
