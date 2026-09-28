import {NextRequest} from "next/server";
import {getSession,requireSession,requireCsrf} from "@/server/auth/session";
import {ApiError,failure,ok,readJson,requireUuid} from "@/server/http";
import {actOnProposal,proposalAction} from "@/server/services/proposals";
export const runtime="nodejs";
export async function POST(request:NextRequest,{params}:{params:Promise<{mapId:string;id:string}>}){try{const {mapId,id}=await params;const session=requireSession(await getSession(request));requireCsrf(request,session);const version=request.headers.get("if-match")?.match(/^"(\d+)"$/)?.[1];if(!version)throw new ApiError(428,"VERSION_REQUIRED","제안서를 다시 열어 주세요.");return ok(await actOnProposal(requireUuid(mapId),requireUuid(id),session,version,proposalAction.parse(await readJson(request))));}catch(error){return failure(error);}}
