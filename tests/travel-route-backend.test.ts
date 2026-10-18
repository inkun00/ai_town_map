import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from "vitest";
import {PGlite} from "@electric-sql/pglite";
import {readFile} from "node:fs/promises";
import {randomUUID} from "node:crypto";
import {NextRequest} from "next/server";
import type {AppSession} from "../src/server/auth/session";

let db:PGlite,queue:Promise<unknown>=Promise.resolve(),transactionOpen=false;
const execute=async(sql:string,values:unknown[]=[])=>{
  const result=await db.query(sql,values);return {...result,rowCount:result.rows.length||result.affectedRows||0,rows:result.rows.map(row=>Object.fromEntries(Object.entries(row as Record<string,unknown>).map(([key,value])=>[key,value instanceof Uint8Array?Buffer.from(value):["version","data_revision"].includes(key)?String(value):value])))};
};
vi.mock("../src/server/db",()=>({
  query:async(sql:string,values:unknown[]=[])=> (await execute(sql,values)).rows,
  withTransaction:(action:(client:unknown)=>unknown)=>{
    const task=queue.then(async()=>{await db.exec("BEGIN");transactionOpen=true;try{const result=await action({query:execute});await db.exec("COMMIT");return result;}catch(error){await db.exec("ROLLBACK");throw error;}finally{transactionOpen=false;}});queue=task.catch(()=>{});return task;
  },
}));
vi.mock("../src/server/env",()=>({getServerConfig:()=>({appOrigin:"http://localhost:3001",invitePepper:"travel-tests-not-a-real-key-independent-limits"})}));
const probe=vi.hoisted(()=>({route:vi.fn(),config:vi.fn()}));
vi.mock("../src/server/routing/kakao",()=>({getTravelRouter:()=>{probe.config();return {provider:"Kakao",credit:"카카오모빌리티",route:probe.route};}}));
import {createMap,createMapSchema} from "../src/server/services/maps";
import {createObservation,observationSchema} from "../src/server/services/observations";
import {calculateTravelRoute} from "../src/server/services/travel-route";
import {ApiError} from "../src/server/http";
import {POST} from "../src/app/api/v1/maps/[mapId]/travel-route/route";

let owner:AppSession,mapId:string,ids:string[],serial=0;
const plan=()=>({stops:ids.map(pointId=>({pointId,mode:"car"}))});
beforeAll(async()=>{
  db=new PGlite();await db.exec("CREATE ROLE anon; CREATE ROLE authenticated;");
  for(const file of ["001_core.sql","002_observations.sql","003_community_moderation.sql","004_analysis_proposals.sql","005_retention.sql","006_exploration_games.sql","007_account_roles_game_deletion.sql","008_map_participation_passwords.sql","009_student_identifiers.sql"])await db.exec(await readFile(`db/migrations/${file}`,"utf8"));
  const theme=JSON.parse(await readFile("docs/contracts/theme-presets.json","utf8")).templates.find((item:{key:string})=>item.key==="tourism");
  await execute("INSERT INTO app.theme_templates(theme_key,version,definition) VALUES($1,$2,$3)",[theme.key,theme.version,JSON.stringify(theme)]);
},30000);
afterAll(async()=>db.close());
beforeEach(async()=>{
  vi.clearAllMocks();probe.config.mockReset();probe.route.mockReset();serial++;
  await execute("DELETE FROM app_private.invite_attempts");
  const principalId=randomUUID();await execute("INSERT INTO app.principals(id,kind,auth_user_id,account_role) VALUES($1,'account',$2,'teacher')",[principalId,randomUUID()]);
  owner={id:randomUUID(),principalId,kind:"account",accountRole:"teacher",csrfHash:Buffer.alloc(32),expiresAt:new Date(Date.now()+86400000)};
  const theme=JSON.parse(await readFile("docs/contracts/theme-presets.json","utf8")).templates.find((item:{key:string})=>item.key==="tourism");
  const map=await createMap(createMapSchema.parse({themeKey:"tourism",themeVersion:theme.version,title:"여행 동선 검증",locationLabel:"가상 지역",visibility:"public"}),owner,randomUUID());mapId=map.map.id;
  const category=theme.categories[0],emoji=category.emojiOptions[0];ids=[];
  for(let index=0;index<3;index++){
    const saved=await createObservation(mapId,owner,randomUUID(),observationSchema.parse({configRevision:1,title:`가상 관광지 ${index}`,body:"관광지의 특징을 직접 살펴보고 남긴 관찰입니다.",locationLabel:"가상 위치",locationSource:"manual",location:{lat:37.5+index*.01+serial*.00001,lng:126.8+index*.01},categoryKey:category.key,emojiKey:emoji.key,ratingKey:null,answers:{}}));ids.push(saved.observation.id);
  }
  probe.route.mockImplementation(async(from:{lat:number;lng:number},to:{lat:number;lng:number})=>{expect(transactionOpen).toBe(false);return {status:"ready",paths:[[from,to]],distanceMeters:2000,durationSeconds:300};});
});
afterEach(()=>{vi.unstubAllEnvs();});

