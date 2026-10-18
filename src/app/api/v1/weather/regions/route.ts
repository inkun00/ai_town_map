import { NextRequest } from "next/server";
import { ApiError, failure, ok } from "@/server/http";
import { weatherRegion, weatherRegionChildren, WEATHER_REGION_SOURCE, WEATHER_REGION_UPDATED_AT } from "@/lib/weather-regions";

export const runtime = "nodejs";
export async function GET(request: NextRequest) {
  try {
    const parentId = request.nextUrl.searchParams.get("parentId");
    if (parentId && !weatherRegion(parentId)) throw new ApiError(404, "WEATHER_REGION_NOT_FOUND", "날씨 지역을 찾을 수 없습니다.");
    return ok({ items: weatherRegionChildren(parentId), source: WEATHER_REGION_SOURCE, updatedAt: WEATHER_REGION_UPDATED_AT });
  } catch (error) { return failure(error); }
}
