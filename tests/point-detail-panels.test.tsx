// @vitest-environment happy-dom
import {act,useState,type ComponentProps} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {PointDetailPanels} from "../src/components/PointDetailPanels";
import {CommentSection} from "../src/components/CommunityControls";

let container:HTMLDivElement;
let root:Root;
const fetchSpy=vi.fn();
const notice=vi.fn();
const commentDirty=vi.fn();
const commentBusy=vi.fn();
const ownComment={id:"comment-own",body:"학교 앞 횡단보도는 신호가 길어요.",status:"visible",version:"1",author:"내 닉네임",createdAt:"2026-10-10T00:00:00Z",canEdit:true,canModerate:true};

function EditFields(){
  const [title,setTitle]=useState("기존 장소 이름");
  return <label>수정할 장소 이름<input aria-label="수정할 장소 이름" value={title} onChange={event=>setTitle(event.target.value)}/></label>;
}
function comments(readOnly=false){return <CommentSection mapId="map-a" observationId="point-a" enabled canWrite canModerate csrfToken="test-token" onNotice={notice} readOnly={readOnly} onDirtyChange={commentDirty} onBusyChange={commentBusy}/>;}
async function render(props:ComponentProps<typeof PointDetailPanels>={}){
  await act(async()=>{root.render(<article aria-label="위치 기록 상세"><h2>학교 앞 신호등</h2><p>등록한 장소 설명</p><PointDetailPanels {...props}/></article>);});
}
function button(label:string){
  return [...container.querySelectorAll<HTMLButtonElement>("button")].find(item=>{
    const accessible=item.cloneNode(true) as HTMLElement;
    accessible.querySelectorAll("[aria-hidden='true']").forEach(child=>child.remove());
    return item.getAttribute("aria-label")===label||accessible.textContent?.trim()===label;
  });
}
async function click(label:string){
  const target=button(label);expect(target).toBeDefined();
  await act(async()=>{target!.click();});
}
async function fill(input:HTMLInputElement,value:string){
  await act(async()=>{
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);
    input.dispatchEvent(new Event("input",{bubbles:true}));
    input.dispatchEvent(new Event("change",{bubbles:true}));
  });
}
function controlledRegion(label:string){
  const target=button(label)!;
  const id=target.getAttribute("aria-controls");
  expect(id).toBeTruthy();
  const region=document.getElementById(id!);
  expect(region?.getAttribute("role")).toBe("region");
  return region!;
}

beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
  fetchSpy.mockReset();notice.mockReset();commentDirty.mockReset();commentBusy.mockReset();
  fetchSpy.mockResolvedValue({ok:true,json:async()=>({data:{items:[ownComment]}})});
  vi.stubGlobal("fetch",fetchSpy);
  container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});

