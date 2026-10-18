// @vitest-environment happy-dom
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {copyWeatherPng,createWeatherPng,downloadWeatherPng,weatherImageFilename} from "../src/lib/weather-image-export";

const imageBlobs:Blob[]=[],canvasSizes:{width:number;height:number;type:string}[]=[];
const context={font:"",fillStyle:"",textBaseline:"",measureText:vi.fn((text:string)=>({width:Array.from(text).length*10})),scale:vi.fn(),fillRect:vi.fn(),drawImage:vi.fn(),fillText:vi.fn()};
let failImage=false,failCanvas=false,emptyPng=false;
class TestImage{
  onload:(()=>void)|null=null;onerror:(()=>void)|null=null;
  set src(value:string){if(value)queueMicrotask(()=>failImage?this.onerror?.():this.onload?.());}
}
function svg(width=390,height=640){
  const node=document.createElementNS("http://www.w3.org/2000/svg","svg");node.setAttribute("viewBox",`0 0 ${width} ${height}`);
  node.innerHTML='<g transform="translate(20 30) scale(1.4)"><path d="M0,0 L100,0 L100,100 Z" fill="#c9e6dd"/><text x="25" y="50" style="font-size:11px;fill:#173e51;stroke:white;stroke-width:3;paint-order:stroke fill;font-family:Malgun Gothic">연수구<tspan x="25" y="64"> 13.9°C</tspan></text><polyline points="0,0 20,40 40,20" fill="none" stroke="#156f94" stroke-width="2.5"/></g>';
  document.body.appendChild(node);return node;
}
beforeEach(()=>{
  imageBlobs.length=0;canvasSizes.length=0;failImage=false;failCanvas=false;emptyPng=false;
  context.measureText.mockClear();context.scale.mockClear();context.fillRect.mockClear();context.drawImage.mockClear();context.fillText.mockClear();
  vi.stubGlobal("Image",TestImage);
  vi.spyOn(URL,"createObjectURL").mockImplementation(blob=>{imageBlobs.push(blob as Blob);return `blob:weather-${imageBlobs.length}`;});
  vi.spyOn(URL,"revokeObjectURL").mockImplementation(()=>{});
  vi.spyOn(HTMLCanvasElement.prototype,"getContext").mockImplementation(()=>failCanvas?null:context as unknown as CanvasRenderingContext2D);
  vi.spyOn(HTMLCanvasElement.prototype,"toBlob").mockImplementation(function(this:HTMLCanvasElement,callback:BlobCallback,type?:string){canvasSizes.push({width:this.width,height:this.height,type:type??""});callback(emptyPng?null:new Blob(["png bytes"],{type:"image/png"}));});
});
afterEach(()=>{document.body.innerHTML="";vi.restoreAllMocks();vi.unstubAllGlobals();vi.useRealTimers();});

