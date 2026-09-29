import "server-only";
import type { PoolClient, QueryResultRow } from "pg";
import type { AppSession } from "@/server/auth/session";
import { ApiError } from "@/server/http";
import { canReadMap } from "@/server/policies/maps";

export type CommunityMap = QueryResultRow & {
  id: string; owner_principal_id: string; visibility: "public" | "invite_only";
  status: "draft" | "active" | "archived" | "deleted";
  moderation: "immediate" | "approval"; participation: "invited" | "admin_only" | "closed";
  comments_enabled: boolean; proposals_enabled:boolean; version: string;
  member_id: string | null; member_role: "admin" | "participant" | null;
  member_status: "active" | "blocked" | "left" | null;
};

export async function communityMap(client: PoolClient, mapId: string, session: AppSession | null): Promise<CommunityMap> {
  const result = await client.query<CommunityMap>(`SELECT m.id,m.owner_principal_id,m.visibility,m.status,m.moderation,m.participation,m.comments_enabled,m.proposals_enabled,m.version,
    mm.id AS member_id,mm.role AS member_role,mm.status AS member_status
    FROM app.maps m LEFT JOIN app.map_members mm ON mm.map_id=m.id AND mm.principal_id=$2 WHERE m.id=$1`, [mapId,session?.principalId ?? null]);
  const map = result.rows[0];
  if (!map || !canReadMap(session?.principalId ?? null,{visibility:map.visibility,status:map.status,ownerPrincipalId:map.owner_principal_id},map.member_status ? {status:map.member_status,role:map.member_role!} : null)) throw new ApiError(404,"NOT_FOUND","지도를 찾을 수 없습니다.");
  return map;
}

export function isAdmin(map: CommunityMap, session: AppSession | null): boolean {
  return !!session && map.member_status === "active" && (map.owner_principal_id === session.principalId || map.member_role === "admin");
}

export function requireAdmin(map: CommunityMap, session: AppSession): void {
  if (!isAdmin(map,session)) throw new ApiError(403,"ADMIN_REQUIRED","지도 관리자만 할 수 있습니다.");
}

export function requireMember(map: CommunityMap): string {
  if (map.member_status !== "active" || !map.member_id) throw new ApiError(403,"MEMBERSHIP_REQUIRED","지도에 참여해야 합니다.");
  return map.member_id;
}

export async function audit(client: PoolClient, mapId: string, session: AppSession, action: string, targetType: string, targetId: string, reason?: string) {
  await client.query("INSERT INTO app.audit_events(map_id,actor_principal_id,action,target_type,target_id,reason) VALUES($1,$2,$3,$4,$5,$6)",[mapId,session.principalId,action,targetType,targetId,reason ?? null]);
}
