import { describe, expect, it } from "vitest";
import { MapPager, mapListUrl, type MapPage, type PageState } from "../src/lib/map-directory";
import { inviteFeedback, validInviteInput } from "../src/lib/invite-feedback";

const deferred = <T>() => { let resolve!: (value: T) => void; let reject!: (reason: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
type Row = { id: string; title: string };

describe("map directory pages", () => {
  it("deduplicates overlaps and preserves the cursor and existing rows after a failed next page", async () => {
    const cursors: (string | null)[] = [];
    let attempt = 0;
    const pager = new MapPager<Row>(async cursor => {
      cursors.push(cursor);
      if (++attempt === 1) return { items: [{ id: "a", title: "old" }], nextCursor: "next" };
      if (attempt === 2) throw new Error("offline");
      return { items: [{ id: "a", title: "updated" }, { id: "b", title: "B" }], nextCursor: null };
    }, () => {});
    await pager.load(); await pager.load();
    expect(pager.state.items).toEqual([{ id: "a", title: "old" }]);
    expect(pager.state.nextCursor).toBe("next");
    expect(pager.state.error).toBe("offline");
    await pager.load(); await pager.load();
    expect(cursors).toEqual([null, "next", "next"]);
    expect(pager.state.items.map(row => row.title)).toEqual(["updated", "B"]);
    expect(pager.state.error).toBe("");
  });
  it("prevents rapid duplicate requests and ignores an old search result after disposal", async () => {
    const request = deferred<MapPage<Row>>();
    let calls = 0; let aborted = false;
    const updates: PageState<Row>[] = [];
    const pager = new MapPager<Row>((_cursor, signal) => { calls++; signal.addEventListener("abort", () => { aborted = true; }); return request.promise; }, value => updates.push(value));
    const first = pager.load(); await pager.load();
    pager.dispose();
    request.resolve({ items: [{ id: "stale", title: "old search" }], nextCursor: null });
    await first; await pager.load();
    expect(calls).toBe(1); expect(aborted).toBe(true);
    expect(updates).toHaveLength(1); expect(updates[0].items).toEqual([]);
  });
  it("can retry the first page and terminates empty results", async () => {
    let calls = 0;
    const pager = new MapPager<Row>(async () => { if (++calls === 1) throw new Error("network"); return { items: [], nextCursor: null }; }, () => {});
    await pager.load(); expect(pager.state.loaded).toBe(false);
    await pager.load(); await pager.load(); expect(calls).toBe(2);
    expect(pager.state).toMatchObject({ loaded: true, busy: false, error: "", items: [] });
  });
  it("keeps query, theme and scope on subsequent requests without URL injection", () => {
    const params = new URL(mapListUrl("mine", "공원 &scope=public", "ecology", "a+b/="), "https://local.test").searchParams;
    expect(params.get("scope")).toBe("mine"); expect(params.get("limit")).toBe("20");
    expect(params.get("q")).toBe("공원 &scope=public"); expect(params.get("themeKey")).toBe("ecology"); expect(params.get("cursor")).toBe("a+b/=");
  });
});

describe("invite recovery guidance", () => {
  it("gives distinct recovery actions and bounded retry guidance", () => {
    expect(inviteFeedback("INVITE_EXPIRED")).toContain("기한");
    expect(inviteFeedback("INVITE_REVOKED")).toContain("중지");
    expect(inviteFeedback("INVITE_EXHAUSTED")).toContain("인원");
    expect(inviteFeedback("MAP_CLOSED")).toContain("다시 열어");
    expect(inviteFeedback("MEMBERSHIP_BLOCKED")).toContain("관리자");
    expect(inviteFeedback("INVITE_RATE_LIMIT", "90")).toContain("2분");
    expect(inviteFeedback("INVITE_RATE_LIMIT", "bad")).toContain("10분");
    expect(inviteFeedback("unknown")).not.toContain("undefined");
  });
  it("validates before submitting while accepting formatted or lowercase codes", () => {
    expect(validInviteInput(" abcd-efgh-jkmn ", "별칭")).toBe(true);
    expect(validInviteInput("abcdefghjkmn", "  ")).toBe(false);
    expect(validInviteInput("abcd-efgh-ijkl", "별칭")).toBe(false);
    expect(validInviteInput("bad", "별칭")).toBe(false);
  });
});
