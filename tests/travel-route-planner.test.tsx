// @vitest-environment happy-dom
import {act,type ComponentProps} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type ExplorerMap from "../src/components/ExplorerMap";
import type {MapPoint} from "../src/components/KakaoMap";
import {parseTravelPlan,serializeTravelPlan,travelPlanKey,type TravelPlan,type TravelRouteResult} from "../src/domain/travel-route";

const probe=vi.hoisted(()=>({props:null as ComponentProps<typeof ExplorerMap>|null}));
vi.mock("../src/components/ExplorerMap",()=>({default:(props:ComponentProps<typeof ExplorerMap>)=>{probe.props=props;return <div aria-label="탐험 지도">{props.points?.map(point=><button type="button" key={point.id} aria-label={`핀 ${point.title}`} onClick={()=>props.onSelectPoint?.(point.id)}>{point.title}</button>)}</div>;}}));
import TravelRoutePlanner from "../src/components/TravelRoutePlanner";

const points:MapPoint[]=Array.from({length:13},(_,index)=>({id:`place-${index+1}`,title:`유적 ${index+1}`,emoji:"🏛️",color:"#277d99",location:{lat:37.4+index*.001,lng:126.6+index*.001}}));
const onSelect=vi.fn(),onBegin=vi.fn(),fetchSpy=vi.fn();
let container:HTMLDivElement,root:Root;
const ok=(data:unknown)=>({ok:true,json:async()=>({data})});
function result(plan:TravelPlan):TravelRouteResult{return {provider:"Kakao",calculatedAt:new Date().toISOString(),legs:plan.stops.slice(0,-1).map((stop,index)=>({fromId:stop.pointId,toId:plan.stops[index+1].pointId,mode:stop.mode,status:"ready",paths:[[points.find(point=>point.id===stop.pointId)!.location,points.find(point=>point.id===plan.stops[index+1].pointId)!.location]],distanceMeters:1000*(index+1),durationSeconds:600*(index+1)}))};}
function button(label:string){const found=[...container.querySelectorAll<HTMLButtonElement>("button")].find(element=>element.getAttribute("aria-label")===label||element.textContent?.replace(/\s+/g," ").trim()===label);if(!found)throw new Error(`Missing button: ${label}`);return found;}
async function click(label:string){await act(async()=>button(label).click());}
async function advance(ms=500){await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});}
async function render(props:Partial<ComponentProps<typeof TravelRoutePlanner>>={}){await act(async()=>root.render(<TravelRoutePlanner mapId="map-a" scope="student-a" themeKey="tourism" title="문화유산 탐험" points={points} onSelectPoint={onSelect} onBeginPlanning={onBegin} {...props}/>));}
async function choose(...indices:number[]){await click("길찾기");for(const index of indices)await click(`핀 유적 ${index}`);}
function saved(scope="student-a"){return parseTravelPlan(localStorage.getItem(travelPlanKey(scope,"map-a"))!,"map-a");}
beforeEach(()=>{vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-19T01:00:00Z"));vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);localStorage.clear();onSelect.mockReset();onBegin.mockReset();probe.props=null;fetchSpy.mockReset().mockImplementation(async(_url:string,options:RequestInit)=>ok(result(JSON.parse(options.body as string))));vi.stubGlobal("fetch",fetchSpy);container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();vi.useRealTimers();});

describe("private tourism and heritage route planner",()=>{
  it.each(["safety","ecology","universal_design","weather_life","weather_data","custom"])("leaves %s maps unchanged",async themeKey=>{
    await render({themeKey});expect(container.querySelector(".travel-route-planner")).toBeNull();await click("핀 유적 1");expect(onSelect).toHaveBeenCalledExactlyOnceWith("place-1");expect(fetchSpy).not.toHaveBeenCalled();expect(localStorage.length).toBe(0);
  });
  it.each(["tourism","heritage"])("keeps record details by default and picks ordered stops only in %s planning mode",async themeKey=>{
    await render({themeKey});await click("핀 유적 1");expect(onSelect).toHaveBeenCalledExactlyOnceWith("place-1");
    await choose(1,2);expect(onBegin).toHaveBeenCalledOnce();expect(onSelect).toHaveBeenCalledTimes(1);expect(saved().stops.map(stop=>stop.pointId)).toEqual(["place-1","place-2"]);expect(saved().stops.every(stop=>stop.mode==="car")).toBe(true);expect(container.querySelector("select")).toBeNull();expect(container.textContent).not.toContain("도보");expect(container.textContent).toContain("나의 길찾기");expect(container.textContent).toContain("자동차 기준 경로·예상시간");expect(probe.props?.travelRoute?.draft).toBe(true);
    await click("핀 유적 1");expect(saved().stops).toHaveLength(2);expect(container.textContent).toContain("이미 선택한 장소");
    await click("선택 완료");await click("길찾기 패널 접기");expect(probe.props?.travelRoute?.stops).toHaveLength(2);await click("핀 유적 3");expect(onSelect).toHaveBeenLastCalledWith("place-3");
  });
  it("caps plans at twelve registered points and ignores IDs outside the selectable data",async()=>{
    await render();await choose(...Array.from({length:13},(_,index)=>index+1));expect(saved().stops).toHaveLength(12);expect(container.textContent).toContain("최대 12곳");
    await act(async()=>probe.props?.onSelectPoint?.("gps-current-location"));expect(saved().stops).toHaveLength(12);
  });
  it("reorders and deletes stops, keeps every leg in car mode and clears only this private plan",async()=>{
    await render();await choose(1,2,3);await click("2번 장소 위로 이동");expect(saved().stops).toEqual([{pointId:"place-2",mode:"car"},{pointId:"place-1",mode:"car"},{pointId:"place-3",mode:"car"}]);
    await click("2번 장소 경로에서 삭제");expect(saved().stops.map(stop=>stop.pointId)).toEqual(["place-2","place-3"]);await click("경로 비우기");expect(saved().stops).toEqual([]);expect(probe.props?.travelRoute).toBeUndefined();await advance();expect(fetchSpy).not.toHaveBeenCalled();
  });
  it("debounces road reads and does not repeat them on caption, focus or equivalent-point rerenders",async()=>{
    await render();await choose(1,2);await advance(499);expect(fetchSpy).not.toHaveBeenCalled();await advance(1);expect(fetchSpy).toHaveBeenCalledOnce();expect(probe.props?.travelRoute?.draft).toBe(false);expect(container.textContent).toContain("총 이동");
    const call=fetchSpy.mock.calls[0];expect(call[0]).toBe("/api/v1/maps/map-a/travel-route");expect(call[1]).toMatchObject({method:"POST",credentials:"same-origin",headers:{"content-type":"application/json"}});expect(JSON.parse(call[1].body)).toEqual({stops:saved().stops});
    await render({title:"다른 안내",points:points.map(point=>({...point})),focus:{location:points[0].location,nonce:1}});await advance(1000);expect(fetchSpy).toHaveBeenCalledOnce();
    await click("2번 장소 위로 이동");await advance();expect(fetchSpy).toHaveBeenCalledTimes(2);expect(probe.props?.travelRoute?.legs[0].fromId).toBe("place-2");expect(probe.props?.travelRoute?.legs[0].mode).toBe("car");
  });
  it("keeps a plan on setup errors, invents no roads or times, and supports retry",async()=>{
    fetchSpy.mockResolvedValueOnce({ok:false,json:async()=>({error:{message:"길찾기 연결 설정이 필요합니다."}})});await render();await choose(1,2);await advance();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("길찾기 연결 설정이 필요합니다");expect(probe.props?.travelRoute?.legs).toEqual([]);expect(probe.props?.travelRoute?.draft).toBe(true);expect(container.querySelector(".travel-route-planner__total")).toBeNull();expect(saved().stops).toHaveLength(2);
    await click("다시 계산");await advance();expect(container.querySelector('[role="alert"]')).toBeNull();expect(probe.props?.travelRoute?.legs[0].status).toBe("ready");
  });
  it("labels partial totals as confirmed segments rather than a complete trip",async()=>{
    fetchSpy.mockImplementation(async(_url:string,options:RequestInit)=>{const data=result(JSON.parse(options.body as string));data.legs[1]={...data.legs[1],status:"unavailable",paths:[],distanceMeters:null,durationSeconds:null,message:"이 구간은 확인하지 못했어요."};return ok(data);});await render();await choose(1,2,3);await advance();
    expect(container.querySelector(".travel-route-planner__total")?.textContent).toContain("확인된 1개 구간");expect(container.querySelector(".travel-route-planner__total")?.textContent).not.toContain("총 이동");expect(container.textContent).toContain("이 구간은 확인하지 못했어요");
  });
  it("passes the actual provider credit to map and PNG captions",async()=>{
    fetchSpy.mockImplementation(async(_url:string,options:RequestInit)=>ok({...result(JSON.parse(options.body as string)),provider:"Kakao",credit:"카카오모빌리티"}));await render();await choose(1,2);await advance();
    expect(probe.props?.travelRoute?.provider).toBe("Kakao");expect(probe.props?.travelRoute?.credit).toBe("카카오모빌리티");expect(container.textContent).toContain("카카오모빌리티");expect(container.textContent).toContain("장소 체류시간은 제외");
  });
  it("retains hidden intermediate stops, blocks calculation and never bridges across them",async()=>{
    const plan:TravelPlan={stops:[1,2,3].map(index=>({pointId:`place-${index}`,mode:"car"}))};localStorage.setItem(travelPlanKey("student-a","map-a"),serializeTravelPlan("map-a",plan));
    await render({points:[points[0],points[2]]});await click("길찾기");await advance(1000);expect(fetchSpy).not.toHaveBeenCalled();expect(saved()).toEqual(plan);expect(probe.props?.travelRoute).toBeUndefined();expect(container.textContent).toContain("보이지 않는 장소가 1곳");
    await render();await advance();expect(fetchSpy).toHaveBeenCalledOnce();expect(probe.props?.travelRoute?.stops.map(stop=>stop.id)).toEqual(["place-1","place-2","place-3"]);
  });
  it("aborts a superseded calculation and rejects its later response",async()=>{
    let reply:((value:unknown)=>void)|undefined;fetchSpy.mockImplementationOnce(()=>new Promise(resolve=>{reply=resolve;}));await render();await choose(1,2);await advance();const first=fetchSpy.mock.calls[0][1];
    await click("2번 장소 위로 이동");expect(first.signal.aborted).toBe(true);await advance();expect(probe.props?.travelRoute?.legs[0].fromId).toBe("place-2");
    await act(async()=>reply!(ok(result({stops:[{pointId:"place-1",mode:"car"},{pointId:"place-2",mode:"car"}]}))));expect(probe.props?.travelRoute?.legs[0].fromId).toBe("place-2");
  });
  it("restores an old walking plan as car-only directions with no transportation selector",async()=>{
    const legacy={format:"town-travel-route",version:1,mapId:"map-a",plan:{stops:[{pointId:"place-1",mode:"walk"},{pointId:"place-2",mode:"walk"}]}};localStorage.setItem(travelPlanKey("student-a","map-a"),JSON.stringify(legacy));
    await render();await click("길찾기");await advance();expect(container.querySelector("select")).toBeNull();expect(container.textContent).not.toContain("도보");expect(JSON.parse(fetchSpy.mock.calls[0][1].body).stops.every((stop:{mode:string})=>stop.mode==="car")).toBe(true);expect(probe.props?.travelRoute?.legs[0].mode).toBe("car");
  });
  it("isolates stored plans by participant and map, with no server mutation outside road reads",async()=>{
    await render();await choose(1,2);await advance();await render({scope:"student-b"});expect(probe.props?.travelRoute).toBeUndefined();expect(container.querySelector(".travel-route-planner__sheet")).toBeNull();await choose(3);expect(saved("student-b").stops.map(stop=>stop.pointId)).toEqual(["place-3"]);
    await render();expect(probe.props?.travelRoute?.stops.map(stop=>stop.id)).toEqual(["place-1","place-2"]);expect(fetchSpy.mock.calls.every(([url])=>url==="/api/v1/maps/map-a/travel-route")).toBe(true);
  });
  it("suspends note and point-tool interaction while selecting, then restores normal callbacks",async()=>{
    const canvas=vi.fn(),close=vi.fn(),note=vi.fn();await render({onCanvasPick:canvas,onSelectNote:note,onCloseContext:close,contextPointId:"place-1",contextPopup:<p>포인트 도구</p>});await click("길찾기");expect(onBegin).toHaveBeenCalledOnce();expect(close).toHaveBeenCalledOnce();expect(probe.props?.onCanvasPick).toBeUndefined();expect(probe.props?.onSelectNote).toBeUndefined();expect(probe.props?.contextPointId).toBeNull();expect(note).not.toHaveBeenCalled();
    await click("선택 완료");expect(probe.props?.onCanvasPick).toBe(canvas);await act(async()=>probe.props?.onSelectNote?.("note-1"));expect(note).toHaveBeenCalledExactlyOnceWith("note-1");expect(container.querySelector('[aria-label="나의 길찾기"]')).toBeNull();
  });
  it("collapses the route panel before opening a point popup or starting a gesture",async()=>{
    await render();await choose(1,2);await click("선택 완료");expect(container.querySelector('[aria-label="나의 길찾기"]')).not.toBeNull();await click("핀 유적 1");expect(onSelect).toHaveBeenLastCalledWith("place-1");expect(container.querySelector('[aria-label="나의 길찾기"]')).toBeNull();
    await click("길찾기");await render({gestureTool:{kind:"radius",pointId:"place-1"}});expect(container.querySelector('[aria-label="나의 길찾기"]')).toBeNull();expect(probe.props?.gestureTool).toEqual({kind:"radius",pointId:"place-1"});
  });
  it("marks two-minute-old geometry clearly without repeated automatic API calls",async()=>{
    await render();await choose(1,2);await advance();expect(container.textContent).toContain("계산 시각:");await click("선택 완료");await click("길찾기 패널 접기");const prior=probe.props?.travelRoute?.legs;
    await advance(119999);expect(container.textContent).not.toContain("계산한 지 오래됐어요");await advance(1);expect(container.textContent).toContain("계산한 지 오래됐어요");expect(container.textContent).toContain("이전 결과가 표시돼요");expect(probe.props?.travelRoute?.legs).toBe(prior);expect(fetchSpy).toHaveBeenCalledOnce();
    await click("길찾기");await click("다시 계산");await advance();expect(container.textContent).not.toContain("계산한 지 오래됐어요");expect(fetchSpy).toHaveBeenCalledTimes(2);
  });
  it("checks freshness on returning to the tab without spending another route request",async()=>{
    await render();await choose(1,2);await advance();await click("선택 완료");await click("길찾기 패널 접기");
    vi.setSystemTime(new Date("2026-10-19T01:03:00Z"));await act(async()=>{document.dispatchEvent(new Event("visibilitychange"));window.dispatchEvent(new Event("focus"));});
    expect(container.textContent).toContain("계산한 지 오래됐어요");expect(fetchSpy).toHaveBeenCalledOnce();expect(probe.props?.travelRoute?.draft).toBe(false);
  });
  it("fits all selected stops on request without rewriting the plan",async()=>{
    await render();await choose(1,2);await advance();const before=saved();await click("전체 경로 보기");expect(probe.props?.focus?.locations).toContainEqual(points[0].location);expect(probe.props?.focus?.locations).toContainEqual(points[1].location);expect(saved()).toEqual(before);
  });
});
