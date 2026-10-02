import {NextRequest} from "next/server";
import {getSession,requireSession,requireCsrf} from "@/server/auth/session";
import {failure,ok,readJson} from "@/server/http";
import {registerAccount} from "@/server/services/accounts";
import {registrationSchema} from "@/domain/account";
export const runtime="nodejs";
export async function POST(request:NextRequest){try{
 const session=requireSession(await getSession(request));requireCsrf(request,session);
 return ok(await registerAccount(session,registrationSchema.parse(await readJson(request)).role));
}catch(e){return failure(e);}}
