import { resourceVersion } from "@/domain/resource-version";
import { NextRequest } from "next/server";
import { z } from "zod";
import { getSession,requireCsrf,requireSession } from "@/server/auth/session";
import { ApiError,failure,ok,readJson,requireUuid } from "@/server/http";
import { moderateObservation } from "@/server/services/observations";
export const runtime="nodejs";
type Context={params:Promise<{mapId:string;id:string}>};
const schema=z.strictObject({action:z.enum(["approve","hide","restore","request_changes"]),reason:z.string().trim().max(500).optional()});
export async function POST(request:NextRequest,{params}:Context){try{const {mapId,id}=await params;const session=requireSession(await getSession(request));requireCsrf(request,session);const version=resourceVersion(request.headers);if(!version)throw new ApiError(428,"VERSION_REQUIRED","기록을 다시 열어 주세요.");const input=schema.parse(await readJson(request));return ok(await moderateObservation(requireUuid(mapId),requireUuid(id),session,version,input.action,input.reason));}catch(error){return failure(error);}}
