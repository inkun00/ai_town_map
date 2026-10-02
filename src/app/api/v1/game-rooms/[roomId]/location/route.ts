import {NextRequest} from "next/server";
import {getSession,requireSession,requireCsrf} from "@/server/auth/session";
import {failure,ok,readJson,requireUuid} from "@/server/http";
import {locationSchema} from "@/domain/exploration-game";
import {updateLocation} from "@/server/services/exploration-games";
export const runtime="nodejs";
export async function POST(request:NextRequest,ctx:{params:Promise<{roomId:string}>}){try{const s=requireSession(await getSession(request));requireCsrf(request,s);return ok(await updateLocation(requireUuid((await ctx.params).roomId),s,locationSchema.parse(await readJson(request))));}catch(e){return failure(e);}}
