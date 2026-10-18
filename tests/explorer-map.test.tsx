// @vitest-environment happy-dom
import {act,type ComponentProps} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type KakaoMap from "../src/components/KakaoMap";
import type CommunityBlankMap from "../src/components/CommunityBlankMap";
import type {WeatherImageOptions} from "../src/lib/weather-image-export";

const probe=vi.hoisted(()=>({sdk:null as ComponentProps<typeof KakaoMap>|null,blank:null as ComponentProps<typeof CommunityBlankMap>|null,mounts:0,unmounts:0,options:null as WeatherImageOptions|null,disabled:false}));
vi.mock("../src/components/KakaoMap",async()=>{const {useEffect}=await import("react");return {default:(props:ComponentProps<typeof KakaoMap>)=>{probe.sdk=props;useEffect(()=>{probe.mounts++;return()=>{probe.unmounts++;};},[]);return <div aria-label="원래 카카오 지도"/>;}};});
vi.mock("../src/components/CommunityBlankMap",()=>({default:(props:ComponentProps<typeof CommunityBlankMap>)=>{probe.blank=props;return <div aria-label="공통 백지도"><svg className="community-blank-map-canvas"/><p>{props.error}</p><p>{props.features.map(feature=>feature.id).join(",")}</p></div>;}}));
vi.mock("../src/components/WeatherImageActions",()=>({WeatherImageActions:({options,disabled}:{options:WeatherImageOptions;disabled?:boolean})=>{probe.options=options;probe.disabled=!!disabled;return <div><button aria-label="지도 이미지 복사">복사</button><button aria-label="지도 PNG 저장">저장</button></div>;}}));
import ExplorerMap from "../src/components/ExplorerMap";
const points=[{id:"a",title:"공원",emoji:"🌳",color:"#287554",location:{lat:37.5,lng:126.7}}];
const feature={id:"region1",name:"우리 구",label:[126.7,37.5],geometry:{type:"Polygon",coordinates:[[[126.6,37.4],[126.8,37.4],[126.8,37.6],[126.6,37.4]]]}};
const response=(id="region1")=>({ok:true,json:async()=>({data:{features:[{...feature,id}],source:"SGIS · vuski/admdongkor · CC BY 4.0",updatedAt:"2026-07-01",missingIds:[],level:"dong"}})});
let container:HTMLDivElement,root:Root;
const fetchMock=vi.fn();
beforeEach(()=>{vi.useFakeTimers();vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("fetch",fetchMock);fetchMock.mockReset().mockResolvedValue(response());probe.sdk=null;probe.blank=null;probe.options=null;probe.mounts=probe.unmounts=0;container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});
async function render(props:ComponentProps<typeof ExplorerMap>={}){await act(async()=>root.render(<ExplorerMap points={points} {...props}/>));}
async function toggle(){await act(async()=>container.querySelector<HTMLButtonElement>('button[aria-label="백지도"]')!.click());}
async function settle(){await act(async()=>{await vi.advanceTimersByTimeAsync(350);});}

