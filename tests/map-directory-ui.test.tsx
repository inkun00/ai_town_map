// @vitest-environment happy-dom
import {act,useState} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {MapDirectory,type DirectoryScope} from "../src/components/MapDirectory";
import type {LiveMap} from "../src/lib/map-directory";

const map=(id:string,overrides:Partial<LiveMap>={}):LiveMap=>({id,title:`지도 ${id}`,description:"우리 동네 기록",themeKey:"ecology",location:"우리학교",center:null,configRevision:1,visibility:"public",participation:"invited",moderation:"immediate",commentsEnabled:true,status:"active",version:"1",isMine:false,isOwner:false,capabilities:{canManageMap:false,canCreateObservation:false,canComment:false},...overrides});
let container:HTMLDivElement,root:Root;
let publicMaps:LiveMap[],mineMaps:LiveMap[],cursor:string|null;
let nextPageError:boolean;
const fetchSpy=vi.fn(),onCreate=vi.fn(),onOpen=vi.fn();

function Directory({signedIn=true,teacher=false}:{signedIn?:boolean;teacher?:boolean}){
  const [scope,setScope]=useState<DirectoryScope>("public");
  return <MapDirectory signedIn={signedIn} scope={scope} onScopeChange={setScope} onOpen={onOpen} onCreate={teacher?onCreate:undefined}/>;
}
const activePanel=()=>container.querySelector<HTMLElement>("[role='tabpanel']:not([hidden])")!;
function button(text:string){const found=[...container.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.getAttribute("aria-label")===text||item.textContent?.trim()===text);if(!found)throw new Error(`Button missing: ${text}`);return found;}
async function click(text:string){await act(async()=>button(text).click());}
async function render(props:{signedIn?:boolean;teacher?:boolean}={}){await act(async()=>root.render(<Directory {...props}/>));}
async function input(value:string){const target=container.querySelector<HTMLInputElement>("input")!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(target,value);target.dispatchEvent(new Event("input",{bubbles:true}));});}

beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  publicMaps=[map("a")];mineMaps=[map("mine")];cursor=null;nextPageError=false;
  onCreate.mockReset();onOpen.mockReset();fetchSpy.mockReset().mockImplementation(async(raw:RequestInfo|URL)=>{
    const url=new URL(String(raw),"https://map.test"),mine=url.searchParams.get("scope")==="mine",next=url.searchParams.has("cursor");
    if(next&&nextPageError)return{ok:false,json:async()=>({error:{message:"연결이 끊겼어요"}})};
    return{ok:true,json:async()=>({data:{items:mine?mineMaps:next?[map("b")]:publicMaps,nextCursor:mine||next?null:cursor}})};
  });
  vi.stubGlobal("fetch",fetchSpy);container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});

