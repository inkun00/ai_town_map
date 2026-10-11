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
function rejected(code:string,message:string,status=403){return {ok:false,status,json:async()=>({error:{code,message}})};}
function field(label:string){
  const matching=[...container.querySelectorAll<HTMLLabelElement>("label")].find(item=>item.firstChild?.textContent===label);
  const input=matching?.querySelector<HTMLInputElement>("input");if(!input)throw new Error(`Field missing: ${label}`);return input;
}
async function fill(label:string,value:string){const input=field(label);await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});}
async function submit(){await act(async()=>container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));}
async function click(label:string){const found=[...container.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.textContent===label);if(!found)throw new Error(`Button missing: ${label}`);await act(async()=>found.click());}
async function render(strict=false){await act(async()=>root.render(strict?<StrictMode><StudentEmailAuth {...props}/></StrictMode>:<StudentEmailAuth {...props}/>));}
async function fillCredentials(identifier="explorer01@school.example",password="student-password"){
  await fill(props.method==="email"&&props.mode==="login"?"이메일":"이메일 형식의 아이디",identifier);await fill("비밀번호",password);
  if(props.mode==="signup")await fill("비밀번호 확인",password);
}
async function remount(){await act(async()=>root.unmount());root=createRoot(container);await render();}

beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  authSpy.mockReset().mockResolvedValue(ok({needsConfirmation:false,returnTo:"/?map=abc"}));
  sessionLookup.mockReset().mockResolvedValue(ok(null));
  fetchSpy.mockReset().mockImplementation((url,init)=>url==="/api/v1/session"?sessionLookup():authSpy(url,init));vi.stubGlobal("fetch",fetchSpy);
  navigate.mockReset();vi.spyOn(window.location,"assign").mockImplementation(navigate);
  localStorage.clear();sessionStorage.clear();window.history.replaceState(null,"","/account/register?returnTo=%2F");
  props={mode:"signup",returnTo:"/?map=abc"};container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.useRealTimers();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("student identifier account screens",()=>{
  it("preserves teacher/student Google signup and explains that a real email address is unnecessary",async()=>{
    await render();const google=[...container.querySelectorAll<HTMLAnchorElement>('a[href^="/api/v1/auth/google"]')];
    expect(google).toHaveLength(2);expect(google.map(link=>link.getAttribute("aria-label"))).toEqual(["교사로 Google 회원가입","학생으로 Google 회원가입"]);
    expect(google.map(link=>new URL(link.href).searchParams.get("role"))).toEqual(["teacher","student"]);
    for(const link of google)expect(new URL(link.href).searchParams.get("returnTo")).toBe(props.returnTo);
    expect(container.textContent).toContain("지도 만들기 · 탐험게임 운영");expect(container.textContent).toContain("지도 참여 · 관찰 기록 · 미션 수행");
    expect(container.textContent).toContain("학생 회원으로 등록돼요");expect(container.textContent).toContain("실제 이메일이 없어도 이메일 형식이면 가입할 수 있어요. 확인 메일은 보내지 않아요.");
    expect(container.textContent).toContain("아이디와 비밀번호를 잘 기억해 주세요");expect(container.querySelector(".account-auth__confirmation")).toBeNull();
    const identifier=field("이메일 형식의 아이디");expect(identifier.type).toBe("text");expect(identifier.inputMode).toBe("email");expect(identifier.autocomplete).toBe("username");expect(identifier.placeholder).toContain("explorer01@school.example");
    expect(container.querySelectorAll("input[type=password]")).toHaveLength(2);expect(container.querySelectorAll("main")).toHaveLength(1);expect(authSpy).not.toHaveBeenCalled();
  });

  it("keeps Google login role neutral and offers an explicit legacy-email login link",async()=>{
    props.mode="login";await render();const google=[...container.querySelectorAll<HTMLAnchorElement>('a[href^="/api/v1/auth/google"]')];
    expect(google).toHaveLength(1);expect(google[0].textContent).toBe("Google로 로그인");const query=new URL(google[0].href).searchParams;
    expect(query.get("returnTo")).toBe(props.returnTo);expect(query.has("role")).toBe(false);expect(container.textContent).toContain("교사·학생·일반회원");
    const legacy=container.querySelector<HTMLAnchorElement>(".account-auth__legacy-link")!;expect(legacy.textContent).toBe("이전에 이메일 인증으로 가입했나요?");
    expect(new URL(legacy.href).searchParams.get("method")).toBe("email");expect(new URL(legacy.href).searchParams.get("returnTo")).toBe(props.returnTo);
    expect(container.querySelectorAll("input[type=password]")).toHaveLength(1);expect(field("비밀번호").autocomplete).toBe("current-password");
  });

  it("checks identifier format, password length, and repeated password before signup",async()=>{
    await render();await fill("이메일 형식의 아이디","not-an-email");await submit();expect(container.querySelector("[role=alert]")?.textContent).toContain("아이디를 이메일 형식");
    await fill("이메일 형식의 아이디","explorer01@school.example");await fill("비밀번호","short");await submit();expect(container.querySelector("[role=alert]")?.textContent).toContain("8~128자");
    await fill("비밀번호","student-password");await fill("비밀번호 확인","different-password");await submit();expect(container.querySelector("[role=alert]")?.textContent).toContain("같지 않아요");
    expect(authSpy).not.toHaveBeenCalled();
  });

  it("creates an identifier account immediately through the student endpoint without mail or credential storage",async()=>{
    const localWrite=vi.spyOn(localStorage,"setItem"),sessionWrite=vi.spyOn(sessionStorage,"setItem");
    await render();await fillCredentials(" explorer01@school.example ");await submit();
    const [url,options]=authSpy.mock.calls[0];expect(url).toBe("/api/v1/auth/student");expect(options.method).toBe("POST");expect(options.headers["Content-Type"]).toBe("application/json");
    expect(JSON.parse(options.body)).toEqual({action:"signup",identifier:"explorer01@school.example",password:"student-password",returnTo:"/?map=abc"});
    expect(JSON.parse(options.body)).not.toHaveProperty("email");expect(JSON.parse(options.body)).not.toHaveProperty("repeatPassword");
    expect(navigate).toHaveBeenCalledWith("/?map=abc");expect(field("비밀번호").value).toBe("");expect(field("비밀번호 확인").value).toBe("");
    expect(container.querySelector(".account-auth__confirmation")).toBeNull();expect(localWrite).not.toHaveBeenCalled();expect(sessionWrite).not.toHaveBeenCalled();
    expect(window.location.href).not.toContain("student-password");expect(window.location.href).not.toContain("explorer01");
  });

  it("uses only the student signup endpoint even if the component is given a legacy method prop",async()=>{
    props.method="email";await render();expect(container.textContent).toContain("확인 메일은 보내지 않아요");await fillCredentials();await submit();
    expect(authSpy.mock.calls[0][0]).toBe("/api/v1/auth/student");expect(JSON.parse(authSpy.mock.calls[0][1].body).action).toBe("signup");
  });

  it("logs in through the student endpoint and trusts only the sanitized server-page destination",async()=>{
    props.mode="login";authSpy.mockResolvedValue(ok({needsConfirmation:false,returnTo:"https://unsafe.example/steal"}));await render();await fillCredentials(" explorer01@school.example ");await submit();
    expect(authSpy.mock.calls[0][0]).toBe("/api/v1/auth/student");expect(JSON.parse(authSpy.mock.calls[0][1].body)).toEqual({action:"login",identifier:"explorer01@school.example",password:"student-password",returnTo:"/?map=abc"});
    expect(navigate).toHaveBeenCalledWith("/?map=abc");expect(field("비밀번호").value).toBe("");expect(container.querySelector("fieldset")?.disabled).toBe(true);
    await submit();expect(authSpy).toHaveBeenCalledTimes(1);
  });

  it("includes an existing guest session CSRF when switching to a student identifier account",async()=>{
    props.mode="login";sessionLookup.mockResolvedValue(ok({kind:"guest",accountRole:null,canCreateMap:false,csrfToken:"guest-csrf"}));await render();await fillCredentials();await submit();
    expect(fetchSpy.mock.calls[0][0]).toBe("/api/v1/session");expect(authSpy.mock.calls[0][1].headers["X-CSRF-Token"]).toBe("guest-csrf");expect(navigate).toHaveBeenCalledWith("/?map=abc");
  });

  it("waits for session lookup and reports failed session checks",async()=>{
    let resolve:((value:unknown)=>void)|undefined;sessionLookup.mockImplementationOnce(()=>new Promise(done=>{resolve=done;}));await render();
    expect(container.querySelector("fieldset")?.disabled).toBe(true);expect(container.querySelector("[role=status]")?.textContent).toContain("현재 참여 정보를 확인하고 있어요");await submit();expect(authSpy).not.toHaveBeenCalled();
    await act(async()=>resolve!(ok(null)));expect(container.querySelector("fieldset")?.disabled).toBe(false);
    sessionLookup.mockRejectedValueOnce(new Error("session unavailable"));await remount();expect(container.querySelector("fieldset")?.disabled).toBe(true);
    expect(container.querySelector("[role=alert]")?.textContent).toContain("현재 참여 정보를 확인하지 못했어요");await submit();expect(authSpy).not.toHaveBeenCalled();
  });

  it("blocks a malformed existing session without a CSRF token",async()=>{
    sessionLookup.mockResolvedValue(ok({kind:"account",accountRole:"student",canCreateMap:false,csrfToken:null}));await render();expect(container.querySelector("fieldset")?.disabled).toBe(true);
    expect(container.querySelector("[role=alert]")?.textContent).toContain("페이지를 새로고침");await submit();expect(authSpy).not.toHaveBeenCalled();
  });

  it("reports duplicate identifiers without navigating or offering mail verification",async()=>{
    authSpy.mockResolvedValue(rejected("IDENTIFIER_UNAVAILABLE","이미 사용 중인 아이디예요. 다른 아이디를 입력해 주세요.",409));await render();await fillCredentials();await submit();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("다른 아이디");expect(navigate).not.toHaveBeenCalled();expect(container.querySelector("fieldset")?.disabled).toBe(false);
    expect(container.querySelector(".account-auth__resend")).toBeNull();
  });

  it("does not interpret an unexpected confirmation response as a successful identifier signup",async()=>{
    authSpy.mockResolvedValue(ok({needsConfirmation:true}));await render();await fillCredentials();await submit();expect(navigate).not.toHaveBeenCalled();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("완료하지 못했어요");expect(container.querySelector(".account-auth__confirmation")).toBeNull();expect(field("비밀번호").value).toBe("");
  });

  it("shows identifier login and network errors without granting login",async()=>{
    props.mode="login";authSpy.mockResolvedValueOnce(rejected("INVALID_CREDENTIALS","아이디 또는 비밀번호를 확인해 주세요."));await render();await fillCredentials();await submit();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("아이디 또는 비밀번호");expect(navigate).not.toHaveBeenCalled();expect(container.querySelector("fieldset")?.disabled).toBe(false);
    authSpy.mockRejectedValueOnce(new Error("연결을 확인해 주세요."));await submit();expect(container.querySelector("[role=alert]")?.textContent).toContain("연결을 확인");expect(navigate).not.toHaveBeenCalled();
  });

  it("prevents duplicate requests and aborts late results after unmount",async()=>{
    let resolve:((value:unknown)=>void)|undefined;props.mode="login";authSpy.mockImplementation(()=>new Promise(done=>{resolve=done;}));await render(true);await fillCredentials();await submit();await submit();
    expect(authSpy).toHaveBeenCalledTimes(1);const signal=authSpy.mock.calls[0][1].signal as AbortSignal;expect(container.querySelector("fieldset")?.disabled).toBe(true);
    await act(async()=>root.unmount());expect(signal.aborted).toBe(true);await act(async()=>resolve!(ok({needsConfirmation:false})));expect(navigate).not.toHaveBeenCalled();root=createRoot(container);
  });

  it("defaults login to identifiers but recognizes legacy mode only from an explicit scalar marker",async()=>{
    const initial=await LoginPage({searchParams:Promise.resolve({returnTo:"/games"})});expect(initial.props.method).toBe("student");expect(initial.props.returnTo).toBe("/games");
    const legacy=await LoginPage({searchParams:Promise.resolve({method:"email",returnTo:"/?map=abc"})});expect(legacy.props.method).toBe("email");expect(legacy.props.returnTo).toBe("/?map=abc");
    const repeated=await LoginPage({searchParams:Promise.resolve({method:["email","email"],confirmed:["1","1"],emailError:["1","1"]})});expect(repeated.props.method).toBe("student");expect(repeated.props.confirmed).toBe(false);expect(repeated.props.confirmationError).toBe(false);
  });

  it("routes confirmed/error callbacks to legacy login and never echoes raw error text",async()=>{
    const confirmed=await LoginPage({searchParams:Promise.resolve({returnTo:"/?map=123",confirmed:"1"})});expect(confirmed.props.method).toBe("email");expect(confirmed.props.confirmed).toBe(true);props=confirmed.props;await render();
    expect(container.querySelector("[role=status]")?.textContent).toContain("이메일 인증을 마쳤어요");expect(container.textContent).not.toContain("확인 메일은 보내지 않아요");
    const failed=await LoginPage({searchParams:Promise.resolve({error:"<script>unsafe-secret</script>"})});expect(failed.props.method).toBe("email");props=failed.props;await remount();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("이메일 인증을 완료하지 못했어요");expect(container.textContent).not.toContain("unsafe-secret");
    const emailError=await LoginPage({searchParams:Promise.resolve({returnTo:"/games",emailError:"1"})});expect(emailError.props.method).toBe("email");expect(emailError.props.confirmationError).toBe(true);
  });

  it("sanitizes unsafe and repeated destinations for both server pages",async()=>{
    for(const returnTo of ["https://unsafe.example","//unsafe.example","/\\unsafe.example",["/games","https://unsafe.example"]]){
      const login=await LoginPage({searchParams:Promise.resolve({returnTo,error:"<script>unsafe</script>"})});expect(login.props.returnTo).toBe("/");expect(login.props.confirmationError).toBe(true);expect(login.props).not.toHaveProperty("error");
      const register=await RegisterPage({searchParams:Promise.resolve({returnTo})});expect(register.props.returnTo).toBe("/");expect(register.props.mode).toBe("signup");
    }
  });
});

