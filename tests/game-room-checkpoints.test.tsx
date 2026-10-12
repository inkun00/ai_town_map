// @vitest-environment happy-dom
import {act,type ReactNode} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {GameMission,GameSubmission,RoomState} from "../src/domain/exploration-game";

const probes=vi.hoisted(()=>({request:vi.fn(),precise:vi.fn(),remember:vi.fn(),pending:vi.fn(),scan:null as null|((code:string)=>Promise<void>),session:{kind:"guest",accountRole:null,canCreateMap:false,csrfToken:"test-csrf"}}));
vi.mock("../src/components/games/GameShared",()=>({
  useGameSession:()=>({session:probes.session,ready:true,error:""}),gameRequest:probes.request,
  GameShell:({children}:{children:ReactNode})=><main>{children}</main>,
  GameMessage:({error,notice}:{error?:string;notice?:string})=><>{error&&<p role="alert">{error}</p>}{notice&&<p role="status">{notice}</p>}</>,
}));
vi.mock("../src/lib/geolocation",async()=>({...await vi.importActual<typeof import("../src/lib/geolocation")>("../src/lib/geolocation"),acquirePrecisePosition:probes.precise}));
vi.mock("../src/lib/game-checkpoint",()=>({rememberGameRoom:probes.remember,takePendingCheckpoint:probes.pending}));
vi.mock("../src/components/KakaoMap",()=>({default:()=> <div aria-label="게임 지도"/>}));
vi.mock("../src/components/games/QrCheckpointCards",()=>({QrCheckpointCards:()=>null}));
vi.mock("../src/components/games/QrCheckpointScanner",()=>({QrCheckpointScanner:({onScan,onClose}:{onScan:(code:string)=>Promise<void>;onClose:()=>void})=>{probes.scan=onScan;return <div role="dialog" aria-label="QR 스캐너"><button onClick={onClose}>스캐너 닫기</button></div>;}}));
import GameRoom from "../src/components/games/GameRoom";

let root:Root,container:HTMLDivElement,state:RoomState,hidden:boolean;
const base="/api/v1/game-rooms/room-a";
const mission=(overrides:Partial<GameMission>={}):GameMission=>({id:"mission-a",pointId:"point-a",title:"나무 보물 찾기",prompt:"나무의 QR을 찾아요.",kind:"qr",arrivalMode:"qr",points:100,radiusMeters:50,maxAttempts:3,options:[],checklist:[],location:{lat:37.5,lng:127},emoji:"🌳",pointTitle:"나무",...overrides});
function fixture():RoomState{return {room:{id:"room-a",gameId:"game-a",title:"QR 탐험",status:"running",durationMinutes:30,maxPlayers:40,startsAt:new Date().toISOString(),endsAt:new Date(Date.now()+1800000).toISOString(),joinExpiresAt:new Date(Date.now()+1800000).toISOString(),serverNow:new Date().toISOString(),isHost:false},missions:[mission()],me:{id:"student-a",nickname:"탐험가",score:0,completed:0,rank:1,sharing:false},players:[],submissions:[],pendingCount:0};}
function button(name:string){const element=[...container.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.textContent===name);if(!element)throw new Error(`Missing button ${name}`);return element;}
async function mount(){await act(async()=>root.render(<GameRoom roomId="room-a"/>));}
async function select(title=state.missions[0].title){await act(async()=>[...container.querySelectorAll<HTMLButtonElement>(".game-mission-buttons button")].find(item=>item.textContent?.includes(title))!.click());}
async function scan(code="valid-code"){await act(async()=>button("📷 QR 카드 스캔하기").click());await act(async()=>probes.scan!(code));}
async function submit(){await act(async()=>container.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));}
const submissions=()=>probes.request.mock.calls.filter(([url])=>url.endsWith("/submissions"));

