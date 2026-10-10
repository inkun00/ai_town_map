// @vitest-environment happy-dom
import {act,useState,type ReactNode} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {emptyWorkbench,parseWorkbench,serializeWorkbench,workbenchKey,type WorkbenchState} from "../src/domain/map-workbench";
import {themeByKey,type DemoPoint} from "../src/lib/demo-data";
import type {ObservationFilter} from "../src/domain/analysis";
import type {Coordinates} from "../src/components/KakaoMap";

type MapProbe={
  points?:{id:string;title:string}[];
  workbench?:WorkbenchState;
  onSelectPoint?:(id:string)=>void;
  contextPointId?:string|null;
  contextPopup?:ReactNode;
  gestureTool?:{kind:string;pointId:string}|null;
  onGestureEnd?:(result:{pointId:string;meters?:number;targetId?:string}|null)=>void;
  onBoundsChange?:(bounds:[number,number,number,number])=>void;
  onCanvasPick?:(location:Coordinates)=>void;
};
const mapProbe=vi.hoisted(()=>({props:null as MapProbe|null}));
vi.mock("../src/components/KakaoMap",()=>({default:(props:MapProbe)=>{
  mapProbe.props=props;
  return <div data-testid="map">
    {props.points?.map(point=><button type="button" key={point.id} aria-label={`핀 ${point.title}`} onClick={()=>props.onSelectPoint?.(point.id)}>{point.title}</button>)}
    {props.contextPointId&&props.contextPopup&&<div data-testid="point-tools">{props.contextPopup}</div>}
    <button type="button" aria-label="반경 드래그 완료" onClick={()=>props.onGestureEnd?.({pointId:"point-a",meters:275})}>반경 드래그 완료</button>
    <button type="button" aria-label="지도 이동" onClick={()=>props.onBoundsChange?.([126,36,128,38])}>지도 이동</button>
  </div>;
}}));
vi.mock("../src/components/PointDialog",()=>({PointDialog:({label,children}:{label:string;children:ReactNode})=><section role="dialog" aria-label={label}>{children}</section>}));
import {MapWorkspace} from "../src/components/MapWorkspace";

const points:DemoPoint[]=[
  {id:"point-a",mapId:"map-a",title:"학교 앞 신호등",categoryKey:"traffic",emojiKey:"traffic-1",ratingKey:"positive",body:"횡단보도 옆에 신호등이 있어요.",link:"https://example.com/signal",photoUrl:"https://example.com/signal.jpg",x:10,y:20,author:"학생",date:"10월 10일",createdAt:"2026-10-10T00:00:00Z",location:{lat:37,lng:127}},
  {id:"point-b",mapId:"map-a",title:"어두운 골목",categoryKey:"daily",emojiKey:"daily-1",ratingKey:"improve",body:"저녁에는 조명이 약해요.",x:30,y:40,author:"학생",date:"10월 10일",createdAt:"2026-10-10T00:10:00Z",location:{lat:37.001,lng:127}},
];
let container:HTMLDivElement;
let root:Root;
const sharedFilter=vi.fn();
const sharedBounds=vi.fn();
const selected=vi.fn();
const analysisSelected=vi.fn();
const fetchSpy=vi.fn();

function Harness({scope="teacher-a",mapId="map-a",startAnalysis=false,publicPoints=points,initialFilter={},loadAnalysisPoints}:{scope?:string;mapId?:string;startAnalysis?:boolean;publicPoints?:DemoPoint[];initialFilter?:ObservationFilter;loadAnalysisPoints?:()=>Promise<DemoPoint[]>}){
  const [analysisMode,setAnalysisMode]=useState(startAnalysis);
  const [selectedId,setSelectedId]=useState<string|null>(null);
  const [showList,setShowList]=useState(false);
  const [filter,setFilter]=useState<ObservationFilter>(initialFilter);
  const point=points.find(item=>item.id===selectedId);
  return <>
    <MapWorkspace mapId={mapId} scope={scope} theme={themeByKey.safety} points={publicPoints} live center={{lat:37,lng:127}} analysisMode={analysisMode} onAnalysisModeChange={setAnalysisMode} loadAnalysisPoints={loadAnalysisPoints} onAnalysisPointSelect={analysisSelected} selectedId={selectedId} onSelect={id=>{selected(id);setSelectedId(id);}} filter={filter} onFilter={value=>{sharedFilter(value);setFilter(value);}} onBounds={sharedBounds} showList={showList} onToggleList={()=>setShowList(value=>!value)} loading={false} error="" fallback={()=>null}/>
    {point&&<article aria-label="등록 기록"><h2>{point.title}</h2><img src={point.photoUrl??undefined} alt="등록한 사진"/><p>{point.body}</p><a href={point.link}>등록한 링크</a></article>}
  </>;
}

