// @vitest-environment happy-dom
import {act,type ComponentType} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {KakaoApi,MapPoint} from "../src/components/KakaoMap";

vi.mock("next/script",async()=>{
  const {useEffect}=await import("react");
  return {default:({onReady}:{onReady:()=>void})=>{useEffect(()=>onReady(),[]);return null;}};
});
vi.mock("../src/components/PointInteraction",()=>({PointInteraction:()=>null}));

type MarkerProbe={options:Record<string,unknown>;setMap:ReturnType<typeof vi.fn>};
type ImageProbe={src:string;size:{width:number;height:number};options:Record<string,unknown>};
const markers:MarkerProbe[]=[],clusters:{addMarkers:ReturnType<typeof vi.fn>;clear:ReturnType<typeof vi.fn>}[]=[];
const events=new Map<unknown,Map<string,()=>void>>();
const onSelect=vi.fn();
let container:HTMLDivElement,root:Root,KakaoMap:ComponentType<{points:MapPoint[];autoLocate:boolean;selectedId?:string|null;onSelectPoint:(id:string)=>void}>;

function sdk(){
  const coordinate={getLat:()=>37,getLng:()=>127};
  class MapSdk{
    getCenter(){return coordinate;}getBounds(){return {getSouthWest:()=>coordinate,getNorthEast:()=>coordinate};}
    relayout(){}setCenter(){}setLevel(){}setBounds(){}
  }
  class Marker{
    setMap=vi.fn();constructor(public options:Record<string,unknown>){markers.push(this);}
  }
  class MarkerImage{constructor(public src:string,public size:{width:number;height:number},public options:Record<string,unknown>) {}}
  class MarkerClusterer{
    addMarkers=vi.fn();clear=vi.fn();constructor(){clusters.push(this);}
  }
  return {maps:{Map:MapSdk,Marker,MarkerImage,MarkerClusterer,load:(callback:()=>void)=>callback(),
    LatLng:class{constructor(public lat:number,public lng:number){}},Size:class{constructor(public width:number,public height:number){}},Point:class{constructor(public x:number,public y:number){}},
    event:{addListener:(target:unknown,name:string,callback:()=>void)=>{if(!events.has(target))events.set(target,new Map());events.get(target)!.set(name,callback);},removeListener:(target:unknown,name:string)=>events.get(target)?.delete(name)}}} as unknown as KakaoApi;
}
function point(id:string,state?:"selected"|"unselected",index=0):MapPoint{return {id,title:`포인트 ${id}`,emoji:"🌳",color:"#C62828",rating:{symbol:"×",label:"개선 필요",color:"#C62828"},selectionState:state,location:{lat:37+index/100,lng:127+index/100}};}
function svg(marker:MarkerProbe){const image=marker.options.image as ImageProbe;return decodeURIComponent(image.src.split(",")[1]);}
async function render(points:MapPoint[],selectedId?:string){await act(async()=>root.render(<KakaoMap points={points} autoLocate={false} selectedId={selectedId} onSelectPoint={onSelect}/>));}
async function clickMarker(marker:MarkerProbe){await act(async()=>events.get(marker)?.get("click")?.());}

beforeEach(async()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubEnv("NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY","test-key");
  vi.resetModules();KakaoMap=(await import("../src/components/KakaoMap")).default;
  markers.length=0;clusters.length=0;events.clear();onSelect.mockReset();
  vi.stubGlobal("ResizeObserver",class{observe(){}disconnect(){}});window.kakao=sdk();
  container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();delete window.kakao;vi.unstubAllGlobals();vi.unstubAllEnvs();});

describe("Kakao merge selection rendering",()=>{
  it("draws selected and unselected markers independently of focus or rating",async()=>{
    await render([point("a","selected",0),point("b","unselected",1)]);
    expect(markers).toHaveLength(2);expect(svg(markers[0])).toContain('data-selection-state="selected"');expect(svg(markers[1])).toContain('data-selection-state="unselected"');
    expect(svg(markers[0])).not.toContain('>×</text>');expect(svg(markers[1])).not.toContain('>×</text>');
    expect(markers[0].options.zIndex).toBeGreaterThan(markers[1].options.zIndex as number);
    expect(markers[0].options.title).toContain("선택됨 · 누르면 선택 해제");expect(markers[1].options.title).toContain("선택 안 됨 · 누르면 선택");
    expect((markers[0].options.image as ImageProbe).size).toEqual({width:48,height:54});
    await clickMarker(markers[0]);expect(onSelect).toHaveBeenCalledWith("a");
    markers.length=0;await render([point("a","unselected",0),point("b","selected",1)],"a");
    expect(svg(markers[0])).toContain('data-selection-state="unselected"');expect(svg(markers[0])).toContain('stroke="#0f172a"');expect(svg(markers[1])).toContain('data-selection-state="selected"');
  });

  it("keeps selection visible beyond 20 markers and retains normal map clustering",async()=>{
    await render(Array.from({length:21},(_,index)=>point(String(index),index%2?"unselected":"selected",index)));
    expect(markers).toHaveLength(21);expect(clusters).toHaveLength(0);expect(markers.every(marker=>marker.setMap.mock.calls.some(([map])=>map!==null))).toBe(true);
    markers.length=0;await render(Array.from({length:21},(_,index)=>point(String(index),undefined,index)));
    expect(clusters).toHaveLength(1);expect(clusters[0].addMarkers).toHaveBeenCalledWith(markers);expect(svg(markers[0])).toContain('>×</text>');
  });

  it("represents mixed colocated points by count and gives every overlap row a selection state",async()=>{
    await render([point("a","selected"),point("b","unselected")]);
    expect(markers).toHaveLength(1);expect(svg(markers[0])).toContain('data-selection-state="mixed"');expect(svg(markers[0])).toContain('>1/2</text>');expect(markers[0].options.title).toContain("2개 · 1개 선택 · 일부 선택됨");
    await clickMarker(markers[0]);
    const selected=container.querySelector<HTMLButtonElement>('button[aria-pressed="true"]')!,unselected=container.querySelector<HTMLButtonElement>('button[aria-pressed="false"]')!;
    expect(selected.textContent).toContain("✓ 선택됨");expect(unselected.textContent).toContain("○ 선택 안 됨");
    expect(selected.getAttribute("aria-label")).toContain("선택됨 · 선택 해제");expect(unselected.getAttribute("aria-label")).toContain("선택 안 됨 · 선택");
    await act(async()=>unselected.click());expect(onSelect).toHaveBeenCalledWith("b");expect(container.querySelector("dialog")).toBeNull();
  });

  it("shows all and none colocated selections without a source rating badge",async()=>{
    await render([point("a","selected"),point("b","selected")]);expect(svg(markers[0])).toContain('>2/2</text>');expect(svg(markers[0])).not.toContain('>×</text>');
    markers.length=0;await render([point("a","unselected"),point("b","unselected")]);expect(svg(markers[0])).toContain('>0/2</text>');expect(svg(markers[0])).toContain('stroke-dasharray="5 3"');
  });
});