describe("compact home map directory",()=>{
  it("shows one heading and short tabs before shared filters, with a teacher action only when supplied",async()=>{
    await render({teacher:true});
    expect([...container.querySelectorAll("h2")].map(item=>item.textContent)).toEqual(["탐험 지도"]);
    expect(container.querySelector(".eyebrow,.section-stamp")).toBeNull();
    const tabs=container.querySelector(".home-directory__tabs")!,filters=container.querySelector(".home-directory__filters")!;
    expect(tabs.compareDocumentPosition(filters)&Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect([...tabs.querySelectorAll("button")].map(item=>item.textContent)).toEqual(["전체 지도","참여한 지도"]);
    expect(container.querySelector("input")?.getAttribute("placeholder")).toBe("지도 이름·지역 검색");
    await click("지도 만들기");expect(onCreate).toHaveBeenCalledOnce();
    await act(async()=>root.render(<Directory/>));expect(container.querySelector(".home-directory__create")).toBeNull();
  });

  it("describes contribution rights without implying private viewing or allowing archived/closed recording",async()=>{
    publicMaps=[map("open"),map("partial",{visibility:"invite_only"}),map("archived",{status:"archived",visibility:"invite_only"}),map("closed",{participation:"closed"}),map("admin",{participation:"admin_only"})];
    await render();const badges=[...activePanel().querySelectorAll(".home-directory__permission")].map(item=>item.textContent);
    expect(badges).toEqual(["누구나 기록 가능","인증 후 기록 가능","보관 중 · 보기만 가능","등록 마감","관리자만 기록"]);
    const row=activePanel().querySelector<HTMLButtonElement>(".home-directory__map")!;await act(async()=>row.click());expect(onOpen).toHaveBeenCalledWith(publicMaps[0]);
  });

  it("keeps keyboard tab IDs and roving focus while reusing the same theme and search",async()=>{
    await render();
    const all=button("전체 지도"),mine=button("참여한 지도");
    expect(all.id).toBe("directory-tab-public");expect(all.getAttribute("aria-controls")).toBe("directory-panel-public");expect(mine.tabIndex).toBe(-1);
    const theme=container.querySelector<HTMLSelectElement>("select")!;
    await act(async()=>{theme.value="safety";theme.dispatchEvent(new Event("change",{bubbles:true}));});
    await input("우리 동네");await act(async()=>{await new Promise(resolve=>setTimeout(resolve,330));});
    await act(async()=>{all.focus();all.dispatchEvent(new KeyboardEvent("keydown",{key:"ArrowRight",bubbles:true,cancelable:true}));});
    expect(mine.getAttribute("aria-selected")).toBe("true");expect(mine.tabIndex).toBe(0);expect(all.tabIndex).toBe(-1);expect(document.activeElement).toBe(mine);
    expect(activePanel().id).toBe("directory-panel-mine");expect(theme.value).toBe("safety");expect(container.querySelector<HTMLInputElement>("input")?.value).toBe("우리 동네");
    const urls=fetchSpy.mock.calls.map(([url])=>new URL(String(url),"https://map.test"));
    expect(urls.some(url=>url.searchParams.get("scope")==="public"&&url.searchParams.get("themeKey")==="safety"&&url.searchParams.get("q")==="우리 동네")).toBe(true);
    expect(urls.some(url=>url.searchParams.get("scope")==="mine"&&url.searchParams.get("themeKey")==="safety"&&url.searchParams.get("q")==="우리 동네")).toBe(true);
    await act(async()=>mine.dispatchEvent(new KeyboardEvent("keydown",{key:"Home",bubbles:true,cancelable:true})));expect(activePanel().id).toBe("directory-panel-public");expect(document.activeElement).toBe(all);
    await act(async()=>all.dispatchEvent(new KeyboardEvent("keydown",{key:"End",bubbles:true,cancelable:true})));expect(activePanel().id).toBe("directory-panel-mine");
  });

  it("keeps pagination and retry inside the bounded list while preserving existing records",async()=>{
    cursor="next-page";await render();nextPageError=true;await click("전체 지도 더 보기");
    expect(activePanel().textContent).toContain("지도 a");expect(activePanel().querySelector("[role='alert']")?.textContent).toContain("연결이 끊겼어요");
    expect(button("전체 지도 다시 불러오기").closest(".home-directory__scroll")).not.toBeNull();
    nextPageError=false;await click("전체 지도 다시 불러오기");expect(activePanel().textContent).toContain("지도 a");expect(activePanel().textContent).toContain("지도 b");
    expect(activePanel().querySelector("[role='alert']")).toBeNull();expect([...activePanel().querySelectorAll(".home-directory__map")]).toHaveLength(2);
  });

  it("helps visitors join with a nickname or teacher credential without requiring Google login",async()=>{
    await render({signedIn:false});expect(fetchSpy.mock.calls.every(([url])=>!String(url).includes("scope=mine"))).toBe(true);
    await click("참여한 지도");expect(activePanel().textContent).toContain("닉네임");expect(activePanel().textContent).toContain("비밀번호나 교사 인증코드");expect(activePanel().textContent).not.toContain("로그인");
    expect(activePanel().querySelector("a[href='/join']")?.textContent).toBe("지도 인증코드로 참여");
    await click("전체 지도 보기");expect(activePanel().id).toBe("directory-panel-public");
  });
});
