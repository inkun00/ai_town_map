// @vitest-environment happy-dom
import {act,StrictMode} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {MapParticipationJoin,type MapParticipationJoinProps} from "../src/components/MapParticipationJoin";

let container:HTMLDivElement,root:Root;
const fetchSpy=vi.fn(),joined=vi.fn(),close=vi.fn(),notice=vi.fn();
const mapId="10000000-0000-4000-8000-000000000001";
let props:MapParticipationJoinProps;
function ok(){return {ok:true,json:async()=>({data:{mapId}})};}
async function render(strict=false){await act(async()=>root.render(strict?<StrictMode><MapParticipationJoin {...props}/></StrictMode>:<MapParticipationJoin {...props}/>));}
function field(label:string){const input=[...container.querySelectorAll<HTMLLabelElement>("label")].find(item=>item.textContent===label)?.querySelector<HTMLInputElement>("input");if(!input)throw new Error(`Field missing: ${label}`);return input;}
async function fill(label:string,value:string){const input=field(label);await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});}
async function submit(){await act(async()=>container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));}
async function click(label:string){const button=[...container.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.textContent?.trim()===label||item.getAttribute("aria-label")===label);if(!button)throw new Error(`Button missing: ${label}`);await act(async()=>button.click());}

beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);fetchSpy.mockReset().mockResolvedValue(ok());vi.stubGlobal("fetch",fetchSpy);joined.mockReset();close.mockReset();notice.mockReset();
  props={mapId,title:"우리학교 탐험지도",visibility:"public",csrfToken:null,onJoined:joined,onClose:close,onNotice:notice};
  container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});

