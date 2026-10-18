// @vitest-environment happy-dom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import type {WeatherImageOptions} from "../src/lib/weather-image-export";

const image=vi.hoisted(()=>({create:vi.fn(),copy:vi.fn(),download:vi.fn()}));
vi.mock("../src/lib/weather-image-export",()=>({createWeatherPng:image.create,copyWeatherPng:image.copy,downloadWeatherPng:image.download}));
import {WeatherImageActions} from "../src/components/WeatherImageActions";

let container:HTMLDivElement,root:Root,svg:SVGSVGElement,options:WeatherImageOptions;
const getSvg=vi.fn<()=>SVGSVGElement|null>();
function button(action:"copy"|"save"){return container.querySelector<HTMLButtonElement>(`button[aria-label="백지도 ${action==="copy"?"이미지 복사":"PNG 저장"}"]`)!;}
async function render(props:Partial<Parameters<typeof WeatherImageActions>[0]>={}){await act(async()=>root.render(<WeatherImageActions label="백지도" getSvg={getSvg} options={options} filename="인천-날씨.png" {...props}/>));}
async function click(action:"copy"|"save"){await act(async()=>button(action).click());}
beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);image.create.mockReset().mockResolvedValue(new Blob(["png"],{type:"image/png"}));image.copy.mockReset().mockImplementation(async(create:()=>Promise<Blob>)=>{await create();});image.download.mockReset();
  container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);svg=document.createElementNS("http://www.w3.org/2000/svg","svg");svg.setAttribute("viewBox","0 0 440 640");getSvg.mockReset().mockReturnValue(svg);
  options={title:"인천광역시 날씨",subtitle:"2025년 1월 · 평균 기온",details:["월별"],legend:[{label:"평균 기온",color:"#277d99"}],footnotes:["기상청 자료"]};
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});

