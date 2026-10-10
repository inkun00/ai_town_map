import {describe,it,expect,beforeAll,afterAll,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {emojiCatalog,filterCatalog,normalizeEmoji,recordEmojiOptions} from "../src/lib/emoji-catalog";
import {getPointEmoji,type Theme} from "../src/lib/demo-data";
import type {AppSession} from "../src/server/auth/session";

let db:PGlite;
let queue:Promise<unknown>=Promise.resolve();
async function execute(sql:string,values:unknown[]=[]){
  const r=await db.query(sql,values);
  return {...r,rows:r.rows.map(row=>Object.fromEntries(Object.entries(row as Record<string,unknown>).map(([key,value])=>[key,value instanceof Uint8Array?Buffer.from(value):key==="version"?String(value):value]))),rowCount:r.rows.length||r.affectedRows||0};
}
vi.mock("../src/server/db",()=>({withTransaction:(action:(client:unknown)=>unknown)=>{
  const next=queue.then(async()=>{await db.exec("BEGIN");try{const result=await action({query:execute});await db.exec("COMMIT");return result;}catch(e){await db.exec("ROLLBACK");throw e;}});
  queue=next.catch(()=>{});return next;
}}));
import {createObservation,updateObservation,listObservations,type ObservationInput} from "../src/server/services/observations";

beforeAll(async()=>{
  db=new PGlite();await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  for(const name of ["001_core.sql","002_observations.sql","003_community_moderation.sql","004_analysis_proposals.sql","005_retention.sql","006_exploration_games.sql","007_account_roles_game_deletion.sql"])await db.exec(await readFile(`db/migrations/${name}`,"utf8"));
},30000);
afterAll(async()=>{await db.close();});

const fox=emojiCatalog.find(e=>e.glyph==="🦊")!;
const rocket=emojiCatalog.find(e=>e.glyph==="🚀")!;
async function fixture(){
  const owner=randomUUID(),map=randomUUID(),template=randomUUID(),member=randomUUID(),category=randomUUID(),emoji=randomUUID();
  const teacher:AppSession={id:randomUUID(),principalId:owner,kind:"account",csrfHash:Buffer.alloc(32),expiresAt:new Date(Date.now()+86400000)};
  const theme:Theme&{identifiers:Record<string,Record<string,string>>}={key:"custom",label:"직접 만들기",version:1,features:{ratingEnabled:false,ideasEnabled:false,proposalsEnabled:false,commentsEnabled:true},pin:{mode:"single"},rating:null,questions:[],categories:[{key:"test",label:"관찰",color:"#267253",defaultEmojiKey:"tree",emojiOptions:[{key:"tree",glyph:"🌳",label:"나무"}]}],identifiers:{categories:{test:category},emojiOptions:{"test:tree":emoji},ratingOptions:{},questionVersions:{}}};
  await execute("INSERT INTO app.principals(id,kind,auth_user_id) VALUES($1,'account',$2)",[owner,randomUUID()]);
  await execute("INSERT INTO app.theme_templates(id,theme_key,version,definition) VALUES($1,$2,1,'{}')",[template,randomUUID()]);
  await execute(`INSERT INTO app.maps(id,owner_principal_id,template_id,theme_key,title,location_label,activity_context,visibility,pin_mode,single_color,rating_enabled,ideas_enabled,proposals_enabled,comments_enabled) VALUES($1,$2,$3,'custom','이모지 시험 지도','가상 지역','school','invite_only','single','#267253',false,false,false,true)`,[map,owner,template]);
  await execute("INSERT INTO app.map_members(id,map_id,principal_id,nickname) VALUES($1,$2,$3,'관찰 학생')",[member,map,owner]);
  await execute("INSERT INTO app.categories(id,map_id,key,label,sort_order) VALUES($1,$2,'test','관찰',0)",[category,map]);
  await execute("INSERT INTO app.emoji_options(id,map_id,category_id,key,glyph,label,sort_order) VALUES($1,$2,$3,'tree','🌳','나무',0)",[emoji,map,category]);
  await execute("INSERT INTO app.map_config_revisions(map_id,revision,definition,created_by) VALUES($1,1,$2,$3)",[map,JSON.stringify(theme),owner]);
  const input:ObservationInput={configRevision:1,title:"여우를 발견했어요",body:"공원에서 여우 모양의 조형물을 발견했어요.",locationLabel:"내가 입력한 장소",locationSource:"gps",location:{lat:37.5,lng:127},categoryKey:"test",emojiKey:fox.key,ratingKey:null,answers:{}};
  return {map,teacher,theme,input};
}

describe("전체 이모지 탐색",()=>{
  it("모든 9개 카테고리와 한글·영문·이모지 검색을 제공한다",()=>{
    expect(emojiCatalog).toHaveLength(3944);
    expect(new Set(emojiCatalog.map(e=>e.groupKey)).size).toBe(9);
    expect(new Set(emojiCatalog.map(e=>e.key)).size).toBe(3944);
    expect(emojiCatalog.every(e=>e.key.length<=60&&[...e.label].length<=60&&[...e.glyph].length<=16)).toBe(true);
    for(const query of ["여우","FOX","🦊"])expect(filterCatalog(emojiCatalog,query).some(e=>e.key===fox.key)).toBe(true);
    expect(filterCatalog(emojiCatalog,"",fox.groupKey).every(e=>e.groupKey===fox.groupKey)).toBe(true);
  });
  it("지도별 키·사용자 이름을 보존하고 사용 중지된 이모지의 우회 선택을 막는다",()=>{
    const options=[{key:"mine",glyph:"🦊",label:"우리 학교 마스코트"},{key:"off",glyph:"☀",label:"햇빛",active:false}];
    const choices=recordEmojiOptions(options);
    expect(choices.find(e=>e.glyph==="🦊")).toMatchObject({key:"mine",label:"우리 학교 마스코트",groupKey:"map"});
    expect(choices.some(e=>normalizeEmoji(e.glyph)==="☀")).toBe(false);
    expect(recordEmojiOptions(options,"off").some(e=>e.key==="off")).toBe(true);
    expect(getPointEmoji({categories:[]} as unknown as Theme,{categoryKey:"test",emojiKey:fox.key})?.glyph).toBe("🦊");
  });
});

describe("기존 지도에서 전체 이모지 저장",()=>{
  it("참여자가 새 이모지를 등록하고 재시도해도 한 번만 저장한다",async()=>{
    const f=await fixture(),key=randomUUID();
    const saved=await createObservation(f.map,f.teacher,key,f.input);
    expect(saved.observation).toMatchObject({emojiKey:fox.key,categoryKey:"test",locationLabel:"내가 입력한 장소"});
    expect(await createObservation(f.map,f.teacher,key,f.input)).toMatchObject({repeated:true,observation:{id:saved.observation.id}});
    const current=(await execute("SELECT definition FROM app.map_config_revisions WHERE map_id=$1 AND revision=2",[f.map])).rows[0].definition as typeof f.theme;
    expect(current.categories[0].emojiOptions).toHaveLength(2);
    expect(current.categories[0].emojiOptions[0]).toEqual(f.theme.categories[0].emojiOptions[0]);
    expect(current.identifiers.emojiOptions[`test:${fox.key}`]).toBeTruthy();
    expect(current.features).toEqual(f.theme.features);
    expect((await execute("SELECT id FROM app.emoji_options WHERE map_id=$1 AND key=$2",[f.map,fox.key])).rows).toHaveLength(1);
    expect((await listObservations(f.map,f.teacher)).items[0].emojiKey).toBe(fox.key);
    await createObservation(f.map,f.teacher,randomUUID(),{...f.input,configRevision:2});
    expect((await execute("SELECT config_revision FROM app.maps WHERE id=$1",[f.map])).rows[0].config_revision).toBe(2);
  });
  it("수정으로 다른 카테고리의 이모지를 선택해도 관찰 유형을 유지한다",async()=>{
    const f=await fixture();const saved=await createObservation(f.map,f.teacher,randomUUID(),f.input);
    const changed=await updateObservation(f.map,saved.observation.id,f.teacher,saved.observation.version,{...f.input,configRevision:2,emojiKey:rocket.key});
    expect(changed).toMatchObject({emojiKey:rocket.key,categoryKey:"test"});
    expect((await execute("SELECT config_revision FROM app.maps WHERE id=$1",[f.map])).rows[0].config_revision).toBe(3);
  });
  it("위조·사용 중지 이모지와 쓰기 권한 없는 요청은 설정을 추가하지 않는다",async()=>{
    const f=await fixture();
    await expect(createObservation(f.map,f.teacher,randomUUID(),{...f.input,emojiKey:"emoji-forged"})).rejects.toMatchObject({code:"INVALID_EMOJI"});
    const tree=emojiCatalog.find(e=>e.glyph==="🌳")!;
    await execute("UPDATE app.emoji_options SET active=false WHERE map_id=$1 AND key='tree'",[f.map]);
    await expect(createObservation(f.map,f.teacher,randomUUID(),{...f.input,emojiKey:tree.key})).rejects.toMatchObject({code:"INVALID_EMOJI"});
    await execute("UPDATE app.maps SET participation='closed' WHERE id=$1",[f.map]);
    await expect(createObservation(f.map,f.teacher,randomUUID(),f.input)).rejects.toMatchObject({code:"WRITE_FORBIDDEN"});
    expect((await execute("SELECT config_revision FROM app.maps WHERE id=$1",[f.map])).rows[0].config_revision).toBe(1);
  });
  it("본문 검증 실패 시 새 이모지와 설정 변경도 함께 취소한다",async()=>{
    const f=await fixture();
    await expect(createObservation(f.map,f.teacher,randomUUID(),{...f.input,ratingKey:"invalid"})).rejects.toMatchObject({code:"RATING_NOT_ALLOWED"});
    expect((await execute("SELECT config_revision FROM app.maps WHERE id=$1",[f.map])).rows[0].config_revision).toBe(1);
    expect((await execute("SELECT id FROM app.emoji_options WHERE map_id=$1",[f.map])).rows).toHaveLength(1);
    await expect(createObservation(f.map,f.teacher,randomUUID(),{...f.input,configRevision:2})).rejects.toMatchObject({code:"CONFIG_CHANGED"});
  });
});
