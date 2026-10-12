// @vitest-environment happy-dom
import {act,StrictMode,type ReactNode} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {rememberGameRoom,takePendingCheckpoint} from "../src/lib/game-checkpoint";

const probes=vi.hoisted(()=>({request:vi.fn()}));
vi.mock("../src/components/games/GameShared",()=>({
  gameRequest:probes.request,useGameSession:()=>({session:null,ready:true,error:""}),
  GameShell:({children}:{children:ReactNode})=><main>{children}</main>,
  GameMessage:({error}:{error?:string})=>error?<p role="alert">{error}</p>:null,
}));
vi.mock("../src/components/games/GameJoinForm",()=>({GameJoinForm:()=> <form aria-label="게임방 입장"/>}));
import GameCheckpointLanding from "../src/components/games/GameCheckpointLanding";

const code=`town-map-checkpoint.v1.eyJnYW1lSWQiOiJ0ZXN0In0.${"a".repeat(43)}`;
const roomId="c19a64ae-3b6d-4ca2-b78b-5e4d1c356639";
let root:Root,container:HTMLDivElement;
beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);window.localStorage.clear();
  window.history.replaceState(null,"",`/games/checkpoint#code=${code}`);
  probes.request.mockReset();vi.spyOn(window.location,"replace").mockImplementation(()=>{});
  container=document.createElement("div");document.body.append(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function mount(){await act(async()=>root.render(<StrictMode><GameCheckpointLanding/></StrictMode>));}

describe("external camera QR landing",()=>{
  it("preserves the QR through StrictMode, removes it from the address and asks for room membership",async()=>{
    await mount();expect(window.location.hash).toBe("");expect(takePendingCheckpoint()).toBe(code);
    expect(container.querySelector('form[aria-label="게임방 입장"]')).not.toBeNull();
    expect(container.querySelector('[role="alert"]')).toBeNull();expect(probes.request).not.toHaveBeenCalled();
  });
  it("continues a remembered active room only after the server confirms student membership",async()=>{
    rememberGameRoom(roomId);probes.request.mockResolvedValue({me:{id:"student"},room:{status:"running"}});
    await mount();expect(probes.request).toHaveBeenCalledWith(`/api/v1/game-rooms/${roomId}`);
    expect(window.location.replace).toHaveBeenCalledWith(`/games/rooms/${roomId}`);expect(takePendingCheckpoint()).toBe(code);
  });
  it.each([
    {me:null,room:{status:"running"}},
    {me:{id:"student"},room:{status:"ended"}},
  ])("does not reopen a host or ended room",async(state)=>{
    rememberGameRoom(roomId);probes.request.mockResolvedValue(state);await mount();
    expect(window.location.replace).not.toHaveBeenCalled();expect(container.querySelector("form")).not.toBeNull();
  });
  it("keeps a scan for joining again when the former session has expired",async()=>{
    rememberGameRoom(roomId);probes.request.mockRejectedValue(new Error("Session expired"));await mount();
    expect(window.location.replace).not.toHaveBeenCalled();expect(takePendingCheckpoint()).toBe(code);expect(container.querySelector("form")).not.toBeNull();
  });
  it("rejects a malformed scan and does not use a remembered room",async()=>{
    rememberGameRoom(roomId);window.history.replaceState(null,"","/games/checkpoint#code=not-a-checkpoint");await mount();
    expect(probes.request).not.toHaveBeenCalled();expect(takePendingCheckpoint()).toBeNull();expect(container.querySelector('[role="alert"]')?.textContent).toContain("보물 QR이 아니에요");
  });
});