describe("shared exploration map wrapper",()=>{
  it("keeps registration and compact previews as their original SDK picker",async()=>{
    const pick=vi.fn();await render({onPick:pick});expect(probe.sdk?.onPick).toBe(pick);expect(container.querySelector('button[aria-label="백지도"]')).toBeNull();
    await render({compact:true});expect(probe.sdk?.compact).toBe(true);expect(container.querySelector('button[aria-label="백지도"]')).toBeNull();expect(fetchMock).not.toHaveBeenCalled();
  });
  it("keeps the SDK mounted and inert while displaying a boundary map and export buttons",async()=>{
    await render({title:"우리 동네",subtitle:"생태 관찰"});expect(probe.mounts).toBe(1);await toggle();
    expect(container.querySelector(".explorer-map-sdk")?.getAttribute("aria-hidden")).toBe("true");expect(container.querySelector(".explorer-map-sdk")?.hasAttribute("inert")).toBe(true);
    expect(container.querySelector('button[aria-label="지도 이미지 복사"]')).not.toBeNull();expect(container.querySelector('button[aria-label="지도 PNG 저장"]')).not.toBeNull();
    await settle();expect(probe.blank?.features).toHaveLength(1);expect(probe.options?.title).toBe("우리 동네");expect(probe.options?.subtitle).toBe("생태 관찰");
    expect(probe.options?.details).toContain("표시된 위치포인트 1개");expect(container.querySelector(".community-map-attribution")?.getAttribute("href")).toBe("https://github.com/vuski/admdongkor");
    await toggle();expect(probe.mounts).toBe(1);expect(probe.unmounts).toBe(0);expect(container.querySelector('button[aria-label="지도 PNG 저장"]')).toBeNull();
  });
  it("forwards SDK bounds normally, ignores them while hidden and forwards blank-map viewport changes",async()=>{
    const change=vi.fn();await render({onBoundsChange:change});await act(async()=>probe.sdk?.onBoundsChange?.([126.6,37.4,126.8,37.6]));expect(change).toHaveBeenCalledWith([126.6,37.4,126.8,37.6]);
    await toggle();await act(async()=>probe.sdk?.onBoundsChange?.([125,36,126,37]));expect(change).toHaveBeenCalledTimes(1);
    await act(async()=>probe.blank?.onViewportChange([126.65,37.45,126.85,37.65]));expect(change).toHaveBeenLastCalledWith([126.65,37.45,126.85,37.65]);
    await toggle();expect(probe.sdk?.focus?.locations).toEqual([{lat:37.45,lng:126.65},{lat:37.65,lng:126.85}]);
  });
  it("consumes resumed focus when a parent requests a new location",async()=>{
    const old={location:points[0].location,nonce:1};await render({focus:old});await toggle();await settle();await toggle();expect(probe.sdk?.focus).not.toBe(old);
    const next={location:{lat:37.6,lng:127},nonce:2};await render({focus:next});expect(probe.sdk?.focus).toBe(next);
  });
  it("recenters an empty game map when its first point supplies a center, preserving zoom and explicit focus",async()=>{
    const change=vi.fn();await render({points:[],onBoundsChange:change});await toggle();const before=probe.blank!.bounds,span=before[2]-before[0];
    await render({points:[],center:{lat:35.1,lng:129},onBoundsChange:change});expect((probe.blank!.bounds[0]+probe.blank!.bounds[2])/2).toBeCloseTo(129);expect((probe.blank!.bounds[1]+probe.blank!.bounds[3])/2).toBeCloseTo(35.1);expect(probe.blank!.bounds[2]-probe.blank!.bounds[0]).toBeCloseTo(span);expect(change).toHaveBeenLastCalledWith(probe.blank!.bounds);
    const focus={location:{lat:37.8,lng:127.2},nonce:2};await render({points:[],center:{lat:35.2,lng:129},focus});expect((probe.blank!.bounds[0]+probe.blank!.bounds[2])/2).toBeCloseTo(127.2);
    await toggle();await render({points:[],center:{lat:35.3,lng:129},focus});expect(probe.sdk?.focus).toBe(focus);
  });
  it("debounces requests and aborts stale responses without replacing the latest geometry",async()=>{
    const resolvers:((value:ReturnType<typeof response>)=>void)[]=[];fetchMock.mockImplementation(()=>new Promise(resolve=>resolvers.push(resolve)));
    await render();await toggle();expect(fetchMock).not.toHaveBeenCalled();await settle();expect(fetchMock).toHaveBeenCalledOnce();
    await act(async()=>probe.blank?.onViewportChange([126.5,37.4,126.9,37.7]));await settle();expect(fetchMock).toHaveBeenCalledTimes(2);
    expect((fetchMock.mock.calls[0][1] as RequestInit).signal?.aborted).toBe(true);
    await act(async()=>{resolvers[1](response("latest"));await Promise.resolve();});expect(probe.blank?.features[0].id).toBe("latest");
    await act(async()=>{resolvers[0](response("stale"));await Promise.resolve();});expect(probe.blank?.features[0].id).toBe("latest");
  });
  it("keeps old valid boundaries while fetching another viewport and shows retryable failures",async()=>{
    await render();await toggle();await settle();expect(probe.blank?.features[0].id).toBe("region1");
    fetchMock.mockResolvedValueOnce({ok:false,json:async()=>({error:{message:"경계 자료 지연"}})});
    await act(async()=>probe.blank?.onViewportChange([126.5,37.4,126.9,37.7]));expect(probe.blank?.features[0].id).toBe("region1");expect(probe.blank?.loading).toBe(true);
    await settle();expect(probe.blank?.error).toBe("경계 자료 지연");expect(probe.blank?.features[0].id).toBe("region1");expect(probe.disabled).toBe(true);
    await act(async()=>probe.blank?.onRetry?.());await settle();expect(probe.blank?.error).toBe("");expect(probe.disabled).toBe(false);
  });
  it("forwards original selection, note, canvas and gesture callbacks in blank mode",async()=>{
    const select=vi.fn(),note=vi.fn(),canvas=vi.fn(),end=vi.fn(),close=vi.fn();await render({onSelectPoint:select,onSelectNote:note,onCanvasPick:canvas,onGestureEnd:end,onCloseContext:close,gestureTool:{kind:"radius",pointId:"a"},contextPointId:"a",contextPopup:<button>반경</button>});
    await toggle();expect(end).toHaveBeenCalledWith(null);expect(probe.blank?.onSelectPoint).toBe(select);expect(probe.blank?.onSelectNote).toBe(note);expect(probe.blank?.onCanvasPick).toBe(canvas);expect(probe.blank?.onCloseContext).toBe(close);expect(probe.sdk?.gestureTool).toBeNull();expect(probe.sdk?.contextPointId).toBeNull();
  });
  it("caps legend size and groups by rating instead of creating a row per observation",async()=>{
    const many=Array.from({length:1000},(_,index)=>({...points[0],id:String(index),rating:{symbol:"✓",label:`평가${index%30}`,color:"#287554"}}));await render({points:many});await toggle();await settle();expect(probe.options?.legend).toHaveLength(20);expect(probe.options?.footnotes).toContain("범례 외 10종");
    expect(probe.options?.details).toContain("표시된 위치포인트 1000개");
  });
  it("discloses missing geometry and avoids a false rating colour legend",async()=>{
    fetchMock.mockResolvedValueOnce({ok:true,json:async()=>({data:{features:[feature],source:"SGIS",updatedAt:"2026-07-01",missingIds:["missing1","missing2"],level:"dong"}})});
    await render({points:[{...points[0],rating:{label:"개선 필요",symbol:"!",color:"#ff0000"}}]});await toggle();await settle();
    expect(probe.options?.legend).toEqual([]);expect(probe.options?.footnotes).toContain("일부 지역 경계 2곳 없음");expect(container.querySelector(".community-map-missing")?.textContent).toBe("일부 지역 경계 2곳 없음");
  });
});
