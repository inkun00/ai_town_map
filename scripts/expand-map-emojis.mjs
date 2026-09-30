// Explicit, transactional catalogue upgrade. No observation or published v1 is rewritten.
import {readFile} from "node:fs/promises";
import {loadEnvFile} from "node:process";
import pg from "pg";
import {emojiUpgradePlan} from "../src/domain/emoji-upgrade.ts";

if(process.env.RUN_EMOJI_UPGRADE!=="1")throw new Error("Set RUN_EMOJI_UPGRADE=1");
loadEnvFile(".env.migrate.local");
const latest=JSON.parse(await readFile("docs/contracts/theme-presets.json","utf8")).templates;
const legacy=JSON.parse(await readFile("docs/contracts/theme-presets-v1.json","utf8")).templates;
const client=new pg.Client({connectionString:process.env.DATABASE_ADMIN_URL});
await client.connect();
try{
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(20261001,502)");
  for(const theme of [...legacy,...latest]){
    const prior=await client.query("SELECT definition=$3::jsonb AS matches FROM app.theme_templates WHERE theme_key=$1 AND version=$2",[theme.key,theme.version,JSON.stringify(theme)]);
    if(prior.rowCount&&!prior.rows[0].matches)throw new Error(`Published template conflict: ${theme.key} v${theme.version}`);
    if(!prior.rowCount)await client.query("INSERT INTO app.theme_templates(theme_key,version,definition) VALUES($1,$2,$3)",[theme.key,theme.version,JSON.stringify(theme)]);
  }
  const maps=(await client.query("SELECT id,theme_key,config_revision,owner_principal_id FROM app.maps WHERE theme_key<>'custom' AND status IN ('active','archived') ORDER BY id FOR UPDATE")).rows;
  let updated=0,added=0;
  for(const map of maps){
    const current=(await client.query("SELECT definition FROM app.map_config_revisions WHERE map_id=$1 AND revision=$2",[map.id,map.config_revision])).rows[0]?.definition;
    if(!current)throw new Error("Missing map configuration");
    const template=latest.find(theme=>theme.key===map.theme_key);
    if(!template)throw new Error("Missing theme template");
    const {theme,additions}=emojiUpgradePlan(current,template);
    if(!additions.length)continue;
    const categories=(await client.query("SELECT id,key FROM app.categories WHERE map_id=$1",[map.id])).rows;
    for(const {categoryKey,emoji,sortOrder} of additions){
      const category=categories.find(item=>item.key===categoryKey);
      if(!category)throw new Error("Missing map category");
      const existing=(await client.query("SELECT id,glyph,label FROM app.emoji_options WHERE map_id=$1 AND category_id=$2 AND key=$3",[map.id,category.id,emoji.key])).rows[0];
      if(existing&&(existing.glyph!==emoji.glyph||existing.label!==emoji.label))throw new Error("Existing emoji meaning conflict");
      const id=existing?.id??(await client.query("INSERT INTO app.emoji_options(map_id,category_id,key,glyph,label,sort_order) VALUES($1,$2,$3,$4,$5,$6) RETURNING id",[map.id,category.id,emoji.key,emoji.glyph,emoji.label,sortOrder])).rows[0].id;
      if(theme.identifiers?.emojiOptions)theme.identifiers.emojiOptions[`${categoryKey}:${emoji.key}`]=id;
    }
    const revision=map.config_revision+1;
    await client.query("INSERT INTO app.map_config_revisions(map_id,revision,definition,created_by) VALUES($1,$2,$3,$4)",[map.id,revision,JSON.stringify(theme),map.owner_principal_id]);
    await client.query("UPDATE app.maps SET config_revision=$2,version=version+1,data_revision=data_revision+1,updated_at=now() WHERE id=$1",[map.id,revision]);
    updated++;added+=additions.length;
  }
  await client.query("COMMIT");
  console.log(`Emoji catalogue upgraded: ${updated} maps, ${added} added options`);
}catch(error){await client.query("ROLLBACK");throw error;}
finally{await client.end();}
