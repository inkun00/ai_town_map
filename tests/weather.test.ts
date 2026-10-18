import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aggregateWeather, emptyWeatherValues, koreanWeatherDate, summarizeWeather, weatherDistanceKm, weatherNumber, weatherQuerySchema, type WeatherDay } from "@/domain/weather";
import { weatherRegion, weatherRegionChildren } from "@/lib/weather-regions";
import { clearWeatherCacheForTests, getWeather, parseWeatherCurrent, parseWeatherDays, parseWeatherStations, parseWeatherTable } from "@/server/services/weather";

// Field names and units follow the official APIHub stn_inf / kma_sfcdd3 / kma_sfctm2 specifications.
// These short synthetic responses test parsing. They are not live observations or sample weather for users.
const stations = "#START7777\n# STN_ID LON LAT STN_KO\n112 126.6249 37.4777 인천\n108 126.9658 37.5714 서울\n#7777END";
const daily = "#START7777\n# YYMMDD STN TA_AVG TA_MIN TA_MAX RN_DAY HM_AVG WS_AVG CA_TOT SD_MAX SD_NEW SS_DAY\n# KST ID C C C mm % m/s tenth cm cm hr\n20261010 112 -9.0 -12.3 -2.1 0.0 50.0 2.3 1.0 0.0 0.0 8.0\n20261011 112 10.0 7.0 15.0 -9.0 -99.0 1.0 -9.0 -9.0 -9.0 -9.0\n20261010 108 3.0 1.0 5.0 12.0 80.0 4.5 9.0 0.0 0.0 1.0\n#7777END";
const current = "#START7777\n# YYMMDDHHMI STN TA RN_DAY HM WS CA_TOT SD_TOT\n202610181100 112 16.5 3.0 70.0 2.0 8.0 0.0\n#7777END";
// Public KMA responses received on 2026-10-18. Keep their fixed-width two-line headers:
// duplicate names identify different variables and WW may contain spaces.
const publishedStations = `#START7777
# STN           LON           LAT STN_SP          HT     HT_PA     HT_TA     HT_WD     HT_RN STN STN_KO               STN_EN               FCT_ID   LAW_ID    BASIN LAW_ADDR
#  ID         degee        degree --------         m         m         m         m         m  AD -------------------- -------------------- -------- ---------- ---- ----------------------------------------------------------
   90  128.56473000   38.25085000 35100        17.53     18.73      1.70     10.00      1.40  90 속초                 Sokcho               11D20401 5182033035 ---- 강원특별자치도 고성군 토성면 봉포리
   93  127.75443000   37.94738000 31201        95.78     96.78      1.50     10.00      1.40 101 북춘천               Bukchuncheon         11D10301 5111025024 ---- 강원특별자치도 춘천시 신북읍 산천리
#7777END`;
const publishedCurrent = `#START7777
# YYMMDDHHMI STN  WD   WS GST  GST  GST     PA     PS PT    PR    TA    TD    HM    PV     RN     RN     RN     RN     SD     SD     SD WC WP WW                      CA  CA   CH CT        CT  CT  CT    VS   SS    SI ST    TS    TE    TE    TE    TE  ST   WH BF IR IX
#        KST  ID  16  m/s  WD   WS   TM    hPa    hPa  -   hPa     C     C     %   hPa     mm    DAY    JUN    INT    HR3    DAY    TOT -- -- ---------------------- TOT MID  MIN -------- TOP MID LOW                  GD     C     5    10    20    30 SEA    m --  -  -
202610181800  90  18  1.6  25 16.0 1535 1007.3 1009.4  2   2.9  19.0  18.0  94.0  20.6    1.8    6.4    6.4   -9.0   -9.0   -9.0   -9.0 -9 -9 -                       10   1   11 -         -9  -9  -9   619  0.0  0.01 -9  19.1 -99.0 -99.0 -99.0 -99.0  -9 -9.0 -9  1 -9
202610181800 108  23  3.6  -9 -9.0   -9 1003.5 1013.5  2   2.8  18.6  17.2  92.0  19.6    1.7   51.4   51.4   -9.0   -9.0   -9.0   -9.0 61 66 01                      10   8    4 -         -9  -9  -9  1319  0.0  0.02 -9  17.6  18.6  19.4  19.5  19.7  -9 -9.0 -9  4  1
#7777END`;
const publishedDaily = `#START7777
# 11. TA_AVG        : 일 평균기온 (C)
# YYMMDD STN   WS    WR  WD   WS   WS  WD   WS   WS    TA    TA   TA    TA   TA    TD    TS    TG    HM    HM   HM    PV  EV_S  EV_L    FG     PA     PS     PS   PS     PS   PS   CA   SS   SS   SS    SI    SI   SI     RN     RN    RN     RN   RN     RN   RN     RN   RN     SD   SD     SD   SD    TE    TE    TE    TE    TE
#    KST  ID  AVG   DAY MAX  MAX  MAX INS  INS  INS   AVG   MAX  MAX   MIN  MIN   AVG   AVG   MIN   AVG   MIN  MIN   AVG               DUR    AVG    AVG    MAX  MAX    MIN  MIN  TOT  DAY  DUR  CMB   DAY   60M  60M    DAY    D99   DUR    60M  60M    10M  10M    POW  POW    NEW  NEW    MAX  MAX     5    10    15    30    50
20250101  90  3.3  2866  29  6.0   20  27 11.6 1025   4.5   8.0 1520  -0.5  357  -8.5   0.7  -4.9  38.8  22.0   15   3.3   3.0   2.1 -9.00 1017.7 1019.9 1021.3 2400 1018.0 1503  1.3  8.4  9.6 -9.0  9.22  1.59 1100   -9.0   -9.0 -9.00   -9.0   -9   -9.0   -9   -9.0   -9   -9.0   -9   -9.0   -9 -99.0 -99.0 -99.0 -99.0 -99.0
20250101 112  3.0  2625  25  5.9 1322  27  9.2 1350   3.1   7.7 1253  -1.4  105  -3.3   1.4  -6.2  63.1  45.0 2328   4.9   2.3   1.6 -9.00 1013.8 1022.5 1023.8 2343 1021.3 1359  2.0  7.0  9.6 -9.0  9.13  1.65 1300   -9.0   -9.0 -9.00   -9.0   -9   -9.0   -9   -9.0   -9   -9.0   -9   -9.0   -9   4.1   6.1   9.3  15.0  17.1
#7777END`;
const query = { regionId: "2800000000", start: "2026-10-10", end: "2026-10-11", period: "day" };
const day = (date: string, values: Partial<WeatherDay["values"]>, freshSnow: number | null = 0): WeatherDay => ({ date, values: { ...emptyWeatherValues(), ...values }, freshSnow });

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-18T03:30:00Z")); clearWeatherCacheForTests(); vi.stubEnv("KMA_API_KEY", "test-secret-do-not-expose"); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); clearWeatherCacheForTests(); });

