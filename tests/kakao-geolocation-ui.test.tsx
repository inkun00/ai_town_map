// @vitest-environment happy-dom
import {act,type ComponentProps} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type KakaoMapComponent from "../src/components/KakaoMap";
import type {KakaoApi} from "../src/components/KakaoMap";
import type {LocationFix} from "../src/lib/geolocation";

type Progress={fix:LocationFix|null;sampleCount:number;elapsedMs:number};
type Request={signal?:AbortSignal;onProgress?:(progress:Progress)=>void;resolve:(fix:LocationFix)=>void;reject:(error:Error)=>void};
const geo=vi.hoisted(()=>({requests:[] as Request[],measure:vi.fn()}));
vi.mock("../src/lib/geolocation",()=>({acquirePrecisePosition:geo.measure,GeolocationMeasurementError:class extends Error{constructor(public code:string,message:string){super(message);}}}));
vi.mock("next/script",async()=>{
  const {useEffect}=await import("react");
  return {default:({onReady}:{onReady:()=>void})=>{useEffect(()=>onReady(),[]);return null;}};
});
vi.mock("../src/components/PointInteraction",()=>({PointInteraction:()=>null}));

type Props=ComponentProps<typeof KakaoMapComponent>;
type OverlayProbe={options:Record<string,unknown>;setMap:ReturnType<typeof vi.fn>};
type MapProbe={setCenter:ReturnType<typeof vi.fn>;setLevel:ReturnType<typeof vi.fn>;setBounds:ReturnType<typeof vi.fn>};
type MapEvent={latLng?:{getLat:()=>number;getLng:()=>number}};
const circles:OverlayProbe[]=[],markers:OverlayProbe[]=[],maps:MapProbe[]=[];
const events=new Map<unknown,Map<string,(event?:MapEvent)=>void>>();
const keywordSearch=vi.fn();
let container:HTMLDivElement,root:Root,unmounted=false,KakaoMap:typeof KakaoMapComponent;

function sdk(){
  const coordinate={getLat:()=>37,getLng:()=>127};
  class MapSdk{
    setCenter=vi.fn();setLevel=vi.fn();setBounds=vi.fn();
    constructor(){maps.push(this);}
    getCenter(){return coordinate;}getBounds(){return {getSouthWest:()=>coordinate,getNorthEast:()=>coordinate};}relayout(){}
  }
  class Marker{setMap=vi.fn();constructor(public options:Record<string,unknown>){markers.push(this);}}
  class Circle{setMap=vi.fn();constructor(public options:Record<string,unknown>){circles.push(this);}}
  return {maps:{Map:MapSdk,Marker,Circle,MarkerImage:class{},load:(callback:()=>void)=>callback(),
    LatLng:class{constructor(public lat:number,public lng:number){}},Size:class{},Point:class{},LatLngBounds:class{extend(){}},
    services:{Places:class{keywordSearch=keywordSearch;},Status:{OK:"OK"}},
    event:{addListener:(target:unknown,name:string,callback:(event?:MapEvent)=>void)=>{if(!events.has(target))events.set(target,new Map());events.get(target)!.set(name,callback);},removeListener:(target:unknown,name:string)=>events.get(target)?.delete(name)}}} as unknown as KakaoApi;
}
const fix=(accuracy=82.4,lat=37.5):LocationFix=>({lat,lng:127.2,accuracy,observedAt:new Date(Date.now()-8000).toISOString()});
async function render(props:Props={}){await act(async()=>root.render(<KakaoMap {...props}/>));}
function button(text:string){const found=[...container.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.textContent?.trim()===text);if(!found)throw new Error(`Missing button: ${text}`);return found;}
async function click(text:string){await act(async()=>button(text).click());}
async function progress(request:Request,value:LocationFix){await act(async()=>request.onProgress?.({fix:value,sampleCount:2,elapsedMs:2000}));}
async function finish(request:Request,value:LocationFix){await act(async()=>request.resolve(value));}
async function mapEvent(name:string,position?:{lat:number;lng:number}){await act(async()=>events.get(maps[0])?.get(name)?.(position?{latLng:{getLat:()=>position.lat,getLng:()=>position.lng}}:undefined));}

