import {NextRequest} from "next/server";
import {failure,ok} from "@/server/http";
import {getMapBoundaries} from "@/server/services/map-boundaries";

export const runtime="nodejs";
export async function GET(request:NextRequest){
  try{
    const response=ok(await getMapBoundaries(request.nextUrl.searchParams.get("bounds")));
    response.headers.set("Cache-Control","public, max-age=86400");
    return response;
  }catch(error){return failure(error);}
}