describe("weather SVG PNG export",()=>{
  it("snapshots inherited/computed styles before waiting, preserves transforms, and leaves the source unchanged",async()=>{
    const node=svg(),before=node.outerHTML;
    const promise=createWeatherPng(node,{title:"인천 기온",subtitle:"2026-10-01 ~ 2026-10-18"});
    expect(imageBlobs).toHaveLength(1);expect(node.outerHTML).toBe(before);
    node.querySelector("text")!.textContent="changed after click";
    const serialized=await imageBlobs[0].text();
    expect(serialized).toContain("연수구");expect(serialized).toContain("13.9°C");expect(serialized).not.toContain("changed after click");
    expect(serialized).toContain('transform="translate(20 30) scale(1.4)"');
    expect(serialized).toMatch(/paint-order:\s*stroke fill/);expect(serialized).toMatch(/font-size:\s*11px/);expect(serialized).toMatch(/stroke-width:\s*3/);expect(serialized).toContain("Malgun Gothic");
    await expect(promise).resolves.toMatchObject({type:"image/png"});expect(context.drawImage).toHaveBeenCalledOnce();expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:weather-1");
  });
  it("captures the full viewBox including horizontally scrolled graph series",async()=>{
    const node=svg(9800,286);node.setAttribute("width","390");node.style.width="390px";
    await createWeatherPng(node,{title:"전체 그래프",subtitle:"1년 통계"});
    const serialized=await imageBlobs[0].text();expect(serialized).toContain('viewBox="0 0 9800 286"');expect(serialized).toContain('width="9800"');
    expect(context.drawImage.mock.calls[0].slice(-2)).toEqual([9800,286]);
  });
  it.each([[390,640],[20000,10000],[100000,50]])("limits a %i × %i image to 8192px per side and 16MP including captions",async(width,height)=>{
    await createWeatherPng(svg(width,height),{title:"날씨지도",subtitle:"기간 통계",footnotes:["기상청 · 인근 관측소 대표값"]});
    const size=canvasSizes[0];expect(size.type).toBe("image/png");expect(size.width).toBeLessThanOrEqual(8192);expect(size.height).toBeLessThanOrEqual(8192);expect(size.width*size.height).toBeLessThanOrEqual(16_000_000);
    if(width===390)expect(size.width).toBe((390+48)*2);
  });
  it("wraps long Korean captions and records legend labels and source/measurement warnings",async()=>{
    const title="우리 지역의 날씨를 함께 살펴보는 백지도입니다 ".repeat(4).trim(),source="자료: 기상청 · 인근 관측소 대표값이며 지역 전체 평균이 아닙니다.";
    await createWeatherPng(svg(),{title,subtitle:"2026년 10월",details:["항목: 기온, 강수량"],legend:[{label:"기온 (°C) · 꺾은선",color:"#156f94"},{label:"강수량 (mm) · 막대",color:"#bc4550"}],footnotes:[source]});
    const texts=context.fillText.mock.calls.map(call=>call[0] as string);
    expect(texts.filter(text=>text.includes("우리 지역")||text.includes("백지도")).length).toBeGreaterThan(1);
    expect(texts.join(" ").replace(/\s+/g," ")).toContain(title.replace(/\s+/g," "));
    expect(texts).toContain("기온 (°C) · 꺾은선");expect(texts).toContain("강수량 (mm) · 막대");expect(texts.join(" ")).toContain("자료: 기상청");
    const graphicY=context.drawImage.mock.calls[0][2] as number;
    const sourceRow=context.fillText.mock.calls.find(call=>(call[0] as string).startsWith("자료:"))!;
    expect(sourceRow[2]).toBeGreaterThan(graphicY+640);expect(context.fillRect.mock.calls.length).toBe(3);
  });
  it("removes executable HTML and external SVG resources without mutating the live SVG",async()=>{
    const node=svg();node.insertAdjacentHTML("beforeend",'<foreignObject><div>HTML</div></foreignObject><script>alert(1)</script><image href="https://example.com/p.png"/><g onclick="alert(1)"><use href="https://example.com/icon.svg#x"/></g>');
    await createWeatherPng(node,{title:"지도",subtitle:"통계"});
    const serialized=await imageBlobs[0].text();expect(serialized).not.toMatch(/foreignObject|<script|<image|onclick|https:\/\/example/);
    expect(node.querySelector("foreignObject")).not.toBeNull();
  });
  it("cleans up image URLs after decoding or PNG encoding fails",async()=>{
    failImage=true;await expect(createWeatherPng(svg(),{title:"지도",subtitle:""})).rejects.toThrow("이미지로 만들지 못했어요");expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:weather-1");
    failImage=false;emptyPng=true;await expect(createWeatherPng(svg(),{title:"지도",subtitle:""})).rejects.toThrow("PNG 파일을 만들지 못했어요");expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:weather-2");
  });
  it("reports unsupported canvas and invalid geometry dimensions clearly",async()=>{
    failCanvas=true;await expect(createWeatherPng(svg(),{title:"지도",subtitle:""})).rejects.toThrow("브라우저");
    failCanvas=false;const node=svg();node.removeAttribute("viewBox");await expect(createWeatherPng(node,{title:"지도",subtitle:""})).rejects.toThrow("크기를 확인할 수 없어요");
  });
});