describe("existing verified-email login",()=>{
  beforeEach(()=>{props.mode="login";props.method="email";});

  it("uses only the legacy email endpoint and preserves access for verified student accounts",async()=>{
    await render();await fillCredentials("student@example.com");await submit();expect(authSpy.mock.calls[0][0]).toBe("/api/v1/auth/email");
    expect(JSON.parse(authSpy.mock.calls[0][1].body)).toEqual({action:"login",email:"student@example.com",password:"student-password",returnTo:"/?map=abc"});
    expect(navigate).toHaveBeenCalledWith("/?map=abc");expect(field("비밀번호").value).toBe("");
    const identifierLink=container.querySelector<HTMLAnchorElement>(".account-auth__legacy-link")!;expect(identifierLink.textContent).toBe("학생 아이디로 로그인하기");expect(new URL(identifierLink.href).searchParams.has("method")).toBe(false);
  });

  it("retains code-free confirmation resend only for existing unconfirmed email accounts",async()=>{
    authSpy.mockResolvedValueOnce(rejected("EMAIL_NOT_CONFIRMED","이메일 인증을 먼저 완료해 주세요."));await render();await fillCredentials("student@example.com");await submit();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("이메일 인증");expect(field("비밀번호").value).toBe("");expect(field("이메일").value).toBe("student@example.com");expect(navigate).not.toHaveBeenCalled();
    authSpy.mockResolvedValueOnce(ok({needsConfirmation:true,message:"확인 메일을 요청했어요. 이메일에서 인증 링크를 눌러 주세요."}));await click("확인 메일 다시 보내기");
    expect(authSpy.mock.calls[1][0]).toBe("/api/v1/auth/email");expect(JSON.parse(authSpy.mock.calls[1][1].body)).toEqual({action:"resend",email:"student@example.com",returnTo:"/?map=abc"});
    expect(container.querySelector("[role=status]")?.textContent).toContain("인증 링크");
  });

  it("waits 60 seconds between legacy confirmation resends and resets the cooldown after success",async()=>{
    vi.useFakeTimers();props.confirmationError=true;authSpy.mockResolvedValue(ok({needsConfirmation:true}));await render();await fill("이메일","student@example.com");await click("확인 메일 다시 보내기");
    const resend=container.querySelector<HTMLButtonElement>(".account-auth__resend")!;expect(resend.disabled).toBe(true);expect(resend.textContent).toContain("60초 후");
    await act(async()=>vi.advanceTimersByTime(59000));expect(resend.disabled).toBe(true);expect(resend.textContent).toContain("1초 후");
    await act(async()=>vi.advanceTimersByTime(1000));expect(resend.disabled).toBe(false);await click("확인 메일 다시 보내기");expect(authSpy).toHaveBeenCalledTimes(2);expect(resend.disabled).toBe(true);expect(resend.textContent).toContain("60초 후");
  });

  it("keeps teacher/member Google-only errors on the legacy email route",async()=>{
    authSpy.mockResolvedValueOnce(rejected("GOOGLE_LOGIN_REQUIRED","이 계정은 Google로 로그인해 주세요."));await render();await fillCredentials("teacher@example.com");await submit();
    expect(container.querySelector("[role=alert]")?.textContent).toContain("Google로 로그인");expect(navigate).not.toHaveBeenCalled();expect(container.querySelector("fieldset")?.disabled).toBe(false);
  });
});
