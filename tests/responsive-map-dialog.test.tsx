// @vitest-environment happy-dom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {ResponsiveMapDialog} from "../src/components/ResponsiveMapDialog";

let container:HTMLDivElement,root:Root,opener:HTMLButtonElement,mapControl:HTMLButtonElement;
let desktop=true,width=1200,height=800,dialogWidth=400,dialogHeight=300;
let media:MediaQueryList,mediaListeners:Set<(event:MediaQueryListEvent)=>void>,resizeCallbacks:Set<ResizeObserverCallback>;
let show:ReturnType<typeof vi.spyOn>,showModal:ReturnType<typeof vi.spyOn>,close:ReturnType<typeof vi.spyOn>;
const onClose=vi.fn();
function popup(label="날씨 그래프"){return document.body.querySelector<HTMLDialogElement>(`dialog[aria-label="${label}"]`)!;}
function header(label="날씨 그래프"){return popup(label).querySelector<HTMLElement>(".responsive-map-dialog__header")!;}
function position(){return {left:parseFloat(popup().style.left),top:parseFloat(popup().style.top)};}
function rect(left:number,top:number,w:number,h:number):DOMRect{return {x:left,y:top,left,top,right:left+w,bottom:top+h,width:w,height:h,toJSON:()=>({})};}
async function render(children=<input aria-label="메모"/>){await act(async()=>root.render(<ResponsiveMapDialog label="날씨 그래프" onClose={onClose} closeLabel="그래프 닫기">{children}</ResponsiveMapDialog>));}
async function pointer(target:HTMLElement,type:string,x:number,y:number){await act(async()=>target.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,pointerId:3,isPrimary:true,button:0,clientX:x,clientY:y})));}
async function key(target:HTMLElement,key:string,shiftKey=false){await act(async()=>target.dispatchEvent(new KeyboardEvent("keydown",{key,shiftKey,bubbles:true,cancelable:true})));}
async function setMode(value:boolean){desktop=value;await act(async()=>mediaListeners.forEach(listener=>listener({matches:value} as MediaQueryListEvent)));}

beforeEach(()=>{
  desktop=true;width=1200;height=800;dialogWidth=400;dialogHeight=300;mediaListeners=new Set();resizeCallbacks=new Set();onClose.mockReset();
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  vi.spyOn(window,"innerWidth","get").mockImplementation(()=>width);vi.spyOn(window,"innerHeight","get").mockImplementation(()=>height);
  media={get matches(){return desktop;},media:"(min-width:900px) and (pointer:fine)",addEventListener:(_type:string,listener:(event:MediaQueryListEvent)=>void)=>mediaListeners.add(listener),removeEventListener:(_type:string,listener:(event:MediaQueryListEvent)=>void)=>mediaListeners.delete(listener)} as unknown as MediaQueryList;
  vi.stubGlobal("matchMedia",vi.fn(()=>media));
  vi.stubGlobal("ResizeObserver",class {callback:ResizeObserverCallback;constructor(callback:ResizeObserverCallback){this.callback=callback;}observe(){resizeCallbacks.add(this.callback);}disconnect(){resizeCallbacks.delete(this.callback);}unobserve(){}});
  vi.spyOn(HTMLDialogElement.prototype,"getBoundingClientRect").mockImplementation(function(this:HTMLDialogElement){return rect(parseFloat(this.style.left)||0,parseFloat(this.style.top)||0,Math.min(dialogWidth,width-16),Math.min(dialogHeight,height-16));});
  const open=function(this:HTMLDialogElement){this.open=true;this.querySelector<HTMLElement>('[tabindex="0"],button,input')?.focus();};
  show=vi.spyOn(HTMLDialogElement.prototype,"show").mockImplementation(open);showModal=vi.spyOn(HTMLDialogElement.prototype,"showModal").mockImplementation(open);close=vi.spyOn(HTMLDialogElement.prototype,"close").mockImplementation(function(this:HTMLDialogElement){this.open=false;});
  opener=document.createElement("button");opener.textContent="그래프 열기";mapControl=document.createElement("button");mapControl.textContent="지도 이동";container=document.createElement("div");container.className="app-frame";container.style.cssText="width:460px;overflow:hidden;isolation:isolate";
  document.body.append(opener,mapControl,container);opener.focus();root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();opener.remove();mapControl.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});

