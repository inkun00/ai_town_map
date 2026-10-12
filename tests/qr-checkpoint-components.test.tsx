// @vitest-environment happy-dom
import {act,StrictMode} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";

const probes=vi.hoisted(()=>({
  scanners:[] as Array<{decode:(result:{data:string})=>void;start:ReturnType<typeof vi.fn>;stop:ReturnType<typeof vi.fn>;destroy:ReturnType<typeof vi.fn>}>,
  trackStop:vi.fn(),scanImage:vi.fn(),request:vi.fn(),svg:vi.fn(),
}));
vi.mock("qr-scanner",()=>({default:class{
  static scanImage=probes.scanImage;
  constructor(video:HTMLVideoElement,decode:(result:{data:string})=>void){
    const scanner={decode,start:vi.fn(async()=>{Object.defineProperty(video,"srcObject",{configurable:true,writable:true,value:{getTracks:()=>[{stop:probes.trackStop}]}});}),stop:vi.fn(),destroy:vi.fn()};
    probes.scanners.push(scanner);return scanner;
  }
}}));
vi.mock("qrcode",()=>({default:{toString:probes.svg}}));
vi.mock("../src/components/games/GameShared",()=>({gameRequest:probes.request}));
import {QrCheckpointScanner} from "../src/components/games/QrCheckpointScanner";
import {QrCheckpointCards} from "../src/components/games/QrCheckpointCards";

const token=`town-map-checkpoint.v1.eyJnYW1lIjoidGVzdCJ9.${"A".repeat(43)}`;
let root:Root,container:HTMLDivElement,hidden:boolean;
function button(name:string){const result=[...document.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.textContent===name);if(!result)throw new Error(`Missing button ${name}`);return result;}
async function click(name:string){await act(async()=>button(name).click());}
async function change(element:HTMLTextAreaElement,value:string){await act(async()=>{Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,"value")!.set!.call(element,value);element.dispatchEvent(new Event("input",{bubbles:true}));});}

beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);hidden=false;
  vi.spyOn(document,"hidden","get").mockImplementation(()=>hidden);
  vi.stubGlobal("navigator",{mediaDevices:{getUserMedia:vi.fn()}});
  probes.scanners.length=0;probes.trackStop.mockReset();probes.scanImage.mockReset();probes.request.mockReset();probes.svg.mockReset();
  probes.svg.mockResolvedValue('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><path d="M0 0h1v1z"/></svg>');
  container=document.createElement("div");document.body.append(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("QR checkpoint scanner",()=>{
  it("serializes camera detections, ignores duplicates and closes only after confirmation",async()=>{
    let finish!:()=>void;const onScan=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;})),onClose=vi.fn();
    await act(async()=>root.render(<QrCheckpointScanner onScan={onScan} onClose={onClose}/>));
    expect(probes.scanners).toHaveLength(1);
    await act(async()=>{probes.scanners[0].decode({data:token});probes.scanners[0].decode({data:token});});
    expect(onScan).toHaveBeenCalledTimes(1);expect(onScan).toHaveBeenCalledWith(token);expect(onClose).not.toHaveBeenCalled();
    expect(probes.trackStop).toHaveBeenCalled();expect(button("QR 확인하기").disabled).toBe(true);
    await act(async()=>finish());expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("rejects foreign URLs and lets the student retry the same rejected checkpoint",async()=>{
    const onScan=vi.fn().mockRejectedValueOnce(new Error("다른 게임의 QR이에요.")).mockResolvedValueOnce(undefined),onClose=vi.fn();
    await act(async()=>root.render(<QrCheckpointScanner onScan={onScan} onClose={onClose}/>));
    await act(async()=>probes.scanners[0].decode({data:"https://example.com/games/checkpoint#code="+token}));
    expect(onScan).not.toHaveBeenCalled();expect(document.body.textContent).toContain("이 게임의 보물찾기 QR이 아니에요");
    await click("다시 스캔하기");await act(async()=>probes.scanners[0].decode({data:token}));
    expect(document.body.textContent).toContain("다른 게임의 QR이에요.");expect(onClose).not.toHaveBeenCalled();
    await click("다시 스캔하기");await act(async()=>probes.scanners[0].decode({data:token}));
    expect(onScan).toHaveBeenCalledTimes(2);expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("turns off camera tracks when hidden, does not restart automatically, and tears down on close",async()=>{
    const onClose=vi.fn();await act(async()=>root.render(<QrCheckpointScanner onScan={vi.fn()} onClose={onClose}/>));
    const scanner=probes.scanners[0];expect(scanner.start).toHaveBeenCalledTimes(1);
    await act(async()=>{hidden=true;document.dispatchEvent(new Event("visibilitychange"));});
    expect(probes.trackStop).toHaveBeenCalled();expect(scanner.stop).toHaveBeenCalled();
    await act(async()=>{hidden=false;document.dispatchEvent(new Event("visibilitychange"));});expect(scanner.start).toHaveBeenCalledTimes(1);
    await click("다시 스캔하기");expect(scanner.start).toHaveBeenCalledTimes(2);
    await act(async()=>document.querySelector<HTMLButtonElement>('[aria-label="QR 스캔 닫기"]')!.click());
    expect(onClose).toHaveBeenCalledTimes(1);expect(probes.trackStop.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("scans uploaded photos locally and supports manual input with camera permission unavailable",async()=>{
    vi.stubGlobal("navigator",{});const onScan=vi.fn().mockResolvedValue(undefined);
    await act(async()=>root.render(<QrCheckpointScanner onScan={onScan} onClose={vi.fn()}/>));
    expect(document.body.textContent).toContain("카메라를 열지 못했어요");
    const manual=document.querySelector<HTMLTextAreaElement>("textarea")!;await change(manual,token);
    await act(async()=>document.querySelector("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true})));
    expect(onScan).toHaveBeenCalledWith(token);
    onScan.mockClear();probes.scanImage.mockResolvedValue({data:token,cornerPoints:[]});
    const input=document.querySelector<HTMLInputElement>('input[type="file"]')!,file=new File(["qr"],"checkpoint.png",{type:"image/png"});
    Object.defineProperty(input,"files",{configurable:true,value:[file]});
    await act(async()=>input.dispatchEvent(new Event("change",{bubbles:true})));
    expect(probes.scanImage).toHaveBeenCalledWith(file,{returnDetailedScanResult:true});expect(onScan).toHaveBeenCalledWith(token);
  });

  it("starts in StrictMode even when the first effect is cleaned up during the dynamic import",async()=>{
    await act(async()=>root.render(<StrictMode><QrCheckpointScanner onScan={vi.fn()} onClose={vi.fn()}/></StrictMode>));
    await act(async()=>new Promise(resolve=>setTimeout(resolve,0)));
    expect(probes.scanners).toHaveLength(1);expect(probes.scanners[0].start).toHaveBeenCalledTimes(1);
    expect(document.body.textContent).toContain("QR을 찾으면 자동으로 확인해요.");
  });

  it("does not close another screen after a pending scan resolves following unmount",async()=>{
    let finish!:()=>void;const onClose=vi.fn(),onScan=vi.fn(()=>new Promise<void>(resolve=>{finish=resolve;}));
    await act(async()=>root.render(<QrCheckpointScanner onScan={onScan} onClose={onClose}/>));
    await act(async()=>probes.scanners[0].decode({data:token}));
    await act(async()=>root.render(<p>게임 화면</p>));
    expect(probes.scanners[0].destroy).toHaveBeenCalledTimes(1);
    await act(async()=>finish());expect(onClose).not.toHaveBeenCalled();
  });
});

describe("QR checkpoint cards",()=>{
  it("fetches teacher cards, encodes fragment links locally, and prints only the cards",async()=>{
    probes.request.mockResolvedValue({items:[{pointId:"p1",title:"도서관 <입구>",emoji:"📚",code:token}]});
    Object.defineProperty(window,"print",{configurable:true,writable:true,value:vi.fn()});
    await act(async()=>root.render(<QrCheckpointCards gameId="game-one" csrfToken="csrf"/>));
    expect(probes.request).toHaveBeenCalledWith("/api/v1/games/game-one/checkpoints","csrf",undefined,"POST",expect.any(AbortSignal));
    const value=probes.svg.mock.calls[0][0] as string,url=new URL(value);
    expect(url.pathname).toBe("/games/checkpoint");expect(url.search).toBe("");expect(new URLSearchParams(url.hash.slice(1)).get("code")).toBe(token);
    expect(container.querySelector("img")?.getAttribute("src")).toMatch(/^data:image\/svg\+xml/);
    expect(container.textContent).toContain("도서관 <입구>");expect(container.querySelector("입구")).toBeNull();
    await click("🖨️ QR 인쇄");expect(document.body.classList.contains("qr-checkpoint-printing")).toBe(true);
    expect(document.body.querySelector(":scope > .qr-checkpoint-print-root")).not.toBeNull();
    await click("닫기");expect(document.body.classList.contains("qr-checkpoint-printing")).toBe(false);
  });

  it("prints the active room's frozen checkpoints instead of changed game editor missions",async()=>{
    probes.request.mockResolvedValue({items:[]});
    await act(async()=>root.render(<QrCheckpointCards gameId="game-one" roomId="room-one"/>));
    expect(probes.request.mock.calls[0][0]).toBe("/api/v1/game-rooms/room-one/checkpoints");
    expect(button("🖨️ QR 인쇄").disabled).toBe(true);
  });
});
