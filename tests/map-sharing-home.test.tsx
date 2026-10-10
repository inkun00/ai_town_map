// @vitest-environment happy-dom
import {act,type ImgHTMLAttributes} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {themeByKey} from "../src/lib/demo-data";
import type {LiveMap} from "../src/lib/map-directory";

const joinState=vi.hoisted(()=>({joined:false}));
vi.mock("next/dynamic",()=>({default:()=>function LazyPanel(){return <section aria-label="지도 화면"/>;}}));
vi.mock("next/image",()=>({default:({src,...props}:ImgHTMLAttributes<HTMLImageElement>&{src:unknown})=><img {...props} src={typeof src==="string"?src:"/test.webp"}/>}));
vi.mock("../src/components/MapParticipationJoin",()=>({MapParticipationJoin:({visibility,passwordEnabled,onJoined,onClose}:{visibility:string;passwordEnabled?:boolean;onJoined:()=>Promise<void>;onClose:()=>void})=><section role="dialog" aria-label="기록 참여"><span>{visibility}:{String(passwordEnabled)}</span><button type="button" onClick={()=>{joinState.joined=true;void onJoined().then(onClose);}}>참여 확인</button></section>}));
vi.mock("../src/components/RecordLocationPicker",()=>({RecordLocationPicker:()=> <section role="dialog" aria-label="위치 고르기"/>}));
import HomePage from "../src/app/page";

const map:LiveMap={id:"11111111-1111-4111-8111-111111111111",title:"공유 설정 시험 지도",description:"누구나 열람해요.",themeKey:"ecology",location:"우리 동네",center:null,configRevision:1,visibility:"invite_only",passwordEnabled:true,participation:"invited",moderation:"immediate",commentsEnabled:true,status:"active",version:"1",isMine:false,isOwner:false,capabilities:{canManageMap:false,canCreateObservation:false,canComment:false}};
const teacher={draftScope:"teacher",kind:"account",accountRole:"teacher",canCreateMap:true,csrfToken:"teacher-csrf",expiresAt:"2099-01-01T00:00:00Z"};
let session:typeof teacher|null;
let currentMap:LiveMap;
let container:HTMLDivElement;
let root:Root;
const fetchSpy=vi.fn();
function response(data:unknown){return {ok:true,json:async()=>({data})};}
function text(node:Element){const clone=node.cloneNode(true) as Element;clone.querySelectorAll("[aria-hidden='true']").forEach(el=>el.remove());return clone.textContent?.trim();}
function button(label:string){const found=[...container.querySelectorAll<HTMLButtonElement>("button")].find(el=>el.getAttribute("aria-label")===label||text(el)===label);if(!found)throw new Error(`Missing button ${label}`);return found;}
async function click(label:string){await act(async()=>button(label).click());}
async function fill(input:HTMLInputElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});}
async function mount(direct=false){window.history.replaceState(null,"",direct?`/?map=${map.id}`:"/");await act(async()=>root.render(<HomePage/>));}
async function finalStep(){await mount();await click("지도 만들기");await act(async()=>container.querySelector<HTMLButtonElement>(".theme-card.adventure-theme--ecology")!.click());await click("다음으로");await fill(container.querySelector<HTMLInputElement>("input[placeholder='예: 우리 동네 모두의 길']")!,"새 공유 지도");await fill(container.querySelector<HTMLInputElement>("input[placeholder='예: 군산시 수송동']")!,"우리 동네");await click("다음으로");await click("다음으로");expect(container.querySelector("input[type='password']")).toBeNull();await click("다음으로");}
function creation(){return fetchSpy.mock.calls.find(([url,init])=>url==="/api/v1/maps"&&init?.method==="POST");}

beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);joinState.joined=false;session={...teacher};currentMap={...map};fetchSpy.mockReset();localStorage.clear();sessionStorage.clear();
  fetchSpy.mockImplementation(async(url:string,init?:RequestInit)=>{
    if(url==="/api/v1/status")return response({configured:true});
    if(url==="/api/v1/session")return response(joinState.joined?{...teacher,kind:"guest",accountRole:null,canCreateMap:false,csrfToken:"guest-csrf",draftScope:"guest"}:session);
    if(url.startsWith("/api/v1/maps?"))return response({items:[currentMap],nextCursor:null});
    if(url===`/api/v1/maps/${map.id}`)return response(joinState.joined?{...currentMap,isMine:true,capabilities:{canManageMap:false,canCreateObservation:true,canComment:true}}:currentMap);
    if(url==="/api/v1/maps"&&init?.method==="POST")return response({...currentMap,isOwner:true,isMine:true,capabilities:{canManageMap:true,canCreateObservation:true,canComment:true},...JSON.parse(init.body as string)});
    if(url.endsWith("/configuration"))return response({theme:themeByKey.ecology,configRevision:1});
    if(url.includes("/analysis?"))return response({items:[],stats:{total:0,ratings:[],categories:[],questions:[],daily:[]},dataRevision:"1",filter:{}});
    if(url.includes("/observations?")||url.includes("/comments"))return response({items:[],nextCursor:null});
    throw new Error(`Unexpected request ${url}`);
  });vi.stubGlobal("fetch",fetchSpy);container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("home map sharing and contribution entry",()=>{
  it("places contribution sharing in the final creation step and submits a partial-map password",async()=>{
    await finalStep();expect(container.textContent).toContain("전체공개");expect(container.textContent).toContain("일부공개");expect(container.textContent).toContain("누구나 보기");
    const password=container.querySelector<HTMLInputElement>("input[type='password']")!;await fill(password,"12");expect(button("지도 만들기").disabled).toBe(true);await fill(password,"우리반1234");await click("지도 만들기");
    expect(JSON.parse(creation()![1].body as string)).toMatchObject({visibility:"invite_only",participation:"invited",participationPassword:"우리반1234"});
  });
  it("submits full sharing without retaining a previously typed password",async()=>{
    await finalStep();await fill(container.querySelector<HTMLInputElement>("input[type='password']")!,"우리반1234");const full=container.querySelector<HTMLInputElement>("input[type='radio'][value='public']")!;await act(async()=>full.click());await click("지도 만들기");
    const input=JSON.parse(creation()![1].body as string);expect(input.visibility).toBe("public");expect(input.participation).toBe("invited");expect(input).not.toHaveProperty("participationPassword");
  });
  it.each(["invite_only","public"] as const)("lets an anonymous visitor browse %s, and opens participation only on recording",async visibility=>{
    session=null;currentMap={...map,visibility,passwordEnabled:visibility==="invite_only"};await mount(true);expect(container.querySelector(".workspace-header strong")?.textContent).toBe(map.title);expect(container.querySelector("[aria-label='기록 참여']")).toBeNull();
    await click("발견 기록");expect(container.querySelector("[aria-label='기록 참여']")?.textContent).toContain(`${visibility}:${String(visibility==="invite_only")}`);
    await click("참여 확인");expect(container.querySelector("[aria-label='기록 참여']")).toBeNull();expect(fetchSpy.mock.calls.filter(([url])=>url==="/api/v1/session").length).toBeGreaterThanOrEqual(2);await click("발견 기록");expect(container.querySelector(".record-layout")).not.toBeNull();
  });
  it("keeps archived and closed maps readable while refusing new-record entry",async()=>{
    session=null;currentMap={...map,status:"archived",participation:"closed"};await mount(true);await click("발견 기록");expect(container.querySelector("[aria-label='기록 참여']")).toBeNull();expect(container.querySelector(".record-layout")).toBeNull();expect(container.textContent).toContain("현재 이 지도는 새 기록을 받지 않아요.");
  });
});
