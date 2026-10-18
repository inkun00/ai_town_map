import { NextRequest } from "next/server";
import { failure, ok } from "@/server/http";
import { getWeather } from "@/server/services/weather";

export const runtime = "nodejs";
export const maxDuration = 60;
export async function GET(request: NextRequest) {
  try {
    const parameters = request.nextUrl.searchParams;
    return ok(await getWeather({ regionId: parameters.get("regionId"), start: parameters.get("start"), end: parameters.get("end"), period: parameters.get("period") ?? "day" }));
  } catch (error) { return failure(error); }
}