describe("weather calendar and valid measurements", () => {
  it("uses Korean calendar dates across UTC midnight and validates real Gregorian dates", () => {
    expect(koreanWeatherDate(new Date("2026-10-17T15:00:00Z"))).toBe("2026-10-18");
    expect(weatherQuerySchema.safeParse({ ...query, start: "2026-02-30" }).success).toBe(false);
    expect(weatherQuerySchema.safeParse({ ...query, start: "2026-10-12" }).success).toBe(false);
    expect(weatherQuerySchema.safeParse({ ...query, end: "2026-10-19" }).success).toBe(false);
    expect(weatherQuerySchema.safeParse({ ...query, start: "2024-01-01", end: "2024-12-31" }).success).toBe(true);
    expect(weatherQuerySchema.safeParse({ ...query, start: "2024-01-01", end: "2025-01-01" }).success).toBe(false);
  });
  it("keeps valid negative temperatures while preserving missing precipitation", () => {
    expect(weatherNumber("-9.0", "temperature")).toBe(-9);
    expect(weatherNumber("-99.9", "temperature")).toBeNull();
    expect(weatherNumber("-9.0", "rainfall")).toBeNull();
    expect(weatherNumber("0.0", "rainfall")).toBe(0);
    expect(weatherNumber("", "rainfall")).toBeNull();
    expect(weatherNumber("101", "humidity")).toBeNull();
    expect(weatherNumber("11", "cloudCover")).toBeNull();
  });
  it("uses sums for precipitation/sunshine, extrema for max/min/snow, means elsewhere", () => {
    const result = summarizeWeather([day("2026-10-01", { temperature: 10, minTemperature: 8, maxTemperature: 12, rainfall: 2, sunshine: 3, snowDepth: 0 }), day("2026-10-02", { temperature: 20, minTemperature: 15, maxTemperature: 30, rainfall: 4, sunshine: 5, snowDepth: 2 })], 3);
    expect(result.values).toMatchObject({ temperature: 15, minTemperature: 8, maxTemperature: 30, rainfall: 6, sunshine: 8, snowDepth: 2, humidity: null });
    expect(result.metricDays.rainfall).toBe(2);
    expect(result.expectedDays).toBe(3);
    expect(result.observedDays).toBe(2);
  });
  it("preserves calendar gaps and clips Monday-week boundaries", () => {
    const series = aggregateWeather([day("2026-10-04", { rainfall: 5 }), day("2026-10-06", { rainfall: 2 })], "2026-10-04", "2026-10-06", "week");
    expect(series).toHaveLength(2);
    expect(series[0]).toMatchObject({ date: "2026-10-04", endDate: "2026-10-04", expectedDays: 1 });
    expect(series[1]).toMatchObject({ date: "2026-10-05", endDate: "2026-10-06", expectedDays: 2, observedDays: 1 });
    expect(aggregateWeather([], "2026-10-01", "2026-10-01", "day")[0].values.rainfall).toBeNull();
  });
  it("does not invent clear skies from absent rain/cloud observations", () => {
    const missing = summarizeWeather([day("2026-10-01", { temperature: 20 }, null)], 2);
    expect(missing.weatherCounts).toEqual({ clear: null, cloudy: null, rain: null, snow: null, unknown: 2 });
    const measured = summarizeWeather([day("2026-10-01", { rainfall: 0, cloudCover: 2 }), day("2026-10-02", { rainfall: 0, cloudCover: 8 }), day("2026-10-03", { rainfall: 1, cloudCover: 10 }, 3), day("2026-10-04", { rainfall: 0, cloudCover: 5 })], 4);
    expect(measured.weatherCounts).toEqual({ clear: 1, cloudy: 2, rain: 1, snow: 1, unknown: 1 });
    expect(summarizeWeather([day("2026-10-01", { cloudCover: 2 }, null)], 1).weatherCounts.clear).toBe(1);
  });
});

