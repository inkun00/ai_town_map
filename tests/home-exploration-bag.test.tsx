// @vitest-environment happy-dom
import {act,type ImgHTMLAttributes} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {themeByKey} from "../src/lib/demo-data";
import type {LiveMap} from "../src/lib/map-directory";
import {unsavedRecordMessage} from "../src/lib/unsaved-record-guard";

vi.mock("next/dynamic",()=>({default:()=>function LazyPanel(){return <section aria-label="열린 지도">지도 화면</section>;}}));
vi.mock("next/image",()=>({default:({src,...props}:ImgHTMLAttributes<HTMLImageElement>&{src:unknown})=><img {...props} src={typeof src==="string"?src:"/test-scene.webp"}/>}));
vi.mock("../src/components/RecordLocationPicker",()=>({RecordLocationPicker:({onClose}:{onClose:()=>void})=><section role="dialog" aria-label="기록 위치 선택"><button type="button" onClick={onClose}>위치 선택 닫기</button></section>}));
import HomePage from "../src/app/page";

type Session={draftScope:string;kind:"account"|"guest";accountRole:"teacher"|"student"|null;canCreateMap:boolean;expiresAt:string;csrfToken:string|null};
const teacher:Session={draftScope:"account:teacher",kind:"account",accountRole:"teacher",canCreateMap:true,expiresAt:"2099-01-01T00:00:00Z",csrfToken:"test-csrf"};
const liveMap:LiveMap={id:"11111111-1111-4111-8111-111111111111",title:"학교 앞 안전 탐험",description:"안전한 길을 찾아요.",themeKey:"safety",location:"우리 동네",center:{lat:37,lng:127},configRevision:1,visibility:"public",participation:"invited",moderation:"immediate",commentsEnabled:true,status:"active",version:"1",isMine:true,isOwner:true,capabilities:{canManageMap:true,canCreateObservation:true,canComment:true}};
const restoredMap:LiveMap={...liveMap,id:"22222222-2222-4222-8222-222222222222",title:"다시 만날 탐험지도",status:"archived",version:"3"};
let container:HTMLDivElement;
let root:Root;
let configured=true;
let session:Session|null;
let restored=false;
let restoreDelay:Promise<void>|null=null;
const fetchSpy=vi.fn();
const confirmSpy=vi.fn();

function reply(data:unknown){return {ok:true,json:async()=>({data})};}
function readableText(node:Element){const clone=node.cloneNode(true) as Element;clone.querySelectorAll("[aria-hidden='true']").forEach(child=>child.remove());return clone.textContent?.trim();}
function button(label:string,scope:ParentNode=container){
  const found=[...scope.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.getAttribute("aria-label")===label||readableText(item)===label);
  if(!found)throw new Error(`Missing button: ${label}`);
  return found;
}
async function click(label:string,scope:ParentNode=container){await act(async()=>{button(label,scope).click();});}
async function flush(){await act(async()=>{await Promise.resolve();});}
async function mount(url="/"){window.history.replaceState(null,"",url);await act(async()=>{root.render(<HomePage/>);});await flush();}
async function fill(input:HTMLInputElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));input.dispatchEvent(new Event("change",{bubbles:true}));});}
function deletedGets(){return fetchSpy.mock.calls.filter(([url,init])=>String(url).startsWith("/api/v1/maps?")&&String(url).includes("scope=deleted")&&(!init?.method||init.method==="GET"));}
function bagHeader(){return container.querySelector(".screen-header strong")?.textContent;}

beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  localStorage.clear();sessionStorage.clear();window.history.replaceState(null,"","/");
  configured=true;session={...teacher};restored=false;restoreDelay=null;fetchSpy.mockReset();confirmSpy.mockReset();confirmSpy.mockReturnValue(true);
  vi.stubGlobal("confirm",confirmSpy);
  fetchSpy.mockImplementation(async(url:string,init?:RequestInit)=>{
    if(url==="/api/v1/status")return reply({configured});
    if(url==="/api/v1/session")return reply(session);
    if(url.startsWith("/api/v1/maps?")){
      const query=new URL(url,"http://localhost").searchParams;
      if(query.get("scope")==="deleted")return reply({items:session?.accountRole==="teacher"&&!restored?[{id:restoredMap.id,title:restoredMap.title,version:"2",deletedAt:"2026-10-10T00:00:00Z"}]:[],nextCursor:null});
      return reply({items:query.get("scope")==="mine"&&restored?[liveMap,restoredMap]:[liveMap],nextCursor:null});
    }
    if(url===`/api/v1/maps/${restoredMap.id}/restore`&&init?.method==="POST"){await restoreDelay;restored=true;return reply({version:restoredMap.version,status:"archived"});}
    if(url===`/api/v1/maps/${liveMap.id}`)return reply(liveMap);
    if(url.endsWith("/configuration"))return reply({theme:themeByKey.safety,configRevision:1});
    if(url.includes("/analysis?"))return reply({items:[],stats:{total:0,ratings:[],categories:[],questions:[],daily:[]},dataRevision:"1",generatedAt:"2026-10-10T00:00:00Z",filterFingerprint:"test",filter:{}});
    if(url.includes("/observations?"))return reply({items:[],nextCursor:null});
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch",fetchSpy);
  container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("home actions and exploration bag navigation",()=>{
  it("places both home actions below the shared directory and opens the real deleted-map picker only in the bag",async()=>{
    await mount();
    const directory=container.querySelector("#map-directory")!;
    for(const href of ["/games","/maps/merge"]){const link=container.querySelector(`.home-actions a[href='${href}']`)!;expect(directory.compareDocumentPosition(link)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();}
    expect(container.querySelector("[aria-label='삭제한 지도']")).toBeNull();expect(deletedGets()).toHaveLength(0);
    await click("탐험가방 열기");
    expect(bagHeader()).toBe("탐험가방");
    const chooser=container.querySelector<HTMLSelectElement>("select[aria-label='삭제한 지도 선택']")!;
    expect(chooser.options).toHaveLength(2);expect(chooser.disabled).toBe(false);
    expect(container.querySelector(".deleted-map-directory .directory-scroll[aria-label='삭제한 지도 목록']")).not.toBeNull();
    await click("보관 상태로 복구");await flush();
    expect(bagHeader()).toBe("탐험가방");expect(chooser.options).toHaveLength(1);expect(chooser.disabled).toBe(true);
    expect(container.textContent).toContain("복구할 지도가 없어요.");
    const restore=fetchSpy.mock.calls.find(([url,init])=>String(url).endsWith("/restore")&&init?.method==="POST")!;
    expect(restore[1]?.headers).toMatchObject({"X-CSRF-Token":"test-csrf","X-Resource-Version":'"2"'});
    expect(deletedGets().length).toBeGreaterThanOrEqual(2);
    await click("홈으로 돌아가기");
    expect(container.querySelector(".home-header")).not.toBeNull();expect(container.querySelector("[aria-label='삭제한 지도']")).toBeNull();
  });

  it("opens the bag from the home dock and returns through the joined-explorations shortcut with refreshed maps",async()=>{
    await mount();await click("탐험가방",container.querySelector("nav[aria-label='홈 탐색']")!);
    expect(bagHeader()).toBe("탐험가방");await click("보관 상태로 복구");await flush();await click("내가 참여한 탐험 보기");
    expect(container.querySelector("#directory-tab-mine")?.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector("#directory-panel-mine")?.textContent).toContain(restoredMap.title);
    expect(container.querySelector("#directory-panel-mine")?.textContent).toContain("보관 중");
  });

  it("opens from the map's bag, stays there during restore with a map URL, and returns to the original map information",async()=>{
    await mount(`/?map=${liveMap.id}`);await click("발견 기록");await click("위치 선택 닫기");
    const field=container.querySelector<HTMLInputElement>("input[placeholder='예: 공원 북쪽 입구']")!;
    await fill(field,"아직 저장하지 않은 장소");confirmSpy.mockReturnValue(false);await click("탐험 가방");
    expect(confirmSpy).toHaveBeenLastCalledWith(unsavedRecordMessage);expect(field.value).toBe("아직 저장하지 않은 장소");expect(container.querySelector(".record-layout")).not.toBeNull();
    const unload=new Event("beforeunload",{cancelable:true});window.dispatchEvent(unload);expect(unload.defaultPrevented).toBe(true);
    confirmSpy.mockReturnValue(true);await click("탐험 가방");await click("삭제한 지도 보기");
    expect(bagHeader()).toBe("탐험가방");expect(window.location.search).toContain(`map=${liveMap.id}`);
    await click("보관 상태로 복구");await flush();expect(bagHeader()).toBe("탐험가방");
    await click("지도로 돌아가기");
    expect(container.querySelector(".workspace-header strong")?.textContent).toBe(liveMap.title);
    expect(container.querySelector(".content-heading h1")?.textContent).toBe(liveMap.title);
    expect(button("삭제한 지도 보기")).toBeDefined();
    expect([...Array(sessionStorage.length)].map((_,index)=>sessionStorage.getItem(sessionStorage.key(index)!)).join("")).toContain("아직 저장하지 않은 장소");
  });

  it("does not expose or fetch deleted maps for unauthenticated or guest explorers",async()=>{
    for(const current of [null,{...teacher,kind:"guest" as const,accountRole:null,canCreateMap:false,csrfToken:null}]){
      session=current;await mount();await click("탐험가방 열기");
      expect(bagHeader()).toBe("탐험가방");expect(container.querySelector("[aria-label='삭제한 지도']")).toBeNull();expect(deletedGets()).toHaveLength(0);
      expect(container.textContent).toContain("삭제한 지도는 로그인 후 볼 수 있어요");expect(container.querySelector("a[href^='/api/v1/auth/google']")).not.toBeNull();
      await act(async()=>root.unmount());root=createRoot(container);
    }
  });

  it("refreshes joined maps without reopening a map when restoration finishes after leaving the bag",async()=>{
    let release!:()=>void;
    restoreDelay=new Promise<void>(resolve=>{release=resolve;});
    await mount(`/?map=${liveMap.id}`);await click("탐험 가방");await click("삭제한 지도 보기");await click("보관 상태로 복구");
    expect(button("보관 상태로 복구").disabled).toBe(true);
    await click("내가 참여한 탐험 보기");
    expect(container.querySelector(".home-header")).not.toBeNull();expect(window.location.search).toContain(`map=${liveMap.id}`);
    await act(async()=>{release();});await flush();
    expect(container.querySelector(".home-header")).not.toBeNull();expect(container.querySelector(".workspace-header")).toBeNull();
    expect(container.querySelector("#directory-tab-mine")?.getAttribute("aria-selected")).toBe("true");
    expect(container.querySelector("#directory-panel-mine")?.textContent).toContain(restoredMap.title);
  });

  it("keeps a newly opened map when an earlier map's restoration refresh arrives late",async()=>{
    const mapB:LiveMap={...liveMap,id:"33333333-3333-4333-8333-333333333333",title:"공원에서 새로운 탐험"};
    const originalFetch=fetchSpy.getMockImplementation()!;
    let release!:()=>void;
    const lateRefresh=new Promise<void>(resolve=>{release=resolve;});
    let delayMapA=false;
    fetchSpy.mockImplementation(async(url:string,init?:RequestInit)=>{
      if(url===`/api/v1/maps/${liveMap.id}`&&delayMapA)await lateRefresh;
      if(url===`/api/v1/maps/${mapB.id}`)return reply(mapB);
      if(url.startsWith("/api/v1/maps?")&&!url.includes("scope=deleted"))return reply({items:[liveMap,mapB,...(restored?[restoredMap]:[])],nextCursor:null});
      return originalFetch(url,init);
    });
    await mount(`/?map=${liveMap.id}`);delayMapA=true;
    await click("탐험 가방");await click("삭제한 지도 보기");await click("보관 상태로 복구");
    expect(fetchSpy.mock.calls.filter(([url])=>url===`/api/v1/maps/${liveMap.id}`)).toHaveLength(2);
    await click("내가 참여한 탐험 보기");
    const mapButton=[...container.querySelectorAll<HTMLButtonElement>("#directory-panel-mine .my-map-list button")].find(item=>item.querySelector("strong")?.textContent===mapB.title)!;
    expect(mapButton).toBeDefined();await act(async()=>{mapButton.click();});
    expect(container.querySelector(".workspace-header strong")?.textContent).toBe(mapB.title);
    await act(async()=>{release();});await flush();
    expect(container.querySelector(".workspace-header strong")?.textContent).toBe(mapB.title);
    expect(window.location.search).toContain(`map=${mapB.id}`);
  });
});
