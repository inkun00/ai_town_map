import { NextRequest } from "next/server";
import { getSession,requireCsrf,requireSession } from "@/server/auth/session";
import { ApiError,failure,ok,readJson,requireUuid } from "@/server/http";
import { createReport,listReports,reportInput } from "@/server/services/reports";
export const runtime="nodejs";
type Context={params:Promise<{mapId:string}>};
export async function GET(request:NextRequest,{params}:Context){try{const {mapId}=await params;const status=request.nextUrl.searchParams.get("status")??"open";if(!["open","resolved","dismissed","all"].includes(status))throw new ApiError(422,"INVALID_STATUS","신고 상태를 확인해 주세요.");return ok(await listReports(requireUuid(mapId),requireSession(await getSession(request)),status as "open"|"resolved"|"dismissed"|"all"));}catch(error){return failure(error);}}
export async function POST(request:NextRequest,{params}:Context){try{const {mapId}=await params;const session=requireSession(await getSession(request));requireCsrf(request,session);const key=request.headers.get("idempotency-key");if(!key)throw new ApiError(422,"IDEMPOTENCY_REQUIRED","요청 키가 필요합니다.");const input=reportInput.parse(await readJson(request));const result=await createReport(requireUuid(mapId),session,requireUuid(key),input);return ok({id:result.report.id,status:result.report.status},result.repeated?200:201);}catch(error){return failure(error);}}
