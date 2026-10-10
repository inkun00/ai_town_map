// @vitest-environment happy-dom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {themeByKey,type DemoPoint,type Theme} from "../src/lib/demo-data";

const mocks=vi.hoisted(()=>({fetch:vi.fn(),prepare:vi.fn(),upload:vi.fn()}));
vi.mock("../src/lib/photo-upload",async()=>({...await vi.importActual<typeof import("../src/lib/photo-upload")>("../src/lib/photo-upload"),preparePhoto:mocks.prepare,uploadPreparedPhoto:mocks.upload}));
vi.mock("../src/components/EmojiPicker",()=>({EmojiPicker:({options,onChoose}:{options:{key:string}[];onChoose:(key:string)=>void})=><button type="button" aria-label={`전체 이모지 ${options.length}개`} onClick={()=>onChoose(options[0].key)}>이모지 선택</button>}));
vi.mock("../src/components/RecordLocationPicker",()=>({RecordLocationPicker:({label,onPick,onClose}:{label:string;onPick:(location:{lat:number;lng:number},source:"gps",label:string)=>void;onClose:()=>void})=><div role="dialog" aria-label="위치 변경"><span>{label}</span><button type="button" onClick={()=>{onPick({lat:38,lng:128},"gps","자동 장소 이름");onClose();}}>이 위치 사용</button></div>}));
import {InlineRecordEditor,type InlineObservation,type InlineRecordEditorProps} from "../src/components/InlineRecordEditor";

const theme:Theme={...themeByKey.safety,questions:[{key:"lighting",label:"조명",type:"boolean",required:true,allowUnknown:true,allowNotApplicable:true}]};
const point:DemoPoint={id:"point-a",mapId:"map-a",title:"신호등",body:"학교 앞에는 보행 신호등이 있어요.",categoryKey:"traffic",emojiKey:"traffic-1",ratingKey:"positive",x:50,y:50,author:"학생",date:"2026. 10. 10.",createdAt:"2026-10-10T00:00:00Z",location:{lat:37,lng:127},locationLabel:"학교 정문",locationSource:"manual",rawAnswers:{lighting:["yes"]},idea:"신호등을 잘 확인해요.",link:"https://example.com",photoUrl:"/old-photo",status:"published",version:"7",canEdit:true,canDelete:true};
const record:InlineObservation={id:point.id,mapId:point.mapId,title:point.title,body:point.body,locationLabel:point.locationLabel!,locationSource:"manual",location:point.location!,categoryKey:point.categoryKey,emojiKey:point.emojiKey,ratingKey:point.ratingKey,answers:point.rawAnswers!,improvementIdea:point.idea!,link:point.link!,status:"published",version:"8",createdAt:point.createdAt!,author:point.author,canEdit:true,canDelete:true,photoUrl:point.photoUrl!};
const saved=vi.fn(),notice=vi.fn(),dirty=vi.fn(),busy=vi.fn();
let host:HTMLDivElement,root:Root;
function result(data:unknown,status=200){return new Response(JSON.stringify(status>=400?{error:data}:{data}),{status,headers:{"Content-Type":"application/json"}});}
function props(extra:Partial<InlineRecordEditorProps>={}):InlineRecordEditorProps{return {point,theme,mapId:point.mapId,configRevision:3,csrfToken:"csrf-test",onSaved:saved,onNotice:notice,onDirtyChange:dirty,onBusyChange:busy,...extra};}
async function render(extra:Partial<InlineRecordEditorProps>={}){await act(async()=>{root.render(<InlineRecordEditor {...props(extra)}/>);});}
function button(label:string){const found=[...host.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.textContent?.trim()===label);if(!found)throw new Error(`Button missing: ${label}`);return found;}
async function click(label:string){await act(async()=>{button(label).click();});}
function input(label:string){const field=[...host.querySelectorAll<HTMLLabelElement>("label")].find(item=>item.querySelector("span")?.textContent?.startsWith(label));const control=field?.querySelector<HTMLInputElement|HTMLTextAreaElement>("input,textarea");if(!control)throw new Error(`Input missing: ${label}`);return control;}
async function write(label:string,value:string){await act(async()=>{const control=input(label);const prototype=control instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(prototype,"value")!.set!.call(control,value);control.dispatchEvent(new Event("input",{bubbles:true}));});}
async function submit(){await act(async()=>{host.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});}
async function selectPhoto(){const file=new File(["photo"],"photo.png",{type:"image/png"});await act(async()=>{const control=host.querySelector<HTMLInputElement>("input[type=file]")!;Object.defineProperty(control,"files",{value:[file],configurable:true});control.dispatchEvent(new Event("change",{bubbles:true}));});}

beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("fetch",mocks.fetch);mocks.fetch.mockReset();mocks.prepare.mockReset();mocks.upload.mockReset();saved.mockClear();notice.mockClear();dirty.mockClear();busy.mockClear();mocks.prepare.mockResolvedValue(new File(["prepared"],"photo.jpg",{type:"image/jpeg"}));host=document.createElement("div");document.body.appendChild(host);root=createRoot(host);});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.unstubAllGlobals();});

describe("inline record editing",()=>{
  it("updates the existing record with configuration, version, CSRF, answers and coordinates while keeping the form",async()=>{
    await render();expect(host.querySelector("button[aria-label^='전체 이모지']")?.getAttribute("aria-label")).toMatch(/전체 이모지 [34]\d\d\d개/);
    await write("기록 제목","  안전한 신호등  ");await write("관찰한 내용","학생들이 신호등을 기다리고 안전하게 길을 건너요.");
    mocks.fetch.mockImplementation(async(_url,options)=>result({...record,...JSON.parse(options.body),version:"8"}));await submit();
    expect(mocks.fetch).toHaveBeenCalledTimes(1);const [url,options]=mocks.fetch.mock.calls[0];expect(url).toBe("/api/v1/maps/map-a/observations/point-a");expect(options.method).toBe("PATCH");expect(options.headers["X-Resource-Version"]).toBe('"7"');expect(options.headers["X-CSRF-Token"]).toBe("csrf-test");expect(JSON.parse(options.body)).toMatchObject({configRevision:3,title:"안전한 신호등",answers:{lighting:["yes"]},location:{lat:37,lng:127},categoryKey:"traffic",emojiKey:"traffic-1",ratingKey:"positive"});expect(saved).toHaveBeenCalledTimes(1);expect(host.querySelector("form[aria-label='등록 기록 수정']")).not.toBeNull();expect(dirty).toHaveBeenLastCalledWith(false);expect(busy).toHaveBeenLastCalledWith(false);
  });

  it("keeps user input and the original version when props refresh or a version conflict occurs",async()=>{
    await render();await write("기록 제목","내가 작성한 수정");await render({point:{...point,title:"다른 사람이 수정",version:"9"},configRevision:4});expect(input("기록 제목").value).toBe("내가 작성한 수정");
    mocks.fetch.mockResolvedValue(result({code:"VERSION_CHANGED",message:"다른 곳에서 수정됐습니다."},412));await submit();expect(input("기록 제목").value).toBe("내가 작성한 수정");expect(mocks.fetch.mock.calls[0][1].headers["X-Resource-Version"]).toBe('"7"');expect(saved).not.toHaveBeenCalled();expect(dirty).toHaveBeenLastCalledWith(true);expect(button("최신 기록·설정 확인")).toBeDefined();expect(button("수정 저장").disabled).toBe(true);
  });

  it("changes coordinates in the fullscreen picker without replacing the manually entered place name",async()=>{
    await render();await click("🗺️전체 화면 지도에서 위치 변경37.00000, 127.00000");await click("이 위치 사용");expect(input("위치 또는 장소 이름").value).toBe("학교 정문");mocks.fetch.mockImplementation(async(_url,options)=>result({...record,...JSON.parse(options.body)}));await submit();expect(JSON.parse(mocks.fetch.mock.calls[0][1].body)).toMatchObject({location:{lat:38,lng:128},locationSource:"gps",locationLabel:"학교 정문"});
  });

  it("preserves a saved body after a photo failure and retries only the photo with the latest returned version",async()=>{
    await render();await write("기록 제목","사진을 바꾸는 기록");await selectPhoto();mocks.fetch.mockImplementation(async(_url,options)=>result({...record,...JSON.parse(options.body),version:"8"}));mocks.upload.mockRejectedValueOnce(new Error("사진 전송 실패"));await submit();
    expect(saved).toHaveBeenCalledWith(expect.objectContaining({title:"사진을 바꾸는 기록",version:"8"}));expect(host.querySelector("[role=alert]")?.textContent).toContain("본문 수정은 저장됐습니다");expect(dirty).toHaveBeenLastCalledWith(true);expect(input("기록 제목").closest("fieldset")?.disabled).toBe(true);
    mocks.upload.mockResolvedValueOnce({photoUrl:"/new-photo?v=9",status:"pending",version:"9"});await click("사진 교체 다시 시도");expect(mocks.fetch).toHaveBeenCalledTimes(1);expect(mocks.upload).toHaveBeenCalledTimes(2);expect(saved).toHaveBeenLastCalledWith(expect.objectContaining({photoUrl:"/new-photo?v=9",status:"pending",version:"9"}));expect(dirty).toHaveBeenLastCalledWith(false);
    await write("기록 제목","사진 저장 후 추가 수정");await submit();expect(mocks.fetch.mock.calls[1][1].headers["X-Resource-Version"]).toBe('"9"');
  });

  it("checks an uncertain PATCH result before retrying and does not write the saved body twice",async()=>{
    await render();await write("기록 제목","응답이 끊긴 수정");mocks.fetch.mockRejectedValueOnce(new Error("네트워크 오류"));await submit();expect(input("기록 제목").value).toBe("응답이 끊긴 수정");expect(button("수정 저장").disabled).toBe(true);expect(dirty).toHaveBeenLastCalledWith(true);
    mocks.fetch.mockImplementation(async(url)=>url.endsWith("/configuration")?result({configRevision:3,theme}):result({...record,title:"응답이 끊긴 수정"}));await click("저장 결과 확인");expect(mocks.fetch.mock.calls.filter(([,options])=>options?.method==="PATCH")).toHaveLength(1);expect(saved).toHaveBeenLastCalledWith(expect.objectContaining({title:"응답이 끊긴 수정",version:"8"}));expect(dirty).toHaveBeenLastCalledWith(false);
  });

  it("keeps input on a configuration conflict and rechecks configuration without loading newer conflicting content",async()=>{
    await render();await write("기록 제목","설정 변경 중 작성");mocks.fetch.mockResolvedValueOnce(result({code:"CONFIG_CHANGED",message:"지도 설정이 바뀌었습니다."},409));await submit();expect(input("기록 제목").value).toBe("설정 변경 중 작성");
    mocks.fetch.mockImplementation(async(url)=>url.endsWith("/configuration")?result({configRevision:5,theme}):result({...record,version:"7"}));await click("최신 기록·설정 확인");expect(input("기록 제목").value).toBe("설정 변경 중 작성");mocks.fetch.mockImplementation(async(_url,options)=>result({...record,...JSON.parse(options.body),version:"8"}));await submit();expect(JSON.parse(mocks.fetch.mock.calls.at(-1)![1].body).configRevision).toBe(5);
  });

  it("cancels pending photo retransmission without resaving or discarding the already saved body",async()=>{
    await render();await write("기록 제목","본문 먼저 저장");await selectPhoto();mocks.fetch.mockImplementation(async(_url,options)=>result({...record,...JSON.parse(options.body),version:"8"}));mocks.upload.mockRejectedValue(new Error("사진 저장 응답 실패"));await submit();await click("사진 교체 취소");expect(mocks.fetch).toHaveBeenCalledTimes(1);expect(saved).toHaveBeenLastCalledWith(expect.objectContaining({title:"본문 먼저 저장",version:"8"}));expect(dirty).toHaveBeenLastCalledWith(false);expect(button("수정 저장").disabled).toBe(true);expect(host.textContent).not.toContain("사진 교체 다시 시도");
  });

  it("keeps conflicting input until the user explicitly confirms loading a newer record",async()=>{
    await render();await write("기록 제목","내가 남긴 입력");mocks.fetch.mockResolvedValueOnce(result({code:"VERSION_CHANGED",message:"다른 곳에서 수정됐습니다."},412));await submit();const newest={...record,title:"새로 저장된 제목",body:"다른 곳에서 먼저 바꾼 관찰 내용입니다.",version:"10"};mocks.fetch.mockImplementation(async(url)=>url.endsWith("/configuration")?result({configRevision:3,theme}):result(newest));await click("최신 기록·설정 확인");expect(input("기록 제목").value).toBe("내가 남긴 입력");expect(saved).not.toHaveBeenCalled();const previousConfirm=window.confirm;const confirmation=vi.fn().mockReturnValue(false);window.confirm=confirmation;await click("최신 내용을 불러오기");expect(input("기록 제목").value).toBe("내가 남긴 입력");confirmation.mockReturnValue(true);await click("최신 내용을 불러오기");expect(input("기록 제목").value).toBe("새로 저장된 제목");expect(saved).toHaveBeenCalledWith(newest);expect(dirty).toHaveBeenLastCalledWith(false);if(previousConfirm)window.confirm=previousConfirm;else Reflect.deleteProperty(window,"confirm");
  });
});
