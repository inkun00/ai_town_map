import { NextRequest } from "next/server";
import { getSession, requireCsrf, requireSession } from "@/server/auth/session";
import { ApiError, failure, ok, readJson, requireUuid } from "@/server/http";
import { createObservation, listObservations, observationSchema } from "@/server/services/observations";

export const runtime="nodejs";
type Context={params:Promise<{mapId:string}>};
export async function GET(request:NextRequest,{params}:Context) {
  try { const {mapId}=await params; return ok(await listObservations(requireUuid(mapId),await getSession(request))); }
  catch(error) { return failure(error); }
}
export async function POST(request:NextRequest,{params}:Context) {
  try {
    const {mapId}=await params; const session=requireSession(await getSession(request)); requireCsrf(request,session);
    const key=request.headers.get("idempotency-key");
    if(!key) throw new ApiError(422,"IDEMPOTENCY_REQUIRED","요청 키가 필요합니다.");
    requireUuid(key);
    const input=observationSchema.parse(await readJson(request));
    const result=await createObservation(requireUuid(mapId),session,key,input);
    return ok(result.observation,result.repeated?200:201);
  } catch(error) { return failure(error); }
}
