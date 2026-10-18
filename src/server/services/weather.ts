import "server-only";
import { createHash } from "node:crypto";
import { ApiError } from "@/server/http";
import { aggregateWeather, emptyWeatherValues, koreanWeatherDate, summarizeWeather, validWeatherDate, weatherDates, weatherDistanceKm, weatherNumber, weatherQuerySchema, type WeatherCurrent, type WeatherDay, type WeatherResult, type WeatherStation, type WeatherValues } from "@/domain/weather";
import { weatherRegion, weatherRegionChildren } from "@/lib/weather-regions";
import { weatherStationReference, WEATHER_STATION_REFERENCE_DATE } from "@/lib/weather-stations";

const SOURCE = "기상청 API허브 · 종관기상관측(ASOS)";
const HOST = "https://apihub.kma.go.kr/api/typ01/url/";
const MAX_BODY_BYTES = 8 * 1024 * 1024;
const CACHE_LIMIT = 36;
const CACHE_BYTES = 32 * 1024 * 1024;
const cache = new Map<string, { expires: number; text: string }>();
const pending = new Map<string, Promise<string>>();
let active = 0;
const waiting: (() => void)[] = [];
let budgetWindow = 0;
let budgetCount = 0;
let stationApiRetryAfter = 0;

async function enter(): Promise<void> {
  if (active < 3) { active += 1; return; }
  if (waiting.length >= 30) throw new ApiError(429, "WEATHER_BUSY", "날씨 조회가 많습니다. 잠시 후 다시 조회해 주세요.");
  await new Promise<void>((resolve) => waiting.push(resolve));
}
function leave(): void { const next = waiting.shift(); if (next) next(); else active -= 1; }
function key(): string | null { const value = process.env.KMA_API_KEY?.trim(); return value && !/replace|your.key/i.test(value) ? value : null; }

