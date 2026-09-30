import { isIP } from "node:net";

export function inviteAttemptActor(
  headers: Pick<Headers, "get">,
  environment: { NODE_ENV?: string; VERCEL?: string; TRUSTED_CLIENT_IP_HEADER?: string },
): string | undefined {
  const configured = environment.TRUSTED_CLIENT_IP_HEADER?.trim().toLowerCase();
  const header = configured || (environment.VERCEL === "1" ? "x-vercel-forwarded-for" : undefined);
  if (environment.NODE_ENV === "production" && !header) return undefined;
  const candidate = header ? headers.get(header)?.trim() : undefined;
  return candidate && isIP(candidate) ? candidate : "global";
}