beforeEach(()=>{
  vi.useFakeTimers();vi.setSystemTime(new Date("2026-10-13T03:00:00Z"));vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  hidden=false;vi.spyOn(document,"hidden","get").mockImplementation(()=>hidden);vi.spyOn(HTMLElement.prototype,"scrollIntoView").mockImplementation(()=>{});
  state=fixture();probes.scan=null;probes.precise.mockReset();probes.remember.mockReset();probes.pending.mockReset().mockReturnValue(null);
  probes.request.mockReset().mockImplementation(async(url,csrf,body)=>{
    if(url.endsWith("/checkpoints"))return {pointId:"point-a",missionIds:state.missions.map(m=>m.id),proof:"signed-student-room-proof"};
    if(url.endsWith("/submissions")){const result:GameSubmission={id:"submission-a",missionId:body.missionId,playerId:"student-a",status:"approved",score:100,attempts:1,response:body.response,reason:null,version:"v1",submittedAt:new Date().toISOString()};state={...state,me:{...state.me!,score:100,completed:1},submissions:[result]};return result;}
    return state;
  });
  vi.stubGlobal("navigator",{geolocation:{watchPosition:vi.fn(),clearWatch:vi.fn(),getCurrentPosition:vi.fn()}});
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(new Response("{}",{status:200})));
  container=document.createElement("div");document.body.append(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

describe("game-room QR missions",()=>{
  it("unlocks without GPS or sharing, and awards points only after server submission",async()=>{
    await mount();await select();expect(button("💎 보물 획득").disabled).toBe(true);expect(container.textContent).toContain("🔒 QR 스캔 필요");
    await scan();expect(button("💎 보물 획득").disabled).toBe(false);expect(container.textContent).toContain("🔓 미션 열림");expect(container.textContent).toContain("0점");expect(submissions()).toHaveLength(0);
    await submit();expect(probes.precise).not.toHaveBeenCalled();expect(probes.request.mock.calls.some(([url])=>url.endsWith("/location"))).toBe(false);
    expect(submissions()[0][2]).toMatchObject({missionId:"mission-a",response:{checkpointProof:"signed-student-room-proof"}});expect(container.textContent).toContain("미션 완료! 100점을 획득했어요");
  });

  it("keeps a wrong checkpoint locked and permits a later valid scan",async()=>{
    const request=probes.request.getMockImplementation()!;probes.request.mockImplementation((url,csrf,body,...rest)=>url.endsWith("/checkpoints")&&body.code==="wrong-code"?Promise.reject(new Error("다른 게임의 QR 카드예요.")):request(url,csrf,body,...rest));
    await mount();await select();await act(async()=>button("📷 QR 카드 스캔하기").click());
    await act(async()=>{await expect(probes.scan!("wrong-code")).rejects.toThrow("다른 게임");});
    expect(button("💎 보물 획득").disabled).toBe(true);expect(submissions()).toHaveLength(0);
    await act(async()=>probes.scan!("valid-code"));expect(button("💎 보물 획득").disabled).toBe(false);
  });

  it("opens the first unfinished QR mission and shares a point proof with other missions there",async()=>{
    state.missions=[mission(),mission({id:"mission-b",title:"나무 관찰",kind:"observation"})];state.submissions=[{id:"done-a",playerId:"student-a",missionId:"mission-a",status:"approved",attempts:1,score:100,response:{},reason:null,version:"v1",submittedAt:new Date().toISOString()}];
    await mount();await scan();expect(container.querySelector("#student-mission h2")?.textContent).toBe("나무 관찰");expect(container.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(false);
    expect(container.querySelectorAll(".game-checkpoint-badge--open")).toHaveLength(2);
  });

  it("retains the written response through a hidden screen, sharing pause, and another QR scan",async()=>{
    state.missions=[mission({kind:"observation",title:"나무 관찰"})];await mount();await scan();
    const textarea=container.querySelector<HTMLTextAreaElement>("textarea")!;
    await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(textarea,"잎 모양을 관찰했어요.");textarea.dispatchEvent(new Event("input",{bubbles:true}));});
    await act(async()=>{hidden=true;document.dispatchEvent(new Event("visibilitychange"));});await act(async()=>{hidden=false;document.dispatchEvent(new Event("visibilitychange"));});
    await scan();expect(container.querySelector<HTMLTextAreaElement>("textarea")?.value).toBe("잎 모양을 관찰했어요.");await submit();
    expect(probes.precise).not.toHaveBeenCalled();expect(submissions()[0][2].response).toEqual({answer:"잎 모양을 관찰했어요.",checkpointProof:"signed-student-room-proof"});
  });

  it("waits for game start before consuming a checkpoint opened with the phone camera",async()=>{
    state.room.status="lobby";probes.pending.mockReturnValue("pending-code");await mount();expect(probes.pending).not.toHaveBeenCalled();
    expect(button("📷 QR 카드 스캔하기").disabled).toBe(true);state.room.status="running";await act(async()=>vi.advanceTimersByTime(5000));
    expect(probes.request.mock.calls.find(([url])=>url===base+"/checkpoints")?.[2]).toEqual({code:"pending-code"});expect(container.textContent).toContain("미션을 열었어요");
  });
});
