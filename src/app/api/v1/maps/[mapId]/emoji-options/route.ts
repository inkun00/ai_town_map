import { resourceVersion } from "@/domain/resource-version";
import {NextRequest} from "next/server";
import {getSession,requireSession,requireCsrf} from "@/server/auth/session";
import {ApiError,failure,ok,readJson,requireUuid} from "@/server/http";
import {changeEmojiAvailability,emojiAvailabilityInput} from "@/server/services/operations";

export const runtime="nodejs";
export async function PATCH(request:NextRequest,{params}:{params:Promise<{mapId:string}>}){
  try {
    const {mapId}=await params;
    const session=requireSession(await getSession(request));requireCsrf(request,session);
    const version=resourceVersion(request.headers);
    if(!version)throw new ApiError(428,"VERSION_REQUIRED","지도 설정을 다시 열어 주세요.");
    return ok(await changeEmojiAvailability(requireUuid(mapId),session,version,emojiAvailabilityInput.parse(await readJson(request))));
  }catch(error){return failure(error);}
}
