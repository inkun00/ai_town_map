// @vitest-environment happy-dom
import {act,type ComponentType,type ReactNode} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {themeByKey,type DemoPoint} from "../src/lib/demo-data";
import type {InlineRecordEditorProps,InlineObservation} from "../src/components/InlineRecordEditor";
import type {LiveMap} from "../src/lib/map-directory";

const probes=vi.hoisted(()=>({editor:null as InlineRecordEditorProps|null,editorMounts:0,editorUnmounts:0}));

vi.mock("next/dynamic",async()=>{
  const {lazy,Suspense}=await import("react");
  return {default:(loader:()=>Promise<ComponentType<Record<string,unknown>>|{default:ComponentType<Record<string,unknown>>}>)=>{
    const Loaded=lazy(async()=>{const module=await loader();return {default:typeof module==="function"?module:module.default};});
    return function Dynamic(props:Record<string,unknown>){return <Suspense fallback={<p>불러오는 중</p>}><Loaded {...props}/></Suspense>;};
  }};
});
vi.mock("next/image",()=>({default:({src,alt}:{src:string|{src:string};alt:string})=><img src={typeof src==="string"?src:src.src} alt={alt}/>}));
vi.mock("../src/components/MapWorkspace",()=>({MapWorkspace:({points,onSelect,analysisMode,onAnalysisModeChange,onAnalysisPointSelect}:{points:DemoPoint[];onSelect:(id:string)=>void;analysisMode:boolean;onAnalysisModeChange:(value:boolean)=>void;onAnalysisPointSelect?:(point:DemoPoint)=>void})=><section aria-label="지도">
  <button type="button" onClick={()=>onAnalysisModeChange(!analysisMode)}>{analysisMode?"공용 지도 보기":"분석지도 만들기"}</button>
  {points.map(point=><button type="button" key={point.id} aria-label={`핀 ${point.title}`} onClick={()=>{if(analysisMode)onAnalysisPointSelect?.(point);onSelect(point.id);}}>{point.title}</button>)}
</section>}));
vi.mock("../src/components/InlineRecordEditor",async()=>{
  const {useEffect}=await import("react");
  return {InlineRecordEditor:(props:InlineRecordEditorProps)=>{
    probes.editor=props;
    useEffect(()=>{probes.editorMounts++;return()=>{probes.editorUnmounts++;};},[]);
    return <div aria-label="펼쳐진 기록 편집기"><input aria-label="수정 내용" defaultValue={props.point.body} onChange={()=>props.onDirtyChange?.(true)}/><span>사진 저장 다시 시도</span></div>;
  }};
});
// This suite exercises the page's real selection, disclosure and close/save state;
// mapping and image rendering are unrelated external surfaces.
import HomePage from "../src/app/page";

const liveMap:LiveMap={id:"map-detail",title:"우리학교 안전지도",description:"학교 주변 안전 조사",themeKey:"safety",location:"우리학교",center:{lat:37,lng:127},configRevision:1,visibility:"public",participation:"invited",moderation:"approval",commentsEnabled:true,status:"active",version:"4",isMine:true,isOwner:true,capabilities:{canManageMap:true,canCreateObservation:true,canComment:true}};
const record:InlineObservation={id:"point-detail",mapId:liveMap.id,title:"횡단보도",body:"신호를 확인하고 길을 건너요.",locationLabel:"학교 정문",locationSource:"manual",location:{lat:37,lng:127},categoryKey:"traffic",emojiKey:"traffic-1",ratingKey:"positive",answers:{},improvementIdea:null,link:"https://example.com/traffic",status:"published",version:"7",createdAt:"2026-10-10T00:00:00Z",author:"교사",canEdit:true,canDelete:true,photoUrl:"https://example.com/traffic.jpg"};
const ownComment={id:"comment-own",body:"신호등을 잘 볼 수 있어요.",status:"visible",version:"1",author:"교사",createdAt:"2026-10-10T00:00:00Z",canEdit:true,canModerate:true};
let container:HTMLDivElement;
let root:Root;
let records:InlineObservation[];
let comments:typeof ownComment[];
const fetchSpy=vi.fn();
const confirmSpy=vi.fn();