function button(label:string){
  const found=[...container.querySelectorAll<HTMLButtonElement>("button")].find(item=>{
    const accessible=item.cloneNode(true) as HTMLButtonElement;
    accessible.querySelectorAll("[aria-hidden='true']").forEach(child=>child.remove());
    return item.getAttribute("aria-label")===label||accessible.textContent?.trim()===label;
  });
  if(!found)throw new Error(`Button missing: ${label}`);
  return found;
}
async function click(label:string){await act(async()=>{button(label).click();});}
async function render(props:Parameters<typeof Harness>[0]={}){await act(async()=>{root.render(<Harness {...props}/>);});}
function markerIds(){return mapProbe.props?.points?.map(point=>point.id)??[];}
function savedState(){
  const state=emptyWorkbench();
  state.hiddenPoints=["point-a"];
  state.radii=[{pointId:"point-b",meters:[500]}];
  state.notes=[{id:"note-a",text:"내 조사 메모",emoji:"🏁",location:{lat:37,lng:127},color:"#fff1a8"}];
  return state;
}

beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  vi.stubGlobal("fetch",fetchSpy);
  fetchSpy.mockClear();sharedFilter.mockClear();sharedBounds.mockClear();selected.mockClear();analysisSelected.mockClear();mapProbe.props=null;
  localStorage.clear();
  container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});

