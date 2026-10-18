import { z } from "zod";

export const weatherMetrics = {
  temperature: { label: "평균 기온", unit: "℃", chart: "line" },
  minTemperature: { label: "최저 기온", unit: "℃", chart: "line" },
  maxTemperature: { label: "최고 기온", unit: "℃", chart: "line" },
  rainfall: { label: "강수량", unit: "mm", chart: "bar" },
  humidity: { label: "평균 습도", unit: "%", chart: "line" },
  windSpeed: { label: "평균 풍속", unit: "m/s", chart: "line" },
  cloudCover: { label: "평균 운량", unit: "할", chart: "line" },
  snowDepth: { label: "최심 적설", unit: "cm", chart: "bar" },
  sunshine: { label: "일조 시간", unit: "시간", chart: "bar" },
} as const;
export type WeatherMetric = keyof typeof weatherMetrics;
export type WeatherPeriod = "day" | "week" | "month";
export type WeatherValues = Record<WeatherMetric, number | null>;
export type WeatherMetricDays = Record<WeatherMetric, number>;
export type WeatherCounts = { clear: number | null; cloudy: number | null; rain: number | null; snow: number | null; unknown: number };
export type WeatherRegion = { id: string; parentId: string | null; name: string; fullName: string; level: "city" | "district" | "dong"; lat: number; lng: number };
export type WeatherStation = { id: string; name: string; lat: number; lng: number };
export type WeatherDay = { date: string; values: WeatherValues; freshSnow: number | null };
export type WeatherBucket = { date: string; endDate: string; values: WeatherValues; metricDays: WeatherMetricDays; observedDays: number; expectedDays: number; weatherCounts: WeatherCounts };
export type WeatherSummary = Omit<WeatherBucket, "date" | "endDate">;
export type WeatherCurrent = { observedAt: string; values: WeatherValues };
export type WeatherLocationResult = { region: WeatherRegion; station: WeatherStation; distanceKm: number; current: WeatherCurrent | null; series: WeatherBucket[]; summary: WeatherSummary; weatherCounts: WeatherCounts };
export type WeatherResult = { region: WeatherRegion; start: string; end: string; period: WeatherPeriod; configured: boolean; items: WeatherLocationResult[]; notice: string; source: string };

export const WEATHER_DAY_MS = 86_400_000;
export const WEATHER_MAX_DAYS = 366;
export const weatherMetricKeys = Object.keys(weatherMetrics) as WeatherMetric[];
export function emptyWeatherValues(): WeatherValues { return Object.fromEntries(weatherMetricKeys.map((key) => [key, null])) as WeatherValues; }
export function koreanWeatherDate(now = new Date()): string { return new Date(now.getTime() + 9 * 3_600_000).toISOString().slice(0, 10); }
export function validWeatherDate(value: string): boolean { return /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value; }
export function weatherDates(start: string, end: string): string[] {
  const days: string[] = [];
  for (let time = Date.parse(`${start}T00:00:00Z`); time <= Date.parse(`${end}T00:00:00Z`) && days.length <= WEATHER_MAX_DAYS; time += WEATHER_DAY_MS) days.push(new Date(time).toISOString().slice(0, 10));
  return days;
}
export const weatherQuerySchema = z.strictObject({
  regionId: z.string().regex(/^\d{10}$/),
  start: z.string().refine(validWeatherDate),
  end: z.string().refine(validWeatherDate),
  period: z.enum(["day", "week", "month"]).default("day"),
}).superRefine((value, context) => {
  if (!validWeatherDate(value.start) || !validWeatherDate(value.end)) return;
  if (value.start > value.end || value.start < "1904-01-01" || value.end > koreanWeatherDate()) context.addIssue({ code: "custom", path: ["start"], message: "과거부터 오늘까지의 날짜를 선택해 주세요." });
  if ((Date.parse(value.end) - Date.parse(value.start)) / WEATHER_DAY_MS >= WEATHER_MAX_DAYS) context.addIssue({ code: "custom", path: ["end"], message: `한 번에 ${WEATHER_MAX_DAYS}일까지 조회할 수 있습니다.` });
});

