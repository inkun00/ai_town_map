export type MapPolicyInput = {
  visibility: "public" | "invite_only";
  status: "draft" | "active" | "archived" | "deleted";
  ownerPrincipalId: string;
};

export type MemberPolicyInput = { status: "active" | "blocked" | "left"; role: "admin" | "participant" } | null;

export function canReadMap(principalId: string | null, map: MapPolicyInput, member: MemberPolicyInput): boolean {
  if (map.status === "deleted") return false;
  if (map.status === "draft") return principalId === map.ownerPrincipalId;
  // Sharing settings govern contribution, not whether the map can be viewed.
  return true;
}

export function canManageMap(principalId: string | null, map: MapPolicyInput, member: MemberPolicyInput): boolean {
  if (!principalId || map.status === "deleted") return false;
  if (principalId === map.ownerPrincipalId) return true;
  return member?.status === "active" && member.role === "admin";
}