async function upstream(file: string, parameters: Record<string, string>, ttl: number): Promise<string> {
  const credential = key();
  if (!credential) throw new ApiError(503, "WEATHER_NOT_CONFIGURED", "기상청 API 연결 설정이 필요합니다.");
  const id = `${createHash("sha256").update(credential).digest("hex").slice(0, 12)}:${file}:${new URLSearchParams(parameters)}`;
  const saved = cache.get(id);
  if (saved && saved.expires > Date.now()) return saved.text;
  if (pending.has(id)) return pending.get(id)!;
  const task = (async () => {
    await enter();
    try {
      const url = new URL(file, HOST);
      Object.entries(parameters).forEach(([name, value]) => url.searchParams.set(name, value));
      url.searchParams.set("authKey", credential);
      let response: Response | undefined;
      // Retry only safe observation reads. Class-wide callers share this entire attempt.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        const now = Date.now();
        if (now - budgetWindow >= 60_000) { budgetWindow = now; budgetCount = 0; }
        if (++budgetCount > 90) throw new ApiError(429, "WEATHER_QUOTA", "기상청 조회량을 보호하기 위해 잠시 쉬고 있습니다. 1분 후 다시 조회해 주세요.");
        try { response = await fetch(url, { cache: "no-store", redirect: "error", signal: AbortSignal.timeout(20_000) }); }
        catch {
          if (attempt === 0) continue;
          throw new ApiError(502, "WEATHER_UNAVAILABLE", "기상청 응답이 늦습니다. 잠시 후 다시 조회해 주세요.");
        }
        if (attempt === 0 && [408, 500, 502, 503, 504].includes(response.status)) {
          await response.body?.cancel();
          continue;
        }
        break;
      }
      if (!response) throw new ApiError(502, "WEATHER_UNAVAILABLE", "기상청 응답을 받지 못했습니다. 잠시 후 다시 조회해 주세요.");
      if (response.status === 403) throw new ApiError(503, "WEATHER_PERMISSION_REQUIRED", "기상청 API허브에서 종관기상관측(ASOS)의 시간자료·일자료(기간 조회)와 지상관측 지점정보의 지상(SFC) API 활용신청이 필요합니다. 활용 승인 후 다시 조회해 주세요.");
      if (response.status === 401) throw new ApiError(503, "WEATHER_KEY_INVALID", "기상청 API 인증키가 유효하지 않습니다. API허브에서 발급받은 인증키와 서버 설정을 확인해 주세요.");
      if (!response.ok) throw new ApiError(response.status === 429 ? 429 : 502, "WEATHER_UPSTREAM", "기상청 연결 상태와 API 활용 승인을 확인해 주세요.");
      const reader = response.body?.getReader();
      if (!reader) throw new ApiError(502, "WEATHER_EMPTY", "기상청에서 자료가 도착하지 않았습니다.");
      let size = 0;
      const chunks: Uint8Array[] = [];
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_BODY_BYTES) { await reader.cancel(); throw new ApiError(502, "WEATHER_RESPONSE_TOO_LARGE", "날씨 자료가 큽니다. 조회 기간을 줄여 주세요."); }
        chunks.push(value);
      }
      const bytes = Buffer.concat(chunks);
      let text = bytes.toString("utf8");
      if (text.includes("\uFFFD")) text = new TextDecoder("euc-kr").decode(bytes);
      if (/<\s*(html|xml|OpenAPI|response|error)|AUTH(?:ENTICATION|ORIZATION)?[ _-]*(?:ERROR|FAIL)|인증키.*(?:오류|없|미등록)|접근.*제한|API_KEY.*(?:ERROR|INVALID)/i.test(text) || /^#?\s*(ERROR|ERR)\b/im.test(text)) throw new ApiError(502, "WEATHER_AUTH_OR_DATA", "기상청 인증키와 지상관측·지점정보 API 활용 승인을 확인해 주세요.");
      cache.delete(id);
      while (cache.size && (cache.size >= CACHE_LIMIT || [...cache.values()].reduce((total, entry) => total + Buffer.byteLength(entry.text, "utf8"), 0) + bytes.length > CACHE_BYTES)) cache.delete(cache.keys().next().value!);
      cache.set(id, { expires: Date.now() + ttl, text });
      return text;
    } catch (error) {
      if (error instanceof ApiError) throw error;
      throw new ApiError(502, "WEATHER_UNAVAILABLE", "기상청 자료를 모두 받지 못했습니다. 잠시 후 다시 조회해 주세요.");
    } finally { leave(); }
  })();
  pending.set(id, task);
  try { return await task; } finally { pending.delete(id); }
}

type WeatherTableHeader = { names: string[]; columns: { field: string; end: number }[]; fixedWidth: boolean };

/** KMA repeats field names on the first line and puts AVG/DAY/TOT on a second line. */
function weatherTable(text: string): { header: string[] | null; numericRows: number; records: Record<string, string>[] } {
  let header: WeatherTableHeader | null = null;
  let numericRows = 0;
  const records: Record<string, string>[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) {
      const fields = line.replace(/^#+\s*/, "").split(/\s+/);
      if ((fields.includes("STN") || fields.includes("STN_ID")) && (fields.includes("LON") || fields.includes("TA") || fields.includes("TA_AVG"))) {
        // Keep the comment prefix: the field labels end at the same columns as the data.
        const columns = [...raw.matchAll(/\S+/g)].filter((match) => !match[0].startsWith("#")).map((match) => ({ field: match[0], end: match.index! + match[0].length }));
        header = { names: fields, columns, fixedWidth: false };
      } else if (header && new Set(header.columns.map(({ field }) => field)).size !== header.columns.length && /^#\s+KST\s+ID\b/.test(line)) {
        let start = 0;
        const seen = new Map<string, number>();
        header.names = header.columns.map(({ field, end }) => {
          const suffix = raw.slice(start, end).trim().split(/\s+/).at(-1) ?? "";
          start = end;
          // Uppercase suffixes describe variables; C/ID/KST and lowercase text are units.
          const qualified = /^[A-Z0-9]+$/.test(suffix) && !["C", "ID", "KST"].includes(suffix) && !(field === "WD" && suffix === "16");
          const name = qualified ? `${field}_${suffix}` : field;
          const count = (seen.get(name) ?? 0) + 1;
          seen.set(name, count);
          // Speed/value and observation-time columns can carry the same printed label.
          return count === 1 ? name : `${name}_${count}`;
        });
        header.fixedWidth = true;
      }
      continue;
    }
    if (/^\d/.test(line)) numericRows += 1;
    if (!header) continue;
    let fields: string[];
    if (header.fixedWidth && header.names.includes("TA_AVG")) {
      // Daily rows are numeric. KMA's time codes can exceed their printed field widths
      // (for example -2343), shifting every later fixed-width position.
      fields = line.split(/\s+/);
      if (fields.length !== header.names.length) continue;
    } else if (header.fixedWidth) {
      const width = header.columns.at(-1)!.end;
      if (raw.length < width || raw.slice(width).trim()) continue;
      let start = 0;
      fields = header.columns.map(({ end }) => {
        const value = raw.slice(start, end).trim();
        start = end;
        // WW/CT text is left-aligned. Its unused padding precedes the next numeric label.
        return value.split(/\s+/).at(-1) ?? "";
      });
    } else {
      if (new Set(header.names).size !== header.names.length) continue;
      fields = line.split(/\s+/);
      if (fields.length !== header.names.length) continue;
    }
    records.push(Object.fromEntries(header.names.map((field, index) => [field, fields[index]])));
  }
  return { header: header?.names ?? null, numericRows, records };
}

