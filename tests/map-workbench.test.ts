import {describe,it,expect} from "vitest";
import {addConnection,connectionEdges,connectionSegments,removePointConnections,snapPoint,distanceMeters,emojiGroup,emptyWorkbench,formatDistance,parseWorkbench,routeSegments,serializeWorkbench,toggleHidden,visiblePoint,workbenchKey} from "../src/domain/map-workbench";

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

describe("direct point manipulation",()=>{
  it("stores independent edges without joining unrelated starting points",()=>{
    let state=emptyWorkbench();state.route=["a","b"];
    state=addConnection(state,"c","d");expect(state.route).toEqual([]);
    expect(connectionEdges(state)).toEqual([{fromId:"a",toId:"b"},{fromId:"c",toId:"d"}]);
    expect(addConnection(state,"b","a")).toBe(state);expect(addConnection(state,"a","a")).toBe(state);
    expect(removePointConnections(state,"b").connections).toEqual([{fromId:"c",toId:"d"}]);
    const points=["a","c","d"].map((id,index)=>({id,location:{lat:37+index*.001,lng:127}}));
    expect(connectionSegments(state,points)).toHaveLength(1);
  });
  it("snaps to the marker body or tip with hysteresis, excluding the source",()=>{
    const points=[{id:"a",x:10,y:100},{id:"b",x:200,y:100}];
    expect(snapPoint({x:10,y:100},points,"a")).toBeNull();
    expect(snapPoint({x:200,y:75},points,"a")).toBe("b");
    expect(snapPoint({x:235,y:100},points,"a")).toBeNull();
    expect(snapPoint({x:235,y:100},points,"a","b")).toBe("b");
    expect(snapPoint({x:245,y:100},points,"a","b")).toBeNull();
    expect(snapPoint({x:220,y:75},[...points,{id:"c",x:220,y:100}],"a","b")).toBe("c");
    expect(snapPoint({x:200,y:100},points.filter(point=>point.id!=="b"),"a","b")).toBeNull();
  });
  it("reads old drawings and round trips continuous radii and new edges",()=>{
    const old=JSON.parse(serializeWorkbench("m",emptyWorkbench()));delete old.state.connections;old.state.route=["a","b"];
    expect(parseWorkbench(JSON.stringify(old),"m").connections).toEqual([]);
    let state=addConnection(parseWorkbench(JSON.stringify(old),"m"),"a","c");state.radii=[{pointId:"a",meters:[327]}];
    expect(parseWorkbench(serializeWorkbench("m",state),"m")).toEqual(state);
    state.radii[0].meters=[20001];expect(()=>serializeWorkbench("m",state)).toThrow();
    state.radii=[];state.connections=Array.from({length:100},(_,index)=>({fromId:"a",toId:String(index)}));
    expect(addConnection(state,"new","other")).toBe(state);
    state.route=["a","b"];expect(()=>serializeWorkbench("m",state)).toThrow();
  });
});
