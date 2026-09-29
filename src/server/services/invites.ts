import "server-only";
import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { z } from "zod";
import { query, withTransaction } from "../db";
import { getServerConfig } from "../env";
import { ApiError } from "../http";
import { issueSession, type AppSession } from "../auth/session";
import { createInviteCode, normalizedCode } from "@/domain/invite-code";
import { getManageableMap } from "./maps";

function codeHash(code: string): Buffer { return createHmac("sha256", getServerConfig().invitePepper).update(`invite:${code}`).digest(); }
function actorHash(value: string): Buffer { return createHmac("sha256", getServerConfig().invitePepper).update(`attempt:${value}`).digest(); }

export const createInviteSchema = z.strictObject({
  maxUses: z.number().int().min(1).max(1000).default(30),
  expiresAt: z.iso.datetime({ offset: true }).optional(),
});
export const redeemSchema = z.strictObject({ code: z.string().min(12).max(20), nickname: z.string().trim().min(2).max(20) });

export async function recordInviteAttempt(request: NextRequest) {
  const headerName = process.env.TRUSTED_CLIENT_IP_HEADER?.toLowerCase();
  if (process.env.NODE_ENV === "production" && !headerName) throw new ApiError(503, "INVITE_LIMIT_NOT_CONFIGURED", "초대 기능을 준비 중입니다.");
  const candidate = headerName ? request.headers.get(headerName) : null;
  const actor = candidate && /^[0-9a-fA-F:.]{3,45}$/.test(candidate) ? candidate : "global";
  const rows = await query<{ attempts: number }>(`INSERT INTO app_private.invite_attempts(actor_hash,window_start,attempts)
    VALUES($1,now(),1) ON CONFLICT(actor_hash) DO UPDATE SET
      attempts = CASE WHEN app_private.invite_attempts.window_start < now() - interval '10 minutes' THEN 1 ELSE app_private.invite_attempts.attempts + 1 END,
      window_start = CASE WHEN app_private.invite_attempts.window_start < now() - interval '10 minutes' THEN now() ELSE app_private.invite_attempts.window_start END
    RETURNING attempts`, [actorHash(actor)]);
  if (rows[0].attempts > 20) throw new ApiError(429, "INVITE_RATE_LIMIT", "잠시 후 다시 시도해 주세요.");
}

export async function createInvite(mapId: string, session: AppSession, input: z.infer<typeof createInviteSchema>) {
  const now = Date.now();
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : new Date(now + 7 * 24 * 60 * 60 * 1000);
  if (expiresAt.getTime() <= now || expiresAt.getTime() > now + 30 * 24 * 60 * 60 * 1000) throw new ApiError(422, "INVALID_EXPIRY", "초대 만료일을 확인해 주세요.");
  return withTransaction(async (client) => {
    const map = await getManageableMap(client, mapId, session);
    if (map.status !== "active") throw new ApiError(409, "MAP_CLOSED", "현재 초대할 수 없는 지도입니다.");
    const raw = createInviteCode();
    const result = await client.query<{ id: string }>(`INSERT INTO app_private.invites(map_id,code_hmac,expires_at,max_uses,created_by)
      VALUES($1,$2,$3,$4,$5) RETURNING id`, [mapId, codeHash(raw), expiresAt, input.maxUses, session.principalId]);
    return { id: result.rows[0].id, code: `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`, expiresAt, maxUses: input.maxUses, joinUrl: `${getServerConfig().appOrigin}/join#code=${raw}` };
  });
}

export async function listInvites(mapId: string, session: AppSession) {
  return withTransaction(async (client) => {
    await getManageableMap(client, mapId, session);
    const result = await client.query<{ id: string; expires_at: Date; revoked_at: Date | null; max_uses: number; uses: number; created_at: Date }>(
      "SELECT id,expires_at,revoked_at,max_uses,uses,created_at FROM app_private.invites WHERE map_id=$1 ORDER BY created_at DESC LIMIT 50", [mapId]);
    return result.rows.map((row) => ({ id: row.id, expiresAt: row.expires_at, revokedAt: row.revoked_at, maxUses: row.max_uses, uses: row.uses, createdAt: row.created_at }));
  });
}

export async function revokeInvite(mapId: string, inviteId: string, session: AppSession) {
  return withTransaction(async (client) => {
    await getManageableMap(client, mapId, session);
    const result = await client.query("UPDATE app_private.invites SET revoked_at=now() WHERE id=$1 AND map_id=$2 AND revoked_at IS NULL", [inviteId, mapId]);
    if (!result.rowCount) throw new ApiError(404, "NOT_FOUND", "초대를 찾을 수 없습니다.");
  });
}

export async function redeemInvite(input: z.infer<typeof redeemSchema>, existing: AppSession | null) {
  const code = normalizedCode(input.code);
  if (!code) throw new ApiError(422, "INVITE_INVALID", "초대 코드를 확인해 주세요.");
  return withTransaction(async (client) => {
    const found = await client.query<{ id: string; map_id: string; expires_at: Date; revoked_at: Date | null; max_uses: number; uses: number; status: string }>(
      `SELECT i.id,i.map_id,i.expires_at,i.revoked_at,i.max_uses,i.uses,m.status
         FROM app_private.invites i JOIN app.maps m ON m.id=i.map_id
        WHERE i.code_hmac=$1 FOR UPDATE OF i`, [codeHash(code)]);
    const invite = found.rows[0];
    if (!invite || invite.status === "deleted") throw new ApiError(422, "INVITE_INVALID", "초대 코드를 확인해 주세요.");
    if (invite.revoked_at) throw new ApiError(422, "INVITE_REVOKED", "개설자가 사용을 중지한 초대입니다. 새 초대 코드를 요청해 주세요.");
    if (invite.expires_at.getTime() <= Date.now()) throw new ApiError(422, "INVITE_EXPIRED", "초대 기한이 지났습니다. 개설자에게 새 초대 코드를 요청해 주세요.");
    if (invite.status !== "active") throw new ApiError(422, "MAP_CLOSED", "보관 중인 지도입니다. 개설자에게 지도 재개를 요청해 주세요.");
    if (existing) {
      const membership = await client.query<{ status: string }>("SELECT status FROM app.map_members WHERE map_id=$1 AND principal_id=$2 FOR UPDATE", [invite.map_id, existing.principalId]);
      if (membership.rows[0]?.status === "active") return { mapId: invite.map_id, session: null, repeated: true };
      if (membership.rows[0]) throw new ApiError(403, "MEMBERSHIP_BLOCKED", "이 지도에 참여할 수 없습니다.");
    }
    if (invite.uses >= invite.max_uses) throw new ApiError(409, "INVITE_EXHAUSTED", "초대 사용 횟수가 모두 찼습니다.");
    let principalId = existing?.principalId;
    if (!principalId) {
      const created = await client.query<{ id: string }>("INSERT INTO app.principals(kind) VALUES('guest') RETURNING id");
      principalId = created.rows[0].id;
    }
    await client.query("INSERT INTO app.map_members(map_id,principal_id,nickname) VALUES($1,$2,$3)", [invite.map_id, principalId, input.nickname]);
    await client.query("UPDATE app_private.invites SET uses=uses+1 WHERE id=$1", [invite.id]);
    const issued = existing ? null : await issueSession(client, principalId);
    return { mapId: invite.map_id, session: issued, repeated: false };
  });
}
