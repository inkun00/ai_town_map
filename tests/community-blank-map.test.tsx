// @vitest-environment happy-dom
import {act,type ReactNode} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import CommunityBlankMap from "../src/components/CommunityBlankMap";
import {communityProjection,initialCommunityBounds,panCommunityBounds,pointWithinCommunityBounds,validCommunityBounds,zoomCommunityBounds,type CommunityBounds} from "../src/domain/community-blank-map";
import {emptyWorkbench} from "../src/domain/map-workbench";
import type {MapPoint} from "../src/components/KakaoMap";
import type {WeatherBoundaryFeature} from "../src/domain/weather-boundaries";
vi.mock("../src/components/PointDialog",()=>({PointDialog:({label,children}:{label:string;children:ReactNode})=><div role="dialog" aria-label={label}>{children}</div>}));

const bounds:CommunityBounds=[126,37,127,38];
const points:MapPoint[]=[{id:"a",title:"공원",emoji:"🌳",color:"#2e7d32",location:{lng:126.3,lat:37.5},rating:{label:"편리해요",color:"#2e7d32",symbol:"✓"}},{id:"b",title:"문화재",emoji:"🏯",color:"#a96838",location:{lng:126.6,lat:37.6}}];
const feature:WeatherBoundaryFeature={id:"district",name:"우리 구",label:[126.5,37.5],geometry:{type:"Polygon",coordinates:[[[126,37],[127,37],[127,38],[126,38],[126,37]]]}};
let container:HTMLDivElement,root:Root;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("ResizeObserver",class{observe(){}disconnect(){}});container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
async function render(props:Partial<React.ComponentProps<typeof CommunityBlankMap>>={}){await act(async()=>root.render(<CommunityBlankMap bounds={bounds} features={[feature]} points={points} onViewportChange={()=>{}} {...props}/>));}
async function pointer(type:string,x:number,y:number){const event=new Event(type,{bubbles:true});Object.assign(event,{pointerId:1,pointerType:"touch",button:0,clientX:x,clientY:y});await act(async()=>container.querySelector("svg")!.dispatchEvent(event));}

