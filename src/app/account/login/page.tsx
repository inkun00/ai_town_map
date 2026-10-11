import {StudentEmailAuth} from "@/components/StudentEmailAuth";
import {safeReturnTo} from "@/server/http";

export default async function Page({searchParams}:{searchParams:Promise<{returnTo?:string|string[];confirmed?:string|string[];error?:string|string[];emailError?:string|string[]}>}){
  const params=await searchParams;
  const returnTo=safeReturnTo(typeof params.returnTo==="string"?params.returnTo:null);
  return <StudentEmailAuth mode="login" returnTo={returnTo} confirmed={params.confirmed==="1"} confirmationError={params.emailError==="1"||(typeof params.error==="string"&&params.error.length>0)}/>;
}