describe("responsive map windows",()=>{
  it("opens outside a clipped app frame as a nonmodal desktop window and leaves map controls usable",async()=>{
    await render();expect(popup().parentElement).toBe(document.body);expect(container.contains(popup())).toBe(false);expect(show).toHaveBeenCalledOnce();expect(showModal).not.toHaveBeenCalled();expect(popup().getAttribute("aria-modal")).not.toBe("true");expect(position()).toEqual({left:400,top:250});
    const useMap=vi.fn();mapControl.addEventListener("click",useMap);mapControl.focus();mapControl.click();expect(useMap).toHaveBeenCalledOnce();expect(popup().open).toBe(true);
    await act(async()=>root.render(null));expect(document.activeElement).toBe(mapControl);
  });
  it("keeps touch screens modal, closes on native cancel once, and supports browsers without matchMedia",async()=>{
    vi.stubGlobal("matchMedia",undefined);await render();expect(showModal).toHaveBeenCalledOnce();expect(show).not.toHaveBeenCalled();expect(header().hasAttribute("tabindex")).toBe(false);expect(popup().querySelector('[aria-label="창 위치 초기화"]')).toBeNull();
    await act(async()=>{popup().dispatchEvent(new Event("cancel",{cancelable:true}));popup().dispatchEvent(new Event("cancel",{cancelable:true}));});expect(onClose).toHaveBeenCalledOnce();
  });
  it("drags from the title bar beyond the map frame while retaining the whole window inside the browser",async()=>{
    await render();const grip=header(),capture=vi.fn(),release=vi.fn();grip.setPointerCapture=capture;grip.hasPointerCapture=()=>true;grip.releasePointerCapture=release;
    await pointer(grip,"pointerdown",450,270);await pointer(grip,"pointermove",950,370);expect(position()).toEqual({left:792,top:350});expect(position().left).toBeGreaterThan(460);expect(capture).toHaveBeenCalledWith(3);
    await pointer(grip,"pointermove",-1000,2000);expect(position()).toEqual({left:8,top:492});await pointer(grip,"pointerup",-1000,2000);expect(release).toHaveBeenCalledWith(3);
    await pointer(grip,"pointermove",800,200);expect(position()).toEqual({left:8,top:492});
  });
  it("does not turn header buttons or text editing into drag and keyboard shortcuts",async()=>{
    await render();const closeButton=popup().querySelector<HTMLButtonElement>('[aria-label="그래프 닫기"]')!;
    await pointer(closeButton,"pointerdown",780,270);await pointer(header(),"pointermove",100,100);expect(position()).toEqual({left:400,top:250});
    const input=popup().querySelector("input")!;input.focus();await key(input,"ArrowLeft");await key(input,"Home");expect(position()).toEqual({left:400,top:250});expect(onClose).not.toHaveBeenCalled();
    await act(async()=>closeButton.click());expect(onClose).toHaveBeenCalledOnce();
  });
  it("moves by keyboard, provides a reset, and constrains content and viewport size changes",async()=>{
    await render();header().focus();await key(header(),"ArrowRight");await key(header(),"ArrowDown",true);expect(position()).toEqual({left:410,top:290});
    await key(header(),"Home");expect(position()).toEqual({left:400,top:250});await pointer(header(),"pointerdown",450,270);await pointer(header(),"pointermove",950,670);await pointer(header(),"pointerup",950,670);expect(position()).toEqual({left:792,top:492});
    dialogHeight=600;await act(async()=>resizeCallbacks.forEach(callback=>callback([],{} as ResizeObserver)));expect(position()).toEqual({left:792,top:192});
    width=1000;height=700;await act(async()=>window.dispatchEvent(new Event("resize")));expect(position()).toEqual({left:592,top:92});
    await act(async()=>popup().querySelector<HTMLButtonElement>('[aria-label="창 위치 초기화"]')!.click());expect(position()).toEqual({left:300,top:50});
  });
  it("switches modal behavior safely when the input or viewport changes and restores the opener on close",async()=>{
    await render();expect(show).toHaveBeenCalledOnce();await setMode(false);expect(showModal).toHaveBeenCalledOnce();expect(popup().style.left).toBe("");expect(popup().dataset.desktop).toBe("false");
    await setMode(true);expect(show).toHaveBeenCalledTimes(2);expect(popup().dataset.desktop).toBe("true");expect(mediaListeners.size).toBe(1);
    header().focus();await key(header(),"Escape");expect(onClose).toHaveBeenCalledOnce();await act(async()=>root.render(null));expect(document.activeElement).toBe(opener);expect(mediaListeners.size).toBe(0);expect(resizeCallbacks.size).toBe(0);expect(close).toHaveBeenCalledTimes(3);
  });
  it("raises the selected desktop window and only closes the focused window on Escape",async()=>{
    const secondClose=vi.fn();await act(async()=>root.render(<><ResponsiveMapDialog label="지역 선택" onClose={secondClose}><input aria-label="지역"/></ResponsiveMapDialog><ResponsiveMapDialog label="날씨 그래프" onClose={onClose}><input aria-label="항목"/></ResponsiveMapDialog></>));
    const first=popup("지역 선택"),second=popup();expect(Number(second.style.zIndex)).toBeGreaterThan(Number(first.style.zIndex));
    await act(async()=>header("지역 선택").focus());expect(Number(first.style.zIndex)).toBeGreaterThan(Number(second.style.zIndex));await key(header("지역 선택"),"Escape");expect(secondClose).toHaveBeenCalledOnce();expect(onClose).not.toHaveBeenCalled();
  });
});
