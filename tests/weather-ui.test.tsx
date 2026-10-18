// @vitest-environment happy-dom
import {act,type ComponentType} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {MapFocus,MapPoint} from "../src/components/KakaoMap";
import type {WeatherBoundaryFeature,WeatherBoundaryResult} from "../src/domain/weather-boundaries";

const mapProbe=vi.hoisted(()=>({autoLocate:undefined as boolean|undefined,focus:null as MapFocus|null,points:[] as MapPoint[]}));
const blankProbe=vi.hoisted(()=>({features:[] as WeatherBoundaryFeature[],points:[] as MapPoint[]}));
vi.mock("next/dynamic",async()=>{const {lazy,Suspense}=await import("react");return {default:(loader:()=>Promise<{default:ComponentType<Record<string,unknown>>}>)=>{const Loaded=lazy(loader);return function Dynamic(props:Record<string,unknown>){return <Suspense fallback={<p>지도 불러오는 중</p>}><Loaded {...props}/></Suspense>;};}};});
vi.mock("../src/components/KakaoMap",()=>({default:({autoLocate,focus,points,onSelectPoint}:{autoLocate:boolean;focus:MapFocus|null;points:MapPoint[];onSelectPoint:(id:string)=>void})=>{mapProbe.autoLocate=autoLocate;mapProbe.focus=focus;mapProbe.points=points;return <div aria-label="날씨 지도">{points.map(point=><button type="button" key={point.id} onClick={()=>onSelectPoint(point.id)}>{point.title}</button>)}</div>;}}));
vi.mock("../src/components/WeatherBlankMap",()=>({default:({features,points,selectedId,onSelectPoint,loading,error,onRetry}:{features:WeatherBoundaryFeature[];points:MapPoint[];selectedId?:string;onSelectPoint:(id:string)=>void;loading?:boolean;error?:string;onRetry?:()=>void})=>{blankProbe.features=features;blankProbe.points=points;return <div aria-label="지역별 백지도" aria-busy={loading}>{error?<p role="alert">{error}</p>:loading?<p role="status">지역 경계를 불러오고 있어요.</p>:features.map(feature=><button type="button" key={feature.id} aria-pressed={feature.id===selectedId} onClick={()=>onSelectPoint(feature.id)}>{points.find(point=>point.id===feature.id)?.label??feature.name}</button>)}{error&&onRetry&&<button type="button" onClick={onRetry}>경계 다시 불러오기</button>}</div>;}}));
import {WeatherChart,WeatherExplorer} from "../src/components/WeatherExplorer";
import {koreanWeatherDate,weatherMetrics,type WeatherMetric} from "../src/domain/weather";