describe("community blank map projection",()=>{
  it("roundtrips a geographic point and pans/zooms a geographic viewport",()=>{
    const projection=communityProjection(bounds,440,640),screen=projection.project([126.3,37.5]),location=projection.unproject(screen.x,screen.y);
    expect(location.lat).toBeCloseTo(37.5,8);expect(location.lng).toBeCloseTo(126.3,8);
    const zoom=zoomCommunityBounds(bounds,2,220,320,440,640);expect(zoom[2]-zoom[0]).toBeCloseTo(.5,5);expect(validCommunityBounds(zoom)).toBe(true);
    const pan=panCommunityBounds(bounds,44,0,440,640);expect(pan[0]).toBeCloseTo(125.9,6);expect(pan[2]).toBeCloseTo(126.9,6);
    expect(pointWithinCommunityBounds(points[0].location,bounds)).toBe(true);expect(validCommunityBounds([127,38,126,37])).toBe(false);
  });
  it("derives a useful empty/default/focus bounds without inventing data",()=>{
    expect(validCommunityBounds(initialCommunityBounds())).toBe(true);
    const focused=initialCommunityBounds(points,null,{location:points[0].location,radiusMeters:100,nonce:1});expect(focused[2]-focused[0]).toBeLessThan(.01);
    const all=initialCommunityBounds(points);expect(points.every(point=>pointWithinCommunityBounds(point.location,all))).toBe(true);
  });
});
describe("community map records and drawings",()=>{
  it("keeps emoji, individual ratings and selected/unselected badges as exportable native SVG",async()=>{
    const select=vi.fn();await render({points:points.map((point,index)=>({...point,selectionState:index?"unselected":"selected"})),selectedId:"a",onSelectPoint:select});
    expect(container.querySelector('g[data-marker="a"]')?.getAttribute("data-selection-state")).toBe("selected");expect(container.querySelector('g[data-marker="b"]')?.getAttribute("data-selection-state")).toBe("unselected");
    expect(container.querySelector('g[data-marker="a"]')?.textContent).toContain("🌳");expect(container.querySelector('g[data-marker="a"]')?.textContent).toContain("✓");
    await act(async()=>container.querySelector('g[data-marker="b"]')!.dispatchEvent(new MouseEvent("click",{bubbles:true})));expect(select).toHaveBeenCalledWith("b");
    expect(container.querySelector("image,foreignObject,script,img")).toBeNull();
  });
  it("opens a same-location chooser rather than selecting one arbitrary record",async()=>{
    const select=vi.fn();await render({points:[points[0],{...points[1],location:points[0].location}],onSelectPoint:select});
    expect(container.querySelector('[data-marker="a"]>path')?.getAttribute("fill")).toBe(points[0].color);
    await act(async()=>container.querySelector('[data-marker="a"]')!.dispatchEvent(new MouseEvent("click",{bubbles:true})));
    expect(select).not.toHaveBeenCalled();expect(container.querySelector('[role="dialog"]')?.textContent).toContain("같은 위치의 기록 2개");
    await act(async()=>container.querySelector('button[aria-label="문화재"]')!.dispatchEvent(new MouseEvent("click",{bubbles:true})));expect(select).toHaveBeenCalledWith("b");
  });
  it("draws analysis layers using all anchors, including hidden observations, without changing records",async()=>{
    const state=emptyWorkbench();state.radii=[{pointId:"a",meters:[100,500]}];state.connections=[{fromId:"a",toId:"b"}];state.notes=[{id:"n",text:"여기에 나무",emoji:"🌱",location:points[0].location,color:"#fff1a8"}];
    const before=JSON.stringify(state),note=vi.fn();await render({points:[points[0]],anchorPoints:points,workbench:state,onSelectNote:note});
    expect(container.querySelectorAll("[data-radius]")).toHaveLength(2);expect(container.querySelectorAll("[data-connection]")).toHaveLength(1);expect(container.querySelector("[data-note]")?.textContent).toContain("🌱 여기에 나무");
    await act(async()=>container.querySelector('[data-note="n"]')!.dispatchEvent(new MouseEvent("click",{bubbles:true})));expect(note).toHaveBeenCalledWith("n");expect(JSON.stringify(state)).toBe(before);
    await render({workbench:{...state,layers:{radii:false,route:false,notes:false}}});expect(container.querySelectorAll("[data-radius],[data-connection],[data-note]")).toHaveLength(0);
  });
  it("keeps observations visible when boundaries fail and offers retry",async()=>{
    const retry=vi.fn();await render({features:[],error:"경계 제공이 지연되고 있어요.",onRetry:retry});expect(container.querySelectorAll("[data-marker]")).toHaveLength(2);expect(container.querySelector('[role="alert"]')?.textContent).toContain("지연");
    await act(async()=>[...container.querySelectorAll("button")].find(button=>button.textContent==="경계 다시 불러오기")!.click());expect(retry).toHaveBeenCalledOnce();
  });
  it("does not reset the viewport when boundary features change",async()=>{
    const move=vi.fn();await render({onViewportChange:move});await render({features:[{...feature,id:"new"}],onViewportChange:move});expect(move).not.toHaveBeenCalled();
    await act(async()=>container.querySelector('button[aria-label="백지도 확대"]')!.dispatchEvent(new MouseEvent("click",{bubbles:true})));expect(move).toHaveBeenCalledOnce();
  });
  it("preserves canvas memo positioning and context popup Escape",async()=>{
    const pick=vi.fn(),close=vi.fn();await render({onCanvasPick:pick,contextPointId:"a",contextPopup:<button>반경</button>,onCloseContext:close});
    await act(async()=>container.querySelector('svg')!.dispatchEvent(new MouseEvent("click",{clientX:220,clientY:320,bubbles:true})));expect(pick).toHaveBeenCalledOnce();expect(pick.mock.calls[0][0].lng).toBeCloseTo(126.5);
    await act(async()=>container.querySelector('[role="dialog"]')!.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));expect(close).toHaveBeenCalled();
  });
  it("measures radius by drag, clamps its maximum and cancels with Escape",async()=>{
    const end=vi.fn();await render({gestureTool:{kind:"radius",pointId:"a"},onGestureEnd:end});const origin=communityProjection(bounds,440,640).project([126.3,37.5]);
    await pointer("pointerdown",origin.x,origin.y);await pointer("pointermove",origin.x+180,origin.y);await pointer("pointerup",origin.x+180,origin.y);
    expect(end.mock.calls[0][0]).toMatchObject({pointId:"a",meters:20000});
    await act(async()=>window.dispatchEvent(new KeyboardEvent("keydown",{key:"Escape",bubbles:true})));expect(end).toHaveBeenLastCalledWith(null);
  });
  it("snaps a dragged connection to a point and supports keyboard radius input",async()=>{
    const end=vi.fn();await render({gestureTool:{kind:"connect",pointId:"a"},onGestureEnd:end});const projection=communityProjection(bounds,440,640),from=projection.project([126.3,37.5]),to=projection.project([126.6,37.6]);
    await pointer("pointerdown",from.x,from.y);await pointer("pointermove",to.x,to.y);expect(container.textContent).toContain("연결 준비");await pointer("pointerup",to.x,to.y);expect(end).toHaveBeenCalledWith({pointId:"a",targetId:"b"});
    await render({gestureTool:{kind:"radius",pointId:"a"},onGestureEnd:end});await act(async()=>[...container.querySelectorAll("button")].find(button=>button.textContent==="적용")!.click());expect(end).toHaveBeenLastCalledWith({pointId:"a",meters:100});
  });
  it("captures an armed gesture immediately and cancels a release outside the map",async()=>{
    const end=vi.fn();await render({gestureTool:{kind:"radius",pointId:"a"},onGestureEnd:end});const element=container.querySelector("svg")!,capture=vi.fn();Object.defineProperty(element,"setPointerCapture",{value:capture,configurable:true});const origin=communityProjection(bounds,440,640).project([126.3,37.5]);
    await pointer("pointerdown",origin.x,origin.y);expect(capture).toHaveBeenCalledWith(1);
    await pointer("pointerup",600,300);expect(end).toHaveBeenLastCalledWith(null);
    await pointer("pointerdown",origin.x,origin.y);expect(capture).toHaveBeenCalledTimes(3);
  });
});
