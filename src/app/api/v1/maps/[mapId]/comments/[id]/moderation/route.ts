import { resourceVersion } from "@/domain/resource-version";
import { NextRequest } from "next/server";
import { getSession,requireCsrf,requireSession } from "@/server/auth/session";
import { ApiError,failure,ok,readJson,requireUuid } from "@/server/http";
import { commentModerationInput,moderateComment } from "@/server/services/comments";
export const runtime="nodejs";
type Context={params:Promise<{mapId:string;id:string}>};
export async function POST(request:NextRequest,{params}:Context){try{const {mapId,id}=await params;const session=requireSession(await getSession(request));requireCsrf(request,session);const version=resourceVersion(request.headers);if(!version)throw new ApiError(428,"VERSION_REQUIRED","댓글을 다시 열어 주세요.");const input=commentModerationInput.parse(await readJson(request));return ok(await moderateComment(requireUuid(mapId),requireUuid(id),session,version,input.action,input.reason));}catch(error){return failure(error);}}
