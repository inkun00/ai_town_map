// @vitest-environment happy-dom
import {act,type ComponentType} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {KakaoApi} from "../src/components/KakaoMap";
import type {TravelRouteOverlay} from "../src/domain/travel-route";
import type {WeatherImageOptions} from "../src/lib/weather-image-export";
import {emptyWorkbench} from "../src/domain/map-workbench";
import CommunityBlankMap from "../src/components/CommunityBlankMap";
import {communityProjection} from "../src/domain/community-blank-map";

const probe=vi.hoisted(()=>({options:null as WeatherImageOptions|null}));
vi.mock("next/script",async()=>{const {useEffect}=await import("react");return {default:({onReady}:{onReady:()=>void})=>{useEffect(()=>onReady(),[]);return null;}};});
vi.mock("../src/components/PointInteraction",()=>({PointInteraction:()=>null}));
vi.mock("../src/components/WeatherImageActions",()=>({WeatherImageActions:({options}:{options:WeatherImageOptions})=>{probe.options=options;return null;}}));
const points=[{id:"a",title:"문화재 <img src=x>",emoji:"🏯",color:"#16835d",location:{lat:37.5,lng:126.7}},{id:"b",title:"공원",emoji:"🌳",color:"#16835d",location:{lat:37.6,lng:126.8}},{id:"c",title:"박물관",emoji:"🏛️",color:"#16835d",location:{lat:37.7,lng:126.9}}];
const route:TravelRouteOverlay={stops:points,provider:"Kakao",credit:"카카오모빌리티",calculatedAt:"2026-10-19T01:00:00Z",legs:[{fromId:"a",toId:"b",mode:"walk",status:"ready",paths:[[points[0].location,{lat:37.53,lng:126.77},points[1].location],[{lat:37.59,lng:126.79},points[1].location]],distanceMeters:1250,durationSeconds:1000},{fromId:"b",toId:"c",mode:"car",status:"unavailable",paths:[[points[1].location,points[2].location]],distanceMeters:null,durationSeconds:null,message:"도로 경로를 확인하지 못했어요."}]};
const polylines:{options:Record<string,unknown>;setMap:ReturnType<typeof vi.fn>}[]=[],overlays:{options:Record<string,unknown>;setMap:ReturnType<typeof vi.fn>}[]=[];
function sdk():KakaoApi{const loc={getLat:()=>37.5,getLng:()=>126.7};return {maps:{load:(callback:()=>void)=>callback(),Map:class{setCenter(){}setLevel(){}setBounds(){}relayout(){}getBounds(){return {getSouthWest:()=>loc,getNorthEast:()=>loc};}},LatLng:class{constructor(public lat:number,public lng:number){}},LatLngBounds:class{extend(){}},Marker:class{setMap(){}},Circle:class{setMap(){}},MarkerImage:class{},Size:class{},Point:class{},Polyline:class{options:Record<string,unknown>;setMap=vi.fn();constructor(options:Record<string,unknown>){this.options=options;polylines.push(this);}},CustomOverlay:class{options:Record<string,unknown>;setMap=vi.fn();constructor(options:Record<string,unknown>){this.options=options;overlays.push(this);}},services:{Places:class{},Status:{OK:"OK"}},event:{addListener(){},removeListener(){}}}} as unknown as KakaoApi;}
let container:HTMLDivElement,root:Root,KakaoMap:ComponentType<import("react").ComponentProps<typeof import("../src/components/KakaoMap").default>>;
beforeEach(async()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("ResizeObserver",class{observe(){}disconnect(){}});vi.stubEnv("NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY","test-key");KakaoMap=(await import("../src/components/KakaoMap")).default;window.kakao=sdk();polylines.length=overlays.length=0;probe.options=null;container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();delete window.kakao;vi.restoreAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();vi.useRealTimers();});
describe("actual road overlays without straight-line estimates",()=>{
  it("draws only ready SDK road segments, uses safe text labels and cleans up independently",async()=>{
    await act(async()=>root.render(<KakaoMap autoLocate={false} points={points} travelRoute={route}/>));
    expect(polylines).toHaveLength(2);expect(polylines.every(line=>line.options.strokeColor==="#16835d")).toBe(true);expect(polylines[0].options.path).toHaveLength(3);
    const text=overlays.map(overlay=>(overlay.options.content as HTMLElement).textContent).join(" ");expect(text).toContain("1 · 🏯 문화재 <img src=x>");expect(text).toContain("1.25 km");expect(text).toContain("시간 확인 불가");expect(overlays.every(overlay=>!(overlay.options.content as HTMLElement).querySelector("img"))).toBe(true);
    const first=[...polylines,...overlays];await act(async()=>root.render(<KakaoMap autoLocate={false} points={points}/>));expect(first.every(overlay=>overlay.setMap.mock.calls.some(([map])=>map===null))).toBe(true);
  });
  it("keeps draft order labels but never presents cached paths as a fresh calculation",async()=>{
    await act(async()=>root.render(<KakaoMap autoLocate={false} points={points} travelRoute={{...route,draft:true}}/>));expect(polylines).toHaveLength(0);expect(overlays).toHaveLength(3);expect(overlays.every(overlay=>(overlay.options.content as HTMLElement).className==="map-travel-stop")).toBe(true);
  });
  it("includes native SVG road curves, mode colours, duration and order badges in the PNG surface",async()=>{
    const readyCar={...route.legs[1],status:"ready" as const,distanceMeters:2400,durationSeconds:360,paths:[[points[1].location,{lat:37.65,lng:126.85},points[2].location]]};
    await act(async()=>root.render(<CommunityBlankMap bounds={[126.5,37.3,127.1,37.9]} features={[]} points={points} onViewportChange={()=>{}} travelRoute={{...route,legs:[route.legs[0],readyCar]}}/>));
    expect(container.querySelectorAll("[data-travel-leg] polyline")).toHaveLength(3);expect(container.querySelector('[data-travel-mode="car"] polyline')?.getAttribute("stroke")).toBe("#2563eb");expect(container.querySelector('[data-travel-mode="walk"] polyline')?.getAttribute("stroke")).toBe("#16835d");
    expect(container.querySelectorAll("[data-travel-stop]")).toHaveLength(3);expect(container.querySelector("svg")?.textContent).toContain("1.25 km");expect(container.querySelector("svg")?.textContent).toContain("17분");expect(container.querySelector("svg")?.querySelector("image,foreignObject")).toBeNull();
  });
  it("keeps old analysis straight-line drawings separate and hides only draft road geometry",async()=>{
    const workbench=emptyWorkbench();workbench.connections=[{fromId:"a",toId:"b"}];await act(async()=>root.render(<CommunityBlankMap bounds={[126.5,37.3,127.1,37.9]} features={[]} points={points} onViewportChange={()=>{}} workbench={workbench} travelRoute={{...route,draft:true}}/>));
    expect(container.querySelectorAll("[data-connection]")).toHaveLength(1);expect(container.querySelectorAll("[data-travel-leg]")).toHaveLength(0);expect(container.querySelectorAll("[data-travel-stop]")).toHaveLength(3);expect(container.querySelector("[data-travel-leg-label]")).toBeNull();
  });
  it("keeps long mobile route captions inside the PNG while badges retain their geographic anchor",async()=>{
    vi.spyOn(HTMLElement.prototype,"getBoundingClientRect").mockImplementation(()=>({x:0,y:0,left:0,top:0,right:320,bottom:500,width:320,height:500,toJSON:()=>({})}));
    const stop={...points[0],title:"우리 지역의 아주 오래된 아름다운 문화유산과 역사 유적지 ".repeat(5),location:{lat:37.899,lng:126.501}},boundedRoute={...route,stops:[stop,...points.slice(1)]};
    await act(async()=>root.render(<CommunityBlankMap bounds={[126.5,37.3,127.1,37.9]} features={[]} points={points} onViewportChange={()=>{}} travelRoute={boundedRoute}/>));
    const labels=container.querySelectorAll<SVGGElement>("[data-travel-label]");expect(labels).toHaveLength(5);
    for(const label of labels){const x=Number(label.dataset.labelX),y=Number(label.dataset.labelY),width=Number(label.dataset.labelWidth),height=Number(label.dataset.labelHeight);expect(x-width/2).toBeGreaterThanOrEqual(7.99);expect(x+width/2).toBeLessThanOrEqual(312.01);expect(y-height/2).toBeGreaterThanOrEqual(0);expect(y+height/2).toBeLessThanOrEqual(500);}
    const position=communityProjection([126.5,37.3,127.1,37.9],320,500).project([stop.location.lng,stop.location.lat]),badge=container.querySelector('[data-travel-stop="a"] circle')!;
    expect(Number(badge.getAttribute("cx"))).toBeCloseTo(position.x-18,5);expect(Number(badge.getAttribute("cy"))).toBeCloseTo(position.y-43,5);
    const caption=container.querySelector('[data-travel-label="0-stop:a"]')!;expect(caption.querySelector("text")?.textContent).toContain("…");expect(caption.querySelector("title")?.textContent).toContain(stop.title);expect(container.querySelector(".community-travel-overlay line")).not.toBeNull();
  });
  it("adds provider, stop order and honest partial leg totals to exported PNG captions",async()=>{
    vi.useFakeTimers();vi.stubGlobal("fetch",vi.fn(async()=>({ok:true,json:async()=>({data:{features:[],source:"SGIS",updatedAt:"2026-07-01",missingIds:[],level:"district"}})})));
    const fullTitle="우리 지역의 아름다운 문화유산과 역사 유적지 이름을 전부 보존해요";
    const currentRoute:TravelRouteOverlay={...route,stops:[{...points[0],title:fullTitle},...points.slice(1)],legs:[{...route.legs[0],mode:"car"},{...route.legs[1],mode:"walk"}]};
    const ExplorerMap=(await import("../src/components/ExplorerMap")).default;await act(async()=>root.render(<ExplorerMap autoLocate={false} title="문화유산 여행" points={points} travelRoute={currentRoute}/>));
    await act(async()=>container.querySelector<HTMLButtonElement>('button[aria-label="백지도"]')!.click());await act(async()=>{await vi.advanceTimersByTimeAsync(350);});
    const captions=JSON.stringify(probe.options);expect(probe.options?.title).toBe("문화유산 여행");expect(captions).toContain(fullTitle);expect(captions).toContain("여행 방문 순서");expect(captions).toContain("확인된 구간 합계");expect(captions).not.toContain("전체 구간 합계");expect(captions).toContain("도보 · 거리 확인 불가 · 시간 확인 불가");expect(captions).toContain("카카오모빌리티");expect(captions).toContain("동선 계산");expect(probe.options?.legend).toContainEqual({label:"여행 동선 · 자동차",color:"#2563eb"});expect(probe.options?.legend?.some(item=>item.label.includes("도보"))).toBe(false);
  });
});
