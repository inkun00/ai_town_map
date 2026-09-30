import { resourceVersion } from "@/domain/resource-version";
import { NextRequest } from "next/server";
import { getSession,requireCsrf,requireSession } from "@/server/auth/session";
import { ApiError,failure,ok,requireUuid } from "@/server/http";
import { restoreMap } from "@/server/services/operations";
export const runtime="nodejs";
export async function POST(request:NextRequest,{params}:{params:Promise<{mapId:string}>}){try{const {mapId}=await params;const session=requireSession(await getSession(request));requireCsrf(request,session);const version=resourceVersion(request.headers);if(!version)throw new ApiError(428,"VERSION_REQUIRED","지도를 다시 열어 주세요.");return ok(await restoreMap(requireUuid(mapId),session,version));}catch(error){return failure(error);}}
