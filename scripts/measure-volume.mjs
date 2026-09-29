// Opt-in bounded synthetic volume probe against the deployed app. All fixture rows are removed.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { existsSync, writeFileSync, readFileSync, unlinkSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { performance } from 'node:perf_hooks';
import nextEnv from '@next/env';
import pg from 'pg';
import sharp from 'sharp';

if (process.env.PERF_VOLUME_RUN !== '1') throw new Error('Set PERF_VOLUME_RUN=1 for synthetic production volume probe');
nextEnv.loadEnvConfig(process.cwd());
if (existsSync('.env.migrate.local')) loadEnvFile('.env.migrate.local');
const origin = new URL(process.env.PERF_ORIGIN ?? 'https://ai-town-map.vercel.app').origin;
if (!/^https:\/\//.test(origin)) throw new Error('Use an HTTPS origin');
if (!process.env.DATABASE_ADMIN_URL) throw new Error('DATABASE_ADMIN_URL is required');
const marker = '.volume-fixture.json';
const db = new pg.Client({ connectionString: process.env.DATABASE_ADMIN_URL, application_name: 'aimap-volume-probe', connectionTimeoutMillis: 5000 });
const tokenHash = value => createHash('sha256').update(value).digest();
const uuid = value => /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
let principalId = null, mapId = null, creationKey = null;

async function cleanup(map, principal) {
  if (map && !uuid(map)) throw new Error('Unsafe fixture map ID');
  if (principal && !uuid(principal)) throw new Error('Unsafe fixture principal ID');
  await db.query('BEGIN');
  try {
    await db.query('SET CONSTRAINTS ALL DEFERRED');
    if (map) {
      for (const table of ['app.proposal_versions', 'app.proposals', 'app.audit_events', 'app.reports', 'app.comments', 'app.observation_photos', 'app.observations', 'app.map_config_revisions', 'app.question_versions', 'app.questions', 'app.rating_options', 'app.rating_schemes', 'app.emoji_options', 'app.categories', 'app_private.invites', 'app.map_members']) {
        await db.query(`DELETE FROM ${table} WHERE map_id=$1`, [map]);
      }
      await db.query('DELETE FROM app.maps WHERE id=$1 AND owner_principal_id=$2', [map, principal]);
    }
    if (principal) {
      await db.query('DELETE FROM app_private.idempotency_keys WHERE principal_id=$1', [principal]);
      await db.query('DELETE FROM app_private.sessions WHERE principal_id=$1', [principal]);
      await db.query('DELETE FROM app.principals WHERE id=$1 AND kind=$2', [principal, 'account']);
    }
    await db.query('COMMIT');
  } catch (error) { await db.query('ROLLBACK'); throw error; }
}

const request = async (path, cookie = '', options = {}) => {
  const started = performance.now();
  const response = await fetch(new URL(path, origin), {
    cache: 'no-store', signal: AbortSignal.timeout(20000),
    headers: { ...(cookie ? { Cookie: cookie } : {}), ...(options.body ? { Origin: origin, 'Content-Type': 'application/json', 'X-CSRF-Token': options.csrf, 'Idempotency-Key': options.key } : {}) },
    method: options.body ? 'POST' : 'GET', body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = await response.text();
  return { status: response.status, ms: Math.round(performance.now() - started), bytes: Buffer.byteLength(body), region: response.headers.get('x-vercel-id')?.split('::').slice(0, -1).join('::') ?? null, data: JSON.parse(body) };
};
const percentile = (rows, fraction) => [...rows].sort((a,b) => a-b)[Math.ceil(rows.length*fraction)-1];
const sample = async (path, cookie, expectedTotal, count = 30) => {
  const rows=[];
  for (let i=0;i<count;i++) {
    const result=await request(path,cookie);
    if(result.status!==200 || (expectedTotal!==null && result.data.data.stats.total!==expectedTotal)) throw new Error(`Volume probe failed: status ${result.status}, sample ${i+1}`);
    rows.push(result);
  }
  return { requests: count, failures: 0, p50Ms: percentile(rows.map(x=>x.ms),.5), p95Ms: percentile(rows.map(x=>x.ms),.95), maxMs: Math.max(...rows.map(x=>x.ms)), maxBytes: Math.max(...rows.map(x=>x.bytes)), regions: [...new Set(rows.map(x=>x.region))] };
};

try {
  await db.connect();
  if (existsSync(marker)) {
    if (process.env.PERF_VOLUME_CLEANUP !== '1') throw new Error('Earlier volume fixture exists. Set PERF_VOLUME_CLEANUP=1 to remove it first.');
    const old = JSON.parse(readFileSync(marker,'utf8'));
    await cleanup(old.mapId, old.principalId);
    unlinkSync(marker);
    console.log('Previous synthetic fixture removed');
    process.exit(0);
  }
  principalId=(await db.query("INSERT INTO app.principals(kind,auth_user_id) VALUES('account',$1) RETURNING id",[randomUUID()])).rows[0].id;
  writeFileSync(marker,JSON.stringify({principalId,mapId}));
  const sessionToken=randomBytes(32).toString('base64url'), csrfToken=randomBytes(32).toString('base64url');
  await db.query("INSERT INTO app_private.sessions(principal_id,token_hash,csrf_hash,expires_at) VALUES($1,$2,$3,now()+interval '2 hours')",[principalId,tokenHash(sessionToken),tokenHash(csrfToken)]);
  const cookie=`__Host-moa_session=${sessionToken}; __Host-moa_csrf=${csrfToken}`;
  creationKey=randomUUID();
  const created=await request('/api/v1/maps',cookie,{csrf:csrfToken,key:creationKey,body:{themeKey:'universal_design',themeVersion:1,title:'합성 성능 검증 지도',locationLabel:'가상 지역',activityContext:'community',visibility:'invite_only',moderation:'immediate'}});
  if(created.status!==201)throw new Error(`Synthetic map creation returned ${created.status}`);
  mapId=created.data.data.id;
  writeFileSync(marker,JSON.stringify({principalId,mapId}));
  const member=(await db.query('SELECT id FROM app.map_members WHERE map_id=$1 AND principal_id=$2',[mapId,principalId])).rows[0].id;
  const categories=(await db.query('SELECT c.id AS category_id,e.id AS emoji_id FROM app.categories c JOIN app.emoji_options e ON e.id=c.default_emoji_id WHERE c.map_id=$1 ORDER BY c.sort_order',[mapId])).rows;
  const ratings=(await db.query('SELECT id FROM app.rating_options WHERE map_id=$1 ORDER BY ordinal',[mapId])).rows;
  if(categories.length<2||ratings.length<3)throw new Error('Fixture theme was not copied');
  const config=await request(`/api/v1/maps/${mapId}/configuration`,cookie);
  if(config.status!==200)throw new Error('Fixture configuration unavailable');
  const answers=Object.fromEntries(config.data.data.theme.questions.map(question=>[question.key,[question.type==='boolean'?'yes':question.type==='text'?'가상 응답':question.options?.[0]?.key??'unknown']]));
  const pixels=randomBytes(400*300*3);
  const photo=await sharp(pixels,{raw:{width:400,height:300,channels:3}}).webp({quality:70}).toBuffer();
  const stages=[]; let current=0;
  for(const target of [100,500,1000]) {
    const added=target-current;
    await db.query(`INSERT INTO app.observations(map_id,author_member_id,title,body,location_label,location_source,lat,lng,category_id,emoji_option_id,rating_option_id,answers,status,config_revision,created_at)
      SELECT $1,$2,'가상 기록 '||g.n,'가상 성능 검증 기록입니다. 실제 현장 자료가 아닙니다.','가상 지점','manual',37.5+(g.n % 100)*0.0001,127+(g.n % 100)*0.0001,
        ($3::uuid[])[(g.n % $7)+1],($4::uuid[])[(g.n % $7)+1],($5::uuid[])[(g.n % $8)+1],$6::jsonb,'published',1,now()-(g.n % 90)*interval '1 day'
      FROM generate_series($9::int,$10::int) AS g(n)`,[mapId,member,categories.map(x=>x.category_id),categories.map(x=>x.emoji_id),ratings.map(x=>x.id),JSON.stringify(answers),categories.length,ratings.length,current+1,target]);
    const rows=(await db.query('SELECT id FROM app.observations WHERE map_id=$1 ORDER BY created_at DESC,id DESC LIMIT 5',[mapId])).rows;
    for(const row of rows)await db.query('INSERT INTO app.observation_photos(map_id,observation_id,uploaded_by,content,mime) VALUES($1,$2,$3,$4,$5) ON CONFLICT (observation_id) DO NOTHING',[mapId,row.id,principalId,photo,'image/webp']);
    await db.query('UPDATE app.maps SET data_revision=data_revision+1 WHERE id=$1',[mapId]);
    const total=Number((await db.query('SELECT count(*) AS count FROM app.observations WHERE map_id=$1',[mapId])).rows[0].count);
    if(total!==target)throw new Error('Fixture count mismatch');
    stages.push({records:target,photos:Number((await db.query('SELECT count(*) AS count FROM app.observation_photos WHERE map_id=$1',[mapId])).rows[0].count),analysis:await sample(`/api/v1/maps/${mapId}/analysis`,cookie,target),configuration:await sample(`/api/v1/maps/${mapId}/configuration`,cookie,null,10)});
    current=target;
    console.log(`Measured ${target} synthetic records`);
  }
  const result={measuredAt:new Date().toISOString(),origin,mode:'synthetic private map; signed-in sequential full-response requests from developer Windows host; no network throttling or concurrency',stages};
  writeFileSync('docs/qa/volume-performance.json',JSON.stringify(result,null,2)+'\n');
  console.log(JSON.stringify(stages,null,2));
} finally {
  if (db._connected) {
    if(principalId && !mapId && creationKey) {
      const rescue=await db.query("SELECT resource_id FROM app_private.idempotency_keys WHERE principal_id=$1 AND key=$2",[principalId,creationKey]);
      mapId=rescue.rows[0]?.resource_id??null;
    }
    if(principalId) {await cleanup(mapId,principalId); if(existsSync(marker))unlinkSync(marker); console.log('Synthetic volume fixture removed');}
    await db.end();
  }
}