export function weatherDistanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const radians = Math.PI / 180;
  const value = Math.sin((b.lat - a.lat) * radians / 2) ** 2 + Math.cos(a.lat * radians) * Math.cos(b.lat * radians) * Math.sin((b.lng - a.lng) * radians / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(value), Math.sqrt(Math.max(0, 1 - value)));
}

/** Negative precipitation and KMA sentinel values remain missing, never become zero. */
export function weatherNumber(raw: string | undefined, metric?: WeatherMetric): number | null {
  if (raw === undefined || !raw.trim() || /^(null|nan|\/|-)$/i.test(raw)) return null;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= -90) return null;
  if (metric && !["temperature", "minTemperature", "maxTemperature"].includes(metric) && value < 0) return null;
  if (metric === "humidity" && value > 100 || metric === "cloudCover" && value > 10) return null;
  return value;
}

function classifyWeather(days: WeatherDay[], expectedDays: number): WeatherCounts {
  const counts: WeatherCounts = { clear: null, cloudy: null, rain: null, snow: null, unknown: expectedDays - days.length };
  const validRain = days.filter((day) => day.values.rainfall !== null);
  const validSnow = days.filter((day) => day.freshSnow !== null);
  if (validRain.length) counts.rain = validRain.filter((day) => day.values.rainfall! > 0).length;
  if (validSnow.length) counts.snow = validSnow.filter((day) => day.freshSnow! > 0).length;
  // These are independent measured-variable counts, not exclusive official daily phenomena.
  const cloudDays = days.filter((day) => day.values.cloudCover !== null);
  if (cloudDays.length) {
    counts.clear = cloudDays.filter((day) => day.values.cloudCover! <= 2).length;
    counts.cloudy = cloudDays.filter((day) => day.values.cloudCover! >= 8).length;
  }
  counts.unknown += days.filter((day) => !(day.freshSnow !== null && day.freshSnow > 0) && !(day.values.rainfall !== null && day.values.rainfall > 0) && !(day.values.cloudCover !== null && (day.values.cloudCover <= 2 || day.values.cloudCover >= 8))).length;
  return counts;
}

export function summarizeWeather(days: WeatherDay[], expectedDays: number): WeatherSummary {
  const values = emptyWeatherValues();
  const metricDays = Object.fromEntries(weatherMetricKeys.map((key) => [key, 0])) as WeatherMetricDays;
  for (const key of weatherMetricKeys) {
    const samples = days.map((day) => day.values[key]).filter((value): value is number => value !== null);
    metricDays[key] = samples.length;
    if (!samples.length) continue;
    const raw = key === "rainfall" || key === "sunshine" ? samples.reduce((sum, value) => sum + value, 0) : key === "minTemperature" ? Math.min(...samples) : key === "maxTemperature" || key === "snowDepth" ? Math.max(...samples) : samples.reduce((sum, value) => sum + value, 0) / samples.length;
    values[key] = Math.round(raw * 100) / 100;
  }
  return { values, metricDays, observedDays: days.filter((day) => weatherMetricKeys.some((key) => day.values[key] !== null)).length, expectedDays, weatherCounts: classifyWeather(days, expectedDays) };
}

/** Week buckets start on Monday; first/last buckets are clipped to the requested dates. */
export function aggregateWeather(days: WeatherDay[], start: string, end: string, period: WeatherPeriod): WeatherBucket[] {
  const groups = new Map<string, string[]>();
  for (const date of weatherDates(start, end)) {
    const instant = new Date(`${date}T00:00:00Z`);
    const key = period === "month" ? date.slice(0, 7) : period === "week" ? new Date(instant.getTime() - ((instant.getUTCDay() + 6) % 7) * WEATHER_DAY_MS).toISOString().slice(0, 10) : date;
    groups.set(key, [...(groups.get(key) ?? []), date]);
  }
  const byDate = new Map(days.map((day) => [day.date, day]));
  return [...groups.values()].map((dates) => ({ date: dates[0], endDate: dates.at(-1)!, ...summarizeWeather(dates.flatMap((date) => byDate.has(date) ? [byDate.get(date)!] : []), dates.length) }));
}