/** Parse the published field layout instead of assuming a fixed variable order. */
export function parseWeatherTable(text: string): Record<string, string>[] { return weatherTable(text).records; }

export function parseWeatherStations(text: string): WeatherStation[] {
  return parseWeatherTable(text).flatMap((row) => {
    const id = row.STN_ID ?? row.STN;
    const lat = Number(row.LAT), lng = Number(row.LON);
    if (!/^\d{1,4}$/.test(id ?? "") || !Number.isFinite(lat) || !Number.isFinite(lng) || lat < 32 || lat > 40 || lng < 123 || lng > 133 || !row.STN_KO) return [];
    return [{ id, name: row.STN_KO, lat, lng }];
  });
}

/** Public KMA station history keeps observation queries usable during metadata API outages. */
async function loadWeatherStations(asOf: string): Promise<{ stations: WeatherStation[]; reference: boolean }> {
  if (Date.now() >= stationApiRetryAfter) {
    try {
      const text = await upstream("stn_inf.php", { inf: "SFC", tm: `${asOf.replaceAll("-", "")}0900`, stn: "0", help: "0" }, 86_400_000);
      const stations = parseWeatherStations(text);
      if (stations.length) return { stations, reference: false };
    } catch (error) {
      if (error instanceof ApiError && error.code === "WEATHER_KEY_INVALID") throw error;
    }
    // Do not repeat a denied or unavailable metadata call for every classroom request.
    stationApiRetryAfter = Date.now() + 600_000;
  }
  const stations = weatherStationReference(asOf);
  if (!stations.length) throw new ApiError(502, "WEATHER_STATIONS_EMPTY", "선택한 날짜의 기상청 관측소 정보를 확인하지 못했습니다. 다른 기간을 선택해 주세요.");
  return { stations, reference: true };
}
function rowTime(row: Record<string, string>): string { return row.TM ?? row.YYMMDD ?? row.YYMMDDHHMI ?? ""; }
function isoDay(value: string): string | null {
  if (!/^\d{8}(?:\d{4})?$/.test(value)) return null;
  const date = `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}`;
  return validWeatherDate(date) ? date : null;
}
function checkedRows(text: string, requiredField: string): Record<string, string>[] {
  const table = weatherTable(text);
  if (!table.header?.includes(requiredField) || table.numericRows !== table.records.length) throw new ApiError(502, "WEATHER_DATA_FORMAT", "기상청 자료 형식을 확인하지 못했습니다. 잠시 후 다시 조회해 주세요.");
  return table.records;
}
function dailyValues(row: Record<string, string>): WeatherValues {
  return {
    temperature: weatherNumber(row.TA_AVG, "temperature"), minTemperature: weatherNumber(row.TA_MIN, "minTemperature"), maxTemperature: weatherNumber(row.TA_MAX, "maxTemperature"),
    rainfall: weatherNumber(row.RN_DAY, "rainfall"), humidity: weatherNumber(row.HM_AVG, "humidity"), windSpeed: weatherNumber(row.WS_AVG, "windSpeed"),
    cloudCover: weatherNumber(row.CA_TOT, "cloudCover"), snowDepth: weatherNumber(row.SD_MAX, "snowDepth"), sunshine: weatherNumber(row.SS_DAY, "sunshine"),
  };
}
export function parseWeatherDays(text: string): Map<string, WeatherDay[]> {
  const stations = new Map<string, Map<string, WeatherDay>>();
  for (const row of checkedRows(text, "TA_AVG")) {
    const date = isoDay(rowTime(row));
    if (!date || !/^\d{1,4}$/.test(row.STN ?? "")) throw new ApiError(502, "WEATHER_DATA_FORMAT", "기상청 날짜·지점 형식을 확인하지 못했습니다.");
    if (!stations.has(row.STN)) stations.set(row.STN, new Map());
    stations.get(row.STN)!.set(date, { date, values: dailyValues(row), freshSnow: weatherNumber(row.SD_NEW, "snowDepth") });
  }
  return new Map([...stations].map(([stationId, days]) => [stationId, [...days.values()]]));
}
export function parseWeatherCurrent(text: string): Map<string, WeatherCurrent> {
  const result = new Map<string, WeatherCurrent>();
  for (const row of checkedRows(text, "TA")) {
    const stamp = rowTime(row), date = isoDay(stamp);
    if (!date || stamp.length !== 12 || Number(stamp.slice(8, 10)) > 23 || Number(stamp.slice(10, 12)) > 59 || !/^\d{1,4}$/.test(row.STN ?? "")) throw new ApiError(502, "WEATHER_DATA_FORMAT", "기상청 시각·지점 형식을 확인하지 못했습니다.");
    const values = emptyWeatherValues();
    values.temperature = weatherNumber(row.TA, "temperature");
    values.rainfall = weatherNumber(row.RN_DAY, "rainfall");
    values.humidity = weatherNumber(row.HM, "humidity");
    values.windSpeed = weatherNumber(row.WS, "windSpeed");
    values.cloudCover = weatherNumber(row.CA_TOT, "cloudCover");
    values.snowDepth = weatherNumber(row.SD_TOT, "snowDepth");
    result.set(row.STN, { observedAt: `${date}T${stamp.slice(8, 10)}:${stamp.slice(10, 12)}:00+09:00`, values });
  }
  return result;
}