describe("expandable point detail panels",()=>{
  it("starts with information only, expands independent panels below it and preserves unsaved edit input",async()=>{
    await render({edit:<EditFields/>,comments:<label>댓글 초안<input aria-label="댓글 초안"/></label>});
    expect(container.textContent).toContain("등록한 장소 설명");
    expect(button("기록 수정")?.getAttribute("aria-expanded")).toBe("false");
    expect(button("댓글")?.getAttribute("aria-expanded")).toBe("false");
    expect(container.querySelectorAll("input,textarea,form")).toHaveLength(0);
    await click("기록 수정");
    const editRegion=controlledRegion("기록 수정");
    expect(editRegion.hidden).toBe(false);
    expect(button("기록 수정")?.getAttribute("aria-expanded")).toBe("true");
    const title=editRegion.querySelector<HTMLInputElement>("input")!;
    await fill(title,"학교 북쪽 신호등");
    expect(title.value).toBe("학교 북쪽 신호등");
    await click("댓글");
    expect(controlledRegion("댓글").hidden).toBe(false);
    expect(editRegion.hidden).toBe(false);
    expect(button("기록 수정")?.getAttribute("aria-expanded")).toBe("true");
    await click("기록 수정");
    expect(editRegion.hidden).toBe(true);
    expect(controlledRegion("댓글").hidden).toBe(false);
    expect(editRegion.querySelector("input")).toBe(title);
    await click("기록 수정");
    expect(controlledRegion("기록 수정").hidden).toBe(false);
    expect(controlledRegion("기록 수정").querySelector<HTMLInputElement>("input")?.value).toBe("학교 북쪽 신호등");
    const information=container.querySelector("article > p")!;
    expect(information.compareDocumentPosition(editRegion)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("loads comments only after expansion and submits the real comment form from the same detail panel",async()=>{
    let items=[ownComment];
    fetchSpy.mockImplementation(async(_url:string,options?:RequestInit)=>{
      if(options?.method==="POST")items=[...items,{...ownComment,id:"comment-new",body:JSON.parse(String(options.body)).body}];
      return {ok:true,json:async()=>({data:{items}})};
    });
    await render({comments:comments()});
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(container.querySelector("form")).toBeNull();
    await click("댓글");
    expect(container.textContent).toContain(ownComment.body);
    const commentRegion=controlledRegion("댓글");
    const input=commentRegion.querySelector<HTMLInputElement>("input[placeholder='의견을 남겨주세요']")!;
    await fill(input,"보도 턱도 낮아서 걷기 편해요.");
    expect(commentDirty).toHaveBeenLastCalledWith(true);
    await click("댓글");
    expect(commentRegion.hidden).toBe(true);
    expect(commentDirty).toHaveBeenLastCalledWith(true);
    await click("댓글");
    expect(controlledRegion("댓글").querySelector("input[placeholder='의견을 남겨주세요']")).toBe(input);
    expect(input.value).toBe("보도 턱도 낮아서 걷기 편해요.");
    const form=input.closest("form")!;
    await act(async()=>{form.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});
    const mutation=fetchSpy.mock.calls.find(([,options])=>options?.method==="POST");
    expect(mutation?.[0]).toBe("/api/v1/maps/map-a/observations/point-a/comments");
    expect(JSON.parse(String(mutation?.[1].body))).toEqual({body:"보도 턱도 낮아서 걷기 편해요."});
    expect(commentRegion.textContent).toContain("보도 턱도 낮아서 걷기 편해요.");
    expect(input.value).toBe("");
    expect(commentDirty).toHaveBeenLastCalledWith(false);
    expect(notice).not.toHaveBeenCalled();
  });

  it("offers no record edit or management without permission and keeps analysis comments read-only",async()=>{
    await render({comments:comments(true)});
    expect(button("기록 수정")).toBeUndefined();
    expect([...container.querySelectorAll("summary")].some(item=>item.textContent?.includes("기록 관리"))).toBe(false);
    expect(container.querySelectorAll("input,form,textarea")).toHaveLength(0);
    await click("댓글");
    const commentRegion=controlledRegion("댓글");
    expect(commentRegion.textContent).toContain(ownComment.body);
    expect(commentRegion.querySelectorAll("button,input,form,textarea,select")).toHaveLength(0);
    expect(button("기록 수정")).toBeUndefined();
    expect(fetchSpy.mock.calls.every(([,options])=>!options?.method||options.method==="GET")).toBe(true);
  });

  it("keeps optional record management collapsed and removes it when the caller has no management access",async()=>{
    await render({management:<button type="button">내 기록 삭제</button>});
    const details=container.querySelector("details");
    expect(details).not.toBeNull();
    expect(details?.open).toBe(false);
    expect(details?.querySelector("summary")?.textContent).toContain("기록 관리");
    expect(button("내 기록 삭제")).toBeUndefined();
    await render();
    expect(container.querySelector("details")).toBeNull();
    expect(button("내 기록 삭제")).toBeUndefined();
  });

  it("reports pending comment work, preserves failed input while folded and excludes read-only drafts from dirty state",async()=>{
    let rejectPost!:(reason:Error)=>void;
    const post=new Promise((_resolve,reject)=>{rejectPost=reject;});
    fetchSpy.mockImplementation(async(_url:string,options?:RequestInit)=>options?.method==="POST"?post:{ok:true,json:async()=>({data:{items:[ownComment]}})});
    await render({comments:comments()});
    await click("댓글");
    const commentRegion=controlledRegion("댓글");
    const input=commentRegion.querySelector<HTMLInputElement>("input[placeholder='의견을 남겨주세요']")!;
    await fill(input,"이곳의 안내판 글자가 커서 읽기 좋아요.");
    await act(async()=>{input.closest("form")!.dispatchEvent(new Event("submit",{bubbles:true,cancelable:true}));});
    expect(commentBusy).toHaveBeenLastCalledWith(true);
    expect(commentDirty).toHaveBeenLastCalledWith(true);
    expect(button("등록")?.disabled).toBe(true);
    await act(async()=>{rejectPost(new Error("네트워크 연결을 확인해 주세요."));});
    expect(commentBusy).toHaveBeenLastCalledWith(false);
    expect(commentDirty).toHaveBeenLastCalledWith(true);
    expect(notice).toHaveBeenLastCalledWith("네트워크 연결을 확인해 주세요.");
    expect(input.value).toBe("이곳의 안내판 글자가 커서 읽기 좋아요.");
    await click("댓글");
    expect(commentDirty).toHaveBeenLastCalledWith(true);
    await click("댓글");
    expect(commentRegion.querySelector("input[placeholder='의견을 남겨주세요']")).toBe(input);
    await render({comments:comments(true)});
    expect(controlledRegion("댓글").querySelectorAll("input,textarea,form,button")).toHaveLength(0);
    expect(controlledRegion("댓글").textContent).toContain(ownComment.body);
    expect(commentDirty).toHaveBeenLastCalledWith(false);
    expect(fetchSpy.mock.calls.filter(([,options])=>options?.method==="POST")).toHaveLength(1);
  });
});