describe("public map and personal analysis map",()=>{
  it("opens registered information directly and ignores old personal drawings on the public map",async()=>{
    const key=workbenchKey("teacher-a","map-a"),saved=serializeWorkbench("map-a",savedState());
    localStorage.setItem(key,saved);
    await render();
    expect(markerIds()).toEqual(["point-a","point-b"]);
    expect(mapProbe.props?.workbench?.radii??[]).toEqual([]);
    expect(mapProbe.props?.workbench?.notes??[]).toEqual([]);
    expect(container.querySelector("[data-testid='point-tools']")).toBeNull();
    expect(container.querySelector("button[aria-label^='지도 표시 설정']")).toBeNull();
    await click("핀 학교 앞 신호등");
    expect(selected).toHaveBeenLastCalledWith("point-a");
    expect(container.querySelector("[aria-label='등록 기록']")?.textContent).toContain(points[0].body);
    expect(container.querySelector("[aria-label='등록 기록'] img")?.getAttribute("src")).toBe(points[0].photoUrl);
    expect(container.querySelector("[aria-label='등록 기록'] a")?.getAttribute("href")).toBe(points[0].link);
    expect(container.querySelector("[data-testid='point-tools']")).toBeNull();
    expect(localStorage.getItem(key)).toBe(saved);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("restores personal tools only after choosing analysis and restores public pins on exit",async()=>{
    localStorage.setItem(workbenchKey("teacher-a","map-a"),serializeWorkbench("map-a",savedState()));
    await render();
    await click("분석지도 만들기");
    expect(markerIds()).toEqual(["point-b"]);
    expect(mapProbe.props?.workbench?.radii).toEqual([{pointId:"point-b",meters:[500]}]);
    expect(mapProbe.props?.workbench?.notes).toHaveLength(1);
    await click("핀 어두운 골목");
    expect(container.querySelector("[data-testid='point-tools']")?.textContent).toContain("반경");
    expect(container.querySelector("[data-testid='point-tools']")?.textContent).toContain("연결");
    await click("공용 지도 보기");
    expect(markerIds()).toEqual(["point-a","point-b"]);
    expect(mapProbe.props?.workbench?.radii??[]).toEqual([]);
    expect(container.querySelector("[data-testid='point-tools']")).toBeNull();
    await click("핀 학교 앞 신호등");
    expect(selected).toHaveBeenLastCalledWith("point-a");
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("keeps personal filters, list mode, bounds and drawing saves away from shared controls and APIs",async()=>{
    await render();
    await click("분석지도 만들기");
    await click("지도 조건 선택");
    const category=container.querySelector<HTMLSelectElement>(".analysis-filters select");
    expect(category).not.toBeNull();
    await act(async()=>{category!.value="traffic";category!.dispatchEvent(new Event("change",{bubbles:true}));});
    expect(markerIds()).toEqual(["point-a"]);
    expect(sharedFilter).not.toHaveBeenCalled();
    await click("지도 보기");
    await click("지도 이동");
    expect(sharedBounds).not.toHaveBeenCalled();
    await click("핀 학교 앞 신호등");
    await click("⭕반경");
    await click("반경 드래그 완료");
    const persisted=parseWorkbench(localStorage.getItem(workbenchKey("teacher-a","map-a"))!,"map-a");
    expect(persisted.radii).toEqual([{pointId:"point-a",meters:[275]}]);
    await click("기록 목록 보기");
    expect(container.querySelector(".point-list")).not.toBeNull();
    await click("공용 지도 보기");
    expect(container.querySelector(".point-list")).toBeNull();
    expect(markerIds()).toEqual(["point-a","point-b"]);
    expect(sharedFilter).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("isolates saved analysis drawings when changing map or participant scope",async()=>{
    localStorage.setItem(workbenchKey("teacher-a","map-a"),serializeWorkbench("map-a",savedState()));
    await render({startAnalysis:true});
    expect(markerIds()).toEqual(["point-b"]);
    await render({scope:"student-b",startAnalysis:true});
    expect(markerIds()).toEqual(["point-a","point-b"]);
    expect(mapProbe.props?.workbench?.notes??[]).toEqual([]);
    const other=emptyWorkbench();other.hiddenPoints=["point-b"];
    localStorage.setItem(workbenchKey("student-b","map-b"),serializeWorkbench("map-b",other));
    await render({scope:"student-b",mapId:"map-b",startAnalysis:true});
    expect(markerIds()).toEqual(["point-a"]);
    await render({scope:"teacher-a",mapId:"map-a",startAnalysis:true});
    expect(markerIds()).toEqual(["point-b"]);
    expect(mapProbe.props?.workbench?.notes).toHaveLength(1);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("loads the complete source for analysis without changing a filtered public view",async()=>{
    const loadAnalysisPoints=vi.fn().mockResolvedValue(points);
    await render({publicPoints:[points[0]],initialFilter:{category:"traffic"},loadAnalysisPoints});
    expect(markerIds()).toEqual(["point-a"]);
    expect(loadAnalysisPoints).not.toHaveBeenCalled();
    expect(analysisSelected).not.toHaveBeenCalled();
    await click("분석지도 만들기");
    expect(loadAnalysisPoints).toHaveBeenCalledTimes(1);
    expect(markerIds()).toEqual(["point-a","point-b"]);
    expect(sharedFilter).not.toHaveBeenCalled();
    await click("핀 어두운 골목");
    await click("기록 보기");
    expect(analysisSelected).toHaveBeenLastCalledWith(points[1]);
    expect(analysisSelected.mock.calls.at(-1)?.[0].body).toBe(points[1].body);
    expect(selected).toHaveBeenLastCalledWith("point-b");
    expect(analysisSelected.mock.invocationCallOrder.at(-1)!).toBeLessThan(selected.mock.invocationCallOrder.at(-1)!);
    await click("공용 지도 보기");
    expect(markerIds()).toEqual(["point-a"]);
    expect(container.querySelector("button[aria-label^='지도 조건 변경']")).not.toBeNull();
    expect(sharedFilter).not.toHaveBeenCalled();
    analysisSelected.mockClear();
    await click("핀 학교 앞 신호등");
    expect(analysisSelected).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
