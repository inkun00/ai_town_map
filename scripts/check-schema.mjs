import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";

const db = new PGlite();
try {
  await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  for(const name of ["001_core.sql","002_observations.sql","003_community_moderation.sql", "004_analysis_proposals.sql"]){
    await db.exec(await readFile(`db/migrations/${name}`,"utf8"));
  }
  const result = await db.query("SELECT count(*)::int AS count FROM information_schema.tables WHERE table_schema IN ('app','app_private')");
  if (result.rows[0].count < 22) throw new Error("Application tables were not created");
  const privileges = await db.query("SELECT has_table_privilege('anon','app.maps','SELECT') AS anon_read, has_table_privilege('app_backend','app.maps','SELECT') AS backend_read, has_table_privilege('app_backend','app.theme_templates','UPDATE') AS template_update");
  if (privileges.rows[0].anon_read || !privileges.rows[0].backend_read || privileges.rows[0].template_update) throw new Error("Database grants are not isolated");
  await db.exec(`
    INSERT INTO app.principals(id,kind,auth_user_id) VALUES
      ('00000000-0000-4000-8000-000000000001','account','00000000-0000-4000-8000-000000000011');
    INSERT INTO app.theme_templates(id,theme_key,version,definition) VALUES
      ('00000000-0000-4000-8000-000000000021','custom',1,'{}');
    INSERT INTO app.maps(id,owner_principal_id,template_id,theme_key,title,location_label,activity_context,visibility,pin_mode,single_color,rating_enabled,ideas_enabled,proposals_enabled,comments_enabled) VALUES
      ('00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000021','custom','지도 A','지역 A','community','invite_only','single','#285943',false,false,false,true),
      ('00000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000021','custom','지도 B','지역 B','community','invite_only','single','#285943',false,false,false,true);
    INSERT INTO app.categories(id,map_id,key,label,sort_order) VALUES
      ('00000000-0000-4000-8000-000000000041','00000000-0000-4000-8000-000000000031','a','카테고리 A',0),
      ('00000000-0000-4000-8000-000000000042','00000000-0000-4000-8000-000000000032','b','카테고리 B',0);
    INSERT INTO app.emoji_options(id,map_id,category_id,key,glyph,label,sort_order) VALUES
      ('00000000-0000-4000-8000-000000000051','00000000-0000-4000-8000-000000000031','00000000-0000-4000-8000-000000000041','a','☕','카페',0),
      ('00000000-0000-4000-8000-000000000052','00000000-0000-4000-8000-000000000032','00000000-0000-4000-8000-000000000042','b','🌳','나무',0);
  `);
  let crossMapRejected = false;
  try {
    await db.exec(`BEGIN; UPDATE app.categories SET default_emoji_id='00000000-0000-4000-8000-000000000052' WHERE id='00000000-0000-4000-8000-000000000041'; COMMIT;`);
  } catch { crossMapRejected = true; await db.exec("ROLLBACK"); }
  if (!crossMapRejected) throw new Error("Cross-map emoji reference was accepted");
  process.stdout.write(`Migration syntax, ${result.rows[0].count} tables, grants, and cross-map emoji FK verified in PGlite\n`);
} finally {
  await db.close();
}
