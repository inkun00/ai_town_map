// @vitest-environment happy-dom
import {act,type ImgHTMLAttributes} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {themeByKey,type Theme} from "../src/lib/demo-data";
import type {LiveMap} from "../src/lib/map-directory";
import {readDrafts,saveDraft} from "../src/lib/record-draft";

const mocks=vi.hoisted(()=>({prepare:vi.fn(),upload:vi.fn()}));
vi.mock("next/dynamic",()=>({default:()=>function LazyPanel(){return <section aria-label="지도 화면"/>;}}));
vi.mock("next/image",()=>({default:({src,...props}:ImgHTMLAttributes<HTMLImageElement>&{src:unknown})=><img {...props} src={typeof src==="string"?src:"/test.webp"}/>}));
vi.mock("../src/lib/photo-upload",async()=>({...await vi.importActual<typeof import("../src/lib/photo-upload")>("../src/lib/photo-upload"),preparePhoto:mocks.prepare,uploadPreparedPhoto:mocks.upload}));
vi.mock("../src/components/RecordLocationPicker",()=>({RecordLocationPicker:({onPick,onClose}:{onPick:(location:{lat:number;lng:number},source:"manual")=>void;onClose:()=>void})=><section role="dialog" aria-label="위치 고르기"><button type="button" onClick={()=>{onPick({lat:37.52,lng:127.03},"manual");onClose();}}>이 위치 사용</button></section>}));
vi.mock("../src/components/EmojiPicker",()=>({EmojiPicker:({options,selectedKeys,onChoose}:{options:{key:string;label:string}[];selectedKeys:string[];onChoose:(key:string)=>void})=><section aria-label="이모지 선택"><span data-selected-emoji>{selectedKeys[0]}</span><button type="button" onClick={()=>onChoose(options[0].key)}>이모지 고르기</button></section>}));
import HomePage from "../src/app/page";

const map:LiveMap={id:"11111111-1111-4111-8111-111111111111",title:"수업 기록 지도",description:"관찰 기록",themeKey:"safety",location:"학교",center:null,configRevision:1,visibility:"public",participation:"invited",moderation:"immediate",commentsEnabled:true,status:"active",version:"1",isMine:true,isOwner:false,capabilities:{canManageMap:false,canCreateObservation:true,canComment:true}};
const firstTheme:Theme={...themeByKey.safety,questions:[{key:"lighting",label:"조명 설명",type:"text",required:false,allowUnknown:false,allowNotApplicable:false}]};
const latestTheme:Theme={...firstTheme,questions:[{key:"lighting",label:"최신 조명 설명",type:"text",required:false,allowUnknown:false,allowNotApplicable:false},{key:"new_check",label:"추가 확인",type:"text",required:true,allowUnknown:false,allowNotApplicable:false}]};
const prepared=new File(["prepared photo"],"prepared.jpg",{type:"image/jpeg"});
const fetchSpy=vi.fn();
let root:Root,host:HTMLDivElement;
let revision:number,theme:Theme,postError:{code:string;message:string;status:number}|null;
let postThrows:boolean,configurationFailure:boolean;
let resolveConfiguration:((value:Response)=>void)|null;
let holdConfiguration:boolean;
function result(data:unknown,status=200){return new Response(JSON.stringify(status>=400?{error:data}:{data}),{status,headers:{"Content-Type":"application/json"}});}
function text(node:Element){const copy=node.cloneNode(true) as Element;copy.querySelectorAll("[aria-hidden='true']").forEach(item=>item.remove());return copy.textContent?.trim();}
function button(label:string){const found=[...host.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.getAttribute("aria-label")===label||text(item)===label);if(!found)throw new Error(`Missing button ${label}`);return found;}
async function click(label:string){await act(async()=>button(label).click());}
async function fill(selector:string,value:string){const control=host.querySelector<HTMLInputElement|HTMLTextAreaElement>(selector);if(!control)throw new Error(`Missing field ${selector}`);await act(async()=>{const prototype=control instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,"value")!.set!.call(control,value);control.dispatchEvent(new Event("input",{bubbles:true}));});}
function posts(){return fetchSpy.mock.calls.filter(([,options])=>options?.method==="POST");}
async function openDraft(){await act(async()=>root.render(<HomePage/>));await vi.waitFor(()=>expect(host.querySelector(".workspace-header strong")?.textContent).toBe(map.title));await click("발견 기록");await click("이 위치 사용");await fill("input[placeholder='예: 공원 북쪽 입구']","학교 정문");await click("다음");await fill("input[placeholder='예: 공원 입구의 높은 턱']","우리 반이 조사한 신호등");await act(async()=>host.querySelector<HTMLButtonElement>(".category-picker button")!.click());await click("이모지 고르기");await act(async()=>host.querySelector<HTMLButtonElement>(".rating-picker button")!.click());await fill("textarea[placeholder='무엇을 보았는지 자세히 적어주세요.']","학생들이 신호를 확인하고 안전하게 길을 건너요.");await fill("input[placeholder='조명 설명을(를) 적어주세요']","조명이 밝아서 잘 보여요.");await click("다음");await fill("input[type=url]","https://example.com/record");await fill("textarea[placeholder='어떻게 바꾸면 더 좋을까요?']","안내판을 더 크게 만들어요.");}
async function choosePhoto(){await act(async()=>{const control=host.querySelector<HTMLInputElement>("input[type=file]")!;Object.defineProperty(control,"files",{value:[new File(["original"],"class-photo.png",{type:"image/png"})],configurable:true});control.dispatchEvent(new Event("change",{bubbles:true}));});}
async function save(){await act(async()=>host.querySelector("form.record-layout")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));}

beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);localStorage.clear();sessionStorage.clear();window.history.replaceState(null,"",`/?map=${map.id}`);vi.stubGlobal("confirm",vi.fn().mockReturnValue(true));
  revision=1;theme=firstTheme;postError={code:"CONFIG_CHANGED",message:"지도 설정이 바뀌었습니다. 화면을 다시 열어 주세요.",status:409};postThrows=false;configurationFailure=false;holdConfiguration=false;resolveConfiguration=null;
  mocks.prepare.mockReset().mockResolvedValue(prepared);mocks.upload.mockReset().mockResolvedValue({photoUrl:"/photo?v=2",status:"published",version:"2"});
  fetchSpy.mockReset().mockImplementation(async(raw:RequestInfo|URL,options?:RequestInit)=>{
    const url=String(raw);
    if(url==="/api/v1/status")return result({configured:true});
    if(url==="/api/v1/session")return result({draftScope:"student-test",kind:"guest",accountRole:null,canCreateMap:false,expiresAt:"2099-01-01T00:00:00Z",csrfToken:"test-csrf"});
    if(url===`/api/v1/maps/${map.id}`)return result({...map,configRevision:revision});
    if(url.endsWith("/configuration")){
      if(holdConfiguration)return new Promise<Response>((resolve,reject)=>{resolveConfiguration=resolve;options?.signal?.addEventListener("abort",()=>reject(options.signal!.reason),{once:true});});
      if(configurationFailure)return result({code:"SERVER_ERROR",message:"지도 설정을 확인하지 못했어요."},503);
      return result({theme,configRevision:revision});
    }
    if(url.includes("/analysis?"))return result({items:[],stats:{total:0},dataRevision:"1",filter:{}});
    if(url.endsWith("/observations")&&options?.method==="POST"){
      if(postThrows)throw new Error("연결이 끊겼어요.");
      if(postError)return result(postError,postError.status);
      return result({...JSON.parse(options.body as string),id:"22222222-2222-4222-8222-222222222222",mapId:map.id,status:"published",version:"1",createdAt:"2026-10-12T00:00:00Z",author:"학생",canEdit:true,canDelete:true,photoUrl:null},201);
    }
    throw new Error(`Unexpected request ${url}`);
  });vi.stubGlobal("fetch",fetchSpy);host=document.createElement("div");document.body.appendChild(host);root=createRoot(host);
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("new record configuration conflict recovery",()=>{
  it("refreshes setting and access metadata without resubmitting, preserving text, coordinates, choices, answers and the photo",async()=>{
    await openDraft();await choosePhoto();await save();
    expect(posts()).toHaveLength(1);expect(button("기록 남기기").disabled).toBe(true);expect(button("지도 설정 다시 확인")).toBeDefined();
    const original=JSON.parse(posts()[0][1].body as string);revision=4;theme=latestTheme;
    await click("지도 설정 다시 확인");expect(posts()).toHaveLength(1);expect(host.querySelector(".record-progress strong")?.textContent).toBe("3 / 3");expect(host.textContent).toContain("class-photo.png");expect(host.textContent).toContain("관찰 유형, 이모지와 평가 항목을 확인한 뒤 다시 저장");expect(host.querySelector(".upload-status")).toBeNull();
    await save();expect(posts()).toHaveLength(1);expect(host.textContent).toContain("필수 항목을 확인");
    await click("이전");expect(host.querySelector<HTMLInputElement>("input[placeholder='예: 공원 입구의 높은 턱']")?.value).toBe(original.title);expect(host.querySelector<HTMLTextAreaElement>("textarea[placeholder='무엇을 보았는지 자세히 적어주세요.']")?.value).toBe(original.body);expect(host.querySelector("[data-selected-emoji]")?.textContent).toBe(original.emojiKey);expect(host.querySelector(".category-picker .selected")).not.toBeNull();expect(host.querySelector(".rating-picker .selected")).not.toBeNull();expect(host.querySelector<HTMLInputElement>("input[placeholder='최신 조명 설명을(를) 적어주세요']")?.value).toBe(original.answers.lighting[0]);
    await fill("input[placeholder='추가 확인을(를) 적어주세요']","새 항목도 현장에서 확인했어요.");await click("다음");postError=null;await save();
    expect(posts()).toHaveLength(2);const retry=JSON.parse(posts()[1][1].body as string);expect(retry).toMatchObject({...original,configRevision:4,answers:{...original.answers,new_check:["새 항목도 현장에서 확인했어요."]}});expect(posts()[1][1].headers["Idempotency-Key"]).not.toBe(posts()[0][1].headers["Idempotency-Key"]);expect(mocks.upload).toHaveBeenCalledTimes(1);expect(mocks.upload.mock.calls[0][1]).toBe(prepared);expect(host.querySelector(".record-layout")).toBeNull();expect(host.textContent).not.toContain("지도 설정 다시 확인");
  });

  it("prevents duplicate recovery and save while refreshing, and lets a failed refresh be retried",async()=>{
    await openDraft();await save();configurationFailure=true;await click("지도 설정 다시 확인");expect(posts()).toHaveLength(1);expect(button("지도 설정 다시 확인").disabled).toBe(false);expect(host.textContent).toContain("지도 설정을 확인하지 못했어요.");
    configurationFailure=false;holdConfiguration=true;await click("지도 설정 다시 확인");expect(button("지도 설정 다시 확인").disabled).toBe(true);expect(host.querySelector<HTMLFieldSetElement>(".record-layout > fieldset")?.disabled).toBe(true);await save();await click("지도 설정 다시 확인");expect(posts()).toHaveLength(1);expect(fetchSpy.mock.calls.filter(([url])=>String(url).endsWith("/configuration"))).toHaveLength(3);
    const resolve=resolveConfiguration!;await act(async()=>resolve(result({theme:firstTheme,configRevision:3})));expect(button("기록 남기기").disabled).toBe(false);expect(host.querySelector(".record-progress strong")?.textContent).toBe("3 / 3");
  });

  it("retains removed-question answers in the draft while submitting only the current questions",async()=>{
    await openDraft();await save();revision=3;theme={...firstTheme,questions:[{key:"new_check",label:"현장 확인",type:"text",required:false,allowUnknown:false,allowNotApplicable:false}]};await click("지도 설정 다시 확인");
    expect(readDrafts(sessionStorage,"student-test",map.id)[0].draft.answers).toEqual({lighting:["조명이 밝아서 잘 보여요."]});await click("이전");expect(host.querySelector("input[placeholder='조명 설명을(를) 적어주세요']")).toBeNull();await fill("input[placeholder='현장 확인을(를) 적어주세요']","새 질문에도 답했어요.");await click("다음");postError=null;await save();expect(posts()).toHaveLength(2);const retry=JSON.parse(posts()[1][1].body as string);expect(retry.configRevision).toBe(3);expect(retry.answers).toEqual({new_check:["새 질문에도 답했어요."]});expect(retry).toMatchObject({title:"우리 반이 조사한 신호등",location:{lat:37.52,lng:127.03}});
  });

  it.each([{code:"VERSION_CHANGED",status:409},{code:"AUTH_REQUIRED",status:401},{code:"SERVER_ERROR",status:503}])("does not offer configuration recovery for $code",async error=>{
    postError={...error,message:"다른 오류예요."};await openDraft();await save();expect(posts()).toHaveLength(1);expect(host.textContent).not.toContain("지도 설정 다시 확인");expect(fetchSpy.mock.calls.filter(([url])=>String(url).endsWith("/configuration"))).toHaveLength(1);
  });

  it("keeps an uncertain idempotent request locked without offering configuration recovery",async()=>{
    postThrows=true;await openDraft();await save();expect(posts()).toHaveLength(1);expect(host.textContent).toContain("저장 결과 확인 전에는 본문을 바꿀 수 없습니다");expect(host.textContent).not.toContain("지도 설정 다시 확인");expect(host.querySelector(".record-review")?.closest("fieldset")?.disabled).toBe(true);
  });

  it("restores an older uncertain request with unanswered optional questions and replays its exact body and key",async()=>{
    const category=firstTheme.categories[0];const draft={title:"이전 버전에서 쓰던 기록",body:"학교 앞 신호등을 살펴보고 기록했어요.",categoryKey:category.key,emojiKey:category.defaultEmojiKey,ratingKey:firstTheme.rating!.options[0].key,location:"학교 정문",idea:"안내판을 크게 만들어요.",imageName:"",link:"https://example.com/record",answers:{}};
    const payload=JSON.stringify({configRevision:1,title:draft.title,body:draft.body,locationLabel:draft.location,locationSource:"manual",location:{lat:37.52,lng:127.03},categoryKey:draft.categoryKey,emojiKey:draft.emojiKey,ratingKey:draft.ratingKey,answers:{},improvementIdea:draft.idea,link:draft.link});
    const key="33333333-3333-4333-8333-333333333333";
    saveDraft(sessionStorage,"student-test",{format:1,updatedAt:Date.now(),mapId:map.id,editingId:null,editingVersion:null,configRevision:1,draft,coordinates:{lat:37.52,lng:127.03},source:"manual",step:2,request:{key,payload},savedPointId:null});
    revision=4;theme={...firstTheme,questions:[...firstTheme.questions,{key:"optional_check",label:"추가 선택 항목",type:"text",required:false,allowUnknown:false,allowNotApplicable:false}]};await act(async()=>root.render(<HomePage/>));await vi.waitFor(()=>expect(host.querySelector(".workspace-header strong")?.textContent).toBe(map.title));await click("발견 기록");expect(host.querySelector(".record-progress strong")?.textContent).toBe("3 / 3");expect(host.querySelector(".record-review")?.closest("fieldset")?.disabled).toBe(true);
    postThrows=true;await save();expect(posts()).toHaveLength(1);expect(posts()[0][1].body).toBe(payload);expect(posts()[0][1].headers["Idempotency-Key"]).toBe(key);expect(host.textContent).not.toContain("입력을 원래 내용으로 되돌려");
    postThrows=false;postError=null;await save();expect(posts()).toHaveLength(2);expect(posts()[1][1].body).toBe(payload);expect(posts()[1][1].headers["Idempotency-Key"]).toBe(key);expect(readDrafts(sessionStorage,"student-test",map.id)).toEqual([]);expect(host.querySelector(".record-layout")).toBeNull();
  });

  it("clears the conflict action when the draft is reopened",async()=>{
    await openDraft();await save();expect(host.textContent).toContain("지도 설정 다시 확인");await click("탐험 지도");await click("발견 기록");expect(host.querySelector(".record-progress strong")?.textContent).toBe("3 / 3");expect(host.textContent).not.toContain("지도 설정 다시 확인");expect(button("기록 남기기").disabled).toBe(false);
  });

  it("releases a stalled refresh on timeout and aborts a later refresh on unmount",async()=>{
    await openDraft();await save();holdConfiguration=true;const timeout=new AbortController();vi.spyOn(AbortSignal,"timeout").mockReturnValue(timeout.signal);
    await click("지도 설정 다시 확인");const requests=fetchSpy.mock.calls.slice(-2);expect(requests[0][1].signal).toBe(requests[1][1].signal);await act(async()=>timeout.abort(new DOMException("Timed out","TimeoutError")));expect(host.textContent).toContain("지도 설정 확인 시간이 초과됐어요");expect(button("지도 설정 다시 확인").disabled).toBe(false);expect(host.querySelector<HTMLFieldSetElement>(".record-layout > fieldset")?.disabled).toBe(false);expect(host.querySelector(".record-review")?.textContent).toContain("우리 반이 조사한 신호등");expect(posts()).toHaveLength(1);
    const nextTimeout=new AbortController();vi.mocked(AbortSignal.timeout).mockReturnValue(nextTimeout.signal);await click("지도 설정 다시 확인");const signal=fetchSpy.mock.calls.at(-1)![1].signal as AbortSignal;await act(async()=>root.unmount());expect(signal.aborted).toBe(true);root=createRoot(host);expect(posts()).toHaveLength(1);
  });
});
