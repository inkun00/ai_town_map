import {NextRequest} from "next/server";
import {getSession,requireSession,requireCsrf} from "@/server/auth/session";
import {ApiError,failure,ok,readJson,requireUuid} from "@/server/http";
import {createProposal,listProposals,proposalInput} from "@/server/services/proposals";
export const runtime="nodejs";
type Context={params:Promise<{mapId:string}>};
export async function GET(request:NextRequest,{params}:Context){try{const {mapId}=await params;const scope=request.nextUrl.searchParams.get("scope")??"published";if(!["published","mine","review","archive"].includes(scope))throw new ApiError(422,"INVALID_SCOPE","목록 범위를 확인해 주세요.");return ok(await listProposals(requireUuid(mapId),await getSession(request),scope as "published"|"mine"|"review"|"archive",request.nextUrl.searchParams.get("cursor")??undefined));}catch(error){return failure(error);}}
export async function POST(request:NextRequest,{params}:Context){try{const {mapId}=await params;const session=requireSession(await getSession(request));requireCsrf(request,session);const key=request.headers.get("idempotency-key");if(!key)throw new ApiError(422,"IDEMPOTENCY_REQUIRED","요청 키가 필요합니다.");const result=await createProposal(requireUuid(mapId),session,requireUuid(key),proposalInput.parse(await readJson(request)));return ok(result.proposal,result.repeated?200:201);}catch(error){return failure(error);}}
