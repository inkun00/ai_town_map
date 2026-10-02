import {NextRequest} from "next/server";
import {getSession,requireSession,requireCsrf} from "@/server/auth/session";
import {failure,ok,readJson,requireUuid} from "@/server/http";
import {submitMissionSchema} from "@/domain/exploration-game";
import {submitMission} from "@/server/services/exploration-games";
export const runtime="nodejs";
export async function POST(request:NextRequest,ctx:{params:Promise<{roomId:string}>}){try{const s=requireSession(await getSession(request));requireCsrf(request,s);return ok(await submitMission(requireUuid((await ctx.params).roomId),s,submitMissionSchema.parse(await readJson(request))),201);}catch(e){return failure(e);}}
