import {z} from "zod";
export const accountRoles=["teacher","student","member"] as const;
export type AccountRole=typeof accountRoles[number];
export const accountRoleLabels:Record<AccountRole,string>={teacher:"교사",student:"학생",member:"일반회원"};
export const registrationSchema=z.strictObject({role:z.enum(accountRoles)});
