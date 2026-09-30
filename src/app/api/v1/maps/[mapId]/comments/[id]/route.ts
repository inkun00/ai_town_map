import { resourceVersion } from "@/domain/resource-version";
import { NextRequest } from "next/server";
import { getSession,requireCsrf,requireSession } from "@/server/auth/session";
import { ApiError,failure,noContent,ok,readJson,requireUuid } from "@/server/http";
import { commentInput,deleteComment,editComment } from "@/server/services/comments";
export const runtime="nodejs";
type Context={params:Promise<{mapId:string;id:string}>};
function versionOf(request:NextRequest){const version=resourceVersion(request.headers);if(!version)throw new ApiError(428,"VERSION_REQUIRED","댓글을 다시 열어 주세요.");return version;}
export async function PATCH(request:NextRequest,{params}:Context){try{const {mapId,id}=await params;const session=requireSession(await getSession(request));requireCsrf(request,session);const input=commentInput.parse(await readJson(request));return ok(await editComment(requireUuid(mapId),requireUuid(id),session,versionOf(request),input.body));}catch(error){return failure(error);}}
export async function DELETE(request:NextRequest,{params}:Context){try{const {mapId,id}=await params;const session=requireSession(await getSession(request));requireCsrf(request,session);await deleteComment(requireUuid(mapId),requireUuid(id),session,versionOf(request));return noContent();}catch(error){return failure(error);}}