function monthRanges(start: string, end: string, availableEnd: string): { start: string; end: string }[] {
  const ranges: { start: string; end: string }[] = [];
  for (let date = start.slice(0, 7) + "-01"; date <= end;) {
    const next = new Date(`${date}T00:00:00Z`);
    next.setUTCMonth(next.getUTCMonth() + 1);
    const nextDate = next.toISOString().slice(0, 10);
    const lastDate = new Date(next.getTime() - 86_400_000).toISOString().slice(0, 10);
    // Fetch stable calendar chunks so different classrooms reuse the same upstream cache.
    ranges.push({ start: date, end: lastDate < availableEnd ? lastDate : availableEnd });
    date = nextDate;
  }
  return ranges;
}

export async function getWeather(input: unknown, now = new Date()): Promise<WeatherResult> {
  const query = weatherQuerySchema.parse(input);
  const region = weatherRegion(query.regionId);
  if (!region) throw new ApiError(404, "WEATHER_REGION_NOT_FOUND", "날씨 지역을 찾을 수 없습니다.");
  const base = { region, start: query.start, end: query.end, period: query.period, source: SOURCE };
  if (!key()) return { ...base, configured: false, items: [], notice: "기상청 API 연결을 준비하고 있습니다. 지역·기간은 선택할 수 있으며, 인증키 설정 후 실제 관측자료가 표시됩니다." };
  const today = koreanWeatherDate(now);
  const yesterday = koreanWeatherDate(new Date(now.getTime() - 86_400_000));
  const historicalEnd = query.end < today ? query.end : yesterday;
  const currentHour = new Date(now.getTime() + 9 * 3_600_000 - 10 * 60_000).toISOString().slice(0, 13).replace(/[-T]/g, "") + "00";
  const historical = query.start <= historicalEnd ? monthRanges(query.start, historicalEnd, yesterday) : [];
  let currentUnavailable = false;
  let currentError: unknown;
  const [stationInfo, currentText, ...dailyTexts] = await Promise.all([
    loadWeatherStations(query.end),
    query.end === today ? upstream("kma_sfctm2.php", { tm: currentHour, stn: "0", help: "0" }, 600_000).catch(error => { currentUnavailable = true; currentError = error; return ""; }) : Promise.resolve(""),
    ...historical.map((range) => upstream("kma_sfcdd3.php", { tm1: range.start.replaceAll("-", ""), tm2: range.end.replaceAll("-", ""), stn: "0", help: "0" }, range.end < yesterday ? 86_400_000 : 600_000)),
  ]);
  const stations = stationInfo.stations;
  if (!historical.length && currentError) throw currentError;
  const byStation = new Map<string, Map<string, WeatherDay>>();
  for (const text of dailyTexts) for (const [id, days] of parseWeatherDays(text)) {
    if (!byStation.has(id)) byStation.set(id, new Map());
    for (const day of days) if (day.date >= query.start && day.date <= historicalEnd) byStation.get(id)!.set(day.date, day);
  }
  let current = new Map<string, WeatherCurrent>();
  if (currentText) {
    try { current = parseWeatherCurrent(currentText); }
    catch (error) { if (!historical.length) throw error; currentUnavailable = true; }
  }
  const expectedDays = weatherDates(query.start, query.end).length;
  const targets = [region, ...weatherRegionChildren(region.id)];
  const items = targets.map((target) => {
    const station = stations.reduce((nearest, candidate) => weatherDistanceKm(target, candidate) < weatherDistanceKm(target, nearest) ? candidate : nearest);
    const days = [...(byStation.get(station.id)?.values() ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    const summary = summarizeWeather(days, expectedDays);
    return { region: target, station, distanceKm: Math.round(weatherDistanceKm(target, station) * 10) / 10, current: current.get(station.id) ?? null, series: aggregateWeather(days, query.start, query.end, query.period), summary, weatherCounts: summary.weatherCounts };
  });
  return { ...base, configured: true, items, source: stationInfo.reference ? `${SOURCE} · 기상청 공개 관측지점 이력` : SOURCE, notice: `${stationInfo.reference ? `관측소 정보 API 대신 기상청 공개 관측지점 이력(${WEATHER_STATION_REFERENCE_DATE} 확보)을 사용합니다. ` : ""}지역 대표좌표와 가까운 관측소 값입니다. 지역 전체 평균이 아니며 여러 동이 같은 관측소 값을 공유할 수 있습니다. 거리는 ${query.end} 관측소 위치 기준으로, 과거에 이전한 관측소의 당시 거리는 다를 수 있습니다. 현재 관측은 기간에 오늘이 포함될 때 조회하며 강수량은 오늘 누적량입니다. 오늘 일통계는 포함하지 않습니다. 누락값은 0으로 바꾸지 않습니다. 날씨 일수는 공식 일기현상이 아닌 관측값 요약입니다. 강수 있는 날은 비·눈을 포함한 강수량 양수인 날, 새 눈 쌓인 날은 신적설 양수인 날, 운량으로 분류한 맑음·흐림은 평균운량 2 이하·8 이상인 날을 각각 셉니다. 항목별 일수는 서로 겹칠 수 있으며 중간 운량이나 결측은 미분류입니다.${currentUnavailable ? " 현재 관측을 받지 못해 과거 자료만 표시합니다. 잠시 후 다시 조회해 주세요." : ""}` };
}

export function clearWeatherCacheForTests(): void { cache.clear(); pending.clear(); budgetWindow = 0; budgetCount = 0; stationApiRetryAfter = 0; }
