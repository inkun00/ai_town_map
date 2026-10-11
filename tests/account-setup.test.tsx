// @vitest-environment happy-dom
import {act,StrictMode} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import AccountSetup from "../src/components/AccountSetup";
import type {GameSession} from "../src/components/games/GameShared";

let container:HTMLDivElement,root:Root;
const destination="/?map=abc",sessionSpy=vi.fn(),accountSpy=vi.fn(),fetchSpy=vi.fn(),navigate=vi.fn();
const unfinished:GameSession={kind:"account",accountRole:null,canCreateMap:false,csrfToken:"account-csrf"};
function ok(data:unknown){return {ok:true,status:200,json:async()=>({data})};}
async function render(strict=false){await act(async()=>root.render(strict?<StrictMode><AccountSetup returnTo={destination}/></StrictMode>:<AccountSetup returnTo={destination}/>));}
async function choose(role:"teacher"|"student"){await act(async()=>container.querySelector<HTMLInputElement>(`input[value="${role}"]`)!.click());}
async function submit(){await act(async()=>container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));}

beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);sessionSpy.mockReset().mockResolvedValue(ok({...unfinished}));accountSpy.mockReset().mockResolvedValue(ok({role:"student"}));fetchSpy.mockReset().mockImplementation((url,init)=>url==="/api/v1/session"?sessionSpy():accountSpy(url,init));vi.stubGlobal("fetch",fetchSpy);navigate.mockReset();vi.spyOn(window.location,"assign").mockImplementation(navigate);container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("Google signup role fallback",()=>{
  it.each([null,{...unfinished,kind:"guest"}])("offers visitors and guests explicit Google role signup plus student email",async session=>{
    sessionSpy.mockResolvedValue(ok(session));await render();const links=[...container.querySelectorAll<HTMLAnchorElement>('a[href^="/api/v1/auth/google"]')];expect(links).toHaveLength(2);expect(links.map(link=>link.getAttribute("aria-label"))).toEqual(["교사로 Google 회원가입","학생으로 Google 회원가입"]);expect(links.map(link=>new URL(link.href).searchParams.get("role"))).toEqual(["teacher","student"]);for(const link of links)expect(new URL(link.href).searchParams.get("returnTo")).toBe(destination);expect(container.querySelector<HTMLAnchorElement>('a[href^="/account/register"]')?.getAttribute("href")).toBe("/account/register?returnTo=%2F%3Fmap%3Dabc");expect(container.querySelector("form")).toBeNull();expect(accountSpy).not.toHaveBeenCalled();
  });

  it.each(["teacher","student"] as const)("saves only the selected %s role with the account CSRF and returns to the original page",async role=>{
    await render();expect([...container.querySelectorAll<HTMLInputElement>('input[name="account-role"]')].map(input=>input.value)).toEqual(["teacher","student"]);expect(container.querySelector<HTMLButtonElement>('button[type="submit"],form button')?.disabled).toBe(true);await choose(role);await submit();expect(accountSpy).toHaveBeenCalledTimes(1);expect(accountSpy.mock.calls[0][0]).toBe("/api/v1/account");expect(accountSpy.mock.calls[0][1].headers).toEqual({"Content-Type":"application/json","X-CSRF-Token":"account-csrf"});expect(JSON.parse(accountSpy.mock.calls[0][1].body)).toEqual({role});expect(navigate).toHaveBeenCalledWith(destination);await submit();expect(accountSpy).toHaveBeenCalledTimes(1);
  });

  it.each(["teacher","student","member"] as const)("preserves an existing %s account and offers no editable role choices",async role=>{
    sessionSpy.mockResolvedValue(ok({...unfinished,accountRole:role}));await render();expect(container.querySelector("form")).toBeNull();expect(container.querySelectorAll("input[type=radio]")).toHaveLength(0);expect(container.querySelectorAll('a[href^="/api/v1/auth/google"]')).toHaveLength(0);expect(container.textContent).toContain(role==="teacher"?"교사로 가입되어":role==="student"?"학생으로 가입되어":"일반회원으로 가입되어");expect(container.textContent).toContain("변경할 수 없습니다");expect(container.querySelector<HTMLAnchorElement>(`a[href="${destination}"]`)?.textContent).toBe("돌아가기");expect(accountSpy).not.toHaveBeenCalled();
  });

  it("blocks role submission when the account session has no CSRF token",async()=>{
    sessionSpy.mockResolvedValue(ok({...unfinished,csrfToken:null}));await render();expect(container.querySelector("fieldset")?.disabled).toBe(true);expect(container.querySelector("[role=alert]")?.textContent).toContain("페이지를 새로고침");await choose("teacher");await submit();expect(accountSpy).not.toHaveBeenCalled();expect(navigate).not.toHaveBeenCalled();
  });

  it("keeps all signup actions unavailable when the session check fails",async()=>{
    sessionSpy.mockRejectedValue(new Error("참여 정보를 확인하지 못했어요."));await render();expect(container.querySelector("[role=alert]")?.textContent).toContain("참여 정보를 확인하지 못했어요");expect(container.querySelector("form")).toBeNull();expect(container.querySelectorAll('a[href^="/api/v1/auth/google"]')).toHaveLength(0);expect(container.querySelector('[role="status"]')).toBeNull();expect(accountSpy).not.toHaveBeenCalled();
  });

  it("blocks duplicate submissions and late navigation after the screen unmounts",async()=>{
    let resolve:((value:unknown)=>void)|undefined;accountSpy.mockImplementation(()=>new Promise(done=>{resolve=done;}));await render(true);await choose("student");await submit();await submit();expect(accountSpy).toHaveBeenCalledTimes(1);expect(container.querySelector("fieldset")?.disabled).toBe(true);await act(async()=>root.unmount());await act(async()=>resolve!(ok({role:"student"})));expect(navigate).not.toHaveBeenCalled();root=createRoot(container);
  });

  it("shows a failed save and enables a retry without navigating",async()=>{
    accountSpy.mockResolvedValueOnce({ok:false,status:409,json:async()=>({error:{message:"이미 가입한 계정이에요."}})});await render();await choose("teacher");await submit();expect(container.querySelector("[role=alert]")?.textContent).toContain("이미 가입한 계정");expect(container.querySelector("fieldset")?.disabled).toBe(false);expect(navigate).not.toHaveBeenCalled();await submit();expect(accountSpy).toHaveBeenCalledTimes(2);expect(navigate).toHaveBeenCalledWith(destination);
  });
});
