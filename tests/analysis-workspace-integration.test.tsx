// @vitest-environment happy-dom
import {act,useState} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {AnalysisPanel} from "../src/components/AnalysisControls";
import {themeByKey} from "../src/lib/demo-data";

let container:HTMLDivElement,root:Root;
function Writing(){const [text,setText]=useState("");return <label>내 분석<input aria-label="내 분석" value={text} onChange={e=>setText(e.target.value)}/></label>;}
const props={theme:themeByKey.ecology,filter:{},onChange:vi.fn(),data:null,loading:false,error:"",mapId:"test-map",canExport:false,onShowRecords:vi.fn(),onRefresh:vi.fn()};
beforeEach(()=>{vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);container=document.createElement("div");document.body.append(container);root=createRoot(container);});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});

it("preserves student's manual writing while viewing statistics or original records",async()=>{
  const render=async(hidden=false)=>act(async()=>root.render(<AnalysisPanel {...props} hidden={hidden}><Writing/></AnalysisPanel>));
  await render();
  const study=[...container.querySelectorAll("button")].find(b=>b.textContent==="AI 참고·나의 글")!;
  await act(async()=>study.click());
  const input=container.querySelector<HTMLInputElement>('input[aria-label="내 분석"]')!;
  await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,"원본을 확인한 나의 판단");input.dispatchEvent(new Event("input",{bubbles:true}));});
  const statistics=[...container.querySelectorAll("button")].find(b=>b.textContent==="통계 보기")!;
  await act(async()=>statistics.click());
  expect(input.closest("[hidden]")).not.toBeNull();
  await act(async()=>study.click());
  expect(input.value).toBe("원본을 확인한 나의 판단");
  await render(true);
  expect(container.querySelector(".analysis-workspace")?.hasAttribute("hidden")).toBe(true);
  await render();
  expect(container.querySelector('input[aria-label="내 분석"]')).toBe(input);
  expect(input.value).toBe("원본을 확인한 나의 판단");
});
