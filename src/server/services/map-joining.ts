import "server-only";
import { z } from "zod";
import { issueSession, type AppSession } from "@/server/auth/session";
import { withTransaction } from "@/server/db";
import { ApiError } from "@/server/http";
import { redeemInviteInTransaction } from "./invites";
import { participationPasswordSchema, verifyParticipationPassword } from "./map-passwords";

export const joinMapSchema = z.strictObject({
  nickname: z.string().trim().min(2).max(20),
  password: participationPasswordSchema.optional(),
  code: z.string().min(12).max(20).optional(),
}).refine(input => !(input.password !== undefined && input.code !== undefined), "비밀번호 또는 교사 인증코드 중 하나를 입력해 주세요.");

export async function joinMap(mapId: string, input: z.infer<typeof joinMapSchema>, existing: AppSession | null) {
  const parsed = joinMapSchema.parse(input);
  return withTransaction(async client => {
    const { rows } = await client.query<{ status: string; participation: string; visibility: "public" | "invite_only" }>(
      "SELECT status,participation,visibility FROM app.maps WHERE id=$1 FOR UPDATE", [mapId]);
    const map = rows[0];
    if (!map || map.status === "draft" || map.status === "deleted") throw new ApiError(404, "NOT_FOUND", "지도를 찾을 수 없습니다.");
    if (map.status !== "active") throw new ApiError(409, "MAP_CLOSED", "보관 중인 지도에는 새 포인트를 등록할 수 없습니다.");
    if (existing) {
      const member = await client.query<{ status: string }>("SELECT status FROM app.map_members WHERE map_id=$1 AND principal_id=$2 FOR UPDATE", [mapId, existing.principalId]);
      if (member.rows[0]?.status === "active") return { mapId, repeated: true, session: null };
      if (member.rows[0]) throw new ApiError(403, "MEMBERSHIP_BLOCKED", "이 지도에 참여할 수 없습니다.");
    }
    if (map.participation !== "invited") throw new ApiError(403, "WRITE_FORBIDDEN", "현재 이 지도는 새 포인트 등록 참여를 받지 않습니다.");
    if (map.visibility === "invite_only") {
      if (parsed.code !== undefined) return redeemInviteInTransaction(client, { nickname: parsed.nickname, code: parsed.code }, existing, mapId);
      if (parsed.password === undefined) throw new ApiError(403, "PARTICIPATION_AUTH_REQUIRED", "포인트를 등록하려면 지도 비밀번호 또는 교사 인증코드를 입력해 주세요.");
      if (!await verifyParticipationPassword(client, mapId, parsed.password)) throw new ApiError(403, "PARTICIPATION_PASSWORD_INVALID", "지도 비밀번호를 확인해 주세요.");
    }
    let principalId = existing?.principalId;
    if (!principalId) {
      const created = await client.query<{ id: string }>("INSERT INTO app.principals(kind) VALUES('guest') RETURNING id");
      principalId = created.rows[0].id;
    }
    await client.query("INSERT INTO app.map_members(map_id,principal_id,nickname) VALUES($1,$2,$3)", [mapId, principalId, parsed.nickname]);
    return { mapId, repeated: false, session: existing ? null : await issueSession(client, principalId) };
  });
}
