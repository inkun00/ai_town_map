// @vitest-environment happy-dom
import {act,type ComponentType} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {themeByKey} from "../src/lib/demo-data";
import type {LiveMap} from "../src/lib/map-directory";
import type {MergePoint,MergeSource} from "../src/domain/map-merge";
import type {MapFocus,MapPoint} from "../src/components/KakaoMap";

const mapProbe=vi.hoisted(()=>({autoLocate:undefined as boolean|undefined,focus:null as MapFocus|null,points:[] as MapPoint[]}));
vi.mock("next/dynamic",async()=>{
  const {lazy,Suspense}=await import("react");
  return {default:(loader:()=>Promise<{default:ComponentType<Record<string,unknown>>}>)=>{
    const Loaded=lazy(loader);
    return function Dynamic(props:Record<string,unknown>){return <Suspense fallback={<p>지도 불러오는 중</p>}><Loaded {...props}/></Suspense>;};
  }};
});
vi.mock("../src/components/KakaoMap",()=>({default:({points,focus,autoLocate,onSelectPoint}:{points:MapPoint[];focus:MapFocus|null;autoLocate:boolean;onSelectPoint:(id:string)=>void})=>{
  mapProbe.points=points;mapProbe.focus=focus;mapProbe.autoLocate=autoLocate;
  return <div aria-label="임시 지도">{points.map(point=><button key={point.id} type="button" aria-label={`핀 ${point.title}`} onClick={()=>onSelectPoint(point.id)}>{point.title}</button>)}</div>;
}}));
import {MapMergeFlow} from "../src/components/MapMergeFlow";

type Session={kind:"account"|"guest";accountRole:string|null;canCreateMap:boolean;csrfToken:string|null};
const teacher:Session={kind:"account",accountRole:"teacher",canCreateMap:true,csrfToken:"teacher-csrf"};
const sourceIds=["10000000-0000-4000-8000-000000000001","10000000-0000-4000-8000-000000000002","10000000-0000-4000-8000-000000000003"];
const maps:LiveMap[]=sourceIds.map((id,index)=>({id,title:["학교 안전지도","동네 생태지도","보관 지도"][index],description:"학생들과 조사한 지도",themeKey:index===1?"ecology":"safety",location:"우리 동네",center:{lat:37,lng:127+index/100},configRevision:1,visibility:index===1?"invite_only":"public",participation:"invited",moderation:"immediate",commentsEnabled:true,status:index===2?"archived":"active",version:"3",isMine:true,isOwner:true,capabilities:{canManageMap:true,canCreateObservation:true,canComment:true}}));
const sources:MergeSource[]=maps.slice(0,2).map(map=>({id:map.id,title:map.title,location:map.location,theme:themeByKey[map.themeKey],themeKey:map.themeKey,visibility:map.visibility,center:map.center,configRevision:1,version:"3:1:8",pointCount:1}));
const points:MergePoint[]=sources.map((source,index)=>({id:`20000000-0000-4000-8000-00000000000${index+1}`,mapId:source.id,title:index===0?"학교 앞 횡단보도":"마을 큰 나무",body:index===0?"신호를 확인하고 건너요.":"그늘이 시원해요.",locationLabel:source.location,locationSource:"manual",location:{lat:37+index/100,lng:127},categoryKey:source.theme.categories[0].key,emojiKey:source.theme.categories[0].emojiOptions[0].key,ratingKey:source.theme.features.ratingEnabled?source.theme.rating!.options[0].key:null,answers:{},improvementIdea:index===0?"안내 표시를 더 크게 해요.":null,link:"https://example.com/info",createdAt:"2026-10-10T00:00:00Z",author:"학생 탐험대",version:"7",photoUrl:"https://example.com/photo.jpg"}));

