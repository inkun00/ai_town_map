import {NextRequest} from "next/server";
import {failure,ok} from "@/server/http";
import {getWeatherBoundaries} from "@/server/services/weather-boundaries";

export const runtime="nodejs";
export async function GET(request:NextRequest){
  try{
    const response=ok(await getWeatherBoundaries(request.nextUrl.searchParams.get("regionId")));
    response.headers.set("Cache-Control","public, max-age=86400");
    return response;
  }catch(error){return failure(error);}
}