const city={id:"2800000000",name:"인천광역시",fullName:"인천광역시",parentId:null,level:"city",lat:37.45,lng:126.7};
const district={id:"2818500000",name:"연수구",fullName:"인천광역시 연수구",parentId:city.id,level:"district",lat:37.41,lng:126.68};
const dong={id:"2818570000",name:"송도1동",fullName:"인천광역시 연수구 송도1동",parentId:district.id,level:"dong",lat:37.39,lng:126.64};
const values=(temperature:number|null,rainfall:number|null=null)=>Object.fromEntries((Object.keys(weatherMetrics) as WeatherMetric[]).map(key=>[key,key==="temperature"?temperature:key==="rainfall"?rainfall:null]));
const days=(observed=1)=>Object.fromEntries((Object.keys(weatherMetrics) as WeatherMetric[]).map(key=>[key,key==="temperature"||key==="rainfall"?observed:0]));
const weatherCounts={clear:null,cloudy:null,rain:0,snow:null,unknown:1};
function location(region:typeof city|typeof district){return {region,station:{id:"112",name:"인천",lat:37.48,lng:126.62},distanceKm:4.8,current:{observedAt:"2026-10-18T01:00:00Z",values:values(19,3)},series:[{date:"2026-10-10",endDate:"2026-10-10",values:values(15,4.6),observedDays:1,expectedDays:1,metricDays:days(),weatherCounts},{date:"2026-10-11",endDate:"2026-10-11",values:values(null),observedDays:0,expectedDays:1,metricDays:days(0),weatherCounts},{date:"2026-10-12",endDate:"2026-10-12",values:values(17,5.4),observedDays:1,expectedDays:1,metricDays:days(),weatherCounts}],summary:{values:values(16,10),observedDays:2,expectedDays:3,metricDays:days(2)},weatherCounts};}
function result(){return {region:city,start:"2026-10-10",end:koreanWeatherDate(),period:"day",configured:true,items:[location(city),location(district)],notice:"구체적인 서버 설명은 지도에 상시 노출하지 않습니다.",source:"기상청"};}
function boundaryResult():WeatherBoundaryResult{return {features:[{id:district.id,name:district.name,label:[district.lng,district.lat],geometry:{type:"Polygon",coordinates:[[[126.6,37.3],[126.8,37.3],[126.8,37.5],[126.6,37.5],[126.6,37.3]]]}}],source:"테스트 행정경계",updatedAt:"2026-07-01",missingIds:[]};}
function ok(data:unknown){return {ok:true,json:async()=>({data})};}
let container:HTMLDivElement,root:Root;
const fetchSpy=vi.fn();
let configured:boolean;
function labelled<T extends Element>(tag:string,label:string,scope:ParentNode=document.body):T{
  const direct=[...scope.querySelectorAll<T>(tag)].find(item=>item.getAttribute("aria-label")===label);
  if(direct)return direct;
  const matching=[...scope.querySelectorAll<HTMLLabelElement>("label")].find(item=>{const copy=item.cloneNode(true) as HTMLElement;copy.querySelectorAll("input,select,textarea").forEach(control=>control.remove());return copy.textContent?.replace(/\s+/g," ").trim()===label;});
  const element=matching?.querySelector<T>(tag)??(matching?.htmlFor?scope.querySelector<T>(`#${CSS.escape(matching.htmlFor)}`):null);
  if(!element)throw new Error(`Missing ${tag}: ${label}`);return element;
}
function select(label:string,scope:ParentNode=document.body){return labelled<HTMLSelectElement>("select",label,scope);}
function dialog(label:string){return document.body.querySelector<HTMLDialogElement>(`dialog[aria-label="${label}"],[role="dialog"][aria-label="${label}"]`);}
function button(label:string,scope:ParentNode=document.body){const found=[...scope.querySelectorAll<HTMLButtonElement>("button")].find(item=>{const copy=item.cloneNode(true) as HTMLElement;copy.querySelectorAll('[aria-hidden="true"]').forEach(node=>node.remove());return item.getAttribute("aria-label")===label||copy.textContent?.replace(/\s+/g," ").trim()===label;});if(!found)throw new Error(`Missing button: ${label}`);return found;}
async function change(label:string,value:string){await act(async()=>{const element=select(label);element.value=value;element.dispatchEvent(new Event("change",{bubbles:true}));});}
async function click(label:string,scope:ParentNode=document.body){await act(async()=>button(label,scope).click());}
async function toggle(label:string){await act(async()=>labelled<HTMLInputElement>("input",label,dialog("날씨 그래프")!).click());}
async function check(label:string){if(!labelled<HTMLInputElement>("input",label,dialog("날씨 그래프")!).checked)await toggle(label);}
async function submit(){await act(async()=>dialog("지역·기간 선택")!.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));}
async function render(){await act(async()=>root.render(<WeatherExplorer initialRegion={city.id}/>));await vi.waitFor(()=>expect(select("시·도").value).toBe(city.id));await vi.waitFor(()=>expect(select("시·군·구").disabled).toBe(false));}
async function load(){await render();await submit();await vi.waitFor(()=>expect(mapProbe.points).toHaveLength(1));}
function weatherReads(){return fetchSpy.mock.calls.filter(([url])=>new URL(String(url),"http://localhost:3001").pathname==="/api/v1/weather");}
function boundaryReads(){return fetchSpy.mock.calls.filter(([url])=>new URL(String(url),"http://localhost:3001").pathname==="/api/v1/weather/boundaries");}

beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("matchMedia",undefined);configured=true;mapProbe.points=[];mapProbe.focus=null;mapProbe.autoLocate=undefined;blankProbe.features=[];blankProbe.points=[];fetchSpy.mockReset().mockImplementation(async(raw:RequestInfo|URL)=>{const url=new URL(String(raw),"http://localhost:3001");if(url.pathname==="/api/v1/weather/regions"){const parentId=url.searchParams.get("parentId");return ok({items:parentId===city.id?[district]:parentId===district.id?[dong]:parentId?[]:[city],source:"기상청 행정구역",updatedAt:"2026-07-01"});}if(url.pathname==="/api/v1/weather/boundaries")return ok(boundaryResult());if(url.pathname==="/api/v1/weather")return ok(configured?result():{...result(),configured:false,items:[],notice:"기상청 API 인증키 설정이 필요해요."});throw new Error(`Unexpected URL: ${url}`);});vi.stubGlobal("fetch",fetchSpy);container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("weather explorer map and dialogs",()=>{
  it("keeps a map surface visible and asks for a region and period before reading weather",async()=>{
    await render();
    expect(container.querySelector('[aria-label="날씨 지도"]')).not.toBeNull();
    expect(mapProbe.autoLocate).toBe(false);
    expect(dialog("지역·기간 선택")).not.toBeNull();
    expect(dialog("날씨 그래프")).toBeNull();
    expect(button("백지도").disabled).toBe(true);
    expect(weatherReads()).toHaveLength(0);
    await click("지역·기간 선택 닫기");
    expect(dialog("지역·기간 선택")).toBeNull();
    await click("지역·기간");
    expect(dialog("지역·기간 선택")).not.toBeNull();
  });
  it("uses the returned administrative hierarchy and sends the chosen dong and period",async()=>{
    await render();await change("시·군·구",district.id);await vi.waitFor(()=>expect(select("읍·면·동").options).toHaveLength(2));await change("읍·면·동",dong.id);await click("월별");await submit();
    const request=new URL(String(weatherReads()[0][0]),"http://localhost:3001");
    expect(request.searchParams.get("regionId")).toBe(dong.id);expect(request.searchParams.get("period")).toBe("month");
    expect(dialog("지역·기간 선택")).toBeNull();
  });
  it("shows a real setup error without invented pins or graphs when no server key exists",async()=>{
    configured=false;await render();await submit();
    expect(container.textContent).toContain("실제 날씨자료 연결이 필요해요");
    expect(container.querySelector('[aria-label="날씨 지도"]')).not.toBeNull();
    expect(mapProbe.points).toHaveLength(0);
    expect(button("백지도").disabled).toBe(true);
    expect(container.querySelector("svg.weather-chart")).toBeNull();
  });
  it("shows provider failures on the map and allows a successful retry",async()=>{
    await render();fetchSpy.mockResolvedValueOnce({ok:false,json:async()=>({error:{message:"기상청 응답이 지연되고 있어요."}})});await submit();
    expect(container.querySelector('[role="alert"]')?.textContent).toContain("기상청 응답이 지연되고 있어요.");
    expect(mapProbe.points).toHaveLength(0);
    expect(container.querySelector('[aria-label="날씨 지도"]')).not.toBeNull();
    await click("날씨 다시 불러오기");await vi.waitFor(()=>expect(mapProbe.points).toHaveLength(1));
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it("keeps the map controls on the map and removes explanatory and summary cards",async()=>{
    await load();
    expect(select("지도에 표시할 항목").value).toBe("temperature");
    expect(container.querySelector(".weather-map")).not.toBeNull();
    expect(container.querySelector(".weather-summary,.weather-station,.weather-current,.weather-disclaimer,.weather-detail")).toBeNull();
    expect(container.textContent).not.toContain(result().notice);
    expect(container.textContent).not.toContain("지역 중심에서 약");
    expect(container.querySelector(".weather-chart")).toBeNull();
    await click("그래프");
    expect(dialog("날씨 그래프")).not.toBeNull();
    expect(select("그래프로 볼 지역").value).toBe(district.id);
    expect(dialog("날씨 그래프")!.querySelector("svg")).not.toBeNull();
    await click("그래프 닫기");
    expect(dialog("날씨 그래프")).toBeNull();
    expect(container.querySelector(".weather-chart")).toBeNull();
  });
  it("maps only child regions while retaining the overall region in the graph selector",async()=>{
    await load();
    expect(mapProbe.points.map(point=>point.id)).toEqual([district.id]);
    expect(mapProbe.points[0].label).toBe("연수구 16℃");
    expect(container.querySelector('[aria-label="날씨 지도"]')?.textContent).not.toContain("인천광역시");
    await click("그래프");
    expect([...select("그래프로 볼 지역").options].map(option=>option.value)).toEqual([city.id,district.id]);
    await change("그래프로 볼 지역",city.id);expect(select("그래프로 볼 지역").value).toBe(city.id);
    expect(mapProbe.points.map(point=>point.id)).toEqual([district.id]);
  });
  it("keeps a leaf region's own pin when the result has no child regions",async()=>{
    await render();fetchSpy.mockResolvedValueOnce(ok({...result(),region:dong,items:[location(dong)]}));await submit();
    await vi.waitFor(()=>expect(mapProbe.points.map(point=>point.id)).toEqual([dong.id]));
    expect(mapProbe.points[0].label).toBe("송도1동 16℃");
  });
  it("toggles to child boundaries, updates values without refetching, and returns to the tile map",async()=>{
    await load();expect(button("백지도").getAttribute("aria-pressed")).toBe("false");
    await click("백지도");
    await vi.waitFor(()=>expect(blankProbe.features.map(feature=>feature.id)).toEqual([district.id]));
    expect(button("백지도").getAttribute("aria-pressed")).toBe("true");
    expect(container.querySelector('[aria-label="날씨 지도"]')).toBeNull();
    expect(container.querySelector('[aria-label="지역별 백지도"]')?.textContent).toContain("연수구 16℃");
    expect(blankProbe.points.map(point=>point.id)).toEqual([district.id]);
    expect(new URL(String(boundaryReads()[0][0]),"http://localhost:3001").searchParams.get("regionId")).toBe(city.id);
    await change("지도에 표시할 항목","rainfall");
    expect(blankProbe.points[0].label).toBe("연수구 10mm");expect(boundaryReads()).toHaveLength(1);expect(weatherReads()).toHaveLength(1);
    await click("그래프");await change("그래프로 볼 지역",city.id);
    await click("연수구 10mm",container.querySelector('[aria-label="지역별 백지도"]')!);
    expect(select("그래프로 볼 지역").value).toBe(district.id);
    await click("그래프 닫기");await click("백지도");
    expect(button("백지도").getAttribute("aria-pressed")).toBe("false");
    expect(container.querySelector('[aria-label="지역별 백지도"]')).toBeNull();
    expect(container.querySelector('[aria-label="날씨 지도"]')).not.toBeNull();
    expect(mapProbe.points[0].label).toBe("연수구 10mm");
  });
  it("shows boundary failures without an invented map and allows a successful retry",async()=>{
    await load();fetchSpy.mockResolvedValueOnce({ok:false,json:async()=>({error:{message:"이 지역의 행정경계를 불러오지 못했어요."}})});
    await click("백지도");
    await vi.waitFor(()=>expect(container.querySelector('[role="alert"]')?.textContent).toContain("이 지역의 행정경계를 불러오지 못했어요."));
    expect(container.querySelector('[aria-label="날씨 지도"]')).toBeNull();
    expect(blankProbe.features).toHaveLength(0);
    await click("경계 다시 불러오기");
    await vi.waitFor(()=>expect(blankProbe.features).toHaveLength(1));
    expect(container.querySelector('[role="alert"]')).toBeNull();expect(boundaryReads()).toHaveLength(2);
  });
  it("aborts outdated boundaries and ignores their reply after the weather region changes",async()=>{
    await load();const standardFetch=fetchSpy.getMockImplementation()!;let firstReply:((response:unknown)=>void)|undefined;let boundaryCount=0;
    fetchSpy.mockImplementation((raw:RequestInfo|URL,options?:RequestInit)=>{
      const path=new URL(String(raw),"http://localhost:3001").pathname;
      if(path==="/api/v1/weather/boundaries"){
        boundaryCount++;if(boundaryCount===1)return new Promise(resolve=>{firstReply=resolve;});
        return Promise.resolve(ok({...boundaryResult(),features:[{...boundaryResult().features[0],id:dong.id,name:dong.name,label:[dong.lng,dong.lat]}]}));
      }
      if(path==="/api/v1/weather")return Promise.resolve(ok({...result(),region:district,items:[location(district),location(dong)]}));
      return standardFetch(raw,options);
    });
    await click("백지도");const firstSignal=boundaryReads()[0][1].signal as AbortSignal;
    await click("지역·기간");await change("시·군·구",district.id);await vi.waitFor(()=>expect(select("읍·면·동").options).toHaveLength(2));await submit();
    await vi.waitFor(()=>expect(blankProbe.features.map(feature=>feature.id)).toEqual([dong.id]));
    expect(firstSignal.aborted).toBe(true);
    await act(async()=>firstReply!(ok(boundaryResult())));
    expect(blankProbe.features.map(feature=>feature.id)).toEqual([dong.id]);
    expect(blankProbe.points.map(point=>point.id)).toEqual([dong.id]);
  });
  it("keeps the desktop graph outside the app frame and updates it while using the map",async()=>{
    const media={matches:true,media:"(any-hover: hover) and (any-pointer: fine)",onchange:null,addEventListener:vi.fn(),removeEventListener:vi.fn(),addListener:vi.fn(),removeListener:vi.fn(),dispatchEvent:vi.fn()};
    vi.stubGlobal("matchMedia",vi.fn(()=>media));
    vi.stubGlobal("innerWidth",1440);vi.stubGlobal("innerHeight",900);
    container.className="app-frame";container.style.width="460px";
    const show=vi.spyOn(HTMLDialogElement.prototype,"show");
    const showModal=vi.spyOn(HTMLDialogElement.prototype,"showModal");
    await load();await click("그래프");
    const graph=dialog("날씨 그래프")!;
    expect(graph.open).toBe(true);expect(graph.getAttribute("aria-modal")).not.toBe("true");
    expect(graph.closest(".app-frame")).toBeNull();expect(document.body.contains(graph)).toBe(true);
    expect(show).toHaveBeenCalled();expect(showModal).not.toHaveBeenCalled();
    vi.spyOn(container,"getBoundingClientRect").mockReturnValue({x:490,y:0,left:490,top:0,right:950,bottom:900,width:460,height:900,toJSON:()=>({})});
    vi.spyOn(graph,"getBoundingClientRect").mockImplementation(()=>{const left=Number.parseFloat(graph.style.left)||500,top=Number.parseFloat(graph.style.top)||100;return {x:left,y:top,left,top,right:left+420,bottom:top+400,width:420,height:400,toJSON:()=>({})};});
    const header=graph.querySelector<HTMLElement>(".responsive-map-dialog__header")!;
    Object.defineProperty(header,"setPointerCapture",{value:vi.fn()});Object.defineProperty(header,"releasePointerCapture",{value:vi.fn()});
    await act(async()=>{header.dispatchEvent(new PointerEvent("pointerdown",{pointerId:1,pointerType:"mouse",button:0,isPrimary:true,clientX:550,clientY:120,bubbles:true}));});
    await act(async()=>{header.dispatchEvent(new PointerEvent("pointermove",{pointerId:1,pointerType:"mouse",clientX:-5000,clientY:5000,bubbles:true}));header.dispatchEvent(new PointerEvent("pointerup",{pointerId:1,pointerType:"mouse",clientX:-5000,clientY:5000,bubbles:true}));});
    expect(Number.parseFloat(graph.style.left)).toBeGreaterThanOrEqual(8);expect(Number.parseFloat(graph.style.left)+420).toBeLessThanOrEqual(container.getBoundingClientRect().left);
    expect(Number.parseFloat(graph.style.top)).toBeGreaterThanOrEqual(8);expect(Number.parseFloat(graph.style.top)+400).toBeLessThanOrEqual(window.innerHeight-8);
    expect(select("그래프로 볼 지역",graph).value).toBe(district.id);
    await change("그래프로 볼 지역",city.id);
    await act(async()=>container.querySelector<HTMLButtonElement>('[aria-label="날씨 지도"] button')!.click());
    expect(dialog("날씨 그래프")).toBe(graph);expect(graph.open).toBe(true);
    expect(select("그래프로 볼 지역",graph).value).toBe(district.id);
    expect(weatherReads()).toHaveLength(1);
    await click("그래프 닫기",graph);expect(dialog("날씨 그래프")).toBeNull();
    expect(container.querySelector('[aria-label="날씨 지도"]')).not.toBeNull();
  });
  it("shows missing weather counts as missing, while a measured zero remains zero",async()=>{
    await load();
    await change("지도에 표시할 항목","count:clear");expect(mapProbe.points[0].label).toContain("자료 없음");
    await change("지도에 표시할 항목","count:rain");expect(mapProbe.points[0].label).toContain("0일");
    await click("그래프");await check("맑은 날 (일)");await check("강수 있는 날 (일)");
    const modal=dialog("날씨 그래프")!;
    expect(modal.textContent).toContain("자료 없음");
    expect(modal.querySelector("table")?.textContent).toContain("맑은 날");
    expect(modal.querySelector("table")?.textContent).toContain("강수 있는 날");
  });
  it("maps current observations separately from the historical graph without asking for GPS",async()=>{
    await load();await change("지도에 표시할 자료","current");
    expect(mapProbe.autoLocate).toBe(false);
    expect(mapProbe.points[0].label).toContain("19℃");
    expect(mapProbe.points[0].title).toContain("인천 관측소");
    expect([...select("지도에 표시할 항목").options].map(option=>option.value)).toEqual(["temperature","rainfall","humidity","windSpeed"]);
    await click("그래프");
    const modal=dialog("날씨 그래프")!;
    expect(modal.querySelector("table")?.textContent).toContain("15℃");
    expect(modal.querySelector("table")?.textContent).toContain("17℃");
    expect(modal.querySelector("table")?.textContent).not.toContain("19℃");
    await click("그래프 닫기");await change("지도에 표시할 자료","summary");expect(mapProbe.points[0].label).toContain("16℃");
  });
  it("automatically maps live measurements for today and leaves unfinished daily graphs empty",async()=>{
    await render();fetchSpy.mockResolvedValue(ok({...result(),start:koreanWeatherDate(),end:koreanWeatherDate(),items:[{...location(city),series:[],summary:{values:values(null),metricDays:days(0),observedDays:0,expectedDays:1}}]}));await submit();await vi.waitFor(()=>expect(mapProbe.points).toHaveLength(1));
    expect(mapProbe.points[0].label).toContain("19℃");expect(select("지도에 표시할 자료").value).toBe("current");
    await click("그래프");expect(dialog("날씨 그래프")?.textContent).toContain("해당 기간의 관측자료가 없어요");expect(dialog("날씨 그래프")?.querySelector("svg")).toBeNull();
  });
  it("plots multiple chosen metrics together, keeps their units, and retains at least one series",async()=>{
    await load();await click("그래프");const modal=dialog("날씨 그래프")!;
    expect(modal.querySelectorAll('input[type="checkbox"]')).toHaveLength(13);
    expect(modal.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(1);
    await toggle("평균 기온 (℃)");expect(modal.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(1);
    await toggle("강수량 (mm)");
    expect(modal.querySelectorAll('input[type="checkbox"]:checked')).toHaveLength(2);
    expect(modal.querySelectorAll("svg")).toHaveLength(1);
    const table=modal.querySelector("table")!;
    expect(table.querySelector("thead")?.textContent).toContain("평균 기온");expect(table.querySelector("thead")?.textContent).toContain("강수량");
    expect(table.textContent).toContain("15℃");expect(table.textContent).toContain("4.6mm");
    await change("평균 기온 그래프 종류","bar");expect(modal.querySelectorAll("svg rect")).toHaveLength(4);
    await change("평균 기온 그래프 종류","line");await change("강수량 그래프 종류","line");expect(modal.querySelectorAll("svg circle")).toHaveLength(4);
  });
  it("defaults each selected metric to its own chart type and changes only the chosen series",async()=>{
    await load();await click("그래프");const modal=dialog("날씨 그래프")!;
    expect(select("평균 기온 그래프 종류",modal).value).toBe("line");
    expect(select("강수량 그래프 종류",modal).value).toBe("bar");
    expect(select("강수량 그래프 종류",modal).disabled).toBe(true);
    expect(select("맑은 날 그래프 종류",modal).value).toBe("bar");
    await check("강수량 (mm)");
    expect(select("강수량 그래프 종류",modal).disabled).toBe(false);
    const series=(label:string)=>modal.querySelector<SVGGElement>(`.weather-multi-chart__series[aria-label="${label}"]`)!;
    expect(modal.querySelectorAll("svg")).toHaveLength(1);
    expect(modal.querySelector("svg > title")?.textContent).toContain("혼합 그래프");
    expect(series("평균 기온").querySelectorAll("circle")).toHaveLength(2);
    expect(series("평균 기온").querySelector("rect")).toBeNull();
    expect(series("강수량").querySelectorAll("rect")).toHaveLength(2);
    expect(series("강수량").querySelector("circle")).toBeNull();
    const legend=modal.querySelector('[aria-label="그래프 항목과 단위"]')!;
    expect(legend.textContent).toContain("평균 기온 (℃) · 꺾은선");
    expect(legend.textContent).toContain("강수량 (mm) · 막대");
    const rainValues=[...series("강수량").querySelectorAll("rect")].map(bar=>bar.getAttribute("aria-label"));
    await change("평균 기온 그래프 종류","bar");
    expect(series("평균 기온").querySelectorAll("rect")).toHaveLength(2);
    expect(series("평균 기온").querySelector("circle")).toBeNull();
    expect([...series("강수량").querySelectorAll("rect")].map(bar=>bar.getAttribute("aria-label"))).toEqual(rainValues);
    expect(series("강수량").querySelector("circle")).toBeNull();
    expect(select("강수량 그래프 종류",modal).value).toBe("bar");
    expect(legend.textContent).toContain("평균 기온 (℃) · 막대");
    expect(legend.textContent).toContain("강수량 (mm) · 막대");
  });
  it("retains a metric's graph type when deselected, moved to another region, and reopened",async()=>{
    await load();await click("그래프");await check("강수량 (mm)");
    await change("강수량 그래프 종류","line");
    await toggle("강수량 (mm)");
    expect(select("강수량 그래프 종류").disabled).toBe(true);
    expect(select("강수량 그래프 종류").value).toBe("line");
    await check("강수량 (mm)");
    expect(select("강수량 그래프 종류").disabled).toBe(false);
    expect(select("강수량 그래프 종류").value).toBe("line");
    await change("그래프로 볼 지역",city.id);
    expect(select("강수량 그래프 종류").value).toBe("line");
    await click("그래프 닫기");await click("그래프");
    const modal=dialog("날씨 그래프")!;
    expect(select("그래프로 볼 지역",modal).value).toBe(city.id);
    expect(select("강수량 그래프 종류",modal).value).toBe("line");
    expect(labelled<HTMLInputElement>("input","강수량 (mm)",modal).checked).toBe(true);
    expect(modal.querySelector('.weather-multi-chart__series[aria-label="강수량"] circle')).not.toBeNull();
    expect(modal.querySelector('.weather-multi-chart__series[aria-label="강수량"] rect')).toBeNull();
    expect(weatherReads()).toHaveLength(1);
  });
  it("keeps the displayed result while query edits are unsubmitted",async()=>{
    await load();const before=mapProbe.points.map(point=>({...point}));await click("지역·기간");await change("시·군·구",district.id);await click("주별");
    expect(mapProbe.points).toEqual(before);expect(weatherReads()).toHaveLength(1);
    await click("지역·기간 선택 닫기");expect(mapProbe.points).toEqual(before);
  });
  it("aborts the old query and ignores a stale response after a new query finishes",async()=>{
    await render();let firstReply:((response:unknown)=>void)|undefined;let requested=0;
    fetchSpy.mockImplementation((raw:RequestInfo|URL)=>{if(String(raw).startsWith("/api/v1/weather?")){requested++;return requested===1?new Promise(resolve=>{firstReply=resolve;}):Promise.resolve(ok({...result(),items:[{...location(city),summary:{...location(city).summary,values:values(26)}}]}));}return Promise.resolve(ok({items:[district]}));});
    await submit();const firstSignal=weatherReads()[0][1].signal as AbortSignal;await click("지역·기간");await click("월별");await submit();
    await vi.waitFor(()=>expect(mapProbe.points[0].label).toContain("26℃"));expect(firstSignal.aborted).toBe(true);
    await act(async()=>firstReply!(ok(result())));expect(mapProbe.points[0].label).toContain("26℃");
  });
  it("aborts reads on unmount and ignores a weather response that arrives later",async()=>{
    await render();let reply:((response:unknown)=>void)|undefined;
    fetchSpy.mockImplementation((raw:RequestInfo|URL)=>String(raw).startsWith("/api/v1/weather?")?new Promise(resolve=>{reply=resolve;}):Promise.resolve(ok({items:[]})));await submit();
    const signal=weatherReads()[0][1].signal as AbortSignal;await act(async()=>root.unmount());expect(signal.aborted).toBe(true);
    await act(async()=>reply!(ok(result())));expect(container.childElementCount).toBe(0);root=createRoot(container);
  });
});

describe("weather chart",()=>{
  it("does not connect a line through missing observations, and supports negative temperatures",async()=>{await act(async()=>root.render(<WeatherChart data={[{label:"10/1",value:-3},{label:"10/2",value:-1},{label:"10/3",value:null},{label:"10/4",value:2}]} kind="line" unit="℃" label="기온"/>));const paths=container.querySelectorAll("polyline");expect(paths).toHaveLength(1);expect(paths[0].getAttribute("points")?.split(" ")).toHaveLength(2);expect(container.querySelectorAll("circle")).toHaveLength(3);expect(container.querySelector("svg desc")?.textContent).toContain("빈 구간은 자료 없음");});
  it("renders an explicit unavailable state when every observation is missing",async()=>{await act(async()=>root.render(<WeatherChart data={[{label:"10/1",value:null}]} kind="bar" unit="mm" label="강수량"/>));expect(container.querySelector("svg")).toBeNull();expect(container.textContent).toContain("해당 기간의 관측자료가 없어요");});
});
