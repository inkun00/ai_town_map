import {StudentEmailAuth} from "@/components/StudentEmailAuth";
import {safeReturnTo} from "@/server/http";

export default async function Page({searchParams}:{searchParams:Promise<{returnTo?:string|string[]}>}){
  const params=await searchParams;
  const returnTo=safeReturnTo(typeof params.returnTo==="string"?params.returnTo:null);
  return <StudentEmailAuth mode="signup" returnTo={returnTo}/>;
}