describe("weather image clipboard and download",()=>{
  function clipboard(write:(items:{data:Record<string,Promise<Blob>>}[])=>Promise<void>){
    class Item{data:Record<string,Promise<Blob>>;static supports=()=>true;constructor(data:Record<string,Promise<Blob>>){this.data=data;}}
    vi.stubGlobal("ClipboardItem",Item);vi.stubGlobal("navigator",{clipboard:{write}});vi.stubGlobal("isSecureContext",true);
  }
  it("calls clipboard.write in the click stack before async image generation",async()=>{
    const events:string[]=[],png=new Blob(["png"],{type:"image/png"});
    clipboard(async items=>{events.push("write");expect(items[0].data["image/png"]).toBeInstanceOf(Promise);await items[0].data["image/png"];});
    const result=copyWeatherPng(async()=>{events.push("create");return png;});
    expect(events).toEqual(["write"]);await result;expect(events).toEqual(["write","create"]);
  });
  it("preserves clear PNG fallback guidance when permission is denied",async()=>{
    clipboard(async()=>{throw new DOMException("denied","NotAllowedError");});
    await expect(copyWeatherPng(async()=>new Blob(["png"],{type:"image/png"}))).rejects.toThrow("클립보드 권한");
    await expect(copyWeatherPng(async()=>new Blob(["png"],{type:"image/png"}))).rejects.toThrow("PNG 저장");
  });
  it("does not generate an image when clipboard PNG is unavailable",async()=>{
    vi.stubGlobal("ClipboardItem",undefined);const create=vi.fn();
    await expect(copyWeatherPng(create)).rejects.toThrow("지원하지 않아요. PNG 저장");expect(create).not.toHaveBeenCalled();
  });
  it("handles synchronous clipboard failures and rejected image generation",async()=>{
    clipboard(()=>{throw new DOMException("blocked","NotAllowedError");});await expect(copyWeatherPng(async()=>new Blob())).rejects.toThrow("PNG 저장");
    clipboard(async items=>{await items[0].data["image/png"];});await expect(copyWeatherPng(async()=>{throw new Error("encoding failed");})).rejects.toThrow("PNG 저장");
  });
  it("starts PNG download with a safe filename and revokes its URL after the browser can read it",()=>{
    vi.useFakeTimers();const clicks=vi.spyOn(HTMLAnchorElement.prototype,"click").mockImplementation(function(this:HTMLAnchorElement){expect(this.download).toBe("인천_2026-01-01_2026-01-31.png");expect(this.href).toBe("blob:weather-1");expect(this.isConnected).toBe(true);});
    downloadWeatherPng(new Blob(["png"],{type:"image/png"}),weatherImageFilename("인천","2026-01-01","2026-01-31"));
    expect(clicks).toHaveBeenCalledOnce();expect(document.querySelector("a")).toBeNull();expect(URL.revokeObjectURL).not.toHaveBeenCalled();
    vi.advanceTimersByTime(30000);expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:weather-1");
  });
  it("sanitizes platform-reserved characters, empty names and long filenames",()=>{
    const filename=weatherImageFilename(' ../인천:기온?*<>|"\\ ',"2026/10/01","2026/10/18");expect(filename).not.toMatch(/[<>:"/\\|?*\u0000-\u001f]/);expect(filename).toMatch(/\.png$/);
    expect(weatherImageFilename("...","","")).toBe("날씨지도.png");expect(weatherImageFilename("가".repeat(500),"","").length).toBeLessThan(80);
  });
});
