import { NextRequest } from "next/server";
import { getSession, requireCsrf, requireSession } from "@/server/auth/session";
import { ApiError, failure, noContent, ok, readJson, requireUuid } from "@/server/http";
import { deleteObservation,observationSchema, updateObservation } from "@/server/services/observations";

export const runtime="nodejs";
type Context={params:Promise<{mapId:string;id:string}>};
export async function PATCH(request:NextRequest,{params}:Context) {
  try {
    const {mapId,id}=await params; const session=requireSession(await getSession(request)); requireCsrf(request,session);
    const version=request.headers.get("if-match")?.match(/^"(\d+)"$/)?.[1];
    if(!version) throw new ApiError(428,"VERSION_REQUIRED","기록을 다시 열어 주세요.");
    const input=observationSchema.parse(await readJson(request));
    return ok(await updateObservation(requireUuid(mapId),requireUuid(id),session,version,input));
  } catch(error) { return failure(error); }
}
export async function DELETE(request:NextRequest,{params}:Context){try{const {mapId,id}=await params;const session=requireSession(await getSession(request));requireCsrf(request,session);const version=request.headers.get("if-match")?.match(/^"(\d+)"$/)?.[1];if(!version)throw new ApiError(428,"VERSION_REQUIRED","기록을 다시 열어 주세요.");await deleteObservation(requireUuid(mapId),requireUuid(id),session,version);return noContent();}catch(error){return failure(error);}}
