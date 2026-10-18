import "server-only";
import { readBoundedBody } from "@/lib/read-bounded-body";
import { ApiError } from "@/server/http";

export type RouteLocation = { lat: number; lng: number };
export type KakaoRoutingResult = {
  status: "ready" | "unavailable";
  paths: RouteLocation[][];
  distanceMeters: number | null;
  durationSeconds: number | null;
  message?: string;
};

const responseLimit = 2 * 1024 * 1024;
const coordinateLimit = 10_000;
const requestTimeout = 8_000;
const unavailableMessage = "이 구간의 이동 경로를 찾지 못했어요.";

function unavailable(): KakaoRoutingResult {
  return { status: "unavailable", paths: [], distanceMeters: null, durationSeconds: null, message: unavailableMessage };
}

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function coordinate(value: unknown, maximum: number): value is number {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) <= maximum;
}

function location(value: RouteLocation): boolean {
  return record(value) && coordinate(value.lat, 90) && coordinate(value.lng, 180);
}

function amount(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER;
}

function invalidResponse(): ApiError {
  return new ApiError(502, "TRAVEL_RESPONSE_INVALID", "길찾기 응답을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.");
}

function providerError(status: number): ApiError {
  if (status === 401 || status === 403) return new ApiError(503, "TRAVEL_PROVIDER_AUTH", "길찾기 연결 권한을 확인해야 합니다.");
  if (status === 429) return new ApiError(429, "TRAVEL_RATE_LIMITED", "길찾기 요청이 많아요. 잠시 후 다시 시도해 주세요.");
  return new ApiError(502, "TRAVEL_PROVIDER_UNAVAILABLE", "길찾기 서비스에 연결하지 못했어요. 잠시 후 다시 시도해 주세요.");
}

/** Keep each road separate: never bridge gaps with invented straight lines. */
function parseRoute(payload: unknown): KakaoRoutingResult {
  if (!record(payload)) throw invalidResponse();
  if (typeof payload.code === "number" && payload.code !== 0) {
    if (payload.code === -401) throw providerError(401);
    if (payload.code === -429) throw providerError(429);
    throw invalidResponse();
  }
  if (!Array.isArray(payload.routes) || payload.routes.length !== 1 || !record(payload.routes[0])) throw invalidResponse();
  const route = payload.routes[0];
  if (typeof route.result_code !== "number" || !Number.isSafeInteger(route.result_code)) throw invalidResponse();
  if (route.result_code !== 0) return unavailable();
  if (!record(route.summary) || !amount(route.summary.distance) || !amount(route.summary.duration) || !Array.isArray(route.sections)) throw invalidResponse();
  const paths: RouteLocation[][] = [];
  let coordinates = 0;
  for (const section of route.sections) {
    if (!record(section) || !Array.isArray(section.roads)) throw invalidResponse();
    for (const road of section.roads) {
      if (!record(road) || !Array.isArray(road.vertexes) || road.vertexes.length % 2 !== 0) throw invalidResponse();
      coordinates += road.vertexes.length / 2;
      if (coordinates > coordinateLimit) throw invalidResponse();
      const path: RouteLocation[] = [];
      for (let index = 0; index < road.vertexes.length; index += 2) {
        const lng = road.vertexes[index], lat = road.vertexes[index + 1];
        if (!coordinate(lng, 180) || !coordinate(lat, 90)) throw invalidResponse();
        const previous = path[path.length - 1];
        if (!previous || previous.lat !== lat || previous.lng !== lng) path.push({ lat, lng });
      }
      if (path.length >= 2) paths.push(path);
    }
  }
  if (!paths.length) return unavailable();
  return { status: "ready", paths, distanceMeters: route.summary.distance, durationSeconds: route.summary.duration };
}

/** One leg makes at most one request. Only server headers receive the REST key. */
export function getTravelRouter() {
  const key = process.env.KAKAO_REST_API_KEY?.trim();
  if (!key || /replace[-_ ]?me|replace[-_ ]?with|your[-_]?(?:api|key)/i.test(key)) {
    throw new ApiError(503, "TRAVEL_NOT_CONFIGURED", "자동차 길찾기 연결 설정이 필요합니다.");
  }
  return {
    provider: "Kakao" as const,
    credit: "길찾기: 카카오모빌리티",
    async route(from: RouteLocation, to: RouteLocation, mode: "car", signal?: AbortSignal): Promise<KakaoRoutingResult> {
      if (mode !== "car") throw new ApiError(422, "TRAVEL_MODE_UNSUPPORTED", "지원하는 길찾기 요청인지 확인해 주세요.");
      if (!location(from) || !location(to)) throw new ApiError(422, "TRAVEL_COORDINATES_INVALID", "이동할 위치를 확인해 주세요.");
      const controller = new AbortController();
      const abort = () => controller.abort();
      if (signal?.aborted) abort(); else signal?.addEventListener("abort", abort, { once: true });
      const timer = setTimeout(abort, requestTimeout);
      try {
        if (controller.signal.aborted) throw new Error("Cancelled");
        const url = new URL("https://apis-navi.kakaomobility.com/v1/directions");
        url.searchParams.set("origin", `${from.lng},${from.lat}`);
        url.searchParams.set("destination", `${to.lng},${to.lat}`);
        url.searchParams.set("summary", "false");
        url.searchParams.set("priority", "RECOMMEND");
        url.searchParams.set("alternatives", "false");
        const response = await fetch(url.toString(), {
          method: "GET", cache: "no-store", redirect: "error", signal: controller.signal,
          headers: { Authorization: `KakaoAK ${key}`, Accept: "application/json", "Content-Type": "application/json" },
        });
        if (!response.ok) {
          await response.body?.cancel();
          throw providerError(response.status);
        }
        const length = response.headers.get("content-length");
        if (length && Number(length) > responseLimit) {
          await response.body?.cancel();
          throw invalidResponse();
        }
        const bytes = await readBoundedBody(response.body, responseLimit);
        return parseRoute(JSON.parse(bytes.toString("utf8")));
      } catch (error) {
        if (error instanceof ApiError) throw error;
        if (controller.signal.aborted) throw new ApiError(signal?.aborted ? 499 : 504, "TRAVEL_REQUEST_CANCELLED", signal?.aborted ? "길찾기 요청을 취소했어요." : "길찾기에 시간이 오래 걸려요. 다시 시도해 주세요.");
        throw invalidResponse();
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
      }
    },
  };
}
