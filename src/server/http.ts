import "server-only";
import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { ZodError } from "zod";
import { getServerConfig } from "./env";

export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string, public fields?: { path: string; code: string }[]) { super(message); }
}

function headers() { return { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" }; }

export function ok(data: unknown, status = 200): NextResponse {
  return NextResponse.json({ data, meta: { requestId: randomUUID() } }, { status, headers: headers() });
}

export function noContent(): NextResponse { return new NextResponse(null, { status: 204, headers: headers() }); }

export function failure(error: unknown): NextResponse {
  const known = error instanceof ApiError ? error : error instanceof ZodError ? new ApiError(422, "VALIDATION_ERROR", "입력값을 확인해 주세요.", error.issues.map((issue) => ({ path: issue.path.join("."), code: issue.code }))) : null;
  const status = known?.status ?? (error instanceof Error && /Missing server configuration/.test(error.message) ? 503 : 500);
  const code = known?.code ?? (status === 503 ? "SERVICE_UNAVAILABLE" : "INTERNAL_ERROR");
  const message = known?.message ?? (status === 503 ? "서비스 설정이 아직 완료되지 않았습니다." : "요청을 처리하지 못했습니다.");
  if (!known && status === 500) console.error("API failure", error instanceof Error ? error.name : "Unknown");
  return NextResponse.json({ error: { code, message, ...(known?.fields ? { fields: known.fields } : {}) }, meta: { requestId: randomUUID() } }, { status, headers: { ...headers(), ...(status === 429 ? { "Retry-After": "600" } : {}) } });
}

export function requireSameOrigin(request: NextRequest): void {
  const expected = getServerConfig().appOrigin;
  const origin = request.headers.get("origin");
  if (!origin || origin !== expected) throw new ApiError(403, "ORIGIN_INVALID", "허용되지 않은 요청입니다.");
}

export async function readJson(request: NextRequest): Promise<unknown> {
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new ApiError(415, "JSON_REQUIRED", "JSON 요청만 허용합니다.");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError(422, "BODY_REQUIRED", "요청 본문이 없습니다.");
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 256 * 1024) { await reader.cancel(); throw new ApiError(413, "BODY_TOO_LARGE", "요청 크기가 제한을 초과했습니다."); }
    chunks.push(value);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")); }
  catch { throw new ApiError(422, "INVALID_JSON", "JSON 형식이 올바르지 않습니다."); }
}

export function safeReturnTo(input: string | null): string {
  if (!input || !input.startsWith("/") || input.startsWith("//") || input.includes("\\") || /[\r\n]/.test(input)) return "/";
  return input;
}

export function requireUuid(input: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input)) throw new ApiError(404, "NOT_FOUND", "대상을 찾을 수 없습니다.");
  return input;
}
