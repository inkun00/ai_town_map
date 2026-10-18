// Read-only verification against the local app or its production alias. No credentials are needed.
import assert from "node:assert/strict";

const target = new URL(process.argv[2] ?? "http://localhost:3001");
assert.ok(target.pathname === "/" && !target.username && !target.password && !target.search && !target.hash);
assert.ok(target.origin === "https://ai-town-map.vercel.app" || (target.protocol === "http:" && ["localhost", "127.0.0.1"].includes(target.hostname)));
async function get(path) {
  const response = await fetch(new URL(path, target), { signal: AbortSignal.timeout(60_000) });
  const payload = await response.json();
  assert.equal(response.status, 200, `${path}: ${response.status} ${payload.error?.code ?? ""}`);
  return payload.data;
}
const roots = await get("/api/v1/weather/regions");
const city = roots.items.find(region => region.name === "인천광역시");
assert.ok(city);
const districts = await get(`/api/v1/weather/regions?parentId=${city.id}`);
const district = districts.items.find(region => region.name === "연수구");
assert.ok(district);
const dongs = await get(`/api/v1/weather/regions?parentId=${district.id}`);
const dong = dongs.items.find(region => region.name === "송도1동") ?? dongs.items[0];
assert.ok(dong);
const cases = [[city, "day"], [district, "week"], [dong, "month"]];
for (const [region, period] of cases) {
  const parameters = new URLSearchParams({ regionId: region.id, start: "2025-01-01", end: "2025-01-31", period });
  const result = await get(`/api/v1/weather?${parameters}`);
  assert.equal(result.configured, true);
  assert.equal(result.region.id, region.id);
  assert.equal(result.items.length, 1 + (region === city ? districts.items.length : region === district ? dongs.items.length : 0));
  const first = result.items[0];
  assert.ok(first.station.name && Number.isFinite(first.distanceKm));
  assert.equal(first.summary.expectedDays, 31);
  assert.ok(first.summary.metricDays.temperature > 0);
  assert.ok(Number.isFinite(first.summary.values.temperature));
  assert.equal(first.series.length, period === "day" ? 31 : period === "week" ? 5 : 1);
  assert.equal(first.current, null, "A historical request must not mix in current observations");
  assert.ok(result.source.includes("기상청"));
  assert.ok(!/authKey=|KMA_API_KEY/.test(JSON.stringify(result)));
  console.log(JSON.stringify({ region: region.fullName, period, locations: result.items.length,
    station: first.station.name, measuredDays: first.summary.metricDays.temperature, buckets: first.series.length }));
}
const today = new Date(Date.now() + 9 * 3_600_000).toISOString().slice(0, 10);
const current = await get(`/api/v1/weather?${new URLSearchParams({ regionId: city.id, start: today, end: today, period: "day" })}`);
const live = current.items.find(item => typeof item.current?.values.temperature === "number");
assert.ok(live, "A current observation should be available from the city or its districts");
assert.equal(live.summary.observedDays, 0, "Incomplete today must stay out of the historical daily aggregate");
console.log(JSON.stringify({ currentRegion: live.region.fullName, observedAt: live.current.observedAt,
  temperature: live.current.values.temperature, historicalDays: live.summary.observedDays }));
console.log(`PASS: ${target.origin} weather regions, daily/weekly/monthly data and separate current observations.`);
