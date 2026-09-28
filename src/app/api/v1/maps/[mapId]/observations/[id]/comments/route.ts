import { NextRequest } from "next/server";
import { getSession,requireCsrf,requireSession } from "@/server/auth/session";
import { ApiError,failure,ok,readJson,requireUuid } from "@/server/http";
import { commentInput,createComment,listComments } from "@/server/services/comments";
export const runtime="nodejs";
type Context={params:Promise<{mapId:string;id:string}>};
export async function GET(request:NextRequest,{params}:Context){try{const {mapId,id}=await params;return ok(await listComments(requireUuid(mapId),requireUuid(id),await getSession(request)));}catch(error){return failure(error);}}
export async function POST(request:NextRequest,{params}:Context){try{const {mapId,id}=await params;const session=requireSession(await getSession(request));requireCsrf(request,session);const key=request.headers.get("idempotency-key");if(!key)throw new ApiError(422,"IDEMPOTENCY_REQUIRED","요청 키가 필요합니다.");const input=commentInput.parse(await readJson(request));const result=await createComment(requireUuid(mapId),requireUuid(id),session,requireUuid(key),input.body);return ok(result.comment,result.repeated?200:201);}catch(error){return failure(error);}}
