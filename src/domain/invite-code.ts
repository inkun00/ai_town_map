import { randomBytes } from "node:crypto";

const alphabet = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

export function createInviteCode(): string {
  const bytes = randomBytes(12);
  return [...bytes].map((value) => alphabet[value % alphabet.length]).join("");
}

export function normalizedCode(value: string): string | null {
  const code = value.trim().toUpperCase().replaceAll("-", "").replaceAll(" ", "");
  return /^[0-9A-HJKMNP-TV-Z]{12}$/.test(code) ? code : null;
}