describe("weather image export actions",()=>{
  it("keeps feedback when a live map rerenders with equivalent export metadata",async()=>{
    await render();await click("copy");expect(container.querySelector('[role="status"]')?.textContent).toContain("이미지를 복사했어요");
    options={...options,details:[...options.details!],legend:options.legend!.map(item=>({...item})),footnotes:[...options.footnotes!]};await render();
    expect(container.querySelector('[role="status"]')?.textContent).toContain("이미지를 복사했어요");
  });
  it("starts the clipboard helper directly in the click event and snapshots metadata once",async()=>{
    await render();let resolve:((blob:Blob)=>void)|undefined;image.create.mockImplementation(()=>new Promise<Blob>(reply=>{resolve=reply;}));
    await act(async()=>{button("copy").click();expect(image.copy).toHaveBeenCalledTimes(1);expect(image.create).toHaveBeenCalledTimes(1);});
    expect(image.create.mock.calls[0][0]).toBe(svg);expect(image.create.mock.calls[0][1]).toEqual(options);expect(image.create.mock.calls[0][1]).not.toBe(options);
    options.details!.push("나중에 바뀐 설명");options.legend![0].label="다른 항목";expect(image.create.mock.calls[0][1].details).toEqual(["월별"]);expect(image.create.mock.calls[0][1].legend[0].label).toBe("평균 기온");
    const factory=image.copy.mock.calls[0][0] as ()=>Promise<Blob>;factory();expect(image.create).toHaveBeenCalledTimes(1);
    await act(async()=>resolve!(new Blob(["png"],{type:"image/png"})));expect(container.querySelector('[role="status"]')?.textContent).toContain("이미지를 복사했어요");expect(image.download).not.toHaveBeenCalled();
  });
  it("requests a PNG download with the chosen filename after generation",async()=>{
    await render();await click("save");expect(image.create).toHaveBeenCalledTimes(1);expect(image.download).toHaveBeenCalledExactlyOnceWith(expect.any(Blob),"인천-날씨.png");expect(image.copy).not.toHaveBeenCalled();expect(container.querySelector('[role="status"]')?.textContent).toContain("다운로드를 요청했어요");
  });
  it("disables both actions while an image is being made and prevents duplicate work",async()=>{
    await render();let resolve:((blob:Blob)=>void)|undefined;image.create.mockImplementation(()=>new Promise<Blob>(reply=>{resolve=reply;}));
    await click("save");expect(button("copy").disabled).toBe(true);expect(button("save").disabled).toBe(true);expect(container.querySelector('[role="group"]')?.getAttribute("aria-busy")).toBe("true");
    await click("save");await click("copy");expect(image.create).toHaveBeenCalledTimes(1);expect(image.copy).not.toHaveBeenCalled();
    await act(async()=>resolve!(new Blob(["png"],{type:"image/png"})));expect(button("copy").disabled).toBe(false);expect(button("save").disabled).toBe(false);
  });
  it("does not invoke export when disabled",async()=>{await render({disabled:true});await click("copy");await click("save");expect(getSvg).not.toHaveBeenCalled();expect(image.create).not.toHaveBeenCalled();expect(image.copy).not.toHaveBeenCalled();});
  it.each(["copy","save"] as const)("reports a missing target for %s without generating a blank image",async action=>{
    getSvg.mockReturnValue(null);await render();await click(action);expect(container.querySelector('[role="alert"]')?.textContent).toContain("자료를 먼저 불러와 주세요");expect(image.create).not.toHaveBeenCalled();expect(image.copy).not.toHaveBeenCalled();expect(image.download).not.toHaveBeenCalled();
  });
  it("recommends PNG when clipboard access is denied, then allows PNG download",async()=>{
    image.copy.mockRejectedValue(new DOMException("Denied","NotAllowedError"));await render();await click("copy");expect(container.querySelector('[role="alert"]')?.textContent).toContain("PNG 저장");expect(container.querySelector('[role="status"]')).toBeNull();expect(button("save").disabled).toBe(false);
    await click("save");expect(image.download).toHaveBeenCalledOnce();expect(container.querySelector('[role="alert"]')).toBeNull();
  });
  it.each(["copy","save"] as const)("rejects an empty PNG during %s without claiming success",async action=>{
    image.create.mockResolvedValue(new Blob([],{type:"image/png"}));await render();await click(action);expect(container.querySelector('[role="alert"]')).not.toBeNull();expect(container.querySelector('[role="status"]')).toBeNull();expect(image.download).not.toHaveBeenCalled();
  });
  it("reports a generation failure and remains usable",async()=>{image.create.mockRejectedValue(new Error("Canvas failure"));await render();await click("save");expect(container.querySelector('[role="alert"]')?.textContent).toContain("PNG 이미지를 만들지 못했어요");expect(button("save").disabled).toBe(false);expect(image.download).not.toHaveBeenCalled();});
  it("clears feedback on a changed selection and ignores an outdated completion",async()=>{
    await render();await click("copy");expect(container.querySelector('[role="status"]')).not.toBeNull();options={...options,subtitle:"강수량"};await render();expect(container.querySelector('[role="status"]')).toBeNull();
    let resolve:((blob:Blob)=>void)|undefined;image.create.mockImplementation(()=>new Promise<Blob>(reply=>{resolve=reply;}));await click("copy");options={...options,subtitle:"습도"};await render();await act(async()=>resolve!(new Blob(["png"],{type:"image/png"})));expect(container.querySelector('[role="status"],[role="alert"]')).toBeNull();expect(button("save").disabled).toBe(false);
  });
  it("does not start a download after unmount",async()=>{
    let resolve:((blob:Blob)=>void)|undefined;image.create.mockImplementation(()=>new Promise<Blob>(reply=>{resolve=reply;}));await render();await click("save");await act(async()=>root.unmount());await act(async()=>resolve!(new Blob(["png"],{type:"image/png"})));expect(image.download).not.toHaveBeenCalled();root=createRoot(container);
  });
});
