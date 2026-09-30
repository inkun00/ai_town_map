import { resourceVersion } from "@/domain/resource-version";
import { NextRequest } from "next/server";
import { getSession,requireCsrf,requireSession } from "@/server/auth/session";
import { ApiError,failure,noContent, ok,readJson, requireUuid } from "@/server/http";
import { getMap } from "@/server/services/maps";
import { changeMapSettings,deleteMap,mapSettingsInput } from "@/server/services/operations";

export const runtime = "nodejs";

export async function GET(request: NextRequest, context: { params: Promise<{ mapId: string }> }) {
  try {
    const { mapId } = await context.params;
    return ok(await getMap(requireUuid(mapId), await getSession(request)));
  } catch (error) { return failure(error); }
}
export async function PATCH(request:NextRequest,context:{params:Promise<{mapId:string}>}){try{const {mapId}=await context.params;const session=requireSession(await getSession(request));requireCsrf(request,session);const version=resourceVersion(request.headers);if(!version)throw new ApiError(428,"VERSION_REQUIRED","지도를 다시 열어 주세요.");const input=mapSettingsInput.parse(await readJson(request));return ok(await changeMapSettings(requireUuid(mapId),session,version,input));}catch(error){return failure(error);}}
export async function DELETE(request:NextRequest,context:{params:Promise<{mapId:string}>}){try{const {mapId}=await context.params;const session=requireSession(await getSession(request));requireCsrf(request,session);const version=resourceVersion(request.headers);if(!version)throw new ApiError(428,"VERSION_REQUIRED","지도를 다시 열어 주세요.");await deleteMap(requireUuid(mapId),session,version);return noContent();}catch(error){return failure(error);}}
