// @vitest-environment happy-dom
import {act,StrictMode,type ComponentType} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {themeByKey} from "../src/lib/demo-data";
import type {LiveMap} from "../src/lib/map-directory";
import type {MergePoint} from "../src/domain/map-merge";
import {attachUnsavedRecordGuard} from "../src/lib/unsaved-record-guard";
import type {MapFocus,MapPoint} from "../src/components/KakaoMap";

const mapProbe=vi.hoisted(()=>({autoLocate:undefined as boolean|undefined,focus:null as MapFocus|null,points:[] as MapPoint[]}));
vi.mock("next/dynamic",async()=>{
  const {lazy,Suspense}=await import("react");
  return {default:(loader:()=>Promise<{default:ComponentType<Record<string,unknown>>}>)=>{
    const Loaded=lazy(loader);return function Dynamic(props:Record<string,unknown>){return <Suspense fallback={<p>지도 불러오는 중</p>}><Loaded {...props}/></Suspense>;};
  }};
});
vi.mock("../src/components/KakaoMap",()=>({default:({autoLocate,focus,points,onSelectPoint}:{autoLocate:boolean;focus:MapFocus|null;points:MapPoint[];onSelectPoint:(id:string)=>void})=>{
  mapProbe.autoLocate=autoLocate;mapProbe.focus=focus;mapProbe.points=points;
  return <div aria-label="전체 미리보기 지도">{points.map(point=><button type="button" key={point.id} aria-label={`핀 ${point.title}`} onClick={()=>onSelectPoint(point.id)}>{point.title}</button>)}</div>;
}}));
import MapSourcePreview from "../src/components/MapSourcePreview";

const map:LiveMap={id:"10000000-0000-4000-8000-000000000001",title:"우리학교 안전지도",description:"학생들이 조사한 안전한 길",themeKey:"safety",location:"학교 주변",center:{lat:37,lng:127},configRevision:1,visibility:"public",participation:"invited",moderation:"immediate",commentsEnabled:true,status:"active",version:"1",isMine:true,isOwner:true,capabilities:{canManageMap:true,canCreateObservation:true,canComment:true}};
const theme=themeByKey.safety;
const records:(MergePoint&{status:"published";canEdit:boolean;canDelete:boolean;canModerate:boolean})[]=[0,1].map(index=>({id:`20000000-0000-4000-8000-00000000000${index+1}`,mapId:map.id,title:index===0?"학교 앞 신호등":"골목길 조명",body:"친구들과 신호를 확인했어요.",locationLabel:"학교 정문",locationSource:"manual",location:{lat:37+index/100,lng:127+index/100},categoryKey:theme.categories[0].key,emojiKey:theme.categories[0].emojiOptions[0].key,ratingKey:theme.rating!.options[0].key,answers:{},improvementIdea:"안내판을 더 크게 해요.",link:"https://example.com/info",createdAt:"2026-10-10T00:00:00Z",author:"우리 반",version:"1",photoUrl:"https://example.com/photo.jpg",status:"published",canEdit:true,canDelete:true,canModerate:true}));
let container:HTMLDivElement,root:Root;
const close=vi.fn(),fetchSpy=vi.fn(),confirmSpy=vi.fn();
let pending:((response:unknown)=>void)|null;
let failure:boolean;
let nullTheme:boolean;
let parentGuard:(()=>void)|null;
function ok(data:unknown){return {ok:true,json:async()=>({data})};}
function button(label:string){const found=[...container.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.getAttribute("aria-label")===label||item.textContent?.trim()===label);if(!found)throw new Error(`Button missing: ${label}`);return found;}
async function click(label:string){await act(async()=>button(label).click());}
async function render(strict=false){await act(async()=>{root.render(strict?<StrictMode><MapSourcePreview map={map} onClose={close}/></StrictMode>:<MapSourcePreview map={map} onClose={close}/>);});}
async function back(){await act(async()=>{window.history.back();await new Promise(resolve=>setTimeout(resolve,20));});}

beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("confirm",confirmSpy);
  window.history.replaceState(null,"","/maps/merge");close.mockReset();confirmSpy.mockReset().mockReturnValue(false);parentGuard=null;pending=null;failure=false;nullTheme=false;
  mapProbe.autoLocate=undefined;mapProbe.focus=null;mapProbe.points=[];
  fetchSpy.mockReset().mockImplementation(async(raw:RequestInfo|URL)=>{
    const url=String(raw);
    if(url.includes("/analysis?")){
      if(failure)return {ok:false,json:async()=>({error:{message:"권한을 다시 확인해 주세요."}})};
      return ok({items:records,stats:{total:2}});
    }
    if(url.endsWith("/configuration"))return ok({theme:nullTheme?null:theme,configRevision:1});
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch",fetchSpy);container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{
  await act(async()=>{root.unmount();await new Promise(resolve=>setTimeout(resolve,20));});
  parentGuard?.();container.remove();vi.unstubAllGlobals();
});

