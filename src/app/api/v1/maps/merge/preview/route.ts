import {NextRequest} from "next/server";
import {getSession,requireCsrf,requireSession} from "@/server/auth/session";
import {failure,ok,readJson} from "@/server/http";
import {mergePreviewSchema,previewMapMerge} from "@/server/services/map-merge";

export const runtime="nodejs";
export async function POST(request:NextRequest){
  try{const session=requireSession(await getSession(request));requireCsrf(request,session);return ok(await previewMapMerge(mergePreviewSchema.parse(await readJson(request)),session));}
  catch(error){return failure(error);}
}
