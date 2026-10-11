// @vitest-environment happy-dom
import {act,type ComponentType,type ReactNode} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {themeByKey,type DemoPoint} from "../src/lib/demo-data";
import type {InlineObservation} from "../src/components/InlineRecordEditor";
import type {LiveMap} from "../src/lib/map-directory";

vi.mock("next/dynamic",async()=>{
  const {lazy,Suspense}=await import("react");
  return {default:(loader:()=>Promise<ComponentType<Record<string,unknown>>|{default:ComponentType<Record<string,unknown>>}>)=>{
    const Loaded=lazy(async()=>{const module=await loader();return {default:typeof module==="function"?module:module.default};});
    return function Dynamic(props:Record<string,unknown>){return <Suspense fallback={<p>불러오는 중</p>}><Loaded {...props}/></Suspense>;};
  }};
});
vi.mock("next/image",()=>({default:({src,alt}:{src:string|{src:string};alt:string})=><img src={typeof src==="string"?src:src.src} alt={alt}/>}));
vi.mock("@/assets/adventure/explorer-fox.webp",()=>({default:{src:"/test-fox.webp",width:1,height:1}}));
vi.mock("../src/components/MapWorkspace",()=>({MapWorkspace:({points,onSelect}:{points:DemoPoint[];onSelect:(id:string)=>void})=><section data-testid="workspace-map">
  {points.map(point=><button type="button" key={point.id} aria-label={`핀 ${point.title}`} onClick={()=>onSelect(point.id)}>{point.title}</button>)}
</section>}));
vi.mock("../src/components/AnalysisControls",()=>({AnalysisPanel:({hidden,children,onShowRecords}:{hidden:boolean;children:ReactNode;onShowRecords:()=>void})=><section data-testid="analysis-panel" hidden={hidden}>
  <button type="button" onClick={onShowRecords}>원본 기록 목록 보기</button>{children}
</section>}));
vi.mock("../src/components/AiAnalysisWorkspace",async()=>{
  const {useState}=await import("react");
  return {AiAnalysisWorkspace:({points,onShowPoint}:{points:DemoPoint[];onShowPoint:(id:string)=>void})=>{
    const [draft,setDraft]=useState("");
    return <section data-testid="ai-analysis"><input aria-label="나의 분석 글" value={draft} onChange={event=>setDraft(event.target.value)}/>{points.map(point=><button type="button" key={point.id} onClick={()=>onShowPoint(point.id)}>원본 보기: {point.title}</button>)}</section>;
  }};
});

// Render the actual page so React reconciles its keyed dynamic siblings. The
// external map and analysis implementations are replaced with stateful probes.
import HomePage from "../src/app/page";

const liveMap:LiveMap={id:"map-reconciliation",title:"우리학교 안전지도",description:"학교 주변 안전 조사",themeKey:"safety",location:"우리학교",center:{lat:37,lng:127},configRevision:1,visibility:"public",participation:"invited",moderation:"approval",commentsEnabled:true,status:"active",version:"4",isMine:true,isOwner:true,capabilities:{canManageMap:true,canCreateObservation:true,canComment:true}};
const record:InlineObservation={id:"point-reconciliation",mapId:liveMap.id,title:"횡단보도",body:"신호를 확인하고 길을 건너요.",locationLabel:"학교 정문",locationSource:"manual",location:{lat:37,lng:127},categoryKey:"traffic",emojiKey:"traffic-1",ratingKey:"positive",answers:{},improvementIdea:null,link:null,status:"published",version:"7",createdAt:"2026-10-10T00:00:00Z",author:"교사",canEdit:true,canDelete:true,photoUrl:null};
let container:HTMLDivElement;
let root:Root;
let reactErrors:unknown[][];