describe("official nationwide location hierarchy", () => {
  it("contains release-derived roots and current Incheon districts", () => {
    expect(weatherRegionChildren()).toHaveLength(16);
    const districts = weatherRegionChildren("2800000000");
    expect(districts).toHaveLength(11);
    expect(districts.map((region) => region.name)).toEqual(expect.arrayContaining(["제물포구", "영종구", "서해구", "검단구", "강화군", "옹진군"]));
    expect(districts.map((region) => region.name)).not.toEqual(expect.arrayContaining(["중구", "동구"]));
    expect(weatherRegionChildren("2812500000").length).toBeGreaterThan(0);
    expect(weatherRegionChildren("2812500000")[0].fullName).toContain("인천광역시 제물포구");
    expect(weatherRegion("1200000000")?.name).toBe("전남광주통합특별시");
    expect(weatherRegion("5019000000")).toBeUndefined();
  });
  it("keeps parent links and coordinates valid throughout all levels", () => {
    const all = weatherRegionChildren().flatMap((city) => [city, ...weatherRegionChildren(city.id).flatMap((district) => [district, ...weatherRegionChildren(district.id)])]);
    expect(all).toHaveLength(3836);
    expect(new Set(all.map((region) => region.id)).size).toBe(3836);
    for (const region of all) {
      expect(region.lat).toBeGreaterThan(32);
      expect(region.lat).toBeLessThan(40);
      if (region.parentId) expect(weatherRegion(region.parentId)).toBeDefined();
    }
    expect(weatherDistanceKm({ lat: 37, lng: 127 }, { lat: 37, lng: 127 })).toBe(0);
  });
});