beforeEach(async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubEnv("NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY","test-key");
  vi.stubGlobal("ResizeObserver",class{observe(){}disconnect(){}});
  vi.resetModules();KakaoMap=(await import("../src/components/KakaoMap")).default;
  circles.length=0;markers.length=0;maps.length=0;events.clear();geo.requests.length=0;geo.measure.mockReset();keywordSearch.mockReset();
  geo.measure.mockImplementation((options:{signal?:AbortSignal;onProgress?:(progress:Progress)=>void})=>new Promise<LocationFix>((resolve,reject)=>geo.requests.push({...options,resolve,reject})));
  window.kakao=sdk();container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);unmounted=false;
});
afterEach(async()=>{if(!unmounted)await act(async()=>root.unmount());container.remove();delete window.kakao;vi.unstubAllGlobals();vi.unstubAllEnvs();});

describe("ordinary map precision measurement",()=>{
  it("shows measured uncertainty and age, keeps progress off the camera, and centers only the completed fix",async()=>{
    await render();expect(geo.requests).toHaveLength(1);
    const first=fix();await progress(geo.requests[0],first);
    expect(maps[0].setCenter).not.toHaveBeenCalled();
    expect(circles[0].options).toMatchObject({radius:82.4,strokeStyle:"solid",fillOpacity:.15});
    expect(container.textContent).toContain("예상 오차 약 83m");expect(container.textContent).toContain("8초 전 측정");expect(container.textContent).toContain("오차가 커요");
    const final=fix(12.3,37.5001);await finish(geo.requests[0],final);
    expect(maps[0].setCenter).toHaveBeenCalledTimes(1);expect(maps[0].setCenter).toHaveBeenCalledWith(expect.objectContaining({lat:final.lat,lng:final.lng}));
    expect(circles[0].setMap).toHaveBeenCalledWith(null);expect(circles.at(-1)?.options.radius).toBe(12.3);
    expect(button("정밀하게 다시 찾기").disabled).toBe(false);expect(container.textContent).toContain("최근 측정 위치");
  });

  it("aborts on map drag and rejects a late completion that would move the camera",async()=>{
    await render();const request=geo.requests[0];await progress(request,fix(70));
    await mapEvent("dragstart");expect(request.signal?.aborted).toBe(true);
    await finish(request,fix(5,39));expect(maps[0].setCenter).not.toHaveBeenCalled();expect(container.textContent).toContain("예상 오차 약 70m");
  });

  it("lets a manual pick win over a queued GPS callback and removes the candidate accuracy circle",async()=>{
    const onPick=vi.fn();await render({onPick,autoLocate:false});await click("◎ 현재 위치");
    const request=geo.requests[0];await progress(request,fix());const circle=circles[0];
    await mapEvent("click",{lat:38,lng:128});expect(request.signal?.aborted).toBe(true);expect(circle.setMap).toHaveBeenCalledWith(null);
    await finish(request,fix(4));expect(onPick).toHaveBeenCalledTimes(1);expect(onPick).toHaveBeenCalledWith({lat:38,lng:128},"manual");expect(container.textContent).not.toContain("이 위치 사용");
  });

  it("accepts a GPS position without inserting any title or address and stops its active watch",async()=>{
    const onPick=vi.fn();await render({onPick,autoLocate:false});await click("◎ 현재 위치");const request=geo.requests[0],value=fix(11);
    await progress(request,value);await click("이 위치 사용");
    expect(request.signal?.aborted).toBe(true);expect(onPick).toHaveBeenCalledWith({lat:value.lat,lng:value.lng},"gps");expect(onPick.mock.calls[0]).toHaveLength(2);
    await finish(request,fix(3,40));expect(onPick).toHaveBeenCalledTimes(1);
  });

  it("cancels GPS when the search field receives focus and preserves a searched place",async()=>{
    const onPick=vi.fn();await render({onPick,autoLocate:false});await click("◎ 현재 위치");const request=geo.requests[0];
    const input=container.querySelector<HTMLInputElement>("input")!;
    await act(async()=>input.focus());expect(request.signal?.aborted).toBe(true);
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"학교");input.dispatchEvent(new Event("input",{bubbles:true}));});
    await click("검색");const callback=keywordSearch.mock.calls[0][1] as (result:{x:string;y:string;place_name:string}[],status:string)=>void;
    await act(async()=>callback([{x:"128",y:"38",place_name:"우리 학교"}],"OK"));
    expect(onPick).not.toHaveBeenCalled();
    await act(async()=>container.querySelector<HTMLButtonElement>(".kakao-place-result")!.click());
    await finish(request,fix(4,40));
    expect(onPick).toHaveBeenCalledExactlyOnceWith({lat:38,lng:128},"search","우리 학교");expect(maps[0].setCenter).toHaveBeenCalledTimes(1);
  });

  it("cancels measurement on a focus change, an analysis gesture, and a controlled chosen position",async()=>{
    await render({autoLocate:false});await click("정밀하게 다시 찾기");const first=geo.requests[0];
    await render({autoLocate:false,focus:{location:{lat:38,lng:128},nonce:1}});expect(first.signal?.aborted).toBe(true);
    await finish(first,fix());expect(maps[0].setCenter).toHaveBeenCalledTimes(1);
    await click("정밀하게 다시 찾기");const second=geo.requests[1];
    await render({autoLocate:false,gestureTool:{kind:"radius",pointId:"a"}});expect(second.signal?.aborted).toBe(true);
    await render({autoLocate:false});await click("정밀하게 다시 찾기");const third=geo.requests[2];
    await render({autoLocate:false,chosen:{lat:39,lng:129}});expect(third.signal?.aborted).toBe(true);
  });

  it("retains an explicitly dated prior location when a retry times out",async()=>{
    await render();await finish(geo.requests[0],fix(20));await click("정밀하게 다시 찾기");
    await act(async()=>geo.requests[1].reject(new Error("위치를 측정하지 못했어요. 다시 시도해 주세요.")));
    expect(container.textContent).toContain("이전 측정 위치");expect(container.textContent).toContain("8초 전 측정");expect(container.textContent).toContain("예상 오차 약 20m");
  });

  it("clears a pick candidate after permission denial and makes precise retry available",async()=>{
    const onPick=vi.fn();await render({onPick,autoLocate:false});await click("◎ 현재 위치");await progress(geo.requests[0],fix());
    const {GeolocationMeasurementError}=await import("../src/lib/geolocation");
    await act(async()=>geo.requests[0].reject(new GeolocationMeasurementError("permission-denied","위치 권한이 꺼져 있어요. 브라우저 설정에서 허용해 주세요.")));
    expect(circles[0].setMap).toHaveBeenCalledWith(null);expect(container.textContent).not.toContain("이 위치 사용");expect(container.textContent).toContain("위치 권한이 꺼져 있어요");expect(button("◎ 현재 위치").disabled).toBe(false);expect(onPick).not.toHaveBeenCalled();
  });

  it("stacks a failed retry above the prior GPS confirmation and keeps the acceptance button usable",async()=>{
    const onPick=vi.fn();await render({onPick,autoLocate:false});await click("◎ 현재 위치");const value=fix(120);await finish(geo.requests[0],value);
    await click("◎ 다시 찾기");await act(async()=>geo.requests[1].reject(new Error("현재 위치를 확인하지 못했어요. 다시 시도해 주세요.")));
    const stack=container.querySelector(".map-location-messages")!;
    expect(stack.children[0].classList.contains("kakao-map-error")).toBe(true);expect(stack.children[1].classList.contains("gps-confirm")).toBe(true);
    expect(stack.textContent).toContain("이전 측정 위치");expect(stack.textContent).toContain("오차가 커요");
    await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="위치·지도 안내 닫기"]')!.click());
    expect(stack.querySelector(".kakao-map-error")).toBeNull();await click("이 위치 사용");expect(onPick).toHaveBeenCalledExactlyOnceWith({lat:value.lat,lng:value.lng},"gps");
  });

  it("cancels on native map interaction before a precise retry starts a new isolated request",async()=>{
    await render();const first=geo.requests[0];
    await act(async()=>container.querySelector('[aria-label="카카오 지도"]')!.dispatchEvent(new Event("pointerdown",{bubbles:true})));
    expect(first.signal?.aborted).toBe(true);await click("정밀하게 다시 찾기");const second=geo.requests[1];expect(second.signal?.aborted).toBe(false);
    await finish(first,fix(2,40));expect(maps[0].setCenter).not.toHaveBeenCalled();await finish(second,fix(10,38));expect(maps[0].setCenter).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({lat:38}));
  });

  it("aborts on unmount and removes all accuracy circles, markers, and map listeners",async()=>{
    await render();const request=geo.requests[0];await progress(request,fix());
    await act(async()=>root.unmount());unmounted=true;
    expect(request.signal?.aborted).toBe(true);expect(circles.every(circle=>circle.setMap.mock.calls.some(([map])=>map===null))).toBe(true);
    expect(markers.every(marker=>marker.setMap.mock.calls.some(([map])=>map===null))).toBe(true);expect(events.get(maps[0])?.size).toBe(0);
    await finish(request,fix(2,40));expect(maps[0].setCenter).not.toHaveBeenCalled();
  });
});
