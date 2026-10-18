// @vitest-environment happy-dom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import WeatherBlankMap from "../src/components/WeatherBlankMap";
import {fitWeatherBoundaries,placeWeatherBoundaryLabels,projectWeatherCoordinate,weatherBoundaryColor,weatherBoundaryColors,weatherBoundaryPath,type WeatherBoundaryFeature} from "../src/domain/weather-boundaries";

const holeFeature:WeatherBoundaryFeature={id:"district1",name:"가구",label:[126.5,37.5],geometry:{type:"Polygon",coordinates:[[[126,37],[127,37],[127,38],[126,38],[126,37]],[[126.2,37.2],[126.4,37.2],[126.4,37.4],[126.2,37.4],[126.2,37.2]]]}};
const islands:WeatherBoundaryFeature={id:"district2",name:"나구",label:[128.2,37.2],geometry:{type:"MultiPolygon",coordinates:[[[[128,37],[128.4,37],[128.4,37.4],[128,37.4],[128,37]]],[[[129,38],[129.2,38],[129.2,38.2],[129,38.2],[129,38]]]]}};
const points=[{id:"district1",title:"가구",emoji:"🌡️",color:"#fff",label:"가구 0°C",location:{lat:37.5,lng:126.5}},{id:"district2",title:"나구",emoji:"🌡️",color:"#fff",label:"나구 자료 없음",location:{lat:37.2,lng:128.2}}];

describe("blank weather map geometry",()=>{
  it("preserves polygon holes and each disconnected island as closed paths",()=>{
    const projection=fitWeatherBoundaries([holeFeature,islands],440,640);
    const hole=weatherBoundaryPath(holeFeature.geometry,projection),islandPath=weatherBoundaryPath(islands.geometry,projection);
    expect(hole.match(/M/g)).toHaveLength(2);expect(hole.match(/Z/g)).toHaveLength(2);
    expect(islandPath.match(/M/g)).toHaveLength(2);expect(islandPath.match(/Z/g)).toHaveLength(2);
    expect(hole+islandPath).not.toMatch(/NaN|Infinity/);
  });
  it("fits every projected coordinate below the toolbar and within the map",()=>{
    const projection=fitWeatherBoundaries([holeFeature,islands],440,640);
    for(const feature of [holeFeature,islands]){
      const polygons=feature.geometry.type==="Polygon"?[feature.geometry.coordinates]:feature.geometry.coordinates;
      for(const polygon of polygons)for(const ring of polygon)for(const coordinate of ring){
        const {x,y}=projection.project(coordinate);expect(x).toBeGreaterThanOrEqual(23.99);expect(x).toBeLessThanOrEqual(416.01);expect(y).toBeGreaterThanOrEqual(159.99);expect(y).toBeLessThanOrEqual(605.01);
      }
    }
    expect(projectWeatherCoordinate([126,90]).y).toBeTypeOf("number");
    expect(Number.isFinite(projectWeatherCoordinate([126,90]).y)).toBe(true);
  });
  it("keeps empty or degenerate geometry finite and region colours stable",()=>{
    const empty=fitWeatherBoundaries([],0,0),degenerate=fitWeatherBoundaries([{...holeFeature,geometry:{type:"Polygon",coordinates:[[[126,37],[126,37],[126,37]]]}}],10,10);
    expect(Number.isFinite(empty.scale)).toBe(true);expect(Number.isFinite(degenerate.scale)).toBe(true);
    expect(weatherBoundaryColor("district1")).toBe(weatherBoundaryColor("district1"));
  });
  it("distinguishes all Incheon districts with a stable palette regardless of input order",()=>{
    const ids=["2811000000","2814000000","2817700000","2818500000","2820000000","2823700000","2824500000","2826000000","2826500000","2871000000","2872000000"];
    const colors=weatherBoundaryColors(ids),reversed=weatherBoundaryColors([...ids].reverse());
    expect(new Set(colors.values()).size).toBe(ids.length);expect([...reversed]).toEqual([...colors]);
  });
  it.each([[390,779,20],[320,675,15]])("packs %i×%i clustered labels without clipping or overlap",(width,height,count)=>{
    const anchors=Array.from({length:count},(_,index)=>({id:`region${String(index).padStart(2,"0")}`,x:width*.52+(index%4)*2,y:height*.52+Math.floor(index/4)*3,width:76,height:32}));
    const labels=placeWeatherBoundaryLabels(anchors,{width,height});expect(labels).toHaveLength(count);
    expect(placeWeatherBoundaryLabels([...anchors].reverse(),{width,height})).toEqual(labels);
    for(let index=0;index<labels.length;index++){
      const label=labels[index];expect(label.x-label.width/2).toBeGreaterThanOrEqual(8);expect(label.x+label.width/2).toBeLessThanOrEqual(width-8);expect(label.y-label.height/2).toBeGreaterThanOrEqual(160);expect(label.y+label.height/2).toBeLessThanOrEqual(height-55);
      expect(label.anchorX).toBe(anchors[index].x);expect(label.anchorY).toBe(anchors[index].y);
      for(const other of labels.slice(index+1))expect(Math.abs(label.x-other.x)>=(label.width+other.width)/2+4||Math.abs(label.y-other.y)>=(label.height+other.height)/2+4).toBe(true);
    }
  });
  it("hides only labels whose true anchors moved offscreen instead of piling them on an edge",()=>{
    const labels=placeWeatherBoundaryLabels([{id:"off-left",x:-1,y:300,width:70,height:32},{id:"off-bottom",x:200,y:701,width:70,height:32},{id:"inside",x:2,y:690,width:70,height:32}],{width:390,height:700});
    expect(labels.map(label=>label.id)).toEqual(["inside"]);expect(labels[0].anchorX).toBe(2);expect(labels[0].x).toBeGreaterThan(2);
  });
});

