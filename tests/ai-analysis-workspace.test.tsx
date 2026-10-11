// @vitest-environment happy-dom
import {act,StrictMode} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {AiAnalysisWorkspace,type AiAnalysisWorkspaceProps} from "../src/components/AiAnalysisWorkspace";
import {themeByKey,type DemoPoint} from "../src/lib/demo-data";
import {aiSectionKeys,type AiSuggestions,type StudentAnalysisReport} from "../src/domain/ai-analysis";

const mapId="26cf2dd4-b811-4e69-9c06-04186e244f1f";
const ids=["356bd0be-a02b-411b-bb6b-e0317f074101","356bd0be-a02b-411b-bb6b-e0317f074102","356bd0be-a02b-411b-bb6b-e0317f074103","356bd0be-a02b-411b-bb6b-e0317f074104"];
const points:DemoPoint[]=ids.map((id,index)=>({id,mapId,title:`관찰 기록 ${index+1}`,body:"직접 관찰한 내용",categoryKey:"plants",emojiKey:"plants-1",ratingKey:null,x:50,y:50,author:"학생",date:"2026. 10. 11.",status:"published",photoUrl:`/photos/${id}`}));
const card={title:"AI가 제안한 관점",suggestion:"그늘과 쉼터의 관계를 살펴보면 어떨까요?",evidenceIds:[ids[0]],checkQuestion:"다른 시간에도 그늘이 있나요?"};
const suggestions:AiSuggestions={sections:{discoveries:[card],groups:[card],perspectives:[card],questions:[card],improvements:[card]},dataRevision:"revision-1",generatedAt:"2026-10-11T01:00:00Z",totalRecords:4,analyzedRecords:4,filterFingerprint:"fingerprint",model:"configured-model"};
const savedReport:StudentAnalysisReport={id:"bb51aaf9-cdbe-4d2c-810d-454a94483770",version:1,updatedAt:"2026-10-11T02:00:00Z",dataRevision:"revision-1",title:"저장된 내 글",analysis:"나의 분석",proposal:"나의 개선 방법",reasoning:"기록을 읽고 판단한 이유",followUp:"다른 시간에 다시 관찰",evidenceIds:[ids[0]],status:"draft"};
const fetchMock=vi.fn(),notice=vi.fn(),showPoint=vi.fn(),dirty=vi.fn(),busy=vi.fn();
let host:HTMLDivElement,root:Root,props:AiAnalysisWorkspaceProps;
function response(data:unknown,status=200){return new Response(JSON.stringify(status>=400?{error:data}:{data}),{status,headers:{"Content-Type":"application/json"}});}
function defaultFetch(url:string,options?:RequestInit){
  if(url.endsWith("/ai-suggestions"))return Promise.resolve(response(options?.method==="POST"?suggestions:{ready:true,reason:"",model:"configured-model"}));
  if(options?.method==="PUT"){const {expectedVersion,...content}=JSON.parse(options.body as string);return Promise.resolve(response({...savedReport,...content,version:expectedVersion+1}));}
  return Promise.resolve(response(null));
}
async function render(extra:Partial<AiAnalysisWorkspaceProps>={},strict=false){props={...props,...extra};await act(async()=>root.render(strict?<StrictMode><AiAnalysisWorkspace {...props}/></StrictMode>:<AiAnalysisWorkspace {...props}/>));}
function button(label:string){const item=[...host.querySelectorAll<HTMLButtonElement>("button")].find(element=>element.textContent?.trim()===label);if(!item)throw new Error(`Button missing: ${label}`);return item;}
async function click(label:string){await act(async()=>button(label).click());}
async function writingTab(){await act(async()=>host.querySelector<HTMLButtonElement>("[role=tab][aria-controls$='writing-panel']")!.click());}
function field(label:string){const item=[...host.querySelectorAll<HTMLLabelElement>("label")].find(element=>element.querySelector("span")?.textContent?.startsWith(label));const control=item?.querySelector<HTMLInputElement|HTMLTextAreaElement>("input,textarea");if(!control)throw new Error(`Field missing: ${label}`);return control;}
async function write(label:string,value:string){await act(async()=>{const control=field(label),prototype=control instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,"value")!.set!.call(control,value);control.dispatchEvent(new Event("input",{bubbles:true}));});}
function puts(){return fetchMock.mock.calls.filter(([,options])=>options?.method==="PUT");}
function posts(){return fetchMock.mock.calls.filter(([,options])=>options?.method==="POST");}
async function fillWriting(){await writingTab();await write("내 글의 제목","내가 직접 쓴 제목");await write("내가 분석한 내용","그늘이 있는 곳에 앉아 쉬는 사람이 많았어요.");await write("내가 제안하는 개선 방법","그늘이 없는 곳에도 쉬는 자리를 만들면 좋겠어요.");await write("이렇게 판단한 이유","원본 기록과 직접 관찰한 상황을 비교했어요.");await act(async()=>host.querySelector<HTMLInputElement>(".ai-workspace__evidence input")!.click());}

beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("fetch",fetchMock);fetchMock.mockReset().mockImplementation(defaultFetch);notice.mockReset();showPoint.mockReset();dirty.mockReset();busy.mockReset();host=document.createElement("div");document.body.appendChild(host);root=createRoot(host);props={mapId,theme:themeByKey.ecology,points,filter:{},dataRevision:"revision-1",csrfToken:"csrf-test",isMember:true,active:true,dataReady:true,onNotice:notice,onShowPoint:showPoint,onDirtyChange:dirty,onBusyChange:busy,manageNavigationGuard:true};});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("AI reference suggestions and independently authored final writing",()=>{
  it("shows all five text features and keeps manual writing available when AI is not configured",async()=>{
    fetchMock.mockImplementation((url,options)=>url.endsWith("/ai-suggestions")?Promise.resolve(response({ready:false,reason:"모델과 서버 키를 설정해 주세요.",model:null})):defaultFetch(url,options));
    await render({},true);expect(host.textContent).toContain("결론이나 정답이 아닌 참고 제안");expect(host.textContent).toContain("AI 연결 준비 중");expect(button("AI 참고 제안 받기").disabled).toBe(true);expect(host.querySelectorAll(".ai-workspace__feature-list span")).toHaveLength(5);
    await writingTab();for(const label of ["내 글의 제목","내가 분석한 내용","내가 제안하는 개선 방법","이렇게 판단한 이유","다음에 더 확인할 것"])expect(field(label).value).toBe("");
    await write("내 글의 제목","스스로 정리한 생태 분석");await click("초안 저장");expect(puts()).toHaveLength(1);expect(JSON.parse(puts()[0][1].body)).toMatchObject({title:"스스로 정리한 생태 분석",analysis:"",proposal:"",status:"draft",expectedVersion:0});expect(dirty).toHaveBeenLastCalledWith(false);expect(host.textContent).toContain("나에게만 보이고");
  });

  it("sends only selected data criteria, keeps AI cards separate, and opens original evidence",async()=>{
    await render();await click("AI 참고 제안 받기");expect(posts()).toHaveLength(1);expect(posts()[0][1].headers["X-CSRF-Token"]).toBe("csrf-test");expect(JSON.parse(posts()[0][1].body)).toEqual({filter:{}});
    expect(host.querySelectorAll(".ai-workspace__section")).toHaveLength(aiSectionKeys.length);await click("관찰 기록 1 ↗");expect(showPoint).toHaveBeenCalledWith(ids[0]);
    await act(async()=>host.querySelector<HTMLInputElement>(".ai-workspace__judgment input[value=agree]")!.click());await writingTab();expect(field("내가 분석한 내용").value).toBe("");expect(field("내가 제안하는 개선 방법").value).toBe("");expect(puts()).toHaveLength(0);
    await fillWriting();await click("내 최종 글 저장");const body=JSON.parse(puts()[0][1].body);expect(body.status).toBe("final");expect(body.evidenceIds).toEqual([ids[0]]);expect(body.analysis).toContain("앉아 쉬는 사람이");expect(JSON.stringify(body)).not.toContain(card.suggestion);expect(dirty).toHaveBeenLastCalledWith(false);
  });

  it("uses text-only analysis even when observations have photos",async()=>{
    await render({filter:{category:"plants"}});expect(points.every(point=>point.photoUrl)).toBe(true);
    expect(host.textContent).toContain("사용자가 작성한 텍스트와 선택한 평가·응답을 바탕으로");expect(host.textContent).not.toContain("사진 단서");expect(host.querySelector(".ai-workspace__photos")).toBeNull();expect(host.querySelector("img")).toBeNull();
    await click("AI 참고 제안 받기");expect(posts()).toHaveLength(1);expect(JSON.parse(posts()[0][1].body)).toEqual({filter:{category:"plants"}});expect(host.querySelectorAll(".ai-workspace__section")).toHaveLength(5);expect(host.querySelector("img")).toBeNull();expect(JSON.stringify(posts()[0][1])).not.toContain("/photos/");
  });

  it("invalidates old suggestions on filter changes while preserving the author's writing and hidden evidence",async()=>{
    await render();await click("AI 참고 제안 받기");await fillWriting();await render({filter:{category:"plants"},points:[points[1]]});
    expect(host.querySelectorAll(".ai-workspace__card")).toHaveLength(0);expect(host.textContent).toContain("이전 AI 제안을 숨겼어요");expect(field("내가 분석한 내용").value).toContain("앉아 쉬는 사람이");expect(host.textContent).toContain("삭제하지 않고 유지했어요");
    await click("초안 저장");expect(JSON.parse(puts()[0][1].body).evidenceIds).toEqual([ids[0]]);
  });

  it("aborts and ignores a late AI response after its context changes",async()=>{
    let resolve:((response:Response)=>void)|undefined;
    fetchMock.mockImplementation((url,options)=>options?.method==="POST"?new Promise<Response>(done=>{resolve=done;}):defaultFetch(url,options));await render();await click("AI 참고 제안 받기");const signal=posts()[0][1].signal as AbortSignal;
    await render({dataRevision:"revision-2"});expect(signal.aborted).toBe(true);await act(async()=>resolve!(response(suggestions)));expect(host.querySelectorAll(".ai-workspace__card")).toHaveLength(0);expect(notice).not.toHaveBeenCalled();
  });

  it("does not query private reports or AI availability for visitors who have not joined",async()=>{
    await render({isMember:false,csrfToken:null});expect(fetchMock).not.toHaveBeenCalled();expect(host.textContent).toContain("지도에 참여하면");expect(host.querySelector("form")).toBeNull();
  });

  it("disables saving if initial report loading fails, preventing an accidental overwrite",async()=>{
    fetchMock.mockImplementation((url,options)=>url.endsWith("/student-analysis")?Promise.resolve(response({message:"저장본을 확인하지 못했어요."},503)):defaultFetch(url,options));await render();await writingTab();expect(field("내 글의 제목").closest("fieldset")?.disabled).toBe(true);expect(button("초안 저장").disabled).toBe(true);await click("초안 저장");expect(puts()).toHaveLength(0);expect(host.textContent).toContain("저장한 글 다시 불러오기");
  });

  it("preserves conflict input until an explicit confirmation loads the latest saved report",async()=>{
    await render();await writingTab();await write("내 글의 제목","현재 작성 중인 내 생각");
    fetchMock.mockImplementation((url,options)=>options?.method==="PUT"?Promise.resolve(response({code:"VERSION_CHANGED",message:"다른 곳에서 저장됐어요."},409)):url.endsWith("/student-analysis")?Promise.resolve(response(savedReport)):defaultFetch(url,options));
    await click("초안 저장");expect(field("내 글의 제목").value).toBe("현재 작성 중인 내 생각");expect(button("초안 저장").disabled).toBe(true);await click("최신 저장본 확인");expect(field("내 글의 제목").value).toBe("현재 작성 중인 내 생각");
    const previous=window.confirm,confirm=vi.fn().mockReturnValue(false);window.confirm=confirm;await click("최신 저장본으로 바꾸기");expect(field("내 글의 제목").value).toBe("현재 작성 중인 내 생각");confirm.mockReturnValue(true);await click("최신 저장본으로 바꾸기");expect(field("내 글의 제목").value).toBe(savedReport.title);expect(dirty).toHaveBeenLastCalledWith(false);expect(puts()).toHaveLength(1);if(previous)window.confirm=previous;else Reflect.deleteProperty(window,"confirm");
  });

  it("checks a lost final-save response without issuing another write",async()=>{
    await render();await fillWriting();let committed:StudentAnalysisReport|null=null;
    fetchMock.mockImplementation((url,options)=>{if(options?.method==="PUT"){const {expectedVersion,...body}=JSON.parse(options.body);committed={...savedReport,...body,version:expectedVersion+1};return Promise.reject(new Error("연결이 끊겼어요."));}return url.endsWith("/student-analysis")?Promise.resolve(response(committed)):defaultFetch(url,options);});
    await click("내 최종 글 저장");expect(button("내 최종 글 저장").disabled).toBe(true);expect(field("내 글의 제목").value).toBe("내가 직접 쓴 제목");await click("최신 저장본 확인");expect(puts()).toHaveLength(1);expect(dirty).toHaveBeenLastCalledWith(false);expect(host.textContent).toContain("내가 작성한 최종 글");
  });

  it("allows unavailable evidence to be corrected without discarding the author's text",async()=>{
    await render();await fillWriting();let first=true;
    fetchMock.mockImplementation((url,options)=>{if(options?.method==="PUT"&&first){first=false;return Promise.resolve(response({code:"EVIDENCE_UNAVAILABLE",message:"근거 기록이 숨겨지거나 삭제되었습니다. 근거 목록을 다시 확인해 주세요."},409));}return defaultFetch(url,options);});
    await click("내 최종 글 저장");expect(field("내 글의 제목").value).toBe("내가 직접 쓴 제목");expect(button("내 최종 글 저장").disabled).toBe(false);expect(host.textContent).not.toContain("최신 저장본 확인");
    await act(async()=>{const evidence=[...host.querySelectorAll<HTMLInputElement>(".ai-workspace__evidence input")];evidence[0].click();evidence[1].click();});
    await click("내 최종 글 저장");expect(puts()).toHaveLength(2);expect(JSON.parse(puts()[1][1].body)).toMatchObject({title:"내가 직접 쓴 제목",analysis:"그늘이 있는 곳에 앉아 쉬는 사람이 많았어요.",proposal:"그늘이 없는 곳에도 쉬는 자리를 만들면 좋겠어요.",reasoning:"원본 기록과 직접 관찰한 상황을 비교했어요.",evidenceIds:[ids[1]],expectedVersion:0,status:"final"});expect(dirty).toHaveBeenLastCalledWith(false);
  });

  it("does not replace edits made while checking an uncertain save result",async()=>{
    await render();await writingTab();await write("내 글의 제목","처음 저장한 내용");let committed:StudentAnalysisReport|null=null;
    fetchMock.mockImplementation((url,options)=>{if(options?.method==="PUT"){const {expectedVersion,...body}=JSON.parse(options.body);committed={...savedReport,...body,version:expectedVersion+1};return Promise.reject(new Error("연결 실패"));}return defaultFetch(url,options);});
    await click("초안 저장");let resolve:((response:Response)=>void)|undefined;fetchMock.mockImplementation((url,options)=>url.endsWith("/student-analysis")?new Promise<Response>(done=>{resolve=done;}):defaultFetch(url,options));await click("최신 저장본 확인");await write("내 글의 제목","확인하는 동안 더 쓴 내용");await act(async()=>resolve!(response(committed)));
    expect(field("내 글의 제목").value).toBe("확인하는 동안 더 쓴 내용");expect(dirty).toHaveBeenLastCalledWith(true);expect(button("초안 저장").disabled).toBe(true);expect(host.textContent).toContain("최신 저장본으로 바꾸기");
  });

  it("explains guest report access without changing the shared map",async()=>{
    await render({isGuest:true});await writingTab();expect(host.textContent).toContain("현재 브라우저의 참여 정보로만 다시 열 수 있어요");expect(host.textContent).toContain("전체 지도와 다른 사람의 기록을 바꾸지 않아요");
  });

  it("requires manual final fields and evidence before final saving",async()=>{
    await render();await writingTab();await click("내 최종 글 저장");expect(puts()).toHaveLength(0);expect(host.textContent).toContain("근거 기록을 모두 작성");
    await write("내 글의 제목","제목만 입력");await click("내 최종 글 저장");expect(puts()).toHaveLength(0);
  });

  it("prevents duplicate saves and aborts pending writes when unmounted",async()=>{
    let resolve:((response:Response)=>void)|undefined;await render();await writingTab();await write("내 글의 제목","안전하게 보관할 글");fetchMock.mockImplementation((url,options)=>options?.method==="PUT"?new Promise<Response>(done=>{resolve=done;}):defaultFetch(url,options));
    await act(async()=>{button("초안 저장").click();button("초안 저장").click();});expect(puts()).toHaveLength(1);const signal=puts()[0][1].signal as AbortSignal;expect(busy).toHaveBeenLastCalledWith(true);await act(async()=>root.unmount());expect(signal.aborted).toBe(true);await act(async()=>resolve!(response(savedReport)));expect(notice).not.toHaveBeenCalled();root=createRoot(host);
  });
});