describe("map contribution participation",()=>{
  it("lets a public map visitor browse without joining and join with only a nickname",async()=>{
    await render();expect(container.querySelector<HTMLDialogElement>("dialog")?.open).toBe(true);expect(container.textContent).toContain("지도와 등록된 기록은 누구나 볼 수 있어요.");expect(container.querySelectorAll("input")).toHaveLength(1);
    await click("지금은 지도만 볼게요");expect(close).toHaveBeenCalledTimes(1);expect(fetchSpy).not.toHaveBeenCalled();close.mockClear();
    await fill("닉네임","  나무 탐험가  ");await submit();
    expect(fetchSpy).toHaveBeenCalledTimes(1);const [url,options]=fetchSpy.mock.calls[0];expect(url).toBe(`/api/v1/maps/${mapId}/join`);expect(options.method).toBe("POST");expect(JSON.parse(options.body)).toEqual({nickname:"나무 탐험가"});expect(options.headers).not.toHaveProperty("X-CSRF-Token");expect(joined).toHaveBeenCalledTimes(1);expect(close).toHaveBeenCalledTimes(1);expect(notice).toHaveBeenCalledWith("이제 이 지도에 위치포인트를 등록할 수 있어요.");
  });

  it("adds existing session CSRF and awaits session/map refresh before closing",async()=>{
    let resolve:(()=>void)|undefined;joined.mockImplementation(()=>new Promise<void>(done=>{resolve=done;}));props.csrfToken="session-csrf";await render();await fill("닉네임","별 탐험가");await submit();
    expect(fetchSpy.mock.calls[0][1].headers["X-CSRF-Token"]).toBe("session-csrf");expect(close).not.toHaveBeenCalled();expect(container.querySelector("fieldset")?.disabled).toBe(true);
    await act(async()=>resolve!());expect(close).toHaveBeenCalledTimes(1);
  });

  it("supports a map password or teacher code while never sending both secrets",async()=>{
    props.visibility="invite_only";props.passwordEnabled=true;await render();expect(container.querySelector("[role=tab][aria-selected=true]")?.textContent).toContain("지도 비밀번호");
    await fill("닉네임","다람쥐 탐험가");await fill("지도 비밀번호","Map!Password");await submit();expect(JSON.parse(fetchSpy.mock.calls[0][1].body)).toEqual({nickname:"다람쥐 탐험가",password:"Map!Password"});expect(field("지도 비밀번호").value).toBe("");
    await fill("지도 비밀번호","will-be-cleared");await click("🔑 교사 인증코드");expect(container.querySelector("input[type=password]")).toBeNull();expect(container.querySelector("[role=tab][aria-selected=true]")?.textContent).toContain("교사 인증코드");
    await fill("교사 인증코드","abcd-efgh-jklm");await submit();expect(JSON.parse(fetchSpy.mock.calls[1][1].body)).toEqual({nickname:"다람쥐 탐험가",code:"ABCD-EFGH-JKLM"});expect(field("교사 인증코드").value).toBe("");
    await click("🔒 지도 비밀번호");expect(field("지도 비밀번호").value).toBe("");
  });

  it("offers teacher code only when the map has no password and validates nickname and code",async()=>{
    props.visibility="invite_only";props.passwordEnabled=false;await render();expect(container.querySelector("[role=tablist]")).toBeNull();expect(container.querySelector("input[type=password]")).toBeNull();
    await submit();expect(container.querySelector("[role=alert]")?.textContent).toContain("닉네임");await fill("닉네임","학교 탐험가");await fill("교사 인증코드","SHORT");await submit();expect(container.querySelector("[role=alert]")?.textContent).toContain("인증코드");expect(fetchSpy).not.toHaveBeenCalled();
    await fill("교사 인증코드","ABCD-EFGH-JKLM");await submit();expect(joined).toHaveBeenCalledTimes(1);
  });

  it("keeps the dialog open on rejected credentials and retries without changing reading access",async()=>{
    props.visibility="invite_only";props.passwordEnabled=true;fetchSpy.mockResolvedValueOnce({ok:false,json:async()=>({error:{message:"비밀번호가 맞지 않아요."}})});await render();await fill("닉네임","바다 탐험가");await fill("지도 비밀번호","wrong-password");await submit();
    expect(container.querySelector("[role=alert]")?.textContent).toBe("비밀번호가 맞지 않아요.");expect(joined).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();expect(container.querySelector("fieldset")?.disabled).toBe(false);expect(container.textContent).toContain("누구나 볼 수 있어요");
    await fill("지도 비밀번호","correct-password");await submit();expect(joined).toHaveBeenCalledTimes(1);expect(close).toHaveBeenCalledTimes(1);
  });

  it("blocks duplicate submits and aborts/ignores a request after unmount",async()=>{
    let resolve:((value:unknown)=>void)|undefined;fetchSpy.mockImplementation(()=>new Promise(done=>{resolve=done;}));await render();await fill("닉네임","숲 탐험가");await submit();await submit();expect(fetchSpy).toHaveBeenCalledTimes(1);
    const signal=fetchSpy.mock.calls[0][1].signal as AbortSignal;await act(async()=>root.unmount());expect(signal.aborted).toBe(true);await act(async()=>resolve!(ok()));expect(joined).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();expect(notice).not.toHaveBeenCalled();root=createRoot(container);
  });

  it("clears previous-map secrets and ignores its late response when the target map changes",async()=>{
    let resolve:((value:unknown)=>void)|undefined;fetchSpy.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));props.visibility="invite_only";props.passwordEnabled=true;await render(true);await fill("닉네임","용감한 탐험가");await fill("지도 비밀번호","secret-password");await submit();const signal=fetchSpy.mock.calls[0][1].signal as AbortSignal;
    props={...props,mapId:"10000000-0000-4000-8000-000000000002",title:"다른 탐험지도"};await render(true);expect(signal.aborted).toBe(true);expect(field("닉네임").value).toBe("");expect(field("지도 비밀번호").value).toBe("");await act(async()=>resolve!(ok()));expect(joined).not.toHaveBeenCalled();expect(close).not.toHaveBeenCalled();
  });

  it("shows network errors and validates password length before making a request",async()=>{
    props.visibility="invite_only";props.passwordEnabled=true;fetchSpy.mockRejectedValueOnce(new Error("연결이 끊어졌어요."));await render();await fill("닉네임","동네 탐험가");await fill("지도 비밀번호","123");await submit();expect(fetchSpy).not.toHaveBeenCalled();expect(container.querySelector("[role=alert]")?.textContent).toContain("4~100자");
    await fill("지도 비밀번호","valid-password");await submit();expect(container.querySelector("[role=alert]")?.textContent).toContain("연결이 끊어졌어요");expect(close).not.toHaveBeenCalled();
  });
});
