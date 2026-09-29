// Read-only, anonymous serial probes. Not a 4G simulation or a load test.
import { writeFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { setTimeout as pause } from 'node:timers/promises';

const base = new URL(process.env.PERF_ORIGIN ?? 'https://ai-town-map.vercel.app');
if (!['http:', 'https:'].includes(base.protocol)) throw new Error('HTTP origin required');
const count = Number(process.env.PERF_SAMPLES ?? 30);
if (!Number.isInteger(count) || count < 5 || count > 50) throw new Error('Use 5–50 samples');
const targetFile = process.env.PERF_OUTPUT ?? 'docs/qa/performance-baseline.json';

async function request(path) {
  const start = performance.now();
  try {
    const response = await fetch(new URL(path, base), {
      cache: 'no-store', signal: AbortSignal.timeout(15000),
    });
    const headerMs = performance.now() - start;
    const body = await response.text();
    return {
      status: response.status, ms: Math.round(performance.now() - start),
      headerMs: Math.round(headerMs), bytes: Buffer.byteLength(body),
      region: response.headers.get('x-vercel-id')?.split('::').slice(0, -1).join('::') ?? null,
      body,
    };
  } catch {
    return { status: 0, ms: Math.round(performance.now() - start), headerMs: null, bytes: 0, region: null, body: '' };
  }
}

const discovery = await request('/api/v1/maps?scope=public&limit=50');
if (discovery.status !== 200) throw new Error('Public map discovery failed');
const items = JSON.parse(discovery.body).data.items;
const mapId = process.env.PERF_MAP_ID ?? items[0]?.id;
if (mapId && !/^[0-9a-f-]{36}$/i.test(mapId)) throw new Error('Invalid map id');
const routes = [
  ['status', '/api/v1/status'],
  ['publicMaps', '/api/v1/maps?scope=public&limit=50'],
  ...(mapId ? [
    ['configuration', `/api/v1/maps/${mapId}/configuration`],
    ['analysis', `/api/v1/maps/${mapId}/analysis`],
  ] : []),
];
const samples = Object.fromEntries(routes.map(([name]) => [name, []]));
let observationCount = null;
for (let index = 0; index < count; index++) {
  for (const [name, path] of routes) {
    const { body, ...row } = await request(path);
    samples[name].push(row);
    if (name === 'analysis' && row.status === 200) {
      try { observationCount = JSON.parse(body).data.stats.total; } catch { /* Report HTTP result only. */ }
    }
  }
  if ((index + 1) % 5 === 0) console.log(`Completed ${index + 1}/${count} sequential rounds`);
  await pause(100);
}

const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.ceil(values.length * fraction) - 1] ?? null;
const summary = Object.fromEntries(Object.entries(samples).map(([name, rows]) => {
  const good = rows.filter(row => row.status === 200);
  return [name, {
    requests: rows.length, failures: rows.length - good.length, firstObservedMs: rows[0].ms,
    p50Ms: percentile(good.map(row => row.ms), 0.5), p95Ms: percentile(good.map(row => row.ms), 0.95),
    maxMs: good.length ? Math.max(...good.map(row => row.ms)) : null,
    maxBytes: good.length ? Math.max(...good.map(row => row.bytes)) : null,
    regions: [...new Set(rows.map(row => row.region))],
  }];
}));
// Never persist response bodies, cookies, credentials, or record contents.
const report = {
  measuredAt: new Date().toISOString(), origin: base.origin, deploymentLabel: process.env.PERF_DEPLOYMENT ?? null,
  mode: 'anonymous sequential full-response requests from developer Windows host; no network throttling; first observation is not proven cold start',
  publicMaps: items.length, mapId: mapId ?? null, observationCount, samplesPerRoute: count, summary, samples,
};
writeFileSync(targetFile, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(summary, null, 2));
console.log(`Saved ${targetFile}`);
if (Object.values(summary).some(route => route.failures > 0)) process.exitCode = 1;
