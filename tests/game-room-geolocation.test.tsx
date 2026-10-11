// @vitest-environment happy-dom
import {act,type ReactNode} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {RoomState} from "../src/domain/exploration-game";
import type {LocationFix,PrecisePositionOptions} from "../src/lib/geolocation";

const probes=vi.hoisted(()=>({request:vi.fn(),precise:vi.fn(),session:{kind:"guest",accountRole:null,canCreateMap:false,csrfToken:"test-csrf"}}));
vi.mock("../src/components/games/GameShared",()=>({
  useGameSession:()=>({session:probes.session,ready:true,error:""}),gameRequest:probes.request,
  GameShell:({children}:{children:ReactNode})=><main>{children}</main>,
  GameMessage:({error,notice}:{error?:string;notice?:string})=><>{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}</>,
}));
vi.mock("../src/lib/geolocation",async()=>({...await vi.importActual<typeof import("../src/lib/geolocation")>("../src/lib/geolocation"),acquirePrecisePosition:probes.precise}));
vi.mock("../src/components/KakaoMap",()=>({default:()=> <div aria-label="게임 지도"/>}));
import GameRoom from "../src/components/games/GameRoom";

let root:Root,container:HTMLDivElement,state:RoomState,hidden:boolean,unmounted:boolean;
let watchSuccess:PositionCallback,watchError:PositionErrorCallback,clearWatch:ReturnType<typeof vi.fn>,watch:ReturnType<typeof vi.fn>;
let resolveFix:(fix:LocationFix)=>void;
const base="/api/v1/game-rooms/room-a";
function fixture():RoomState{
  return {room:{id:"room-a",gameId:"game-a",title:"시험 탐험",status:"running",durationMinutes:30,maxPlayers:40,startsAt:new Date().toISOString(),endsAt:new Date(Date.now()+1800000).toISOString(),joinExpiresAt:new Date(Date.now()+1800000).toISOString(),serverNow:new Date().toISOString(),isHost:false},
    missions:[{id:"mission-a",pointId:"point-a",title:"나무 관찰",prompt:"잎을 관찰해요.",kind:"observation",points:100,radiusMeters:50,maxAttempts:3,options:[],checklist:[],location:{lat:37.5,lng:127},emoji:"🌳",pointTitle:"나무"}],
    me:{id:"student-a",nickname:"탐험가",score:0,completed:0,rank:1,sharing:true},players:[],submissions:[],pendingCount:0};
}
function fix(accuracy=7):LocationFix{return {lat:37.5,lng:127,accuracy,observedAt:new Date().toISOString()};}
function raw(timestamp=Date.now(),lat=37.5):GeolocationPosition{return {timestamp,coords:{latitude:lat,longitude:127,accuracy:8,altitude:null,altitudeAccuracy:null,heading:null,speed:null}} as GeolocationPosition;}
function button(name:string){const element=[...container.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.textContent===name);if(!element)throw new Error(`Missing button ${name}`);return element;}
async function click(name:string){await act(async()=>button(name).click());}
async function mount(){await act(async()=>root.render(<GameRoom roomId="room-a"/>));}
const sentLocations=()=>probes.request.mock.calls.filter(([url])=>url.endsWith("/location"));

beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-11T03:00:00Z"));vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  hidden=false;unmounted=false;vi.spyOn(document,"hidden","get").mockImplementation(()=>hidden);vi.spyOn(HTMLElement.prototype,"scrollIntoView").mockImplementation(()=>{});
  state=fixture();probes.request.mockReset().mockImplementation(async(url,csrf,body)=>{
    if(url.endsWith("/submissions"))return {status:"pending",score:0,attempts:1};
    if(body?.action==="stop_sharing"){state={...state,me:{...state.me!,sharing:false}};return {done:true};}
    return url.endsWith("/location")?{shared:true}:state;
  });
  probes.precise.mockReset().mockImplementation(()=>new Promise<LocationFix>(resolve=>{resolveFix=resolve;}));
  clearWatch=vi.fn();watch=vi.fn((success:PositionCallback,error:PositionErrorCallback)=>{watchSuccess=success;watchError=error;return 7;});
  vi.stubGlobal("navigator",{geolocation:{watchPosition:watch,clearWatch,getCurrentPosition:vi.fn()}});
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("{}",{status:200})));
  container=document.createElement("div");document.body.append(container);root=createRoot(container);
});
afterEach(async()=>{if(!unmounted)await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

describe("game-room location quality and measurement lifecycle",()=>{
  it("uses fresh watches, ignores stale and implausible readings, and retains the sensor values",async()=>{
    await mount();expect(watch.mock.calls[0][2]).toMatchObject({enableHighAccuracy:true,maximumAge:0});
    await act(async()=>watchSuccess(raw(Date.now()-30000)));expect(sentLocations()).toHaveLength(0);
    await act(async()=>watchSuccess(raw()));expect(sentLocations()).toHaveLength(1);
    expect(sentLocations()[0][2]).toEqual({location:{lat:37.5,lng:127},accuracy:8,observedAt:new Date().toISOString()});
    expect(container.textContent).toContain("예상 오차 약 8m");
    await act(async()=>{vi.advanceTimersByTime(1000);watchSuccess(raw(Date.now(),38));});
    expect(sentLocations()).toHaveLength(1);expect(container.textContent).toContain("예상 오차 약 8m");
  });

  it("rechecks through the shared sampler, prevents overlap, and shares the unmodified result",async()=>{
    await mount();await click("정밀하게 다시 찾기");
    const options=probes.precise.mock.calls[0][0] as PrecisePositionOptions;expect(options.signal?.aborted).toBe(false);
    await act(async()=>options.onProgress?.({fix:fix(),sampleCount:3,elapsedMs:2000}));
    expect(container.textContent).toContain("3개 측정");expect(button("정밀 위치 확인 중…").disabled).toBe(true);
    await act(async()=>watchSuccess(raw()));expect(sentLocations()).toHaveLength(0);
    const measured=fix(37);await act(async()=>resolveFix(measured));
    expect(sentLocations()).toHaveLength(1);expect(sentLocations()[0][2]).toEqual({location:{lat:measured.lat,lng:measured.lng},accuracy:37,observedAt:measured.observedAt});
    expect(sentLocations()[0][4]).toBe(options.signal);expect(button("정밀하게 다시 찾기").disabled).toBe(false);
  });

  it("aborts hidden measurements and ignores a late successful callback",async()=>{
    await mount();await click("정밀하게 다시 찾기");const options=probes.precise.mock.calls[0][0] as PrecisePositionOptions;
    await act(async()=>{hidden=true;document.dispatchEvent(new Event("visibilitychange"));});expect(options.signal?.aborted).toBe(true);
    await act(async()=>resolveFix(fix()));expect(sentLocations()).toHaveLength(0);expect(clearWatch).toHaveBeenCalledWith(7);
    await act(async()=>watchSuccess(raw()));expect(sentLocations()).toHaveLength(0);
  });

  it("aborts rechecks immediately when sharing is stopped",async()=>{
    await mount();await click("정밀하게 다시 찾기");const options=probes.precise.mock.calls[0][0] as PrecisePositionOptions;
    await click("위치 공유 끄기");expect(options.signal?.aborted).toBe(true);await act(async()=>resolveFix(fix()));
    expect(sentLocations()).toHaveLength(0);expect(container.textContent).toContain("위치 공유가 꺼져 있어요");
  });

  it("does not send a late measurement after unmount or a room change",async()=>{
    await mount();await click("정밀하게 다시 찾기");const options=probes.precise.mock.calls[0][0] as PrecisePositionOptions;
    await act(async()=>root.render(<GameRoom roomId="room-b"/>));expect(options.signal?.aborted).toBe(true);
    await act(async()=>resolveFix(fix()));expect(sentLocations()).toHaveLength(0);
    await click("정밀하게 다시 찾기");const other=probes.precise.mock.calls[1][0] as PrecisePositionOptions;
    await act(async()=>root.unmount());unmounted=true;expect(other.signal?.aborted).toBe(true);
    await act(async()=>resolveFix(fix()));expect(sentLocations()).toHaveLength(0);
  });

  it("checks a fresh sensor position before submitting and never invents its accuracy",async()=>{
    await mount();await act(async()=>watchSuccess(raw()));await click("🌳나무 관찰나무 · 100점 · 0m 떨어짐관찰·서술 응답");
    const textarea=container.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(textarea,"잎을 관찰했어요.");textarea.dispatchEvent(new Event("input",{bubbles:true}));});
    await act(async()=>container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
    expect(probes.precise).toHaveBeenCalledTimes(1);expect(probes.request.mock.calls.some(([url])=>url.endsWith("/submissions"))).toBe(false);
    const measured=fix(19);await act(async()=>resolveFix(measured));
    const calls=probes.request.mock.calls;const submitIndex=calls.findIndex(([url])=>url.endsWith("/submissions"));
    expect(submitIndex).toBeGreaterThan(0);expect(calls[submitIndex-1][0]).toBe(base+"/location");
    expect(calls[submitIndex-1][2].accuracy).toBe(19);expect(calls[submitIndex-1][2].observedAt).toBe(measured.observedAt);
    expect(calls[submitIndex][2]).toMatchObject({missionId:"mission-a",response:{answer:"잎을 관찰했어요."}});
  });

  it("stops the live watch on permission denial without sending more positions",async()=>{
    await mount();await act(async()=>watchError({code:1,message:"denied"} as GeolocationPositionError));expect(clearWatch).toHaveBeenCalledWith(7);
    await act(async()=>watchSuccess(raw()));expect(sentLocations()).toHaveLength(0);expect(container.textContent).toContain("위치 권한이 꺼져 있어요");
  });

  it("finishes an earlier location request before posting the precise location",async()=>{
    let finishLive!:(result:unknown)=>void;
    probes.request.mockImplementationOnce(async()=>state).mockImplementationOnce(()=>new Promise(resolve=>{finishLive=resolve;}));
    await mount();await act(async()=>watchSuccess(raw()));await click("정밀하게 다시 찾기");
    await act(async()=>resolveFix(fix(19)));expect(sentLocations()).toHaveLength(1);
    await act(async()=>finishLive({shared:true}));expect(sentLocations()).toHaveLength(2);
    expect(sentLocations()[1][2].accuracy).toBe(19);
  });

  it("keeps live updates paused until a pending submission finishes",async()=>{
    let finishSubmission!:(result:unknown)=>void;
    const request=probes.request.getMockImplementation()!;
    probes.request.mockImplementation((url,...args)=>url.endsWith("/submissions")?new Promise(resolve=>{finishSubmission=resolve;}):request(url,...args));
    await mount();await act(async()=>watchSuccess(raw()));await click("🌳나무 관찰나무 · 100점 · 0m 떨어짐관찰·서술 응답");
    await act(async()=>container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
    await act(async()=>resolveFix(fix(19)));expect(sentLocations()).toHaveLength(2);
    await act(async()=>{vi.advanceTimersByTime(4000);watchSuccess(raw());});expect(sentLocations()).toHaveLength(2);
    const options=probes.precise.mock.calls[0][0] as PrecisePositionOptions;
    const submission=probes.request.mock.calls.find(([url])=>url.endsWith("/submissions"))!;expect(submission[4]).toBe(options.signal);
    await act(async()=>{hidden=true;document.dispatchEvent(new Event("visibilitychange"));});expect(options.signal?.aborted).toBe(true);
    await act(async()=>finishSubmission({status:"pending",score:0,attempts:1}));
    expect(container.textContent).not.toContain("응답을 제출했어요.");
  });

  it("does not send another watch reading while a stop-sharing request is pending",async()=>{
    let finishStop!:(result:unknown)=>void;
    const request=probes.request.getMockImplementation()!;
    probes.request.mockImplementation((url,csrf,body,...args)=>body?.action==="stop_sharing"?new Promise(resolve=>{finishStop=resolve;}):request(url,csrf,body,...args));
    await mount();await click("위치 공유 끄기");
    await act(async()=>watchSuccess(raw()));expect(sentLocations()).toHaveLength(0);
    expect(container.textContent).toContain("위치 공유가 꺼져 있어요");expect(clearWatch).toHaveBeenCalledWith(7);
    state={...state,me:{...state.me!,sharing:false}};await act(async()=>finishStop({done:true}));
  });

  it("keeps sharing paused after returning to the screen until an explicit successful resume",async()=>{
    await mount();expect(watch).toHaveBeenCalledTimes(1);
    await act(async()=>{hidden=true;document.dispatchEvent(new Event("visibilitychange"));});
    let finishRefresh!:(result:unknown)=>void;
    probes.request.mockImplementationOnce(()=>new Promise(resolve=>{finishRefresh=resolve;}));
    await act(async()=>{hidden=false;document.dispatchEvent(new Event("visibilitychange"));vi.advanceTimersByTime(1000);});
    expect(watch).toHaveBeenCalledTimes(1);await act(async()=>watchSuccess(raw()));expect(sentLocations()).toHaveLength(0);
    await act(async()=>finishRefresh(state));expect(watch).toHaveBeenCalledTimes(1);
    probes.request.mockRejectedValueOnce(new Error("네트워크 오류"));await click("교사에게 위치 공유 시작");expect(watch).toHaveBeenCalledTimes(1);
    await click("교사에게 위치 공유 시작");expect(watch).toHaveBeenCalledTimes(2);
  });

  it("does not revive sharing when a resume request succeeds after the screen was hidden",async()=>{
    await mount();await click("위치 공유 끄기");
    let finishResume!:(result:unknown)=>void;
    probes.request.mockImplementationOnce(()=>new Promise(resolve=>{finishResume=resolve;}));
    await click("교사에게 위치 공유 시작");
    await act(async()=>{hidden=true;document.dispatchEvent(new Event("visibilitychange"));});
    state={...state,me:{...state.me!,sharing:true}};await act(async()=>finishResume({done:true}));
    await act(async()=>{hidden=false;document.dispatchEvent(new Event("visibilitychange"));});
    expect(watch).toHaveBeenCalledTimes(1);expect(container.textContent).toContain("위치 공유가 꺼져 있어요");
    await click("교사에게 위치 공유 시작");expect(watch).toHaveBeenCalledTimes(2);
  });
});
