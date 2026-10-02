import {NextRequest} from "next/server";
import {getSession,requireSession,requireCsrf} from "@/server/auth/session";
import {failure,ok,readJson} from "@/server/http";
import {createGameSchema} from "@/domain/exploration-game";
import {createGame,listGames} from "@/server/services/exploration-games";
import {z} from "zod";
export const runtime="nodejs";
export async function GET(request:NextRequest){try{return ok(await listGames(await getSession(request),(request.nextUrl.searchParams.get("q")??"").slice(0,80),z.enum(["active","deleted"]).parse(request.nextUrl.searchParams.get("scope")??"active")));}catch(e){return failure(e);}}
export async function POST(request:NextRequest){try{const s=requireSession(await getSession(request));requireCsrf(request,s);return ok(await createGame(s,createGameSchema.parse(await readJson(request))),201);}catch(e){return failure(e);}}