let container:HTMLDivElement,root:Root;
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);vi.stubGlobal("ResizeObserver",class{observe(){}disconnect(){}});container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});
const button=(name:string)=>container.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!;

describe("blank weather map surface",()=>{
  it("renders only region boundaries with compact zero and missing-value labels",async()=>{
    await act(async()=>root.render(<WeatherBlankMap features={[holeFeature,islands]} points={points}/>));
    expect(container.querySelectorAll("svg path")).toHaveLength(2);
    expect(container.querySelector("path")?.getAttribute("fill-rule")).toBe("evenodd");
    expect([...container.querySelectorAll("text")].map(text=>text.textContent)).toEqual(["가구 0°C","나구 자료 없음"]);
    expect(container.querySelector("iframe,img,script")).toBeNull();
    expect(container.innerHTML).not.toMatch(/kakao|tile|road/i);
  });
  it("selects a region with pointer or keyboard and marks the selected region",async()=>{
    const onSelectPoint=vi.fn();
    await act(async()=>root.render(<WeatherBlankMap features={[holeFeature,islands]} points={points} selectedId="district2" onSelectPoint={onSelectPoint}/>));
    const regions=container.querySelectorAll<SVGGElement>('[role="button"]');
    expect(regions[0].getAttribute("aria-pressed")).toBe("false");expect(regions[1].getAttribute("aria-pressed")).toBe("true");
    await act(async()=>regions[0].dispatchEvent(new MouseEvent("click",{bubbles:true})));
    await act(async()=>regions[1].dispatchEvent(new KeyboardEvent("keydown",{key:"Enter",bubbles:true})));
    await act(async()=>regions[0].dispatchEvent(new KeyboardEvent("keydown",{key:" ",bubbles:true})));
    expect(onSelectPoint.mock.calls).toEqual([["district1"],["district2"],["district1"]]);
  });
  it("paints all region names above every boundary without adding duplicate keyboard targets",async()=>{
    const onSelectPoint=vi.fn();await act(async()=>root.render(<WeatherBlankMap features={[holeFeature,islands]} points={points} onSelectPoint={onSelectPoint}/>));
    const paths=container.querySelectorAll("path"),texts=container.querySelectorAll("text");
    expect(paths[paths.length-1].compareDocumentPosition(texts[0])&Node.DOCUMENT_POSITION_FOLLOWING).not.toBe(0);
    expect(container.querySelectorAll('[role="button"][tabindex="0"]')).toHaveLength(2);
    expect(texts[0].closest('[aria-hidden="true"]')).not.toBeNull();
    await act(async()=>texts[0].dispatchEvent(new MouseEvent("click",{bubbles:true})));expect(onSelectPoint).toHaveBeenCalledWith("district1");
  });
  it("zooms geometry while keeping text size fixed and resets the view",async()=>{
    await act(async()=>root.render(<WeatherBlankMap features={[holeFeature]} points={points}/>));
    const original=container.querySelector("path")!.getAttribute("transform");
    expect(button("백지도 축소").disabled).toBe(true);
    await act(async()=>button("백지도 확대").click());
    expect(container.querySelector("path")!.getAttribute("transform")).toContain("scale(1.4)");
    expect(container.querySelector("text")!.getAttribute("transform")).toBeNull();
    expect(button("백지도 축소").disabled).toBe(false);
    await act(async()=>button("백지도 위치 초기화").click());expect(container.querySelector("path")!.getAttribute("transform")).toBe(original);
  });
  it("pans with touch and avoids treating a drag as a region selection",async()=>{
    const onSelectPoint=vi.fn();await act(async()=>root.render(<WeatherBlankMap features={[holeFeature]} points={points} onSelectPoint={onSelectPoint}/>));
    const svg=container.querySelector("svg")!,region=container.querySelector('[role="button"]')!;
    for(const [type,x,y] of [["pointerdown",10,10],["pointermove",40,55],["pointerup",40,55]] as const){
      const event=new Event(type,{bubbles:true});Object.assign(event,{pointerId:1,pointerType:"touch",clientX:x,clientY:y,button:0});await act(async()=>svg.dispatchEvent(event));
    }
    expect(container.querySelector("path")!.getAttribute("transform")).toContain("translate(30 45)");
    await act(async()=>region.dispatchEvent(new MouseEvent("click",{bubbles:true})));expect(onSelectPoint).not.toHaveBeenCalled();
  });
  it("does not invent boundaries on a missing-data failure and supports retry",async()=>{
    const retry=vi.fn();await act(async()=>root.render(<WeatherBlankMap features={[]} points={[]} error="지역 경계를 찾을 수 없어요." onRetry={retry}/>));
    expect(container.querySelector("path")).toBeNull();expect(container.querySelector('[role="alert"]')?.textContent).toContain("지역 경계를 찾을 수 없어요.");
    await act(async()=>container.querySelector("button:not([aria-label])")!.dispatchEvent(new MouseEvent("click",{bubbles:true})));expect(retry).toHaveBeenCalledOnce();
    await act(async()=>root.render(<WeatherBlankMap features={[]} points={[]} loading/>));expect(container.querySelector('[role="status"]')?.textContent).toContain("불러오고 있어요");
  });
});
