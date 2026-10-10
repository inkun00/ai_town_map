import "server-only";
import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import { getServerConfig } from "@/server/env";

export const participationPasswordSchema = z.string().min(4).max(100).refine(value => value.trim().length > 0, "비밀번호를 입력해 주세요.");

export function mapCreationRequestHash(input: object & { participationPassword?: string }): Buffer {
  // A plain body hash would provide a fast offline verifier for low-entropy passwords.
  // Preserve old hashes for password-free retries and key password-bearing hashes with the server secret.
  const digest = input.participationPassword === undefined ? createHash("sha256") : createHmac("sha256", getServerConfig().invitePepper);
  return digest.update(JSON.stringify(input)).digest();
}

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(password, salt, 32, { N: 16384, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (error, key) => error ? reject(error) : resolve(key));
  });
}

/** Call while holding the map lock, or while creating a new map in a transaction. */
export async function setParticipationPassword(client: PoolClient, mapId: string, password: string | null, principalId: string) {
  if (password === null) {
    await client.query("DELETE FROM app_private.map_participation_passwords WHERE map_id=$1", [mapId]);
    return;
  }
  const salt = randomBytes(32), hash = await derive(participationPasswordSchema.parse(password), salt);
  await client.query(`INSERT INTO app_private.map_participation_passwords(map_id,salt,password_hash,updated_by)
    VALUES($1,$2,$3,$4) ON CONFLICT(map_id) DO UPDATE SET
    salt=EXCLUDED.salt,password_hash=EXCLUDED.password_hash,updated_by=EXCLUDED.updated_by,updated_at=now()`, [mapId, salt, hash, principalId]);
}

export async function verifyParticipationPassword(client: PoolClient, mapId: string, password: string): Promise<boolean> {
  const { rows } = await client.query<{ salt: Buffer; password_hash: Buffer }>("SELECT salt,password_hash FROM app_private.map_participation_passwords WHERE map_id=$1", [mapId]);
  const stored = rows[0];
  // Derive even when no password is enabled to avoid exposing password state through timing.
  const candidate = await derive(password, stored?.salt ?? Buffer.alloc(32));
  return !!stored && timingSafeEqual(candidate, stored.password_hash);
}