function response(data:unknown){return {ok:true,json:async()=>({data})};}
function button(label:string,within:ParentNode=container){
  const found=[...within.querySelectorAll<HTMLButtonElement>("button")].find(item=>{
    const accessible=item.cloneNode(true) as HTMLButtonElement;
    accessible.querySelectorAll("[aria-hidden='true']").forEach(child=>child.remove());
    return item.getAttribute("aria-label")===label||accessible.textContent?.trim()===label;
  });
  if(!found)throw new Error(`Button missing: ${label}`);
  return found;
}
async function click(label:string,within:ParentNode=container){await act(async()=>{button(label,within).click();});}
async function input(selector:string,value:string){
  const element=container.querySelector<HTMLInputElement>(selector);
  if(!element)throw new Error(`Input missing: ${selector}`);
  await act(async()=>{
    // Native value setter bypasses React's value tracker, like user typing.
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(element,value);
    element.dispatchEvent(new Event("input",{bubbles:true}));
  });
}
function detail(){return container.querySelector<HTMLDialogElement>("dialog.point-dialog");}
async function openRecord(){
  await act(async()=>{root.render(<HomePage/>);});
  await vi.waitFor(()=>expect(container.querySelector("button[aria-label='핀 횡단보도']")).not.toBeNull());
  await click("핀 횡단보도");
  expect(detail()).not.toBeNull();
}

beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  localStorage.clear();sessionStorage.clear();
  window.history.replaceState(null,"",`/?map=${liveMap.id}`);
  records=[{...record}];comments=[{...ownComment}];
  probes.editor=null;probes.editorMounts=0;probes.editorUnmounts=0;
  confirmSpy.mockReset().mockReturnValue(false);
  vi.stubGlobal("confirm",confirmSpy);
  fetchSpy.mockReset().mockImplementation(async(raw:RequestInfo|URL,options?:RequestInit)=>{
    const url=String(raw);
    if(url==="/api/v1/status")return response({configured:true});
    if(url==="/api/v1/session")return response({draftScope:"teacher-test",kind:"account",accountRole:"teacher",canCreateMap:true,expiresAt:"2099-01-01T00:00:00Z",csrfToken:"test-csrf"});
    if(url===`/api/v1/maps/${liveMap.id}`)return response(liveMap);
    if(url.endsWith("/configuration"))return response({theme:themeByKey.safety,configRevision:1});
    if(url.includes("/analysis?"))return response({items:records,stats:{total:records.length},dataRevision:"1",generatedAt:"2026-10-10T00:00:00Z",filterFingerprint:"test",filter:{}});
    if(url===`/api/v1/maps/${liveMap.id}/observations/${record.id}`&&options?.method==="DELETE"){
      records=[];
      return response({id:record.id,status:"deleted"});
    }
    if(url.endsWith(`/observations/${record.id}/comments`)){
      if(options?.method==="POST"){
        const body=(JSON.parse(String(options.body)) as {body:string}).body;
        comments=[...comments,{...ownComment,id:"comment-new",body}];
        return response(comments.at(-1));
      }
      return response({items:comments});
    }
    throw new Error(`Unexpected test request: ${options?.method??"GET"} ${url}`);
  });
  vi.stubGlobal("fetch",fetchSpy);
  container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("record details page integration",()=>{
  it("shows existing information first and expands edit or comments under the same modal",async()=>{
    await openRecord();
    const modal=detail()!;
    expect(modal.textContent).toContain(record.body);
    expect(modal.querySelector(".sheet-photo")?.getAttribute("src")).toBe(record.photoUrl);
    expect(modal.querySelector(".sheet-link")?.getAttribute("href")).toBe(record.link);
    expect(modal.querySelectorAll("input,textarea,form")).toHaveLength(0);
    expect(button("기록 수정",modal).getAttribute("aria-expanded")).toBe("false");
    expect(button("댓글",modal).getAttribute("aria-expanded")).toBe("false");
    await click("기록 수정",modal);
    await vi.waitFor(()=>expect(modal.querySelector("[aria-label='펼쳐진 기록 편집기']")).not.toBeNull());
    expect(detail()).toBe(modal);
    expect(modal.querySelector("[role='region'][aria-label='기록 수정']")?.hasAttribute("hidden")).toBe(false);
    await click("댓글",modal);
    expect(detail()).toBe(modal);
    expect(modal.querySelector("[role='region'][aria-label='댓글']")?.hasAttribute("hidden")).toBe(false);
    expect(modal.querySelector("input[placeholder='의견을 남겨주세요']")).not.toBeNull();
  });

  it("keeps the modal and folded comment draft when close is cancelled, then closes on approval",async()=>{
    await openRecord();await click("댓글");
    await input("input[placeholder='의견을 남겨주세요']","아직 저장하지 않은 의견");
    await click("댓글");
    await click("상세 닫기");
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(confirmSpy.mock.calls[0][0]).toContain("저장");
    expect(detail()).not.toBeNull();
    await click("댓글");
    expect(container.querySelector<HTMLInputElement>("input[placeholder='의견을 남겨주세요']")?.value).toBe("아직 저장하지 않은 의견");
    confirmSpy.mockReturnValue(true);
    await click("상세 닫기");
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(detail()).toBeNull();
  });

  it("clears comment dirty state after a successful submit and closes without a warning",async()=>{
    await openRecord();await click("댓글");
    await input("input[placeholder='의견을 남겨주세요']","새 댓글을 남겨요.");
    const form=container.querySelector<HTMLFormElement>(".sheet-comments form")!;
    await act(async()=>{form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});
    expect(fetchSpy.mock.calls.some(([url,options])=>String(url).endsWith("/comments")&&options?.method==="POST")).toBe(true);
    expect(container.querySelector<HTMLInputElement>("input[placeholder='의견을 남겨주세요']")?.value).toBe("");
    expect(detail()?.textContent).toContain("새 댓글을 남겨요.");
    await click("상세 닫기");
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(detail()).toBeNull();
  });

  it("asks before deleting a record with an unsaved comment and preserves the draft when cancelled",async()=>{
    await openRecord();await click("댓글");
    await input("input[placeholder='의견을 남겨주세요']","삭제 전에 작성 중인 댓글");
    const management=container.querySelector<HTMLDetailsElement>("details.point-detail-management")!;
    await act(async()=>{management.open=true;management.dispatchEvent(new Event("toggle"));});
    await click("내 기록 삭제");
    const deleted=()=>fetchSpy.mock.calls.filter(([url,options])=>String(url).endsWith(`/observations/${record.id}`)&&options?.method==="DELETE");
    expect(confirmSpy).toHaveBeenCalledTimes(1);
    expect(deleted()).toHaveLength(0);
    expect(detail()).not.toBeNull();
    expect(container.querySelector<HTMLInputElement>("input[placeholder='의견을 남겨주세요']")?.value).toBe("삭제 전에 작성 중인 댓글");
    confirmSpy.mockReturnValue(true);
    await click("내 기록 삭제");
    expect(confirmSpy).toHaveBeenCalledTimes(2);
    expect(deleted()).toHaveLength(1);
    expect(detail()).toBeNull();
  });

  it("retains saved pending details and the open editor when refreshed public analysis omits the record",async()=>{
    await openRecord();await click("기록 수정");
    await vi.waitFor(()=>expect(probes.editor).not.toBeNull());
    const modal=detail();
    records=[];
    await act(async()=>{
      probes.editor!.onDirtyChange?.(false);
      probes.editor!.onSaved({...record,title:"바꾼 횡단보도",body:"수정하고 검수를 기다려요.",status:"pending",version:"8"});
    });
    expect(detail()).toBe(modal);
    expect(detail()?.textContent).toContain("바꾼 횡단보도");
    expect(detail()?.textContent).toContain("검수 대기");
    expect(detail()?.querySelector("[aria-label='펼쳐진 기록 편집기']")).not.toBeNull();
    expect(detail()?.textContent).toContain("사진 저장 다시 시도");
    expect(probes.editor?.point.status).toBe("pending");
    expect(probes.editor?.point.version).toBe("8");
    expect(probes.editorMounts).toBe(1);expect(probes.editorUnmounts).toBe(0);
    expect(container.querySelector("button[aria-label='핀 바꾼 횡단보도']")).toBeNull();
  });

  it("keeps record editing and comment mutation absent in the personal analysis detail",async()=>{
    await openRecord();await click("상세 닫기");
    await click("분석지도 만들기");await click("핀 횡단보도");
    expect(detail()?.textContent).toContain("나의 분석지도에만 저장");
    expect(detail()?.querySelector("button[aria-expanded][aria-controls$='-edit']")).toBeNull();
    await click("댓글");
    expect(detail()?.textContent).toContain(ownComment.body);
    expect(detail()?.querySelectorAll("input,textarea,form")).toHaveLength(0);
    expect(probes.editor).toBeNull();
    expect(fetchSpy.mock.calls.every(([,options])=>!options?.method||options.method==="GET")).toBe(true);
  });
});
