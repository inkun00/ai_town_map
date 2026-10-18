import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { getTravelRouter } from "../src/server/routing/kakao";

const origin = { lat: 37.3947, lng: 127.1101 };
const destination = { lat: 37.4019, lng: 127.1082 };
const fetchMock = vi.fn<typeof fetch>();
const fixture = () => ({ routes: [{ result_code: 0, summary: { distance: 1033, duration: 297 }, sections: [{ roads: [
  { vertexes: [127.1101, 37.3947, 127.1096, 37.3944] },
  { vertexes: [127.1086, 37.4024, 127.1082, 37.4019] },
] }] }] });
const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { "content-type": "application/json" } });
const run = () => getTravelRouter().route(origin, destination, "car");

beforeEach(() => {
  vi.stubEnv("KAKAO_REST_API_KEY", "test-server-key-never-in-errors");
  vi.stubEnv("KAKAO_WALKING_ENABLED", "false");
  vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockReset();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Kakao travel router", () => {
  it("requires a server REST key and never substitutes the public map key", () => {
    vi.stubEnv("KAKAO_REST_API_KEY", " ");
    vi.stubEnv("NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY", "unrelated-public-key");
    expect(() => getTravelRouter()).toThrowError(expect.objectContaining({ status: 503, code: "TRAVEL_NOT_CONFIGURED", message: "자동차 길찾기 연결 설정이 필요합니다." }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the standard car endpoint and preserves separate real road paths", async () => {
    fetchMock.mockResolvedValue(respond(fixture()));
    const router = getTravelRouter(), result = await router.route(origin, destination, "car");
    expect(router.provider).toBe("Kakao");
    expect(router.credit).toContain("카카오모빌리티");
    expect(result).toEqual({ status: "ready", distanceMeters: 1033, durationSeconds: 297, paths: [[origin, { lng: 127.1096, lat: 37.3944 }], [{ lng: 127.1086, lat: 37.4024 }, destination]] });
    const [input, options] = fetchMock.mock.calls[0], url = new URL(String(input));
    expect(url.origin + url.pathname).toBe("https://apis-navi.kakaomobility.com/v1/directions");
    expect(url.searchParams.get("origin")).toBe("127.1101,37.3947");
    expect(url.searchParams.get("destination")).toBe("127.1082,37.4019");
    expect(url.searchParams.get("summary")).toBe("false");
    expect(url.searchParams.get("alternatives")).toBe("false");
    expect(String(input)).not.toContain("test-server-key");
    expect(options).toMatchObject({ method: "GET", cache: "no-store", redirect: "error", headers: { Authorization: "KakaoAK test-server-key-never-in-errors" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not fetch walking routes before partnership approval", async () => {
    expect(await getTravelRouter().route(origin, destination, "walk")).toEqual({ status: "unavailable", paths: [], distanceMeters: null, durationSeconds: null, message: "도보 길찾기는 제휴 승인 후 이용할 수 있어요." });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses only the affiliate walking endpoint when explicitly enabled", async () => {
    vi.stubEnv("KAKAO_WALKING_ENABLED", "true"); fetchMock.mockResolvedValue(respond(fixture()));
    expect((await getTravelRouter().route(origin, destination, "walk")).status).toBe("ready");
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.pathname).toBe("/affiliate/walking/v1/directions");
    expect(url.searchParams.get("priority")).toBe("DISTANCE");
  });

  it.each([null, [], "provider-secret", {}, { routes: null }, { routes: [] }, { routes: [null] }, { routes: [{ result_code: "0" }] }])("rejects malformed root and route objects: %j", async payload => {
    fetchMock.mockResolvedValue(respond(payload));
    await expect(run()).rejects.toMatchObject({ status: 502, code: "TRAVEL_RESPONSE_INVALID" });
  });

  it.each([null, "12", -1, Infinity])("rejects invalid summary values %j", async value => {
    const payload = fixture(); (payload.routes[0].summary as Record<string, unknown>).distance = value;
    fetchMock.mockResolvedValue(respond(payload));
    await expect(run()).rejects.toMatchObject({ status: 502 });
  });

  it.each([[127, 37, 127], ["127", 37, 128, 38], [127, null, 128, 38], [181, 37, 128, 38], [127, 91, 128, 38]].map(vertexes => ({ vertexes })))("rejects odd, nonnumeric and out-of-range vertexes $vertexes", async ({ vertexes }) => {
    const payload = fixture(); (payload.routes[0].sections[0].roads[0] as Record<string, unknown>).vertexes = vertexes;
    fetchMock.mockResolvedValue(respond(payload));
    await expect(run()).rejects.toMatchObject({ status: 502 });
  });

  it("reports a provider no-route result without echoing its message", async () => {
    fetchMock.mockResolvedValue(respond({ routes: [{ result_code: 104, result_msg: "test-server-key-never-in-errors" }] }));
    const result = await run();
    expect(result.status).toBe("unavailable"); expect(result.paths).toEqual([]);
    expect(JSON.stringify(result)).not.toContain("test-server-key");
  });

  it("returns no geometry or invented time for empty or degenerate roads", async () => {
    const payload = fixture(); payload.routes[0].sections[0].roads = [{ vertexes: [] }, { vertexes: [127, 37, 127, 37] }];
    fetchMock.mockResolvedValue(respond(payload));
    expect(await run()).toMatchObject({ status: "unavailable", paths: [], distanceMeters: null, durationSeconds: null });
  });

  it("rejects more than 10,000 coordinates without returning partial paths", async () => {
    const payload = fixture(); payload.routes[0].sections[0].roads[0].vertexes = Array.from({ length: 10_001 }, () => [127, 37]).flat();
    fetchMock.mockResolvedValue(respond(payload));
    await expect(run()).rejects.toMatchObject({ status: 502 });
  });

  it.each([[401, 503, "TRAVEL_PROVIDER_AUTH"], [403, 503, "TRAVEL_PROVIDER_AUTH"], [429, 429, "TRAVEL_RATE_LIMITED"], [500, 502, "TRAVEL_PROVIDER_UNAVAILABLE"]])("sanitizes HTTP status %s and ignores provider error bodies", async (http, status, code) => {
    fetchMock.mockResolvedValue(respond({ message: "test-server-key-never-in-errors" }, http));
    await expect(run()).rejects.toMatchObject({ status, code });
    fetchMock.mockResolvedValue(respond({ message: "test-server-key-never-in-errors" }, http));
    await expect(run()).rejects.not.toThrow(/test-server-key/);
  });

  it("sanitizes body-level authentication errors", async () => {
    fetchMock.mockResolvedValue(respond({ code: -401, msg: "test-server-key-never-in-errors" }));
    await expect(run()).rejects.toMatchObject({ status: 503, code: "TRAVEL_PROVIDER_AUTH" });
  });

  it("limits responses with and without Content-Length", async () => {
    fetchMock.mockResolvedValue(new Response("unused", { headers: { "content-length": String(2 * 1024 * 1024 + 1) } }));
    await expect(run()).rejects.toMatchObject({ status: 502 });
    fetchMock.mockResolvedValue(new Response("x".repeat(2 * 1024 * 1024 + 1)));
    await expect(run()).rejects.toMatchObject({ status: 502 });
  });

  it("rejects invalid JSON and reflected network errors safely", async () => {
    fetchMock.mockResolvedValue(new Response("<html>test-server-key-never-in-errors</html>"));
    await expect(run()).rejects.toMatchObject({ code: "TRAVEL_RESPONSE_INVALID" });
    fetchMock.mockRejectedValue(new Error("test-server-key-never-in-errors"));
    await expect(run()).rejects.not.toThrow(/test-server-key/);
  });

  it("aborts after eight seconds and makes no retry", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new Error("test-server-key-never-in-errors")), { once: true })));
    const promise = run(); const assertion = expect(promise).rejects.toMatchObject({ status: 504, code: "TRAVEL_REQUEST_CANCELLED" });
    await vi.advanceTimersByTimeAsync(8_000); await assertion;
    expect(fetchMock).toHaveBeenCalledTimes(1); expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates caller cancellation and rejects already-cancelled calls before fetch", async () => {
    const controller = new AbortController(); controller.abort();
    await expect(getTravelRouter().route(origin, destination, "car", controller.signal)).rejects.toMatchObject({ status: 499 });
    expect(fetchMock).not.toHaveBeenCalled();
    const running = new AbortController();
    fetchMock.mockImplementation((_url, options) => new Promise((_resolve, reject) => options?.signal?.addEventListener("abort", () => reject(new Error("cancelled")), { once: true })));
    const promise = getTravelRouter().route(origin, destination, "car", running.signal);
    const assertion = expect(promise).rejects.toMatchObject({ status: 499 }); running.abort(); await assertion;
  });

  it("validates input coordinates before any provider call", async () => {
    await expect(getTravelRouter().route({ lat: NaN, lng: 127 }, destination, "car")).rejects.toMatchObject({ status: 422 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
