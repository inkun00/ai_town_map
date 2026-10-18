import "server-only";
import records from "./weather-station-data/asos-history.json";
import source from "./weather-station-data/source.json";
import { validWeatherDate, type WeatherStation } from "@/domain/weather";

export const WEATHER_STATION_REFERENCE_DATE = source.retrievedAt;
export const WEATHER_STATION_REFERENCE_SOURCE = "기상청 기상자료개방포털 · 종관기상관측(ASOS) 관측지점 이력";

type StationHistory = [id: string, start: string, end: string | null, name: string, lat: number, lng: number];

/** Official date history, not an assertion that every station measured every weather variable. */
export function weatherStationReference(asOf: string): WeatherStation[] {
  if (!validWeatherDate(asOf)) throw new RangeError("관측지점 기준일은 YYYY-MM-DD 형식의 실제 날짜여야 합니다.");
  const selected = new Map<string, { start: string; station: WeatherStation }>();
  for (const [id, start, end, name, lat, lng] of records as StationHistory[]) {
    if (start > asOf || (end && end < asOf)) continue;
    // KMA occasionally uses the same date for an old row's end and its successor's start.
    // On that transition date, the newer history row supplies the official coordinates.
    if ((selected.get(id)?.start ?? "") > start) continue;
    selected.set(id, { start, station: { id, name, lat, lng } });
  }
  return [...selected.values()].map(({ station }) => station).sort((a, b) => Number(a.id) - Number(b.id));
}
