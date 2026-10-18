import "server-only";
import records from "./weather-region-data/regions.json";
import type { WeatherRegion } from "@/domain/weather";

export const WEATHER_REGION_SOURCE = "기상청 단기예보 행정구역·위경도 목록(2607), 2609 활용가이드 배포본";
export const WEATHER_REGION_UPDATED_AT = "2026-07-01";
const index = new Map<string, WeatherRegion>();
for (const tuple of records) {
  const [id, parentId, name, lat, lng] = tuple as [string, string | null, string, number, number];
  const parent = parentId ? index.get(parentId) : null;
  index.set(id, { id, parentId, name, lat, lng, fullName: parent && parent.name !== name ? `${parent.fullName} ${name}` : parent?.fullName ?? name, level: !parentId ? "city" : parent?.level === "city" ? "district" : "dong" });
}
export function weatherRegion(id: string): WeatherRegion | undefined { return index.get(id); }
export function weatherRegionChildren(parentId: string | null = null): WeatherRegion[] { return [...index.values()].filter((region) => region.parentId === parentId); }