describe("server-owned travel route sources",()=>{
  it("uses registered published coordinates only, in selected order, without editing map data",async()=>{
    const before=await execute("SELECT data_revision,version FROM app.maps WHERE id=$1",[mapId]);
    const result=await calculateTravelRoute(mapId,null,plan(),"school-wifi");
    expect(result).toMatchObject({provider:"Kakao",credit:"카카오모빌리티"});expect(result.legs.map(leg=>[leg.fromId,leg.toId,leg.mode])).toEqual([[ids[0],ids[1],"car"],[ids[1],ids[2],"car"]]);
    expect(probe.route).toHaveBeenCalledTimes(2);expect(Object.keys(probe.route.mock.calls[0][0])).toEqual(["lat","lng"]);
    expect(await execute("SELECT data_revision,version FROM app.maps WHERE id=$1",[mapId])).toEqual(before);
  });
  it("rejects duplicate/extra/arbitrary coordinates, too few or too many stops before provider work",async()=>{
    for(const input of [{stops:[]},{stops:plan().stops.slice(0,1)},{stops:[plan().stops[0],plan().stops[0]]},{...plan(),coordinates:[1,2]},{stops:plan().stops.map(stop=>({...stop,location:{lat:1,lng:2}}))},{stops:Array.from({length:13},()=>({pointId:randomUUID(),mode:"car"}))}])await expect(calculateTravelRoute(mapId,null,input,"actor")).rejects.toBeDefined();
    expect(probe.route).not.toHaveBeenCalled();
  });
  it("rejects unpublished, foreign, removed, and unavailable source maps",async()=>{
    await execute("UPDATE app.observations SET status='hidden' WHERE id=$1",[ids[1]]);await expect(calculateTravelRoute(mapId,null,plan(),"actor")).rejects.toMatchObject({code:"TRAVEL_POINTS_CHANGED"});
    await execute("UPDATE app.observations SET status='published' WHERE id=$1",[ids[1]]);
    await expect(calculateTravelRoute(mapId,null,{stops:[{pointId:ids[0],mode:"car"},{pointId:randomUUID(),mode:"car"}]},"actor")).rejects.toMatchObject({code:"TRAVEL_POINTS_CHANGED"});
    await execute("UPDATE app.maps SET theme_key='ecology' WHERE id=$1",[mapId]);await expect(calculateTravelRoute(mapId,null,plan(),"actor")).rejects.toMatchObject({code:"TRAVEL_THEME_UNSUPPORTED"});
    await execute("UPDATE app.maps SET theme_key='tourism',status='draft' WHERE id=$1",[mapId]);await expect(calculateTravelRoute(mapId,null,plan(),"actor")).rejects.toMatchObject({code:"NOT_FOUND"});
    await execute("UPDATE app.maps SET status='deleted' WHERE id=$1",[mapId]);await expect(calculateTravelRoute(mapId,owner,plan(),"actor")).rejects.toMatchObject({code:"NOT_FOUND"});expect(probe.route).not.toHaveBeenCalled();
  });
  it("revalidates source visibility and coordinates after network calls without holding a transaction",async()=>{
    probe.route.mockImplementationOnce(async()=>{await execute("UPDATE app.observations SET lng=lng+0.001 WHERE id=$1",[ids[0]]);return {status:"ready",paths:[],distanceMeters:100,durationSeconds:60};});
    await expect(calculateTravelRoute(mapId,null,plan(),"actor")).rejects.toMatchObject({code:"TRAVEL_POINTS_CHANGED"});
    probe.route.mockImplementationOnce(async()=>{await execute("UPDATE app.observations SET status='hidden' WHERE id=$1",[ids[0]]);return {status:"ready",paths:[],distanceMeters:100,durationSeconds:60};});
    await expect(calculateTravelRoute(mapId,null,plan(),"actor")).rejects.toMatchObject({code:"TRAVEL_POINTS_CHANGED"});
  });
});

