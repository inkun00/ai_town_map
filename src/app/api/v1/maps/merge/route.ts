import {NextRequest} from "next/server";
import {getSession,requireCsrf,requireSession} from "@/server/auth/session";
import {ApiError,failure,ok,readJson,requireUuid} from "@/server/http";
import {createMergedMap,createMergedMapSchema} from "@/server/services/map-merge";

export const runtime="nodejs";
export async function POST(request:NextRequest){
  try{const session=requireSession(await getSession(request));requireCsrf(request,session);const key=request.headers.get("idempotency-key");if(!key)throw new ApiError(422,"IDEMPOTENCY_REQUIRED","요청 키가 필요합니다.");requireUuid(key);const result=await createMergedMap(createMergedMapSchema.parse(await readJson(request)),session,key);return ok(result,result.repeated?200:201);}
  catch(error){return failure(error);}
}