describe("read-only whole map preview",()=>{
  it("loads all posted records through GET and fits the complete map without requesting current location",async()=>{
    await render();await vi.waitFor(()=>expect(mapProbe.points).toHaveLength(2));
    expect(container.querySelector<HTMLDialogElement>("dialog.map-source-preview")?.open).toBe(true);expect(container.textContent).toContain(map.title);expect(container.textContent).toContain(map.description);expect(container.textContent).toContain("게시된 포인트 2개");expect(mapProbe.autoLocate).toBe(false);expect(mapProbe.focus?.locations).toEqual(records.map(point=>point.location));
    expect(fetchSpy.mock.calls.map(([url])=>String(url))).toEqual([`/api/v1/maps/${map.id}/analysis?filter=%7B%7D`,`/api/v1/maps/${map.id}/configuration`]);expect(fetchSpy.mock.calls.every(([,options])=>!options?.method||options.method==="GET")).toBe(true);
  });

  it("shows photo, text, link and rating without edit or comment controls, and inner Escape keeps the preview open",async()=>{
    await render();await vi.waitFor(()=>expect(mapProbe.points).toHaveLength(2));await click(`핀 ${records[0].title}`);
    const detail=container.querySelector<HTMLDialogElement>("dialog.point-dialog")!;
    expect(detail.textContent).toContain(records[0].body);expect(detail.textContent).toContain(theme.rating!.options[0].label);expect(detail.querySelector(".sheet-photo")?.getAttribute("src")).toBe(records[0].photoUrl);expect(detail.querySelector(".sheet-link")?.getAttribute("href")).toBe(records[0].link);expect(detail.querySelectorAll("form,input,textarea")).toHaveLength(0);expect(detail.textContent).not.toContain("기록 수정");
    await act(async()=>{detail.dispatchEvent(new Event("cancel",{bubbles:true,cancelable:true}));});
    expect(container.querySelector("dialog.point-dialog")).toBeNull();expect(container.querySelector<HTMLDialogElement>("dialog.map-source-preview")?.open).toBe(true);expect(close).not.toHaveBeenCalled();
  });

  it("consumes Back for the record, then the preview, before the parent unsaved guard",async()=>{
    parentGuard=attachUnsavedRecordGuard(window);await render();await vi.waitFor(()=>expect(mapProbe.points).toHaveLength(2));await click(`핀 ${records[0].title}`);
    await back();expect(container.querySelector("dialog.point-dialog")).toBeNull();expect(close).not.toHaveBeenCalled();expect(confirmSpy).not.toHaveBeenCalled();
    const unload=new Event("beforeunload",{cancelable:true});window.dispatchEvent(unload);expect(unload.defaultPrevented).toBe(true);
    await back();expect(close).toHaveBeenCalledTimes(1);expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("preserves the parent's warning for refresh while closing by Escape without a discard prompt",async()=>{
    parentGuard=attachUnsavedRecordGuard(window);await render();
    const outer=container.querySelector<HTMLDialogElement>("dialog.map-source-preview")!;
    await act(async()=>{outer.dispatchEvent(new Event("cancel",{bubbles:true,cancelable:true}));await new Promise(resolve=>setTimeout(resolve,20));});
    expect(close).toHaveBeenCalledTimes(1);expect(confirmSpy).not.toHaveBeenCalled();
  });

  it("shows loading, supports retry after a permission/network failure and rejects missing theme data",async()=>{
    failure=true;await render();expect(container.querySelector("[role='alert']")?.textContent).toContain("권한을 다시 확인");failure=false;await click("미리보기 다시 불러오기");await vi.waitFor(()=>expect(mapProbe.points).toHaveLength(2));
    await act(async()=>{root.unmount();await new Promise(resolve=>setTimeout(resolve,20));});root=createRoot(container);nullTheme=true;await render();expect(container.querySelector("[role='alert']")?.textContent).toContain("주제 정보를 불러오지 못했어요");
  });

  it("aborts a pending read and ignores its late response after the popup unmounts",async()=>{
    fetchSpy.mockReset().mockImplementation((_url:RequestInfo|URL)=>new Promise(resolve=>{pending=resolve;}));await render();expect(container.textContent).toContain("모든 게시 기록을 불러오고 있어요");
    const signal=fetchSpy.mock.calls[0][1].signal as AbortSignal;await act(async()=>root.unmount());expect(signal.aborted).toBe(true);const resolve=pending!;await act(async()=>resolve(ok({items:records})));expect(fetchSpy).toHaveBeenCalledTimes(1);expect(container.querySelector("dialog")).toBeNull();root=createRoot(container);
  });

  it("reuses one popup history entry during Strict Mode remount",async()=>{
    const before=window.history.length;parentGuard=attachUnsavedRecordGuard(window);await render(true);await vi.waitFor(()=>expect(mapProbe.points).toHaveLength(2));await act(async()=>{await new Promise(resolve=>setTimeout(resolve,20));});expect(window.history.length).toBe(before+1);expect(close).not.toHaveBeenCalled();await back();expect(close).toHaveBeenCalledTimes(1);expect(confirmSpy).not.toHaveBeenCalled();
  });
});
