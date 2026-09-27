import { NextRequest, NextResponse } from "next/server";
import sharp from "sharp";
import { getSession, requireCsrf, requireSession } from "@/server/auth/session";
import { ApiError, failure, ok, requireUuid } from "@/server/http";
import { photoAccess, savePhoto } from "@/server/services/observations";

export const runtime="nodejs";
type Context={params:Promise<{mapId:string;id:string}>};
export async function GET(request:NextRequest,{params}:Context) {
  try {
    const {mapId,id}=await params;
    const bytes=await photoAccess(requireUuid(mapId),requireUuid(id),await getSession(request));
    return new NextResponse(new Uint8Array(bytes),{headers:{"Content-Type":"image/webp","Cache-Control":"private, no-store","X-Content-Type-Options":"nosniff"}});
  } catch(error) { return failure(error); }
}
export async function POST(request:NextRequest,{params}:Context) {
  try {
    const {mapId,id}=await params; const session=requireSession(await getSession(request)); requireCsrf(request,session);
    const mime=request.headers.get("content-type")?.split(";")[0].trim().toLowerCase();
    if(!["image/jpeg","image/png","image/webp","image/heic","image/heif"].includes(mime??"")) throw new ApiError(415,"IMAGE_REQUIRED","JPG, PNG, WebP 또는 HEIC 사진을 선택해 주세요.");
    const size=Number(request.headers.get("content-length"));
    if(size>10*1024*1024) throw new ApiError(413,"IMAGE_TOO_LARGE","사진은 10MB 이하여야 합니다.");
    const source=Buffer.from(await request.arrayBuffer());
    if(!source.length || source.length>10*1024*1024) throw new ApiError(413,"IMAGE_TOO_LARGE","사진은 10MB 이하여야 합니다.");
    let content:Buffer;
    try { content=await sharp(source,{limitInputPixels:40_000_000}).rotate().resize({width:1600,height:1600,fit:"inside",withoutEnlargement:true}).webp({quality:78}).toBuffer(); }
    catch { throw new ApiError(415,"INVALID_IMAGE","사진을 읽을 수 없습니다."); }
    if(content.length>2*1024*1024) throw new ApiError(413,"IMAGE_TOO_LARGE","사진을 더 작게 선택해 주세요.");
    return ok(await savePhoto(requireUuid(mapId),requireUuid(id),session,content),201);
  } catch(error) { return failure(error); }
}
