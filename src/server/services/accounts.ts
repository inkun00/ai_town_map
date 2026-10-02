import "server-only";
import type {PoolClient} from "pg";
import type {AppSession} from "@/server/auth/session";
import {withTransaction} from "@/server/db";
import {ApiError} from "@/server/http";
import type {AccountRole} from "@/domain/account";

export async function accountRole(client:PoolClient,session:AppSession|null):Promise<AccountRole|null>{
  if(session?.kind!=="account")return null;
  const r=await client.query<{account_role:AccountRole|null}>("SELECT account_role FROM app.principals WHERE id=$1 AND kind='account' AND status='active'",[session.principalId]);
  return r.rows[0]?.account_role??null;
}
export async function requireTeacher(client:PoolClient,session:AppSession){
  if(await accountRole(client,session)!=="teacher")throw new ApiError(403,"TEACHER_REQUIRED","회원가입에서 교사로 등록한 회원만 지도를 만들 수 있습니다.");
}
export async function registerAccount(session:AppSession,role:AccountRole){
  return withTransaction(async client=>{
    const r=await client.query<{account_role:AccountRole|null}>("SELECT account_role FROM app.principals WHERE id=$1 AND kind='account' AND status='active' FOR UPDATE",[session.principalId]);
    const p=r.rows[0];if(!p||session.kind!=="account")throw new ApiError(403,"ACCOUNT_REQUIRED","회원가입에는 Google 로그인이 필요합니다.");
    if(p.account_role&&p.account_role!==role)throw new ApiError(409,"ROLE_ALREADY_SET","가입할 때 선택한 회원 유형은 이 화면에서 변경할 수 없습니다.");
    if(!p.account_role)await client.query("UPDATE app.principals SET account_role=$2 WHERE id=$1",[session.principalId,role]);
    return {accountRole:role,canCreateMap:role==="teacher"};
  });
}