describe("KMA parser and data service", () => {
  it("reads actual station ids and names despite repeated STN columns and multiword addresses", () => {
    expect(parseWeatherStations(publishedStations)).toEqual([
      { id: "90", name: "속초", lat: 38.25085, lng: 128.56473 },
      { id: "93", name: "북춘천", lat: 37.94738, lng: 127.75443 },
    ]);
  });
  it("finds station fields by their published names when unique headers are reordered", () => {
    expect(parseWeatherStations("# LAT STN_KO STN_ID LON\n37.4777 인천 112 126.6249")).toEqual([
      { id: "112", name: "인천", lat: 37.4777, lng: 126.6249 },
    ]);
  });
  it.each([
    "# STN_ID LON LAT STN_KO\n112 126.6249 37.4777",
    "# STN_ID LON LAT STN_KO\n112 not-a-number 37.4777 인천",
    "# STN_ID LON LAT STN_KO\n112 126.6249 Infinity 인천",
    "# STN_ID LON LAT STN_KO\n112 126.6249 0 인천",
    "# STN_ID LON LAT STN_KO\nnot-an-id 126.6249 37.4777 인천",
  ])("rejects incomplete or invalid station identity/coordinates: %s", (text) => {
    expect(parseWeatherStations(text)).toEqual([]);
  });
  it("uses live station metadata rather than the fallback when the actual SFC response succeeds", async () => {
    const fetch = vi.fn(async (url: URL) => new Response(url.pathname.endsWith("stn_inf.php") ? publishedStations : daily));
    vi.stubGlobal("fetch", fetch);
    const result = await getWeather(query);
    expect(result.configured).toBe(true);
    expect(result.items[0].station).toEqual({ id: "93", name: "북춘천", lat: 37.94738, lng: 127.75443 });
    expect(result.source).toContain("기상청 API허브");
    expect(result.source).not.toContain("공개 관측지점 이력");
    expect(result.notice).not.toContain("관측소 정보 API 대신");
    expect(fetch.mock.calls.filter(([url]) => url.pathname.endsWith("stn_inf.php"))).toHaveLength(1);
  });
  it("reads the actual two-line daily header without confusing values and observation times", () => {
    const parsed = parseWeatherDays(publishedDaily);
    expect(parsed.size).toBe(2);
    expect(parsed.get("112")?.[0]).toEqual({ date: "2025-01-01", freshSnow: null, values: { temperature: 3.1, minTemperature: -1.4, maxTemperature: 7.7, rainfall: null, humidity: 63.1, windSpeed: 3, cloudCover: 2, snowDepth: null, sunshine: 7 } });
    expect(parsed.get("90")?.[0].values).toMatchObject({ temperature: 4.5, minTemperature: -0.5, maxTemperature: 8, cloudCover: 1.3, sunshine: 8.4 });
  });
  it("accepts real daily time codes that overflow the published field widths without shifting later values", () => {
    // Public 2026-09-01 station 202 row: -2343/-2358 expand the two four-character time fields.
    const overflow = "20260901 202  0.7   638  16  2.9 1428  16  4.7 1427  22.6  24.5 1256  21.1 1655  21.9  24.7  21.6  96.1  83.0 1413  26.3  -9.0  -9.0 -9.00 1006.1 1011.5 1012.7  929 1010.3  200 10.0  0.0 13.0 -9.0 -9.00 -9.00   -9   29.6   -9.0 -9.00    9.8 -2343    3.7 -2358   -9.0   -9   -9.0   -9   -9.0   -9 -99.0 -99.0 -99.0 -99.0 -99.0";
    const text = [...publishedDaily.split("\n").filter((line) => line.startsWith("#") && line !== "#7777END"), overflow, "#7777END"].join("\n");
    expect(overflow).toHaveLength(325);
    expect(parseWeatherTable(text)[0]).toMatchObject({ RN_DAY: "29.6", RN_60M_2: "-2343", RN_10M_2: "-2358", TE_50: "-99.0" });
    expect(parseWeatherDays(text).get("202")?.[0]).toEqual({ date: "2026-09-01", freshSnow: null, values: { temperature: 22.6, minTemperature: 21.1, maxTemperature: 24.5, rainfall: 29.6, humidity: 96.1, windSpeed: 0.7, cloudCover: 10, snowDepth: null, sunshine: 0 } });
    expect(() => parseWeatherDays(text.replace(overflow, `${overflow} 123`))).toThrow();
  });
  it("reads actual current-day accumulation, cloud cover and KST timestamp from the two-line layout", () => {
    const parsed = parseWeatherCurrent(publishedCurrent);
    expect(parsed.size).toBe(2);
    expect(parsed.get("90")).toMatchObject({ observedAt: "2026-10-18T18:00:00+09:00", values: { temperature: 19, rainfall: 6.4, humidity: 94, windSpeed: 1.6, cloudCover: 10, snowDepth: null } });
    expect(parsed.get("108")?.values.rainfall).toBe(51.4);
    // Multiple phenomena in the fixed-width WW field must not shift CA_TOT or later values.
    const withPhenomena = publishedCurrent.replace("01                      10", "01 22                   10");
    expect(parseWeatherCurrent(withPhenomena).get("108")?.values.cloudCover).toBe(10);
    expect(() => parseWeatherCurrent(publishedCurrent.replace("619  0.0", "619   0.0"))).toThrow();
  });
  it("reads official header names instead of guessing column positions", () => {
    expect(parseWeatherStations(stations)[0]).toEqual({ id: "112", name: "인천", lat: 37.4777, lng: 126.6249 });
    expect(parseWeatherTable("108 1 2 3")).toEqual([]);
    expect(parseWeatherDays(daily).get("112")?.[0].values.temperature).toBe(-9);
    expect(parseWeatherDays(daily).get("112")?.[1].values.rainfall).toBeNull();
    expect(parseWeatherCurrent(current).get("112")).toMatchObject({ observedAt: "2026-10-18T11:00:00+09:00", values: { temperature: 16.5, rainfall: 3, minTemperature: null, sunshine: null } });
  });
  it("distinguishes genuine empty tables from changed upstream formats", () => {
    expect(parseWeatherDays("# YYMMDD STN TA_AVG\n# no observations").size).toBe(0);
    expect(() => parseWeatherDays("# DATE STATION VALUE\n20261010 112 15")).toThrow();
    expect(() => parseWeatherDays("# YYMMDD STN TA_AVG\n20261010 112 15 extra")).toThrow();
    expect(() => parseWeatherDays("# YYMMDD STN TA_AVG\n20260230 112 15")).toThrow();
    expect(() => parseWeatherCurrent("# YYMMDDHHMI STN TA\n202610189900 112 15")).toThrow();
  });
  it("returns a truthful setup state without calling upstream when key is absent", async () => {
    vi.stubEnv("KMA_API_KEY", "");
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    const result = await getWeather(query);
    expect(result).toMatchObject({ configured: false, items: [], region: { id: "2800000000" } });
    expect(fetch).not.toHaveBeenCalled();
  });
  it("coalesces class-wide repeated requests and maps nearby districts without averaging them", async () => {
    const fetch = vi.fn(async (url: URL) => new Response(url.pathname.endsWith("stn_inf.php") ? stations : daily));
    vi.stubGlobal("fetch", fetch);
    const [first, second] = await Promise.all([getWeather(query), getWeather(query)]);
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(first).toEqual(second);
    expect(first.items).toHaveLength(12);
    expect(first.items[0].station.id).toBe("112");
    expect(first.items[0].summary.values.temperature).toBe(0.5);
    expect(first.items[0].summary.metricDays.rainfall).toBe(1);
    expect(first.items[0].current).toBeNull();
    expect(JSON.stringify(first)).not.toContain("test-secret-do-not-expose");
    for (const [url] of fetch.mock.calls) expect(url.searchParams.get("stn")).toBe("0");
  });
  it("reuses stable month chunks for different date selections and clips extra days", async () => {
    const fetch = vi.fn(async (url: URL) => new Response(url.pathname.endsWith("stn_inf.php") ? stations : daily));
    vi.stubGlobal("fetch", fetch);
    const first = await getWeather(query);
    const second = await getWeather({ ...query, start: "2026-10-11", end: "2026-10-12" });
    expect(fetch.mock.calls.filter(([url]) => url.pathname.endsWith("kma_sfcdd3.php"))).toHaveLength(1);
    expect(first.items[0].series[0].date).toBe("2026-10-10");
    expect(second.items[0].series[0].date).toBe("2026-10-11");
    expect(second.items[0].series[0].values.temperature).toBe(10);
  });
  it.each(["timeout", "gateway"])("retries one transient %s within a shared class-wide read", async (failure) => {
    let dailyCalls = 0;
    const fetch = vi.fn(async (url: URL) => {
      if (url.pathname.endsWith("stn_inf.php")) return new Response(stations);
      dailyCalls += 1;
      if (dailyCalls === 1) {
        if (failure === "timeout") throw new DOMException("provider request timed out", "TimeoutError");
        return new Response("temporary failure", { status: 503 });
      }
      return new Response(daily);
    });
    vi.stubGlobal("fetch", fetch);
    const [first, second] = await Promise.all([getWeather(query), getWeather(query)]);
    expect(first.items[0].summary.values.temperature).toBe(0.5);
    expect(second).toEqual(first);
    expect(dailyCalls).toBe(2);
    expect(JSON.stringify(first)).not.toContain("test-secret-do-not-expose");
  });
  it("bounds repeated transport failures to two attempts", async () => {
    const fetch = vi.fn(async (url: URL) => {
      if (url.pathname.endsWith("stn_inf.php")) return new Response(stations);
      throw new TypeError("network unavailable");
    });
    vi.stubGlobal("fetch", fetch);
    await expect(getWeather(query)).rejects.toMatchObject({ code: "WEATHER_UNAVAILABLE" });
    expect(fetch.mock.calls.filter(([url]) => url.pathname.endsWith("kma_sfcdd3.php"))).toHaveLength(2);
  });
  it("keeps incomplete today out of daily data and degrades current outages explicitly", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => url.pathname.endsWith("kma_sfctm2.php") ? new Response("unavailable", { status: 503 }) : new Response(url.pathname.endsWith("stn_inf.php") ? stations : daily)));
    const result = await getWeather({ ...query, end: "2026-10-18" });
    expect(result.items[0].current).toBeNull();
    expect(result.items[0].series.at(-1)).toMatchObject({ date: "2026-10-18", observedDays: 0 });
    expect(result.notice).toContain("현재 관측을 받지 못해");
  });
  it("sanitizes provider errors and rejects unreadable weather data even when metadata has a public fallback", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("# ERROR invalid authKey test-secret-do-not-expose")));
    await expect(getWeather(query)).rejects.toMatchObject({ code: "WEATHER_AUTH_OR_DATA" });
    clearWeatherCacheForTests();
    vi.stubGlobal("fetch", vi.fn(async () => new Response("# no station rows")));
    await expect(getWeather(query)).rejects.toMatchObject({ code: "WEATHER_DATA_FORMAT" });
  });
  it.each(["kma_sfcdd3.php"])("explains API application requirements when %s returns 403 without exposing provider data", async (endpoint) => {
    const providerMessage = "활용신청이 필요한 API 입니다. test-secret-do-not-expose";
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => url.pathname.endsWith(endpoint)
      ? Response.json({ result: { status: 403, message: providerMessage } }, { status: 403 })
      : new Response(url.pathname.endsWith("stn_inf.php") ? stations : daily)));
    const error = await getWeather(query).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 503, code: "WEATHER_PERMISSION_REQUIRED" });
    expect((error as Error).message).toContain("시간자료·일자료(기간 조회)");
    expect((error as Error).message).toContain("지상(SFC)");
    expect((error as Error).message).not.toContain("test-secret-do-not-expose");
    expect((error as Error).message).not.toContain(providerMessage);
  });
  it("uses dated official public station history when the metadata API is denied and backs off repeat calls", async () => {
    const fetch = vi.fn(async (url: URL) => url.pathname.endsWith("stn_inf.php")
      ? Response.json({ result: { status: 403, message: "test-secret-do-not-expose" } }, { status: 403 })
      : new Response(daily));
    vi.stubGlobal("fetch", fetch);
    const first = await getWeather(query);
    const second = await getWeather({ ...query, end: "2026-10-12" });
    expect(first).toMatchObject({ configured: true, region: { id: "2800000000" } });
    expect(first.items[0].station).toMatchObject({ id: "112", name: "인천" });
    expect(first.items[0].summary.values.temperature).toBe(0.5);
    expect(first.notice).toContain("기상청 공개 관측지점 이력");
    expect(first.source).toContain("기상청 공개 관측지점 이력");
    expect(JSON.stringify(first)).not.toContain("test-secret-do-not-expose");
    expect(second.configured).toBe(true);
    expect(fetch.mock.calls.filter(([url]) => url.pathname.endsWith("stn_inf.php"))).toHaveLength(1);
  });
  it("does not turn failed today-only observations into a successful empty result", async () => {
    vi.stubGlobal("fetch", vi.fn(async (url: URL) => url.pathname.endsWith("stn_inf.php")
      ? new Response(stations) : new Response("denied", { status: 403 })));
    await expect(getWeather({ ...query, start: "2026-10-18", end: "2026-10-18" })).rejects.toMatchObject({ code: "WEATHER_PERMISSION_REQUIRED" });
  });
  it("distinguishes an invalid API key from missing API approval without exposing the credential", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ error: "test-secret-do-not-expose" }, { status: 401 })));
    const error = await getWeather(query).catch((caught: unknown) => caught);
    expect(error).toMatchObject({ status: 503, code: "WEATHER_KEY_INVALID" });
    expect((error as Error).message).toContain("인증키");
    expect((error as Error).message).not.toContain("test-secret-do-not-expose");
  });
  it("rejects unknown regions and oversized ranges before external calls", async () => {
    const fetch = vi.fn(); vi.stubGlobal("fetch", fetch);
    await expect(getWeather({ ...query, regionId: "9999999999" })).rejects.toMatchObject({ code: "WEATHER_REGION_NOT_FOUND" });
    await expect(getWeather({ ...query, start: "2024-01-01", end: "2025-01-01" })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
});
