import {describe,expect,it} from "vitest";
import {emptyTravelPlan,formatTravelDistance,formatTravelDuration,maximumTravelStops,parseTravelPlan,serializeTravelPlan,supportsTravelPlanning,travelLegLabel,travelModeColor,travelModeLabel,travelPlanKey,travelRequestKey,travelRouteSummary,type TravelLeg,type TravelPlan,type TravelRouteOverlay} from "../src/domain/travel-route";
const points=[{id:"a",title:"문화재",emoji:"🏯",color:"#16835d",location:{lat:37.5,lng:126.7}},{id:"b",title:"공원",emoji:"🌳",color:"#16835d",location:{lat:37.6,lng:126.8}},{id:"c",title:"박물관",emoji:"🏛️",color:"#16835d",location:{lat:37.7,lng:126.9}}];
const plan:TravelPlan={stops:[{pointId:"a",mode:"car"},{pointId:"b",mode:"car"},{pointId:"c",mode:"car"}]};
const leg=(fromId:string,toId:string,overrides:Partial<TravelLeg>={}):TravelLeg=>({fromId,toId,mode:"car",status:"ready",paths:[[points[0].location,points[1].location]],distanceMeters:1250,durationSeconds:1000,...overrides});
const route=(legs:TravelLeg[]):TravelRouteOverlay=>({stops:points,legs,calculatedAt:"2026-10-19T01:00:00Z",provider:"Kakao",credit:"카카오모빌리티"});
describe("personal tourism travel plans",()=>{
  it("creates isolated state and stores it separately per user and map",()=>{
    const first=emptyTravelPlan();first.stops.push(plan.stops[0]);expect(emptyTravelPlan()).toEqual({stops:[]});expect(maximumTravelStops).toBe(12);
    expect(travelPlanKey("student:1","a")).not.toBe(travelPlanKey("student:2","a"));expect(travelPlanKey("student:1","a")).not.toBe(travelPlanKey("student:1","b"));
  });
  it("roundtrips a validated map-scoped plan and rejects another map",()=>{
    const text=serializeTravelPlan("map-a",plan);expect(parseTravelPlan(text,"map-a")).toEqual(plan);expect(()=>parseTravelPlan(text,"map-b")).toThrow("다른 지도");
  });
  it("migrates old v1 walking stops to car without losing visit order",()=>{
    const legacy=JSON.stringify({format:"town-travel-route",version:1,mapId:"map-a",plan:{stops:[{pointId:"a",mode:"walk"},{pointId:"b",mode:"car"},{pointId:"c",mode:"walk"}]}});
    expect(parseTravelPlan(legacy,"map-a")).toEqual(plan);expect(JSON.parse(serializeTravelPlan("map-a",parseTravelPlan(legacy,"map-a"))).plan).toEqual(plan);
    const unsupported={stops:[{pointId:"a",mode:"walk"},{pointId:"b",mode:"car"}]} as unknown as TravelPlan;
    expect(()=>serializeTravelPlan("map-a",unsupported)).toThrow();expect(travelRequestKey(unsupported,points)).toBeNull();
  });
  it("rejects duplicate, excessive, invalid and oversized imported plans",()=>{
    expect(()=>serializeTravelPlan("map-a",{stops:[plan.stops[0],plan.stops[0]]})).toThrow();expect(()=>serializeTravelPlan("map-a",{stops:Array.from({length:13},(_,index)=>({pointId:String(index),mode:"car"}))})).toThrow();
    for(const text of ["bad JSON",JSON.stringify({format:"town-travel-route",version:1,mapId:"map-a",plan:{stops:[{pointId:"a",mode:"fly"}]}})])expect(()=>parseTravelPlan(text,"map-a")).toThrow("올바른");
    expect(()=>parseTravelPlan(" ".repeat(100001),"map-a")).toThrow("100KB");
  });
  it("only changes its calculation key when coordinates or stop order changes",()=>{
    const key=travelRequestKey(plan,points);expect(key).not.toBeNull();
    expect(travelRequestKey(plan,[...points].reverse().map(point=>({...point,title:"새 이름",color:"#123456",emoji:"📍"})))).toBe(key);
    expect(travelRequestKey({...plan,stops:plan.stops.map((stop,index)=>index===2?{...stop,mode:"car"}:stop)},points)).toBe(key);
    expect(travelRequestKey({stops:[...plan.stops].reverse()},points)).not.toBe(key);expect(travelRequestKey(plan,points.map(point=>point.id==="a"?{...point,location:{...point.location,lng:126.71}}:point))).not.toBe(key);
  });
  it("refuses missing/invalid anchors instead of estimating a route",()=>{
    expect(travelRequestKey(emptyTravelPlan(),points)).toBeNull();expect(travelRequestKey(plan,points.slice(1))).toBeNull();expect(travelRequestKey(plan,points.map(point=>({...point,location:{lat:NaN,lng:126}})))).toBeNull();expect(travelRequestKey(plan,points.map(point=>({...point,location:{lat:91,lng:126}})))).toBeNull();
  });
  it("enables car-based directions only for tourism and heritage",()=>{
    expect(supportsTravelPlanning("tourism")).toBe(true);expect(supportsTravelPlanning("heritage")).toBe(true);expect(supportsTravelPlanning("safety")).toBe(false);expect(supportsTravelPlanning("custom")).toBe(false);expect(travelModeColor("car")).toBe("#2563eb");expect(travelModeLabel("car")).toBe("길찾기");expect(travelLegLabel(leg("a","b"))).toContain("길찾기 (자동차 기준)");
  });
});
describe("actual road measurements and honest partial totals",()=>{
  it("formats known zero, sub-minute, minute and hour values without inventing unknown times",()=>{
    expect(formatTravelDuration(null)).toBe("시간 확인 불가");expect(formatTravelDuration(NaN)).toBe("시간 확인 불가");expect(formatTravelDuration(-1)).toBe("시간 확인 불가");expect(formatTravelDuration(0)).toBe("0분");expect(formatTravelDuration(20)).toBe("1분 미만");expect(formatTravelDuration(61)).toBe("2분");expect(formatTravelDuration(3600)).toBe("1시간");expect(formatTravelDuration(3660)).toBe("1시간 1분");
    expect(formatTravelDistance(null)).toBe("거리 확인 불가");expect(formatTravelDistance(Infinity)).toBe("거리 확인 불가");expect(formatTravelDistance(0)).toBe("0 m");expect(formatTravelDistance(1250)).toBe("1.25 km");
  });
  it("totals all successfully calculated legs, preserving actual zero",()=>{
    expect(travelRouteSummary(route([leg("a","b"),leg("b","c",{distanceMeters:0,durationSeconds:0})]))).toEqual({complete:true,distanceMeters:1250,durationSeconds:1000,readyLegCount:2,totalLegCount:2});
  });
  it("does not call partial or stale/draft results a complete route",()=>{
    const partial=route([leg("a","b"),leg("b","c",{status:"unavailable",distanceMeters:999,durationSeconds:999})]);
    expect(travelRouteSummary(partial)).toMatchObject({complete:false,distanceMeters:1250,durationSeconds:1000,readyLegCount:1});
    expect(travelRouteSummary({...partial,draft:true})).toMatchObject({complete:false,distanceMeters:null,durationSeconds:null,readyLegCount:0});
    expect(travelRouteSummary(route([leg("a","b",{distanceMeters:null,durationSeconds:null})]))).toMatchObject({complete:false,distanceMeters:null,durationSeconds:null});
  });
});
