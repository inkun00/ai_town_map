// @vitest-environment happy-dom
import {act,StrictMode} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {StudentEmailAuth,type StudentEmailAuthProps} from "../src/components/StudentEmailAuth";
import LoginPage from "../src/app/account/login/page";
import RegisterPage from "../src/app/account/register/page";

let container:HTMLDivElement,root:Root,props:StudentEmailAuthProps;
const authSpy=vi.fn(),fetchSpy=vi.fn(),sessionLookup=vi.fn(),navigate=vi.fn();
function ok(data:unknown){return {ok:true,status:200,json:async()=>({data})};}
function field(label:string){const matching=[...container.querySelectorAll<HTMLLabelElement>("label")].find(item=>item.firstChild?.textContent===label);const input=matching?.querySelector<HTMLInputElement>("input");if(!input)throw new Error(`Field missing: ${label}`);return input;}
async function fill(label:string,value:string){const input=field(label);await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});}
async function submit(){await act(async()=>container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));}
function button(label:string){const found=[...container.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.textContent===label);if(!found)throw new Error(`Button missing: ${label}`);return found;}
async function click(label:string){await act(async()=>button(label).click());}
async function render(strict=false){await act(async()=>root.render(strict?<StrictMode><StudentEmailAuth {...props}/></StrictMode>:<StudentEmailAuth {...props}/>));}
async function fillSignup(password="student-password"){await fill("이메일","student@example.com");await fill("비밀번호",password);await fill("비밀번호 확인",password);}

beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);authSpy.mockReset().mockResolvedValue(ok({needsConfirmation:true}));sessionLookup.mockReset().mockResolvedValue(ok(null));fetchSpy.mockReset().mockImplementation((url,init)=>url==="/api/v1/session"?sessionLookup():authSpy(url,init));vi.stubGlobal("fetch",fetchSpy);navigate.mockReset();vi.spyOn(window.location,"assign").mockImplementation(navigate);localStorage.clear();sessionStorage.clear();window.history.replaceState(null,"","/account/register?returnTo=%2F");
  props={mode:"signup",returnTo:"/?map=abc"};container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("student email account screens",()=>{
  it("offers Google and student email choices while preserving encoded signup setup and return routes",async()=>{
    await render();const google=container.querySelector<HTMLAnchorElement>('a[href^="/api/v1/auth/google"]')!;const query=new URL(google.href).searchParams;expect(query.get("returnTo")).toBe("/account/setup?returnTo=%2F%3Fmap%3Dabc");expect(container.textContent).toContain("학생 회원으로 등록돼요");expect(container.querySelectorAll("input[type=password]")).toHaveLength(2);expect(container.querySelectorAll("main")).toHaveLength(1);
    const login=container.querySelector<HTMLAnchorElement>('a[href^="/account/login"]')!;expect(new URL(login.href).searchParams.get("returnTo")).toBe(props.returnTo);expect(authSpy).not.toHaveBeenCalled();
  });

  it("checks email, password length, and repeated password before signup",async()=>{
    await render();await fill("이메일","not-an-email");await submit();expect(container.querySelector("[role=alert]")?.textContent).toContain("이메일 주소");await fill("이메일","student@example.com");await fill("비밀번호","short");await submit();expect(container.querySelector("[role=alert]")?.textContent).toContain("8~128자");await fill("비밀번호","student-password");await fill("비밀번호 확인","different-password");await submit();expect(container.querySelector("[role=alert]")?.textContent).toContain("같지 않아요");expect(authSpy).not.toHaveBeenCalled();
  });

  it("posts credentials only in a JSON body, shows server confirmation guidance, and clears passwords",async()=>{
    authSpy.mockResolvedValue(ok({needsConfirmation:true,message:"확인 메일을 보냈어요. 메일을 확인해 주세요."}));const localWrite=vi.spyOn(localStorage,"setItem"),sessionWrite=vi.spyOn(sessionStorage,"setItem");await render();await fillSignup();await submit();
    const [url,options]=authSpy.mock.calls[0];expect(url).toBe("/api/v1/auth/email");expect(options.method).toBe("POST");expect(options.headers["Content-Type"]).toBe("application/json");expect(JSON.parse(options.body)).toEqual({action:"signup",email:"student@example.com",password:"student-password",returnTo:"/?map=abc"});expect(JSON.parse(options.body)).not.toHaveProperty("repeatPassword");expect(container.querySelector("[role=status]")?.textContent).toContain("확인 메일을 보냈어요");expect(container.querySelector("form")).toBeNull();expect(container.textContent).toContain("student@example.com");expect(localWrite).not.toHaveBeenCalled();expect(sessionWrite).not.toHaveBeenCalled();expect(window.location.href).not.toContain("student-password");expect(navigate).not.toHaveBeenCalled();
    await click("이메일 다시 입력하기");expect(field("비밀번호").value).toBe("");expect(field("비밀번호 확인").value).toBe("");
  });

  it("waits 60 seconds before resend, sends no password, and starts a new cooldown after success",async()=>{
    vi.useFakeTimers();await render();await fillSignup();await submit();let resend=container.querySelector<HTMLButtonElement>(".account-auth__resend")!;expect(resend.disabled).toBe(true);expect(resend.textContent).toContain("60초 후");await act(async()=>vi.advanceTimersByTime(59000));expect(resend.disabled).toBe(true);expect(resend.textContent).toContain("1초 후");await act(async()=>vi.advanceTimersByTime(1000));resend=container.querySelector<HTMLButtonElement>(".account-auth__resend")!;expect(resend.disabled).toBe(false);await click("확인 메일 다시 보내기");expect(authSpy).toHaveBeenCalledTimes(2);expect(JSON.parse(authSpy.mock.calls[1][1].body)).toEqual({action:"resend",email:"student@example.com",returnTo:"/?map=abc"});expect(resend.disabled).toBe(true);expect(resend.textContent).toContain("60초 후");
  });

  it("logs in with the sanitized server-page destination and clears the password before navigating",async()=>{
    props.mode="login";authSpy.mockResolvedValue(ok({needsConfirmation:false,returnTo:"https://unsafe.example/steal"}));await render();await fill("이메일"," student@example.com ");await fill("비밀번호","student-password");await submit();expect(JSON.parse(authSpy.mock.calls[0][1].body)).toEqual({action:"login",email:"student@example.com",password:"student-password",returnTo:"/?map=abc"});expect(navigate).toHaveBeenCalledWith("/?map=abc");expect(field("비밀번호").value).toBe("");expect(container.querySelector("fieldset")?.disabled).toBe(true);await submit();expect(authSpy).toHaveBeenCalledTimes(1);
  });

  it("includes an existing guest session CSRF when switching to a student account",async()=>{
    props.mode="login";sessionLookup.mockResolvedValue(ok({kind:"guest",accountRole:null,canCreateMap:false,csrfToken:"guest-csrf"}));authSpy.mockResolvedValue(ok({needsConfirmation:false,returnTo:"/?map=abc"}));await render();await fill("이메일","student@example.com");await fill("비밀번호","student-password");await submit();expect(fetchSpy.mock.calls[0][0]).toBe("/api/v1/session");expect(authSpy.mock.calls[0][1].headers["X-CSRF-Token"]).toBe("guest-csrf");expect(navigate).toHaveBeenCalledWith("/?map=abc");
  });

  it("blocks email requests until session lookup is ready and reports failed session checks",async()=>{
    let resolve:((value:unknown)=>void)|undefined;sessionLookup.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));await render();expect(container.querySelector("fieldset")?.disabled).toBe(true);expect(container.querySelector("[role=status]")?.textContent).toContain("현재 참여 정보를 확인하고 있어요");await submit();expect(authSpy).not.toHaveBeenCalled();await act(async()=>resolve!(ok(null)));expect(container.querySelector("fieldset")?.disabled).toBe(false);
    await act(async()=>root.unmount());root=createRoot(container);sessionLookup.mockRejectedValueOnce(new Error("session unavailable"));await render();expect(container.querySelector("fieldset")?.disabled).toBe(true);expect(container.querySelector("[role=alert]")?.textContent).toContain("현재 참여 정보를 확인하지 못했어요");await submit();expect(authSpy).not.toHaveBeenCalled();
  });

  it("blocks a malformed existing session without a CSRF token",async()=>{
    sessionLookup.mockResolvedValue(ok({kind:"account",accountRole:"student",canCreateMap:false,csrfToken:null}));await render();expect(container.querySelector("fieldset")?.disabled).toBe(true);expect(container.querySelector("[role=alert]")?.textContent).toContain("페이지를 새로고침");await submit();expect(authSpy).not.toHaveBeenCalled();
  });

  it("shows email-not-confirmed guidance and enables a code-free confirmation resend for that email",async()=>{
    props.mode="login";authSpy.mockResolvedValueOnce({ok:false,status:403,json:async()=>({error:{code:"EMAIL_NOT_CONFIRMED",message:"이메일 인증을 먼저 완료해 주세요."}})});await render();await fill("이메일","student@example.com");await fill("비밀번호","student-password");await submit();expect(container.querySelector("[role=alert]")?.textContent).toContain("이메일 인증");expect(field("비밀번호").value).toBe("");expect(field("이메일").value).toBe("student@example.com");expect(navigate).not.toHaveBeenCalled();await click("확인 메일 다시 보내기");expect(JSON.parse(authSpy.mock.calls[1][1].body)).not.toHaveProperty("password");expect(container.querySelector("[role=status]")?.textContent).toContain("인증 링크");
  });

  it("displays backend Google-only account and network errors without granting login",async()=>{
    props.mode="login";authSpy.mockResolvedValueOnce({ok:false,status:403,json:async()=>({error:{code:"GOOGLE_LOGIN_REQUIRED",message:"이 계정은 Google로 로그인해 주세요."}})});await render();await fill("이메일","teacher@example.com");await fill("비밀번호","student-password");await submit();expect(container.querySelector("[role=alert]")?.textContent).toContain("Google로 로그인");expect(navigate).not.toHaveBeenCalled();expect(container.querySelector("fieldset")?.disabled).toBe(false);authSpy.mockRejectedValueOnce(new Error("연결을 확인해 주세요."));await submit();expect(container.querySelector("[role=alert]")?.textContent).toContain("연결을 확인");expect(navigate).not.toHaveBeenCalled();
  });

  it("prevents duplicate requests and aborts/ignores late results after unmount",async()=>{
    let resolve:((value:unknown)=>void)|undefined;props.mode="login";authSpy.mockImplementation(()=>new Promise(done=>{resolve=done;}));await render(true);await fill("이메일","student@example.com");await fill("비밀번호","student-password");await submit();await submit();expect(authSpy).toHaveBeenCalledTimes(1);const signal=authSpy.mock.calls[0][1].signal as AbortSignal;expect(container.querySelector("fieldset")?.disabled).toBe(true);await act(async()=>root.unmount());expect(signal.aborted).toBe(true);await act(async()=>resolve!(ok({needsConfirmation:false})));expect(navigate).not.toHaveBeenCalled();root=createRoot(container);
  });

  it("shows a fixed confirmed/error notice rather than echoing raw URL error text",async()=>{
    const confirmed=await LoginPage({searchParams:Promise.resolve({returnTo:"/?map=123",confirmed:"1"})});expect(confirmed.props.returnTo).toBe("/?map=123");expect(confirmed.props.confirmed).toBe(true);props=confirmed.props;await render();expect(container.querySelector("[role=status]")?.textContent).toContain("이메일 인증을 마쳤어요");await act(async()=>root.unmount());root=createRoot(container);const failed=await LoginPage({searchParams:Promise.resolve({error:"<script>unsafe-secret</script>"})});props=failed.props;await render();expect(container.querySelector("[role=alert]")?.textContent).toContain("이메일 인증을 완료하지 못했어요");expect(container.textContent).not.toContain("unsafe-secret");
  });

  it("sanitizes absolute, protocol-relative, repeated and backslash destinations in both server pages",async()=>{
    for(const returnTo of ["https://unsafe.example","//unsafe.example","/\\unsafe.example",["/games","https://unsafe.example"]]){
      const login=await LoginPage({searchParams:Promise.resolve({returnTo,error:"<script>unsafe</script>"})});expect(login.props.returnTo).toBe("/");expect(login.props.confirmationError).toBe(true);expect(login.props).not.toHaveProperty("error");const register=await RegisterPage({searchParams:Promise.resolve({returnTo})});expect(register.props.returnTo).toBe("/");expect(register.props.mode).toBe("signup");
    }
  });

  it("recognizes the callback's fixed emailError marker and ignores repeated query markers",async()=>{
    const failed=await LoginPage({searchParams:Promise.resolve({returnTo:"/games",emailError:"1"})});expect(failed.props.confirmationError).toBe(true);expect(failed.props.returnTo).toBe("/games");props=failed.props;await render();expect(container.querySelector("[role=alert]")?.textContent).toContain("이메일 인증을 완료하지 못했어요");const repeated=await LoginPage({searchParams:Promise.resolve({confirmed:["1","1"],emailError:["1","1"]})});expect(repeated.props.confirmed).toBe(false);expect(repeated.props.confirmationError).toBe(false);
  });
});
