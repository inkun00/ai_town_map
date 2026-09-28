import { NextRequest } from "next/server";
import { getSession,requireCsrf,requireSession } from "@/server/auth/session";
import { ApiError,failure,ok,readJson,requireUuid } from "@/server/http";
import { changeMember,memberInput } from "@/server/services/operations";
export const runtime="nodejs";
export async function PATCH(request:NextRequest,{params}:{params:Promise<{mapId:string;id:string}>}){try{const {mapId,id}=await params;const session=requireSession(await getSession(request));requireCsrf(request,session);const version=request.headers.get("if-match")?.match(/^"(\d+)"$/)?.[1];if(!version)throw new ApiError(428,"VERSION_REQUIRED","참여자 목록을 다시 열어 주세요.");const input=memberInput.parse(await readJson(request));return ok(await changeMember(requireUuid(mapId),requireUuid(id),session,version,input));}catch(error){return failure(error);}}
