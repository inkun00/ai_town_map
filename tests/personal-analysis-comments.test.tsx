// @vitest-environment happy-dom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {CommentSection} from "../src/components/CommunityControls";

const ownComment={id:"comment-own",body:"횡단보도를 건널 때 신호를 확인해요.",status:"visible",version:"2",author:"내 닉네임",createdAt:"2026-10-10T00:00:00Z",canEdit:true,canModerate:true};
const hiddenComment={id:"comment-hidden",body:"관리자가 검토 중인 댓글",status:"hidden",version:"3",author:"다른 참여자",createdAt:"2026-10-10T00:10:00Z",canEdit:false,canModerate:true};
let container:HTMLDivElement;
let root:Root;
const fetchSpy=vi.fn();
const notice=vi.fn();
async function render(readOnly?:boolean){
  await act(async()=>{root.render(<CommentSection mapId="map-a" observationId="point-a" enabled canWrite canModerate csrfToken="test-token" onNotice={notice} readOnly={readOnly}/>);});
}
function button(text:string){return [...container.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.textContent?.trim()===text);}
function expectOnlyReads(){
  expect(fetchSpy).toHaveBeenCalled();
  expect(fetchSpy.mock.calls.every(([,options])=>!options?.method||options.method==="GET")).toBe(true);
}

beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  fetchSpy.mockReset();notice.mockReset();
  fetchSpy.mockResolvedValue({ok:true,json:async()=>({data:{items:[ownComment,hiddenComment]}})});
  vi.stubGlobal("fetch",fetchSpy);
  container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});

describe("comments in a personal analysis map",()=>{
  it("shows comment bodies while read-only overrides ownership, writing and moderation permissions",async()=>{
    await render(true);
    expect(container.textContent).toContain(ownComment.body);
    expect(container.textContent).toContain(hiddenComment.body);
    expect(container.querySelectorAll("button,form,input,textarea,select")).toHaveLength(0);
    expectOnlyReads();
    expect(notice).not.toHaveBeenCalled();
  });

  it("preserves shared-map comment actions and hides an open edit when switching to read-only",async()=>{
    await render();
    expect(button("수정")).toBeDefined();
    expect(button("삭제")).toBeDefined();
    expect(button("숨기기")).toBeDefined();
    expect(button("복구")).toBeDefined();
    expect(button("신고")).toBeDefined();
    expect(container.querySelector("form")).not.toBeNull();
    await act(async()=>{button("수정")!.click();});
    expect(container.querySelector("textarea")?.value).toBe(ownComment.body);
    expect(button("저장")).toBeDefined();
    await render(true);
    expect(container.textContent).toContain(ownComment.body);
    expect(container.querySelectorAll("button,form,input,textarea,select")).toHaveLength(0);
    expectOnlyReads();
    expect(notice).not.toHaveBeenCalled();
  });
});
