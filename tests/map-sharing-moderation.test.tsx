// @vitest-environment happy-dom
import {act} from "react";
import {createRoot,type Root} from "react-dom/client";
import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {ModerationCenter} from "../src/components/CommunityControls";

type Settings={visibility:"public"|"invite_only";passwordEnabled?:boolean;participation:"invited"|"admin_only"|"closed";moderation:"immediate"|"approval";commentsEnabled:boolean;status:"active"|"archived";version:string};
const mapId="10000000-0000-4000-8000-000000000001";
let container:HTMLDivElement,root:Root,settings:Settings,isOwner:boolean;
const fetchSpy=vi.fn(),notice=vi.fn(),changed=vi.fn();
function ok(data:unknown={items:[]}){return {ok:true,json:async()=>({data})};}
function button(label:string){const button=[...container.querySelectorAll<HTMLButtonElement>("button")].find(item=>item.textContent===label);if(!button)throw new Error(`Button missing: ${label}`);return button;}
async function click(label:string){await act(async()=>button(label).click());}
async function render(){await act(async()=>root.render(<ModerationCenter mapId={mapId} csrfToken="owner-csrf" isOwner={isOwner} settings={settings} onNotice={notice} onChanged={changed} onDeleted={()=>{}}/>));}
async function setVisibility(value:"public"|"invite_only"){const radio=container.querySelector<HTMLInputElement>(`input[type=radio][value=${value}]`)!;await act(async()=>radio.click());}
async function fillPassword(value:string){const input=container.querySelector<HTMLInputElement>("input[type=password]")!;await act(async()=>{Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,"value")!.set!.call(input,value);input.dispatchEvent(new Event("input",{bubbles:true}));});}
function writes(){return fetchSpy.mock.calls.filter(([,options])=>options?.method==="PATCH");}

beforeEach(()=>{
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);fetchSpy.mockReset().mockResolvedValue(ok());vi.stubGlobal("fetch",fetchSpy);notice.mockReset();changed.mockReset();isOwner=true;
  settings={visibility:"public",passwordEnabled:false,participation:"invited",moderation:"immediate",commentsEnabled:true,status:"active",version:"8"};container=document.createElement("div");document.body.appendChild(container);root=createRoot(container);
});
afterEach(async()=>{await act(async()=>root.unmount());container.remove();vi.unstubAllGlobals();});

describe("owner contribution sharing settings",()=>{
  it("saves partial sharing with an optional password and includes CSRF/resource version",async()=>{
    await render();await click("설정");expect(container.textContent).toContain("모든 지도는 누구나 볼 수 있어요.");expect(button("공유 설정 저장").disabled).toBe(true);await setVisibility("invite_only");await fillPassword("town-password");await click("공유 설정 저장");
    expect(writes()).toHaveLength(1);const [url,options]=writes()[0];expect(url).toBe(`/api/v1/maps/${mapId}`);expect(options.headers["X-CSRF-Token"]).toBe("owner-csrf");expect(options.headers["X-Resource-Version"]).toBe('"8"');expect(JSON.parse(options.body)).toEqual({visibility:"invite_only",participationPassword:"town-password"});expect(changed).toHaveBeenCalledTimes(1);expect(notice).toHaveBeenCalledWith("공유 설정을 저장했습니다.");expect(container.querySelector<HTMLInputElement>("input[type=password]")?.value).toBe("");
  });

  it("allows teacher-code-only sharing and does not send a blank password",async()=>{
    await render();await click("설정");await setVisibility("invite_only");expect(container.textContent).toContain("교사가 발급한 인증코드로만");await click("공유 설정 저장");expect(JSON.parse(writes()[0][1].body)).toEqual({visibility:"invite_only"});
  });

  it("preserves an existing password on empty input and excludes hidden drafts when switching to full sharing",async()=>{
    settings={...settings,visibility:"invite_only",passwordEnabled:true};await render();await click("설정");expect(container.textContent).toContain("비워 두면 현재 비밀번호를 유지해요");expect(button("공유 설정 저장").disabled).toBe(true);await fillPassword("hidden-password");await setVisibility("public");expect(container.querySelector("input[type=password]")).toBeNull();await click("공유 설정 저장");expect(JSON.parse(writes()[0][1].body)).toEqual({visibility:"public"});
  });

  it("validates replacement passwords and retains them after a server rejection for retry",async()=>{
    settings={...settings,visibility:"invite_only",passwordEnabled:true};fetchSpy.mockImplementation(async(_url,options)=>options?.method==="PATCH"?{ok:false,json:async()=>({error:{message:"지도 설정이 변경됐어요. 다시 확인해 주세요."}})}:ok());await render();await click("설정");await fillPassword("123");expect(button("공유 설정 저장").disabled).toBe(true);expect(container.querySelector("[role=alert]")?.textContent).toContain("4~100자");expect(writes()).toHaveLength(0);
    await fillPassword("correct-password");await click("공유 설정 저장");expect(notice).toHaveBeenCalledWith("지도 설정이 변경됐어요. 다시 확인해 주세요.");expect(container.querySelector<HTMLInputElement>("input[type=password]")?.value).toBe("correct-password");expect(changed).not.toHaveBeenCalled();
  });

  it("keeps registration suspension separate from sharing and only exposes sharing controls to the owner",async()=>{
    await render();await click("설정");const select=container.querySelector<HTMLSelectElement>('select[aria-label="위치포인트 등록 운영"]')!;expect([...select.options].map(option=>option.text)).toEqual(["공유 설정에 따라 참여자 등록","관리자만 등록","등록 마감"]);await act(async()=>{select.value="closed";select.dispatchEvent(new Event("change",{bubbles:true}));});expect(JSON.parse(writes()[0][1].body)).toEqual({participation:"closed"});
    isOwner=false;await render();expect(container.querySelector("input[type=radio]")).toBeNull();expect(container.textContent).not.toContain("공유 설정 저장");
  });
});
