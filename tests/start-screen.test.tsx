// @vitest-environment happy-dom
import {act,type ImgHTMLAttributes} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {themeByKey} from "../src/lib/demo-data";
import type {LiveMap} from "../src/lib/map-directory";

vi.mock("next/dynamic",()=>({default:()=>function LazyPanel(){return <section aria-label="열린 지도">지도 화면</section>;}}));
vi.mock("next/image",()=>({default:({src,...props}:Omit<ImgHTMLAttributes<HTMLImageElement>,"src">&{src:string|{src:string}})=><img {...props} src={typeof src==="string"?src:src.src}/>}));
import HomePage from "../src/app/page";

type Session={draftScope:string;kind:"account"|"guest";accountRole:"teacher"|"student"|"member"|null;canCreateMap:boolean;expiresAt:string;csrfToken:string|null};
const teacher:Session={draftScope:"teacher",kind:"account",accountRole:"teacher",canCreateMap:true,expiresAt:"2099-01-01T00:00:00Z",csrfToken:"test-csrf"};
const map:LiveMap={id:"11111111-1111-4111-8111-111111111111",title:"우리학교 안전지도",description:"학교 주변을 함께 살펴요.",themeKey:"safety",location:"우리학교",center:{lat:37,lng:127},configRevision:1,visibility:"public",participation:"invited",moderation:"immediate",commentsEnabled:false,status:"active",version:"1",isMine:false,isOwner:false,capabilities:{canManageMap:false,canCreateObservation:false,canComment:false}};
const point={id:"22222222-2222-4222-8222-222222222222",mapId:map.id,title:"학교 앞 횡단보도",body:"신호등을 보고 안전하게 건너요.",locationLabel:"학교 정문",locationSource:"manual",location:{lat:37,lng:127},categoryKey:"traffic",emojiKey:"traffic-1",ratingKey:"positive",answers:{},improvementIdea:null,link:null,status:"published",version:"1",createdAt:"2026-10-10T00:00:00Z",author:"우리 반",canEdit:false,canDelete:false,photoUrl:null};
let container:HTMLDivElement,root:Root,session:Session|null;
let sessionDelay:Promise<void>|null;
const fetchSpy=vi.fn();
const startChoice="moa:start:guest";
function response(data:unknown){return {ok:true,json:async()=>({data})};}
function readableText(element:Element){const copy=element.cloneNode(true) as Element;copy.querySelectorAll("[aria-hidden='true']").forEach(item=>item.remove());return copy.textContent?.trim();}
function guestStart(){return [...container.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.getAttribute("aria-label")==="계정 없이 시작"||readableText(item)==="계정 없이 시작");}
async function mount(url="/"){window.history.replaceState(null,"",url);await act(async()=>root.render(<HomePage/>));}
async function restart(){await act(async()=>root.unmount());root=createRoot(container);await mount();}
async function startWithoutAccount(){const button=guestStart();expect(button).toBeDefined();await act(async()=>button!.click());}
function sessionWrites(){return fetchSpy.mock.calls.filter(([url,init])=>url==="/api/v1/session"&&init?.method&&init.method!=="GET");}

beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);localStorage.clear();sessionStorage.clear();session=null;sessionDelay=null;
  fetchSpy.mockReset().mockImplementation(async(raw:RequestInfo|URL,init?:RequestInit)=>{
    const url=String(raw);
    if(url==="/api/v1/status")return response({configured:true});
    if(url==="/api/v1/session"){await sessionDelay;return init?.method==="DELETE"?{ok:true,status:204}:response(session);}
    if(url.startsWith("/api/v1/maps?"))return response({items:[],nextCursor:null});
    if(url===`/api/v1/maps/${map.id}`)return response(map);
    if(url.endsWith("/configuration"))return response({theme:themeByKey.safety,configRevision:1});
    if(url.includes("/analysis?"))return response({items:[point],stats:{total:1,ratings:[],categories:[],questions:[],daily:[]},dataRevision:"1",filter:{}});
    if(url.includes("/observations?")||url.includes("/comments"))return response({items:[],nextCursor:null});
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch",fetchSpy);container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("anonymous start screen and preserved entry routes",()=>{
  it("shows only login, registration, and account-free entry after session lookup",async()=>{
    await mount();
    expect([...container.querySelectorAll("a,button")].map(readableText)).toEqual(["로그인","회원가입","계정 없이 시작"]);
    expect(container.querySelector("a[href='/api/v1/auth/google?returnTo=%2F']")).not.toBeNull();
    const signup=[...container.querySelectorAll<HTMLAnchorElement>("a")].find(item=>readableText(item)==="회원가입");
    expect(signup?.getAttribute("href")).toBe(`/api/v1/auth/google?returnTo=${encodeURIComponent("/account/setup?returnTo=%2F")}`);
    expect(container.querySelector("img")?.getAttribute("src")).toContain("neighborhood-quest");
    expect(container.querySelector("#map-directory,nav[aria-label='홈 탐색']")).toBeNull();
    expect(sessionStorage.getItem(startChoice)).toBeNull();expect(sessionWrites()).toHaveLength(0);
  });

  it("does not offer anonymous entry while the session request is unresolved",async()=>{
    let release!:()=>void;sessionDelay=new Promise<void>(resolve=>{release=resolve;});
    await mount();expect(guestStart()).toBeUndefined();expect(container.querySelector("#map-directory")).toBeNull();
    await act(async()=>release());expect(guestStart()).toBeDefined();
  });

  it("shows an OAuth retry message even after previous account-free browsing and clears it when continuing",async()=>{
    sessionStorage.setItem(startChoice,"1");await mount("/?authError=1");
    expect(container.querySelector("[role='alert']")?.textContent).toContain("로그인을 완료하지 못했어요");
    expect(guestStart()).toBeDefined();expect(container.querySelector("#map-directory")).toBeNull();
    await startWithoutAccount();expect(container.querySelector("#map-directory")).not.toBeNull();
    expect(window.location.search).toBe("");expect(container.querySelector(".start-screen__error")).toBeNull();
  });

  it("keeps session lookup failures on the retry screen instead of treating them as anonymous",async()=>{
    const original=fetchSpy.getMockImplementation()!;
    fetchSpy.mockImplementation(async(raw:RequestInfo|URL,init?:RequestInit)=>String(raw)==="/api/v1/session"?{ok:false,json:async()=>({error:{message:"세션 확인 실패"}})}:original(raw,init));
    await mount();expect(container.querySelector("[role='alert']")?.textContent).toContain("세션 확인 실패");
    expect(guestStart()).toBeUndefined();expect(container.querySelector("#map-directory")).toBeNull();
    fetchSpy.mockImplementation(original);
    const retry=[...container.querySelectorAll<HTMLButtonElement>("button")].find(item=>readableText(item)==="다시 연결")!;
    await act(async()=>retry.click());expect(guestStart()).toBeDefined();
  });

  it.each([
    ["registered account",teacher],
    ["student account",{...teacher,accountRole:"student",canCreateMap:false}],
    ["unfinished account",{...teacher,accountRole:null,canCreateMap:false}],
    ["guest participant",{...teacher,kind:"guest",accountRole:null,canCreateMap:false}],
  ] satisfies [string,Session][])("bypasses start for an existing %s without replacing its session",async(_label,current)=>{
    session=current;await mount();
    expect(guestStart()).toBeUndefined();expect(container.querySelector("#map-directory")).not.toBeNull();
    expect(sessionWrites()).toHaveLength(0);expect(sessionStorage.getItem(startChoice)).toBeNull();
    if(current.kind==="guest")expect(fetchSpy.mock.calls.some(([url])=>String(url).includes("scope=mine"))).toBe(true);
  });

  it("opens home without a session mutation and remembers the choice within the same tab",async()=>{
    await mount();await startWithoutAccount();
    expect(container.querySelector("#map-directory")).not.toBeNull();expect(guestStart()).toBeUndefined();
    expect(sessionStorage.getItem(startChoice)).toBe("1");expect(localStorage.getItem(startChoice)).toBeNull();
    expect(sessionWrites()).toHaveLength(0);
    await restart();expect(guestStart()).toBeUndefined();expect(container.querySelector("#map-directory")).not.toBeNull();
    expect(sessionWrites()).toHaveLength(0);
    // A fresh tab has no sessionStorage choice, even if another tab set a local preference.
    sessionStorage.removeItem(startChoice);localStorage.setItem(startChoice,"1");await restart();
    expect(guestStart()).toBeDefined();expect(container.querySelector("#map-directory")).toBeNull();
  });

  it("still opens home if browser storage refuses to persist the account-free choice",async()=>{
    await mount();vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("storage unavailable");});
    await startWithoutAccount();expect(container.querySelector("#map-directory")).not.toBeNull();expect(guestStart()).toBeUndefined();
    expect(sessionWrites()).toHaveLength(0);
  });

  it.each([false,true])("bypasses start for a public map link, including point selection=%s",async selectPoint=>{
    await mount(`/?map=${map.id}${selectPoint?`&point=${point.id}`:""}`);
    expect(guestStart()).toBeUndefined();expect(container.querySelector(".workspace-header strong")?.textContent).toBe(map.title);
    expect(sessionStorage.getItem(startChoice)).toBeNull();expect(sessionWrites()).toHaveLength(0);
    if(selectPoint){
      expect(container.querySelector("dialog.point-dialog")?.getAttribute("aria-label")).toBe(`${point.title} 상세 기록`);
      expect(container.querySelector("dialog.point-dialog")?.textContent).toContain(point.body);
    }else expect(container.querySelector("dialog.point-dialog")).toBeNull();
  });
});
