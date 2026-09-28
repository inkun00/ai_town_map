import { NextRequest } from "next/server";
import { getSession,requireSession } from "@/server/auth/session";
import { failure,ok,requireUuid } from "@/server/http";
import { listMembers } from "@/server/services/operations";
export const runtime="nodejs";
export async function GET(request:NextRequest,{params}:{params:Promise<{mapId:string}>}){try{const {mapId}=await params;return ok(await listMembers(requireUuid(mapId),requireSession(await getSession(request))));}catch(error){return failure(error);}}
