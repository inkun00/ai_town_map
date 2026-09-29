import {NextRequest} from "next/server";
import {getSession,requireSession,requireCsrf} from "@/server/auth/session";
import {ApiError,failure,noContent,ok,readJson,requireUuid} from "@/server/http";
import {getProposal,updateProposal,deleteProposal,proposalInput} from "@/server/services/proposals";
export const runtime="nodejs";
type Context={params:Promise<{mapId:string;id:string}>};
function version(request:NextRequest){const value=request.headers.get("if-match")?.match(/^"(\d+)"$/)?.[1];if(!value)throw new ApiError(428,"VERSION_REQUIRED","제안서를 다시 열어 주세요.");return value;}
export async function GET(request:NextRequest,{params}:Context){try{const {mapId,id}=await params;return ok(await getProposal(requireUuid(mapId),requireUuid(id),await getSession(request),request.nextUrl.searchParams.get("view")==="published",request.nextUrl.searchParams.get("view")==="archive"));}catch(error){return failure(error);}}
export async function PATCH(request:NextRequest,{params}:Context){try{const {mapId,id}=await params;const session=requireSession(await getSession(request));requireCsrf(request,session);return ok(await updateProposal(requireUuid(mapId),requireUuid(id),session,version(request),proposalInput.parse(await readJson(request))));}catch(error){return failure(error);}}
export async function DELETE(request:NextRequest,{params}:Context){try{const {mapId,id}=await params;const session=requireSession(await getSession(request));requireCsrf(request,session);await deleteProposal(requireUuid(mapId),requireUuid(id),session,version(request));return noContent();}catch(error){return failure(error);}}
