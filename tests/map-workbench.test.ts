import {describe,it,expect} from "vitest";
import {distanceMeters,emojiGroup,emptyWorkbench,formatDistance,parseWorkbench,routeSegments,serializeWorkbench,toggleHidden,visiblePoint,workbenchKey} from "../src/domain/map-workbench";

describe("personal map tools",()=>{
  it("counts overlapping points individually and combines category, emoji and point visibility",()=>{
    const state=emptyWorkbench(),points=[{id:"1",categoryKey:"plants",emojiKey:"tree"},{id:"2",categoryKey:"plants",emojiKey:"flower"},{id:"3",categoryKey:"birds",emojiKey:"tree"}];
    state.hiddenEmojis=[emojiGroup("plants","tree")];expect(points.filter(point=>visiblePoint(point,state)).map(point=>point.id)).toEqual(["2","3"]);
    state.hiddenCategories=["birds"];state.hiddenPoints=["2"];expect(points.filter(point=>visiblePoint(point,state))).toHaveLength(0);
    expect(toggleHidden(state.hiddenPoints,"2")).toEqual([]);expect(toggleHidden([],"2")).toEqual(["2"]);
  });
  it("measures a known equatorial degree and short north/south segments in meters",()=>{
    expect(distanceMeters({lat:0,lng:0},{lat:0,lng:1})).toBeCloseTo(111195.08,1);
    expect(distanceMeters({lat:37,lng:127},{lat:37.001,lng:127})).toBeCloseTo(111.195,2);
    expect(distanceMeters({lat:90,lng:0},{lat:-90,lng:180})).toBeCloseTo(Math.PI*6371008.8,3);
    expect(distanceMeters({lat:37,lng:127},{lat:37,lng:127})).toBe(0);
    expect(formatDistance(123.4)).toBe("123 m");expect(formatDistance(2345)).toBe("2.35 km");
  });
  it("does not create a shortcut through a missing or unauthorized anchor",()=>{
    const points=[{id:"a",location:{lat:37,lng:127}},{id:"b",location:{lat:37.001,lng:127}},{id:"c",location:{lat:37.002,lng:127}}];
    expect(routeSegments(["a","b","c"],points).reduce((sum,segment)=>sum+segment.meters,0)).toBeCloseTo(222.39,2);
    expect(routeSegments(["a","b","c"],points.filter(point=>point.id!=="b"))).toEqual([]);
    expect(routeSegments(["a","b","a"],points)).toHaveLength(2);
  });
  it("round trips drawings with no account scope, observation contents or credentials",()=>{
    const state=emptyWorkbench();state.radii=[{pointId:"p",meters:[100,500]}];state.route=["p","q"];state.notes=[{id:"n",text:"우리 모임 장소",emoji:"🏁",location:{lat:37.5,lng:127},color:"#fff1a8"}];
    const text=serializeWorkbench("map-a",state);expect(parseWorkbench(text,"map-a")).toEqual(state);
    expect(Object.keys(JSON.parse(text))).toEqual(["format","version","mapId","state"]);
    expect(workbenchKey("user-a","map-a")).not.toBe(workbenchKey("user-b","map-a"));
    expect(workbenchKey("user-a","map-a")).not.toBe(workbenchKey("user-a","map-b"));
    expect(()=>parseWorkbench(text,"map-b")).toThrow("다른 지도");
  });
  it("rejects corrupt, oversized and invalid geometry before replacing personal tools",()=>{
    const raw=JSON.parse(serializeWorkbench("map-a",emptyWorkbench()));
    expect(()=>parseWorkbench("{","map-a")).toThrow();expect(()=>parseWorkbench("x".repeat(2_000_001),"map-a")).toThrow("2MB");
    raw.state.radii=[{pointId:"p",meters:[-1]}];expect(()=>parseWorkbench(JSON.stringify(raw),"map-a")).toThrow();
    raw.state.radii=[];raw.state.notes=[{id:"n",text:"hello",emoji:"",location:{lat:91,lng:127},color:"#fff1a8"}];expect(()=>parseWorkbench(JSON.stringify(raw),"map-a")).toThrow();
    raw.state.notes[0].location.lat=37;raw.state.notes.push({...raw.state.notes[0]});expect(()=>parseWorkbench(JSON.stringify(raw),"map-a")).toThrow("중복");
  });
  it("restores a large map's hidden point list within file limits",()=>{
    const state=emptyWorkbench();state.hiddenPoints=Array.from({length:10000},(_,index)=>`12345678-1234-1234-1234-${String(index).padStart(12,"0")}`);
    expect(parseWorkbench(serializeWorkbench("large-map",state),"large-map").hiddenPoints).toHaveLength(10000);
  });
});
