import { describe, expect, it, vi } from "vitest";
import { attachUnsavedRecordGuard } from "../src/lib/unsaved-record-guard";

function fixture(answer = false) {
  const events = new EventTarget();
  const target = {
    addEventListener: events.addEventListener.bind(events), removeEventListener: events.removeEventListener.bind(events),
    location: { href: "https://example.test/?map=one", reload: vi.fn() },
    history: { state: { router: "preserved" }, pushState: vi.fn() }, confirm: vi.fn(() => answer),
  };
  const dispose = attachUnsavedRecordGuard(target as unknown as Window);
  return { events, target, dispose };
}
describe("unsaved record navigation", () => {
  it("requests the native refresh warning and removes it on cleanup", () => {
    const f = fixture();
    const event = new Event("beforeunload", { cancelable: true });
    Object.defineProperty(event, "returnValue", { value: "", writable: true });
    f.events.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
    f.dispose();
    const saved = new Event("beforeunload", { cancelable: true });
    f.events.dispatchEvent(saved);
    expect(saved.defaultPrevented).toBe(false);
  });
  it("restores the original URL and router state when Back is canceled", () => {
    const f = fixture();
    f.target.location.href = "https://example.test/";
    f.events.dispatchEvent(new Event("popstate"));
    expect(f.target.history.pushState).toHaveBeenCalledWith({ router: "preserved" }, "", "https://example.test/?map=one");
    expect(f.target.location.reload).not.toHaveBeenCalled();
  });
  it("applies accepted Back without prompting a second time", () => {
    const f = fixture(true);
    f.events.dispatchEvent(new Event("popstate"));
    expect(f.target.location.reload).toHaveBeenCalledOnce();
    const event = new Event("beforeunload", { cancelable: true });
    Object.defineProperty(event, "returnValue", { value: "", writable: true });
    f.events.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    expect(f.target.history.pushState).not.toHaveBeenCalled();
  });
});
