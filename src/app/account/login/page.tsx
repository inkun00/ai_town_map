import {StudentEmailAuth} from "@/components/StudentEmailAuth";
import {safeReturnTo} from "@/server/http";

export default async function Page({searchParams}:{searchParams:Promise<{returnTo?:string|string[];method?:string|string[];confirmed?:string|string[];error?:string|string[];emailError?:string|string[]}>}){
  const params=await searchParams;
  const returnTo=safeReturnTo(typeof params.returnTo==="string"?params.returnTo:null);
  const confirmed=params.confirmed==="1",confirmationError=params.emailError==="1"||(typeof params.error==="string"&&params.error.length>0);
  const method=params.method==="email"||confirmed||confirmationError?"email":"student";
  return <StudentEmailAuth mode="login" method={method} returnTo={returnTo} confirmed={confirmed} confirmationError={confirmationError}/>;
}
