import AccountSetup from "@/components/AccountSetup";
import {safeReturnTo} from "@/server/http";
export default async function Page({searchParams}:{searchParams:Promise<{returnTo?:string}>}){
 const returnTo=safeReturnTo((await searchParams).returnTo??null);
 // Avoid nesting the setup URL when OAuth returns to this page.
 return <AccountSetup returnTo={returnTo.startsWith("/account/setup")?"/":returnTo}/>;
}
