import {NextRequest} from "next/server";
import {getSession} from "@/server/auth/session";
import {ApiError,failure,ok,requireUuid} from "@/server/http";
import {filterSchema} from "@/domain/analysis";
import {getAnalysis} from "@/server/services/analysis";
export const runtime="nodejs";
export async function GET(request:NextRequest,{params}:{params:Promise<{mapId:string}>}){try{const {mapId}=await params;let input:unknown;try{input=JSON.parse(request.nextUrl.searchParams.get("filter")??"{}");}catch{throw new ApiError(422,"INVALID_FILTER","필터를 확인해 주세요.");}return ok(await getAnalysis(requireUuid(mapId),await getSession(request),filterSchema.parse(input)));}catch(error){return failure(error);}}
