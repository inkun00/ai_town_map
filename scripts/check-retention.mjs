import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
const q = (sql, values=[]) => db.query(sql, values);
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const count = async (table, where="true") => Number((await q(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`)).rows[0].n);
try {
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  for (const name of ["001_core.sql","002_observations.sql","003_community_moderation.sql","004_analysis_proposals.sql","005_retention.sql"])
    await db.exec(await readFile(`db/migrations/${name}`,"utf8"));
  await q("INSERT INTO app.principals(id,kind,auth_user_id) VALUES($1,'account',$2)",[id(1),id(2)]);
  await q("INSERT INTO app.theme_templates(id,theme_key,version,definition) VALUES($1,'custom',1,'{}')",[id(3)]);
  const maps = [
    { map:id(10),member:id(11),category:id(12),emoji:id(13),status:"deleted",age:31 },
    { map:id(20),member:id(21),category:id(22),emoji:id(23),status:"deleted",age:29 },
    { map:id(30),member:id(31),category:id(32),emoji:id(33),status:"active",age:null },
  ];
  for (const m of maps) {
    await q(`INSERT INTO app.maps(id,owner_principal_id,template_id,theme_key,title,location_label,activity_context,
      visibility,pin_mode,single_color,rating_enabled,ideas_enabled,proposals_enabled,comments_enabled,status,deleted_at)
      VALUES($1,$2,$3,'custom','검증 지도','검증 지역','community','invite_only','single','#285943',false,true,true,true,$4,
      CASE WHEN $5::int IS NULL THEN NULL ELSE now()-make_interval(days=>$5::int) END)`,[m.map,id(1),id(3),m.status,m.age]);
    await q("INSERT INTO app.map_members(id,map_id,principal_id,nickname,role) VALUES($1,$2,$3,'검증자','admin')",[m.member,m.map,id(1)]);
    await q("INSERT INTO app.categories(id,map_id,key,label,sort_order) VALUES($1,$2,'place','장소',0)",[m.category,m.map]);
    await q("INSERT INTO app.emoji_options(id,map_id,category_id,key,glyph,label,sort_order) VALUES($1,$2,$3,'tree','🌳','나무',0)",[m.emoji,m.map,m.category]);
    await q("INSERT INTO app.map_config_revisions(map_id,revision,definition,created_by) VALUES($1,1,'{}',$2)",[m.map,id(1)]);
    await q("INSERT INTO app_private.invites(map_id,code_hmac,expires_at,max_uses,created_by) VALUES($1,decode(repeat($2,64),'hex'),now()+interval '1 day',10,$3)",[m.map,String(m.map===id(10)?"a":m.map===id(20)?"b":"c"),id(1)]);
  }
  const addObservation = async (n,m,status,age) => {
    await q(`INSERT INTO app.observations(id,map_id,author_member_id,title,body,location_label,location_source,
      lat,lng,category_id,emoji_option_id,status,config_revision,deleted_at)
      VALUES($1,$2,$3,'검증 기록','검증용 기록 내용입니다','검증 지역','manual',37.5,127,$4,$5,$6,1,
      CASE WHEN $7::int IS NULL THEN NULL ELSE now()-make_interval(days=>$7::int) END)`,
      [id(n),m.map,m.member,m.category,m.emoji,status,age]);
    return id(n);
  };
  const oldMapObs=await addObservation(100,maps[0],"published",null);
  const oldObs=await addObservation(101,maps[2],"deleted",31);
  const recentObs=await addObservation(102,maps[2],"deleted",29);
  await q("INSERT INTO app.observation_photos(map_id,observation_id,uploaded_by,content,mime) VALUES($1,$2,$3,decode('00','hex'),'image/webp'),($4,$5,$3,decode('00','hex'),'image/webp')",[maps[0].map,oldMapObs,id(1),maps[2].map,oldObs]);
  const addComment = async (n,obs,status,age) => {
    const m=obs===oldMapObs?maps[0]:maps[2];
    await q(`INSERT INTO app.comments(id,map_id,observation_id,author_member_id,body,status,updated_at)
      VALUES($1,$2,$3,$4,'검증 댓글',$5,now()-make_interval(days=>$6::int))`,[id(n),m.map,obs,m.member,status,age]);
  };
  await addComment(110,oldMapObs,"visible",1);
  await addComment(111,oldObs,"visible",1);
  await addComment(112,recentObs,"deleted",31);
  await addComment(113,recentObs,"deleted",29);
  await q("INSERT INTO app.reports(id,map_id,reporter_member_id,target_type,target_id,reason_code) VALUES($1,$2,$3,'observation',$4,'spam'),($5,$6,$7,'comment',$8,'spam')",
    [id(120),maps[2].map,maps[2].member,oldObs,id(121),maps[2].map,maps[2].member,id(112)]);
  await q("INSERT INTO app.audit_events(map_id,actor_principal_id,action,target_type,target_id) VALUES($1,$2,'report.resolved','report',$3)",[maps[2].map,id(1),id(120)]);
  const addProposal = async (n,m,age) => {
    await db.exec("BEGIN");
    await q(`INSERT INTO app.proposals(id,map_id,author_member_id,request_key,request_hash,deleted_at)
      VALUES($1,$2,$3,$4,decode(repeat('a',64),'hex'),CASE WHEN $5::int IS NULL THEN NULL ELSE now()-make_interval(days=>$5::int) END)`,
      [id(n),m.map,m.member,id(n+50),age]);
    await q("INSERT INTO app.proposal_versions(map_id,proposal_id,revision,status,content,evidence,snapshot) VALUES($1,$2,1,'draft','{}','[]','{}')",[m.map,id(n)]);
    await db.exec("COMMIT");
  };
  await addProposal(130,maps[0],null);
  await addProposal(131,maps[2],31);
  await addProposal(132,maps[2],29);
  const result=(await q("SELECT app_private.purge_expired_content() AS result")).rows[0].result;
  if (result.maps!==1||result.observations!==1||result.comments!==1||result.proposals!==1)
    throw new Error(`Wrong purge counts: ${JSON.stringify(result)}`);
  if (await count("app.maps")!==2 || await count("app.observations")!==1 || await count("app.comments")!==1 ||
      await count("app.observation_photos")!==0 || await count("app.proposals")!==1 ||
      await count("app.proposal_versions")!==1 || await count("app.reports")!==0 ||
      await count("app.audit_events")!==0 || await count("app_private.invites")!==2)
    throw new Error("Purge did not remove all expired dependencies or preserved entries");
  const surviving=(await q("SELECT id FROM app.observations")).rows[0].id;
  if (surviving!==recentObs || await count("app.maps",`id='${maps[1].map}'`)!==1 ||
      await count("app.comments",`id='${id(113)}'`)!==1 || await count("app.proposals",`id='${id(132)}'`)!==1)
    throw new Error("An in-window record was purged");
  const again=(await q("SELECT app_private.purge_expired_content() AS result")).rows[0].result;
  if (again.maps||again.observations||again.comments||again.proposals) throw new Error("Purge was not idempotent");
  const privilege=(await q("SELECT has_function_privilege('app_backend','app_private.purge_expired_content()','EXECUTE') AS allowed")).rows[0].allowed;
  if (privilege) throw new Error("Application role may execute retention purge");
  console.log("30-day retention boundary, dependency cleanup, idempotency and privilege verified in PGlite");
} finally {
  await db.close();
}
