import {afterAll,beforeAll,describe,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import type {AppSession} from "../src/server/auth/session";
import type {Theme} from "../src/lib/demo-data";

let db:PGlite;let queue:Promise<unknown>=Promise.resolve();let failPhotoCopy=false;
const execute=async(sql:string,values:unknown[]=[])=>{if(failPhotoCopy&&sql.startsWith("INSERT INTO app.observation_photos(map_id,observation_id,uploaded_by,content,mime,created_at)")){failPhotoCopy=false;throw new Error("simulated target photo write failure");}const result=await db.query(sql,values);return {...result,rows:result.rows.map(row=>Object.fromEntries(Object.entries(row as Record<string,unknown>).map(([key,value])=>[key,value instanceof Uint8Array?Buffer.from(value):key==="version"?String(value):value]))),rowCount:result.rows.length||result.affectedRows||0};};
vi.mock("../src/server/db",()=>({query:async(sql:string,values:unknown[]=[])=> (await execute(sql,values)).rows,withTransaction:(action:(client:unknown)=>unknown)=>{const next=queue.then(async()=>{await db.exec("BEGIN");try{const result=await action({query:execute});await db.exec("COMMIT");return result;}catch(error){await db.exec("ROLLBACK");throw error;}});queue=next.catch(()=>{});return next;}}));
import {createMap,createMapSchema,getMapConfiguration} from "../src/server/services/maps";
import {createMergedMap,createMergedMapSchema,previewMapMerge} from "../src/server/services/map-merge";
import {createObservation,observationSchema} from "../src/server/services/observations";
const session=(id:string,kind:AppSession["kind"]="account"):AppSession=>({id:randomUUID(),principalId:id,kind,csrfHash:Buffer.alloc(32),expiresAt:new Date(Date.now()+86400000)});
beforeAll(async()=>{db=new PGlite();await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");for(const name of ["001_core.sql","002_observations.sql","003_community_moderation.sql","004_analysis_proposals.sql","005_retention.sql","006_exploration_games.sql","007_account_roles_game_deletion.sql"])await db.exec(await readFile(`db/migrations/${name}`,"utf8"));for(const path of ["docs/contracts/theme-presets-v1.json","docs/contracts/theme-presets.json"]){const source=JSON.parse(await readFile(path,"utf8"));for(const theme of source.templates as Theme[])await execute("INSERT INTO app.theme_templates(theme_key,version,definition) VALUES($1,$2,$3) ON CONFLICT DO NOTHING",[theme.key,theme.version,JSON.stringify(theme)]);}},30000);
afterAll(async()=>db.close());

async function actor(role:"teacher"|"student"="teacher",kind:AppSession["kind"]="account"){
  const id=randomUUID();await execute("INSERT INTO app.principals(id,kind,auth_user_id,account_role) VALUES($1,$2,$3,$4)",[id,kind,kind==="account"?randomUUID():null,kind==="account"?role:null]);return session(id,kind);
}
async function source(teacher:AppSession,visibility:"public"|"invite_only"="public",title="원본 지도"){
  const created=await createMap(createMapSchema.parse({themeKey:"custom",themeVersion:2,title,locationLabel:"가상 동네",visibility,custom:{pinMode:"category",categories:[{key:"nature",label:"나무",color:"#338855",defaultEmojiKey:"tree",emojiOptions:[{key:"tree",glyph:"🌳",label:"나무"}]}]}}),teacher,randomUUID());
  const mapId=created.map.id;const member=(await execute("SELECT id FROM app.map_members WHERE map_id=$1 AND principal_id=$2",[mapId,teacher.principalId])).rows[0].id as string;
  const published=await createObservation(mapId,teacher,randomUUID(),observationSchema.parse({configRevision:1,title:"큰 나무",body:"나무 아래 그늘이 넓고 잎이 푸르러요.",locationLabel:"학교 정문",locationSource:"gps",location:{lat:37.123,lng:127.234},categoryKey:"nature",emojiKey:"tree",ratingKey:null,answers:{},link:"https://example.com/tree"}));
  const id=published.observation.id;
  await execute("UPDATE app.observations SET created_at='2026-10-01 12:34:56.123456+00',improvement_idea='나무 아래에 벤치가 있으면 좋겠어요.' WHERE id=$1",[id]);
  await execute("INSERT INTO app.observation_photos(map_id,observation_id,uploaded_by,content,mime) VALUES($1,$2,$3,$4,'image/webp')",[mapId,id,teacher.principalId,Buffer.from("independent-test-photo")]);
  for(const status of ["pending","hidden","deleted"])await execute("INSERT INTO app.observations(map_id,author_member_id,title,body,location_label,location_source,lat,lng,category_id,emoji_option_id,status,config_revision) SELECT map_id,author_member_id,$2,body,location_label,location_source,lat,lng,category_id,emoji_option_id,$2,1 FROM app.observations WHERE id=$1",[id,status]);
  await execute("INSERT INTO app.comments(map_id,observation_id,author_member_id,body) VALUES($1,$2,$3,'원본 댓글은 여기에 유지해요.')",[mapId,id,member]);
  return {mapId,id,member};
}
async function fixture(){const teacher=await actor();const a=await source(teacher,"public","첫 번째 원본"),b=await source(teacher,"invite_only","두 번째 원본");const preview=await previewMapMerge({mapIds:[a.mapId,b.mapId]},teacher);return {teacher,a,b,preview};}
function input(f:Awaited<ReturnType<typeof fixture>>,ids=f.preview.points.map(point=>point.id)){return createMergedMapSchema.parse({mapIds:f.preview.sources.map(source=>source.id),title:"선택해서 합친 지도",locationLabel:"가상 동네",pointIds:ids,sourceVersions:Object.fromEntries(f.preview.sources.map(source=>[source.id,source.version])),pointVersions:Object.fromEntries(f.preview.points.filter(point=>ids.includes(point.id)).map(point=>[point.id,point.version]))});}

describe("map merge transaction and source integrity",()=>{
  it("installs preset category, emoji, rating and current-question references with the shared bulk helper",async()=>{
    const teacher=await actor();
    for(const themeKey of ["universal_design","safety","ecology","weather_life"] as const){
      const created=await createMap(createMapSchema.parse({themeKey,themeVersion:2,title:`일괄 설치 ${themeKey}`,locationLabel:"가상 동네",visibility:"invite_only"}),teacher,randomUUID());
      const config=await getMapConfiguration(created.map.id,teacher),theme=config.theme!;
      const counts=(await execute(`SELECT
        (SELECT count(*)::int FROM app.categories WHERE map_id=$1) AS categories,
        (SELECT count(*)::int FROM app.emoji_options WHERE map_id=$1) AS emojis,
        (SELECT count(*)::int FROM app.rating_options WHERE map_id=$1) AS ratings,
        (SELECT count(*)::int FROM app.questions q JOIN app.question_versions v ON v.id=q.current_version_id AND v.question_id=q.id AND v.map_id=q.map_id WHERE q.map_id=$1) AS questions,
        (SELECT count(*)::int FROM app.categories c JOIN app.emoji_options e ON e.id=c.default_emoji_id AND e.category_id=c.id AND e.map_id=c.map_id WHERE c.map_id=$1) AS defaults`,[created.map.id])).rows[0];
      expect(counts).toEqual({categories:theme.categories.length,emojis:theme.categories.reduce((sum,c)=>sum+c.emojiOptions.length,0),ratings:theme.rating?.options.length??0,questions:theme.questions.length,defaults:theme.categories.length});
    }
  });

  it("previews only published points and requires real teacher role and source read access",async()=>{
    const f=await fixture();expect(f.preview.points.map(point=>point.id).sort()).toEqual([f.a.id,f.b.id].sort());expect(f.preview.sources.map(source=>source.pointCount)).toEqual([1,1]);expect(f.preview.sources[0].version).toMatch(/^\d+:\d+:\d+$/);expect(f.preview.points.every(point=>point.photoUrl?.startsWith("/api/v1/maps/"))).toBe(true);
    const outsider=await actor();await expect(previewMapMerge({mapIds:[f.a.mapId,f.b.mapId]},outsider)).rejects.toMatchObject({code:"SOURCE_UNAVAILABLE"});const student=await actor("student");await expect(previewMapMerge({mapIds:[f.a.mapId,f.b.mapId]},{...student,accountRole:"teacher"})).rejects.toMatchObject({code:"TEACHER_REQUIRED"});const guest=await actor("teacher","guest");await expect(previewMapMerge({mapIds:[f.a.mapId,f.b.mapId]},guest)).rejects.toMatchObject({code:"ACCOUNT_REQUIRED"});
  });

  it("atomically copies a selected subset, timestamp precision, independent photo bytes and origin metadata without changing sources",async()=>{
    const f=await fixture();const before=(await execute("SELECT m.id,m.version,m.config_revision,m.data_revision,count(o.id)::int AS points FROM app.maps m LEFT JOIN app.observations o ON o.map_id=m.id WHERE m.id=ANY($1::uuid[]) GROUP BY m.id ORDER BY m.id",[[f.a.mapId,f.b.mapId]])).rows;
    const key=randomUUID(),request=input(f,[f.a.id]);const created=await createMergedMap(request,f.teacher,key);expect(created).toMatchObject({copiedPoints:1,repeated:false,map:{visibility:"invite_only",participation:"invited",moderation:"immediate",isOwner:true,themeKey:"custom"}});
    const copied=(await execute("SELECT o.*,m.principal_id,to_char(o.created_at AT TIME ZONE 'UTC','YYYY-MM-DD HH24:MI:SS.US') AS precise FROM app.observations o JOIN app.map_members m ON m.map_id=o.map_id AND m.id=o.author_member_id WHERE o.map_id=$1",[created.map.id])).rows;
    expect(copied).toHaveLength(1);expect(copied[0]).toMatchObject({title:"큰 나무",body:"나무 아래 그늘이 넓고 잎이 푸르러요.",location_label:"학교 정문",location_source:"gps",lat:37.123,lng:127.234,improvement_idea:"나무 아래에 벤치가 있으면 좋겠어요.",link_url:"https://example.com/tree",precise:"2026-10-01 12:34:56.123456",principal_id:f.teacher.principalId});
    expect(JSON.stringify(copied[0].answers)).toContain("첫 번째 원본");expect(JSON.stringify(copied[0].answers)).toContain("원래 등록일");
    const config=await getMapConfiguration(created.map.id,f.teacher);expect(config.theme?.questions.some(question=>question.key==="merge_origin")).toBe(true);expect(config.theme?.categories).toHaveLength(1);
    const photo=(await execute("SELECT content,uploaded_by FROM app.observation_photos WHERE map_id=$1",[created.map.id])).rows[0];expect(photo.content).toEqual(Buffer.from("independent-test-photo"));expect(photo.uploaded_by).toBe(f.teacher.principalId);expect((await execute("SELECT id FROM app.comments WHERE map_id=$1",[created.map.id])).rows).toHaveLength(0);
    expect((await execute("SELECT m.id,m.version,m.config_revision,m.data_revision,count(o.id)::int AS points FROM app.maps m LEFT JOIN app.observations o ON o.map_id=m.id WHERE m.id=ANY($1::uuid[]) GROUP BY m.id ORDER BY m.id",[[f.a.mapId,f.b.mapId]])).rows).toEqual(before);
    expect(await createMergedMap(request,f.teacher,key)).toMatchObject({map:{id:created.map.id},copiedPoints:1,repeated:true});expect((await execute("SELECT id FROM app.maps WHERE title='선택해서 합친 지도' AND owner_principal_id=$1",[f.teacher.principalId])).rows).toHaveLength(1);
    await execute("DELETE FROM app.observation_photos WHERE observation_id=$1",[f.a.id]);expect((await execute("SELECT content FROM app.observation_photos WHERE map_id=$1",[created.map.id])).rows[0].content).toEqual(Buffer.from("independent-test-photo"));
  });

  it("rejects stale point/config snapshots, unpublished selections and retired source maps before creating a target",async()=>{
    const f=await fixture();await execute("UPDATE app.observations SET version=version+1 WHERE id=$1",[f.a.id]);await expect(createMergedMap(input(f),f.teacher,randomUUID())).rejects.toMatchObject({code:"MERGE_POINTS_CHANGED"});await execute("UPDATE app.observations SET version=version-1 WHERE id=$1",[f.a.id]);await execute("UPDATE app.maps SET config_revision=config_revision+1 WHERE id=$1",[f.a.mapId]);await expect(createMergedMap(input(f),f.teacher,randomUUID())).rejects.toMatchObject({code:"THEME_UNAVAILABLE"});await execute("UPDATE app.maps SET config_revision=config_revision-1,version=version+1 WHERE id=$1",[f.a.mapId]);await expect(createMergedMap(input(f),f.teacher,randomUUID())).rejects.toMatchObject({code:"MERGE_SOURCE_CHANGED"});
    await execute("UPDATE app.maps SET version=version-1 WHERE id=$1",[f.a.mapId]);await execute("UPDATE app.observations SET status='hidden' WHERE id=$1",[f.a.id]);await expect(createMergedMap(input(f),f.teacher,randomUUID())).rejects.toMatchObject({code:"MERGE_POINTS_CHANGED"});await execute("UPDATE app.maps SET status='archived' WHERE id=$1",[f.a.mapId]);await expect(previewMapMerge({mapIds:[f.a.mapId,f.b.mapId]},f.teacher)).rejects.toMatchObject({code:"SOURCE_UNAVAILABLE"});expect((await execute("SELECT id FROM app.maps WHERE title='선택해서 합친 지도' AND owner_principal_id=$1",[f.teacher.principalId])).rows).toHaveLength(0);
  });

  it("rolls back map/config/points together when the photo copy fails and can safely retry the same key",async()=>{
    const f=await fixture();const request=input(f),key=randomUUID();failPhotoCopy=true;
    await expect(createMergedMap(request,f.teacher,key)).rejects.toThrow("simulated target photo write failure");
    expect((await execute("SELECT id FROM app.maps WHERE title='선택해서 합친 지도' AND owner_principal_id=$1",[f.teacher.principalId])).rows).toHaveLength(0);expect((await execute("SELECT key FROM app_private.idempotency_keys WHERE principal_id=$1 AND route_scope='create_merged_map' AND key=$2",[f.teacher.principalId,key])).rows).toHaveLength(0);
    expect(await createMergedMap(request,f.teacher,key)).toMatchObject({copiedPoints:2,repeated:false});
  });

  it("requires complete preview tokens and rechecks teacher role and private membership before creation",async()=>{
    const f=await fixture(),request=input(f);
    const {sourceVersions:omitted,...withoutSources}=request;void omitted;
    expect(createMergedMapSchema.safeParse(withoutSources).success).toBe(false);
    expect(createMergedMapSchema.safeParse({...request,sourceVersions:{}}).success).toBe(false);
    expect(createMergedMapSchema.safeParse({...request,pointVersions:{}}).success).toBe(false);
    const student=await actor("student");
    await expect(createMergedMap(request,{...student,accountRole:"teacher"},randomUUID())).rejects.toMatchObject({code:"TEACHER_REQUIRED"});
    const collaborator=await actor();
    await execute("INSERT INTO app.map_members(map_id,principal_id,nickname) VALUES($1,$2,'함께 만든 교사')",[f.b.mapId,collaborator.principalId]);
    const preview=await previewMapMerge({mapIds:request.mapIds},collaborator);
    const collaboratorRequest={...request,sourceVersions:Object.fromEntries(preview.sources.map(source=>[source.id,source.version]))};
    for(const status of ["blocked","left"]){
      await execute("UPDATE app.map_members SET status=$3 WHERE map_id=$1 AND principal_id=$2",[f.b.mapId,collaborator.principalId,status]);
      await expect(createMergedMap(collaboratorRequest,collaborator,randomUUID())).rejects.toMatchObject({code:"SOURCE_UNAVAILABLE"});
    }
    expect((await execute("SELECT id FROM app.maps WHERE title='선택해서 합친 지도' AND owner_principal_id=$1",[collaborator.principalId])).rows).toHaveLength(0);
  });

  it("rejects over 2,000 published points and oversized preview payloads explicitly",async()=>{
    const f=await fixture();
    await execute(`INSERT INTO app.observations(map_id,author_member_id,title,body,location_label,location_source,lat,lng,category_id,emoji_option_id,status,config_revision)
      SELECT o.map_id,o.author_member_id,'대량 기록',o.body,o.location_label,o.location_source,o.lat,o.lng,o.category_id,o.emoji_option_id,'published',1
      FROM app.observations o CROSS JOIN generate_series(1,1999) WHERE o.id=$1`,[f.a.id]);
    await expect(previewMapMerge({mapIds:[f.a.mapId,f.b.mapId]},f.teacher)).rejects.toMatchObject({status:422,code:"MERGE_PREVIEW_LIMIT"});
    await execute("DELETE FROM app.observations WHERE map_id=$1 AND title='대량 기록'",[f.a.mapId]);
    await execute(`INSERT INTO app.observations(map_id,author_member_id,title,body,location_label,location_source,lat,lng,category_id,emoji_option_id,status,config_revision)
      SELECT o.map_id,o.author_member_id,'긴 기록',repeat('가',2000),o.location_label,o.location_source,o.lat,o.lng,o.category_id,o.emoji_option_id,'published',1
      FROM app.observations o CROSS JOIN generate_series(1,700) WHERE o.id=$1`,[f.a.id]);
    await expect(previewMapMerge({mapIds:[f.a.mapId,f.b.mapId]},f.teacher)).rejects.toMatchObject({status:422,code:"MERGE_PREVIEW_SIZE"});
  });
});
