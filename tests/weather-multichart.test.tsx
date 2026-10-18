// @vitest-environment happy-dom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {WeatherMultiChart,type WeatherChartSeries} from "../src/components/WeatherMultiChart";

let container:HTMLDivElement,root:Root;
const series=(id:string,unit:string,values:(number|null)[],label=id):WeatherChartSeries=>({id,label,unit,color:id==="low"?"#277d99":"#b33b26",data:values.map((value,index)=>({label:`10/${index+1}`,value}))});
async function render(items:WeatherChartSeries[],kind?:"line"|"bar"){await act(async()=>root.render(<WeatherMultiChart series={items} kind={kind}/>));}
function marks(label:string,tag="circle"){return [...container.querySelectorAll<SVGElement>(`.weather-multi-chart__series[aria-label="${label}"] ${tag}`)];}

beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});

describe("multi-series weather graph",()=>{
  it("compares two temperatures on one shared unit scale, including negative values",async()=>{
    await render([series("low","℃",[-4,2],"최저 기온"),series("high","℃",[2,12],"최고 기온")]);
    expect(container.querySelectorAll(".weather-multi-chart__axis")).toHaveLength(1);
    expect(marks("최저 기온")[1].getAttribute("cy")).toBe(marks("최고 기온")[0].getAttribute("cy"));
    expect(Number(marks("최저 기온")[0].getAttribute("cy"))).toBeGreaterThan(Number(marks("최고 기온")[1].getAttribute("cy")));
    expect(container.querySelector("svg title")?.textContent).toContain("최저 기온, 최고 기온");
    expect(container.querySelector(".weather-multi-chart__legend")?.textContent).toContain("최저 기온 (℃)");
    expect(marks("최저 기온")[0].querySelector("title")?.textContent).toBe("10/1 · 최저 기온: -4℃");
  });
  it("labels each independent axis when units differ and does not imply a common value scale",async()=>{
    await render([series("temperature","℃",[2,4],"평균 기온"),series("rain","mm",[200,400],"강수량")]);
    const axes=[...container.querySelectorAll(".weather-multi-chart__axis")];
    expect(axes.map(axis=>axis.getAttribute("aria-label"))).toEqual(["℃ 축: 평균 기온","mm 축: 강수량"]);
    expect(axes[0].textContent).toContain("4");expect(axes[1].textContent).toContain("400");
    expect(container.querySelector(".weather-multi-chart__scale-note")?.textContent).toContain("같은 높이가 같은 값을 뜻하지 않아요");
    expect(marks("평균 기온")[1].getAttribute("cy")).toBe(marks("강수량")[1].getAttribute("cy"));
  });
  it("keeps each series' gaps independent and preserves exact tooltip precision",async()=>{
    await render([series("low","℃",[-3.125,-1,null,3,4],"기온"),series("rain","mm",[null,2,3,null,0],"강수량")]);
    const temperatureLines=marks("기온","polyline"),rainLines=marks("강수량","polyline");
    expect(temperatureLines).toHaveLength(2);expect(rainLines).toHaveLength(1);
    expect(temperatureLines.map(line=>line.getAttribute("points")?.split(" ").length)).toEqual([2,2]);
    expect(marks("기온")).toHaveLength(4);expect(marks("강수량")).toHaveLength(3);
    expect(marks("기온")[0].querySelector("title")?.textContent).toBe("10/1 · 기온: -3.125℃");
    expect(container.querySelector("desc")?.textContent).toContain("빈 구간은 자료 없음");
  });
  it("reports missing series without fabricating values and distinguishes a real zero",async()=>{
    await render([series("low","℃",[null,null],"기온"),series("rain","mm",[0,null],"강수량")]);
    expect(container.querySelector(".weather-multi-chart__legend")?.textContent).toContain("기온 (℃) · 자료 없음");
    expect(marks("기온")).toHaveLength(0);expect(marks("강수량")).toHaveLength(1);
    expect(marks("강수량")[0].getAttribute("aria-label")).toBe("10/1 · 강수량: 0mm");
    await render([series("low","℃",[null,Number.NaN])]);
    expect(container.querySelector("svg")).toBeNull();expect(container.textContent).toContain("해당 기간의 관측자료가 없어요");
  });
  it("draws grouped bars side by side with shared same-unit baseline and honest zero height",async()=>{
    await render([series("low","℃",[-2,0],"최저 기온"),series("high","℃",[4,6],"최고 기온")],"bar");
    const low=marks("최저 기온","rect"),high=marks("최고 기온","rect");
    expect(low).toHaveLength(2);expect(high).toHaveLength(2);
    const endOfLow=Number(low[0].getAttribute("x"))+Number(low[0].getAttribute("width"));
    expect(endOfLow).toBeLessThan(Number(high[0].getAttribute("x")));
    expect(low[1].getAttribute("height")).toBe("0");
    expect(Number(low[0].getAttribute("y"))).toBeGreaterThan(Number(high[0].getAttribute("y")));
    expect(high[1].querySelector("title")?.textContent).toBe("10/2 · 최고 기온: 6℃");
  });
  it("combines bars and lines, painting lines last while retaining unit scales and missing gaps",async()=>{
    const temperature={...series("low","℃",[-2,null,3,4],"기온"),kind:"line" as const};
    const rain={...series("rain","mm",[2,0,null,4],"강수량"),kind:"bar" as const};
    await render([temperature,rain]);
    expect([...container.querySelectorAll(".weather-multi-chart__series")].map(item=>item.getAttribute("aria-label"))).toEqual(["강수량","기온"]);
    expect(marks("강수량","rect")).toHaveLength(3);expect(marks("기온")).toHaveLength(3);
    expect(marks("기온","polyline")).toHaveLength(1);
    expect(marks("기온","polyline")[0].getAttribute("points")?.split(" ")).toHaveLength(2);
    expect(marks("강수량","rect")[1].getAttribute("height")).toBe("0");
    expect(container.querySelectorAll(".weather-multi-chart__axis")).toHaveLength(2);
    expect(container.querySelector("svg title")?.textContent).toBe("기온, 강수량 혼합 그래프");
    expect(container.querySelector(".weather-multi-chart__legend")?.textContent).toContain("기온 (℃) · 꺾은선");
    expect(container.querySelector(".weather-multi-chart__legend")?.textContent).toContain("강수량 (mm) · 막대");
  });
  it("groups only bar series so adding a line does not narrow or offset bars",async()=>{
    const low={...series("low","℃",[-2,0],"최저 기온"),kind:"bar" as const};
    const high={...series("high","℃",[4,6],"최고 기온"),kind:"bar" as const};
    await render([low,high]);
    const geometry=(label:string)=>marks(label,"rect").map(mark=>[mark.getAttribute("x"),mark.getAttribute("width")]);
    const original=[geometry("최저 기온"),geometry("최고 기온")];
    await render([{...series("average","℃",[1,3],"평균 기온"),kind:"line"},low,high]);
    expect([geometry("최저 기온"),geometry("최고 기온")]).toEqual(original);
    expect(container.querySelectorAll(".weather-multi-chart__axis")).toHaveLength(1);
    const zeroBar=marks("최저 기온","rect")[1],baseline=Number(zeroBar.getAttribute("y"));
    expect(Number(marks("최저 기온","rect")[0].getAttribute("y"))).toBe(baseline);
    expect(Number(marks("평균 기온")[0].getAttribute("cy"))).toBeLessThan(baseline);
  });
  it("lets each series override the fallback and updates its shape when its selected kind changes",async()=>{
    const low=series("low","℃",[-2,3],"기온"),rain=series("rain","mm",[2,4],"강수량");
    await render([{...low,kind:"line"},rain],"bar");
    expect(marks("기온")).toHaveLength(2);expect(marks("기온","rect")).toHaveLength(0);
    expect(marks("강수량","rect")).toHaveLength(2);
    await render([{...low,kind:"bar"},{...rain,kind:"line"}],"bar");
    expect(marks("기온")).toHaveLength(0);expect(marks("기온","rect")).toHaveLength(2);
    expect(marks("강수량","rect")).toHaveLength(0);expect(marks("강수량")).toHaveLength(2);
    await render([{...low,kind:"bar"},{...rain,kind:"bar"}]);
    expect(container.querySelector("svg title")?.textContent).toBe("기온, 강수량 막대그래프");
    await render([low]);
    expect(container.querySelector("svg title")?.textContent).toBe("기온 꺾은선그래프");
  });
  it("keeps every daily bucket even when displayed date labels repeat across years",async()=>{
    const item=series("low","℃",Array.from({length:366},(_,index)=>index));item.data[365].label=item.data[0].label;
    await render([item]);
    expect(marks("low")).toHaveLength(366);
    expect(marks("low")[0].getAttribute("cx")).not.toBe(marks("low")[365].getAttribute("cx"));
    expect(Number.parseFloat(container.querySelector<SVGElement>("svg")!.style.minWidth)).toBeGreaterThan(330);
  });
});