describe("bounded provider calls and honest partial results",()=>{
  it("keeps unavailable road legs out of calculated distance and has no fabricated fallback",async()=>{
    probe.route.mockResolvedValueOnce({status:"ready",paths:[[{lat:37.5,lng:126.8},{lat:37.51,lng:126.81}]],distanceMeters:1300,durationSeconds:240});
    probe.route.mockResolvedValueOnce({status:"unavailable",paths:[],distanceMeters:null,durationSeconds:null,message:"이 구간의 이동 경로를 찾지 못했어요."});
    const result=await calculateTravelRoute(mapId,null,plan(),"actor");expect(result.legs[0]).toMatchObject({status:"ready",distanceMeters:1300,durationSeconds:240});expect(result.legs[1]).toMatchObject({status:"unavailable",paths:[],distanceMeters:null,durationSeconds:null});
  });
  it("reuses recent successful coordinate/mode legs and preserves their original calculation time",async()=>{
    const first=await calculateTravelRoute(mapId,null,plan(),"actor");
    const next=await calculateTravelRoute(mapId,null,plan(),"actor");expect(probe.route).toHaveBeenCalledTimes(2);expect(next.calculatedAt).toBe(first.calculatedAt);
    await execute("UPDATE app.observations SET lat=lat+0.0001 WHERE id=$1",[ids[2]]);await calculateTravelRoute(mapId,null,plan(),"actor");expect(probe.route).toHaveBeenCalledTimes(3);
  });
  it("fails cleanly for missing setup and cancellation before calling a provider",async()=>{
    probe.config.mockImplementationOnce(()=>{throw new ApiError(503,"TRAVEL_NOT_CONFIGURED","자동차 길찾기 연결 설정이 필요합니다.");});
    await expect(calculateTravelRoute(mapId,null,plan(),"actor")).rejects.toMatchObject({status:503});
    const abort=new AbortController();abort.abort();await expect(calculateTravelRoute(mapId,null,plan(),"actor",abort.signal)).rejects.toMatchObject({status:499});expect(probe.route).not.toHaveBeenCalled();
  });
  it("enforces durable account limits even when all legs are cached",async()=>{
    for(let index=0;index<30;index++)await calculateTravelRoute(mapId,owner,plan(),"shared-school-ip");
    await expect(calculateTravelRoute(mapId,owner,plan(),"another-ip")).rejects.toMatchObject({status:429,code:"TRAVEL_RATE_LIMIT"});expect(probe.route).toHaveBeenCalledTimes(2);
  });
  it("accepts anonymous public-map routing and rejects cross-origin requests without provider work",async()=>{
    const request=(origin:string)=>new NextRequest(`http://localhost:3001/api/v1/maps/${mapId}/travel-route`,{method:"POST",headers:{origin,"content-type":"application/json"},body:JSON.stringify(plan())});
    const context={params:Promise.resolve({mapId})};expect((await POST(request("https://outside.example"),context)).status).toBe(403);expect(probe.route).not.toHaveBeenCalled();
    const response=await POST(request("http://localhost:3001"),context);expect(response.status).toBe(200);expect(response.headers.get("cache-control")).toBe("private, no-store");expect((await response.json()).data.legs).toHaveLength(2);
  });
  it("rejects walking API requests with 422 before provider work",async()=>{
    const input={stops:ids.map(pointId=>({pointId,mode:"walk"}))};
    const request=new NextRequest(`http://localhost:3001/api/v1/maps/${mapId}/travel-route`,{method:"POST",headers:{origin:"http://localhost:3001","content-type":"application/json"},body:JSON.stringify(input)});
    const response=await POST(request,{params:Promise.resolve({mapId})});
    expect(response.status).toBe(422);expect(probe.config).not.toHaveBeenCalled();expect(probe.route).not.toHaveBeenCalled();
  });
  it("uses car routing when the mode is omitted",async()=>{
    const result=await calculateTravelRoute(mapId,null,{stops:ids.map(pointId=>({pointId}))},"actor");
    expect(result.legs.map(leg=>leg.mode)).toEqual(["car","car"]);expect(probe.route).toHaveBeenCalledTimes(2);
  });
});
