import {NextRequest} from "next/server";
import {z} from "zod";
import {getSession,requireSession,requireCsrf} from "@/server/auth/session";
import {failure,readJson,requireUuid} from "@/server/http";
import {filterSchema} from "@/domain/analysis";
import {exportCsv} from "@/server/services/analysis";
export const runtime="nodejs";
const schema=z.strictObject({filter:filterSchema,includeAuthor:z.boolean().default(false),includeCoordinates:z.boolean().default(false)});
export async function POST(request:NextRequest,{params}:{params:Promise<{mapId:string}>}){try{const {mapId}=await params;const session=requireSession(await getSession(request));requireCsrf(request,session);const input=schema.parse(await readJson(request));const csv=await exportCsv(requireUuid(mapId),session,input.filter,input.includeAuthor,input.includeCoordinates);return new Response(csv,{headers:{"Content-Type":"text/csv; charset=utf-8","Content-Disposition":'attachment; filename="community-records.csv"',"Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});}catch(error){return failure(error);}}