let container:HTMLDivElement;
let root:Root;
let session:Session|null;
let preview:{sources:MergeSource[];points:MergePoint[]};
let creationResponses:(Error|{status:number;message:string}|null)[];
const fetchSpy=vi.fn(),navigate=vi.fn(),confirmSpy=vi.fn();
function ok(data:unknown){return {ok:true,status:200,json:async()=>({data})};}
function button(label:string){const found=[...container.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.getAttribute("aria-label")===label||item.textContent?.trim()===label);if(!found)throw new Error(`Button missing: ${label}`);return found;}
async function click(label:string){await act(async()=>{button(label).click();});}
async function checkboxFor(title:string){
  const label=[...container.querySelectorAll<HTMLLabelElement>("label")].find(item=>item.querySelector("strong")?.textContent===title);
  const input=label?.querySelector<HTMLInputElement>("input[type='checkbox']");if(!input)throw new Error(`Checkbox missing: ${title}`);
  await act(async()=>input.click());
}
async function setField(labelText:string,value:string){
  const label=[...container.querySelectorAll<HTMLLabelElement>("label")].find(item=>item.textContent?.trim()===labelText);
  const element=label?.querySelector<HTMLInputElement|HTMLTextAreaElement>("input,textarea");if(!element)throw new Error(`Field missing: ${labelText}`);
  await act(async()=>{const prototype=element.tagName==="TEXTAREA"?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,"value")!.set!.call(element,value);element.dispatchEvent(new Event("input",{bubbles:true}));});
}
function creationCalls(){return fetchSpy.mock.calls.filter(([url])=>String(url)==="/api/v1/maps/merge");}
async function render(){await act(async()=>root.render(<MapMergeFlow onNavigate={navigate}/>));}
async function chooseSources(){await render();await checkboxFor(maps[0].title);await checkboxFor(maps[1].title);}
async function previewPoints(){await chooseSources();await click("만들기");await vi.waitFor(()=>expect(container.querySelector("[aria-label='임시 지도']")).not.toBeNull());}
async function prepareFinal(){await previewPoints();await click(`핀 ${points[0].title}`);await click("다음");await setField("새 지도 이름","함께 걷는 우리 동네");await setField("지역 또는 장소","우리학교 주변");await setField("지도 소개","필요한 안전 기록을 모았어요.");}
async function submit(){await act(async()=>{container.querySelector<HTMLFormElement>("#map-merge-finish")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});}

beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("confirm",confirmSpy);
  session=teacher;preview={sources:structuredClone(sources),points:structuredClone(points)};creationResponses=[];
  navigate.mockReset();confirmSpy.mockReset().mockReturnValue(false);mapProbe.points=[];mapProbe.focus=null;mapProbe.autoLocate=undefined;
  window.history.replaceState(null,"","/maps/merge");
  fetchSpy.mockReset().mockImplementation(async(raw:RequestInfo|URL,options?:RequestInit)=>{
    const url=String(raw);
    if(url==="/api/v1/session")return ok(session);
    if(url.startsWith("/api/v1/maps?"))return ok({items:maps,nextCursor:null});
    if(url==="/api/v1/maps/merge/preview")return ok(preview);
    if(url==="/api/v1/maps/merge"){
      const next=creationResponses.shift();if(next instanceof Error)throw next;
      if(next)return {ok:false,status:next.status,json:async()=>({error:{message:next.message}})};
      const payload=JSON.parse(String(options?.body)) as {pointIds:string[]};return ok({map:{id:"merged-map"},copiedPoints:payload.pointIds.length,repeated:false});
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch",fetchSpy);container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});

describe("mobile map merge flow",()=>{
  it("gates creation by login, account setup and teacher capabilities",async()=>{
    session=null;await render();expect(container.querySelector("a[href^='/api/v1/auth/google']")).not.toBeNull();expect(container.querySelector(".map-merge-directory")).toBeNull();
    await act(async()=>root.unmount());root=createRoot(container);
    session={...teacher,accountRole:null,canCreateMap:false};await render();expect(container.querySelector("a[href^='/account/setup']")).not.toBeNull();
    await act(async()=>root.unmount());root=createRoot(container);
    session={...teacher,accountRole:"student",canCreateMap:false};await render();expect(container.textContent).toContain("현재 회원은 참여용 계정");expect(container.querySelector(".map-merge-directory")).toBeNull();
    expect(creationCalls()).toHaveLength(0);
  });

  it("requires two active maps and preserves source choices across directory tabs",async()=>{
    await render();expect(button("만들기").disabled).toBe(true);
    const archived=[...container.querySelectorAll("label")].find(item=>item.textContent?.includes("보관 지도"))?.querySelector<HTMLInputElement>("input");expect(archived?.disabled).toBe(true);
    await checkboxFor(maps[0].title);expect(button("만들기").disabled).toBe(true);
    await click("내가 참여한 지도");await checkboxFor(maps[1].title);expect(button("만들기").disabled).toBe(false);
    expect(container.querySelector("[aria-label='선택한 지도']")?.textContent).toContain(maps[0].title);expect(container.querySelector("[aria-label='선택한 지도']")?.textContent).toContain(maps[1].title);
    expect(creationCalls()).toHaveLength(0);
  });

  it("supports arrow, Home and End navigation with roving focus and a labelled directory panel",async()=>{
    await render();
    const publicTab=button("공개 지도"),mineTab=button("내가 참여한 지도");
    const panel=container.querySelector<HTMLElement>("[role='tabpanel']")!;
    expect(publicTab.tabIndex).toBe(0);expect(mineTab.tabIndex).toBe(-1);
    expect(publicTab.getAttribute("aria-controls")).toBe(panel.id);
    expect(mineTab.getAttribute("aria-controls")).toBe(panel.id);
    expect(panel.getAttribute("aria-labelledby")).toBe(publicTab.id);
    async function press(target:HTMLButtonElement,key:string){await act(async()=>{target.focus();target.dispatchEvent(new KeyboardEvent("keydown",{key,bubbles:true,cancelable:true}));});}
    await press(publicTab,"ArrowRight");expect(document.activeElement).toBe(mineTab);expect(mineTab.tabIndex).toBe(0);expect(publicTab.tabIndex).toBe(-1);expect(mineTab.getAttribute("aria-selected")).toBe("true");expect(panel.getAttribute("aria-labelledby")).toBe(mineTab.id);
    await press(mineTab,"ArrowLeft");expect(document.activeElement).toBe(publicTab);expect(publicTab.getAttribute("aria-selected")).toBe("true");
    await press(publicTab,"End");expect(document.activeElement).toBe(mineTab);expect(panel.getAttribute("aria-labelledby")).toBe(mineTab.id);
    await press(mineTab,"Home");expect(document.activeElement).toBe(publicTab);expect(panel.getAttribute("aria-labelledby")).toBe(publicTab.id);
    expect(creationCalls()).toHaveLength(0);
  });

  it("shows all preview locations without saving a map, selects only chosen records and submits snapshot versions",async()=>{
    await previewPoints();expect(creationCalls()).toHaveLength(0);expect(mapProbe.autoLocate).toBe(false);expect(mapProbe.focus?.locations).toEqual(points.map(point=>point.location));expect(mapProbe.points).toHaveLength(2);expect(mapProbe.points.every(point=>point.color==="#808b94")).toBe(true);expect(container.textContent).toContain("파란 핀은 선택한 기록");
    expect(container.querySelector(".map-merge-footer")?.textContent).toContain("포인트 0개 선택");expect(button("다음").disabled).toBe(true);
    await click(`핀 ${points[0].title}`);expect(container.querySelector("dialog")).toBeNull();expect(container.querySelector(".map-merge-footer")?.textContent).toContain("포인트 1개 선택");expect(mapProbe.points.find(point=>point.id===points[0].id)?.color).toBe("#2563eb");expect(mapProbe.points.find(point=>point.id===points[1].id)?.color).toBe("#808b94");expect(mapProbe.points[0].rating?.label).toBe(sources[0].theme.rating!.options.find(option=>option.key===points[0].ratingKey)!.label);
    await click(`${points[0].title} 정보 보기`);expect(container.querySelector("dialog")?.textContent).toContain(points[0].body);expect(container.querySelector("dialog .sheet-photo")?.getAttribute("src")).toBe(points[0].photoUrl);expect(container.querySelector("dialog .sheet-link")?.getAttribute("href")).toBe(points[0].link);await click("합칠 기록 정보 닫기");
    await click("다음");expect(container.textContent).toContain("초대 전용");expect(container.textContent).toContain("분류별 색");await setField("새 지도 이름","함께 걷는 지도");await setField("지역 또는 장소","우리마을");await submit();
    const [,options]=creationCalls()[0];const payload=JSON.parse(String(options.body));expect(payload.pointIds).toEqual([points[0].id]);expect(payload.mapIds).toEqual(sourceIds.slice(0,2));expect(payload.pointVersions).toEqual({[points[0].id]:"7"});expect(payload.sourceVersions).toEqual(Object.fromEntries(sources.map(source=>[source.id,source.version])));expect(options.headers["X-CSRF-Token"]).toBe("teacher-csrf");expect(options.headers["Idempotency-Key"]).toMatch(/^[0-9a-f-]{36}$/);expect(navigate).toHaveBeenCalledWith("/?map=merged-map");
    const unload=new Event("beforeunload",{cancelable:true});window.dispatchEvent(unload);expect(unload.defaultPrevented).toBe(false);
  });

  it("filters by source and changes selection through list checkboxes and bulk controls",async()=>{
    await previewPoints();await click("표시된 포인트 전체 선택");expect(container.querySelector(".map-merge-footer")?.textContent).toContain("포인트 2개 선택");
    const filter=container.querySelector<HTMLSelectElement>("select[aria-label='포인트 원본 지도']")!;
    await act(async()=>{filter.value=sourceIds[0];filter.dispatchEvent(new Event("change",{bubbles:true}));});expect(mapProbe.points.map(point=>point.id)).toEqual([points[0].id]);
    await click("표시된 포인트 선택 해제");expect(container.querySelector(".map-merge-footer")?.textContent).toContain("포인트 1개 선택");await checkboxFor(points[0].title);expect(container.querySelector(".map-merge-footer")?.textContent).toContain("포인트 2개 선택");expect(creationCalls()).toHaveLength(0);
  });

  it("preserves input after a network failure and retries exactly the same idempotent creation",async()=>{
    await prepareFinal();creationResponses=[new TypeError("연결이 끊겼어요."),null];await submit();expect(navigate).not.toHaveBeenCalled();expect(container.querySelector<HTMLInputElement>("#map-merge-finish input")?.value).toBe("함께 걷는 우리 동네");expect(container.querySelector(".map-merge-footer")?.textContent).toContain("포인트 1개 선택");
    await submit();const calls=creationCalls();expect(calls).toHaveLength(2);expect(calls[0][1].body).toBe(calls[1][1].body);expect(calls[0][1].headers["Idempotency-Key"]).toBe(calls[1][1].headers["Idempotency-Key"]);expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("requires a fresh preview after a source conflict and retains title and selected surviving points",async()=>{
    await prepareFinal();creationResponses=[{status:409,message:"원본이 바뀌었어요."}];await submit();expect(button("완료").disabled).toBe(true);expect(container.textContent).toContain("미리보기를 새로 확인");
    preview={sources:sources.map(source=>({...source,version:"4:1:9"})),points:[{...points[0],version:"8"}]};await click("미리보기 새로 확인");expect(container.querySelector(".map-merge-footer")?.textContent).toContain("포인트 1개 선택");await click("다음");expect(container.querySelector<HTMLInputElement>("#map-merge-finish input")?.value).toBe("함께 걷는 우리 동네");await submit();const payload=JSON.parse(String(creationCalls()[1][1].body));expect(payload.pointVersions[points[0].id]).toBe("8");expect(payload.sourceVersions[sourceIds[0]]).toBe("4:1:9");expect(navigate).toHaveBeenCalledWith("/?map=merged-map");
  });

  it("keeps selections and text on step back, and warns only when leaving the flow",async()=>{
    await prepareFinal();await click("이전");expect(container.querySelector(".map-merge-footer")?.textContent).toContain("포인트 1개 선택");await click("다음");expect(container.querySelector<HTMLInputElement>("#map-merge-finish input")?.value).toBe("함께 걷는 우리 동네");expect(confirmSpy).not.toHaveBeenCalled();
    const unload=new Event("beforeunload",{cancelable:true});window.dispatchEvent(unload);expect(unload.defaultPrevented).toBe(true);
    await click("지도 합치기 취소");expect(confirmSpy).toHaveBeenCalledTimes(1);expect(navigate).not.toHaveBeenCalled();expect(container.querySelector<HTMLInputElement>("#map-merge-finish input")?.value).toBe("함께 걷는 우리 동네");confirmSpy.mockReturnValue(true);await click("지도 합치기 취소");expect(navigate).toHaveBeenCalledWith("/");
  });
});