function response(data:unknown){return {ok:true,json:async()=>({data})};}
function button(label:string){
  const found=[...container.querySelectorAll<HTMLButtonElement>("button")].find(item=>{
    const accessible=item.cloneNode(true) as HTMLButtonElement;
    accessible.querySelectorAll("[aria-hidden='true']").forEach(child=>child.remove());
    return item.getAttribute("aria-label")===label||accessible.textContent?.trim()===label;
  });
  if(!found)throw new Error(`Button missing: ${label}`);
  return found;
}
async function click(label:string){await act(async()=>button(label).click());}
async function setDraft(value:string){
  const input=container.querySelector<HTMLInputElement>("input[aria-label='나의 분석 글']")!;
  await act(async()=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);
    input.dispatchEvent(new Event("input",{bubbles:true}));
  });
}
function maps(){return container.querySelectorAll("[data-testid='workspace-map']");}
function panel(){return container.querySelector<HTMLElement>("[data-testid='analysis-panel']");}
function assertStableAnalysis(expected:HTMLElement,draft:string){
  expect(container.querySelectorAll("[data-testid='analysis-panel']")).toHaveLength(1);
  expect(container.querySelectorAll("[data-testid='ai-analysis']")).toHaveLength(1);
  expect(panel()).toBe(expected);
  expect(container.querySelector<HTMLInputElement>("input[aria-label='나의 분석 글']")?.value).toBe(draft);
}
function assertNoKeyWarning(){expect(reactErrors.flat().map(String).join(" ")).not.toMatch(/same key|unique.*key/i);}
async function openAnalysis(){
  await act(async()=>root.render(<HomePage/>));
  await vi.waitFor(()=>expect(maps()).toHaveLength(1));
  await click("통계·분석");
  await vi.waitFor(()=>expect(container.querySelector("input[aria-label='나의 분석 글']")).not.toBeNull());
  expect(maps()).toHaveLength(0);
}

beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  localStorage.clear();sessionStorage.clear();
  window.history.replaceState(null,"",`/?map=${liveMap.id}`);
  reactErrors=[];vi.spyOn(console,"error").mockImplementation((...args:unknown[])=>reactErrors.push(args));
  vi.stubGlobal("confirm",vi.fn().mockReturnValue(false));
  vi.stubGlobal("fetch",vi.fn(async(raw:RequestInfo|URL)=>{
    const url=String(raw);
    if(url==="/api/v1/status")return response({configured:true});
    if(url==="/api/v1/session")return response({draftScope:"teacher-test",kind:"account",accountRole:"teacher",canCreateMap:true,expiresAt:"2099-01-01T00:00:00Z",csrfToken:"test-csrf"});
    if(url===`/api/v1/maps/${liveMap.id}`)return response(liveMap);
    if(url.endsWith("/configuration"))return response({theme:themeByKey.safety,configRevision:1});
    if(url.includes("/analysis?"))return response({items:[record],stats:{total:1},dataRevision:"1",generatedAt:"2026-10-10T00:00:00Z",filterFingerprint:"test",filter:{}});
    throw new Error(`Unexpected test request: ${url}`);
  }));
  container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("map and persistent analysis sibling reconciliation",()=>{
  it("keeps one map and one analysis draft across repeated list/map transitions",async()=>{
    await openAnalysis();
    const analysis=panel()!;const draft="횡단보도 주변을 더 살펴보자.";
    await setDraft(draft);
    for(let index=0;index<8;index++){
      await click("원본 기록 목록 보기");
      expect(maps()).toHaveLength(1);expect(analysis.hidden).toBe(true);
      assertStableAnalysis(analysis,draft);
      await click("통계·분석");
      expect(maps()).toHaveLength(0);expect(analysis.hidden).toBe(false);
      assertStableAnalysis(analysis,draft);
    }
    assertNoKeyWarning();
  });

  it("opens an original point repeatedly without duplicating maps or losing the analysis draft",async()=>{
    await openAnalysis();
    const analysis=panel()!;const draft="내가 직접 관찰한 안전 문제";
    await setDraft(draft);
    for(let index=0;index<5;index++){
      await click("원본 보기: 횡단보도");
      expect(maps()).toHaveLength(1);
      expect(container.querySelectorAll("dialog.point-dialog")).toHaveLength(1);
      expect(container.querySelector("dialog.point-dialog")?.textContent).toContain(record.body);
      assertStableAnalysis(analysis,draft);
      await click("상세 닫기");
      await click("통계·분석");
      expect(maps()).toHaveLength(0);
      expect(container.querySelector("dialog.point-dialog")).toBeNull();
      assertStableAnalysis(analysis,draft);
    }
    assertNoKeyWarning();
  });
});
