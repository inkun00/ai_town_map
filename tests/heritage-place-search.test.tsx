// @vitest-environment happy-dom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type KakaoMapComponent from "../src/components/KakaoMap";
import type { KakaoApi, KakaoPlace } from "../src/components/KakaoMap";

const probes = vi.hoisted(() => ({ search: vi.fn(), locate: vi.fn() }));
vi.mock("../src/lib/geolocation", () => ({ acquirePrecisePosition: probes.locate, GeolocationMeasurementError: class extends Error { constructor(public code: string, message: string) { super(message); } } }));
vi.mock("next/script", async () => {
  const { useEffect } = await import("react");
  return { default: ({ onReady }: { onReady: () => void }) => { useEffect(() => onReady(), []); return null; } };
});
vi.mock("../src/components/PointInteraction", () => ({ PointInteraction: () => null }));

type MapEvent = (event?: { latLng: { getLat: () => number; getLng: () => number } }) => void;
const listeners = new Map<string, MapEvent>();
const setCenter = vi.fn(), onPick = vi.fn();
const overlays: { content: HTMLElement; xAnchor: number; yAnchor: number; setMap: ReturnType<typeof vi.fn> }[] = [];
let container: HTMLDivElement, root: Root, KakaoMap: typeof KakaoMapComponent;
function sdk(): KakaoApi {
  const coordinates = { getLat: () => 37, getLng: () => 127 };
  return { maps: { load: (callback: () => void) => callback(),
    Map: class { setCenter = setCenter; setLevel() {} relayout() {} getBounds() { return { getSouthWest: () => coordinates, getNorthEast: () => coordinates }; } },
    LatLng: class { constructor(public lat: number, public lng: number) {} },
    Marker: class { setMap() {} }, Circle: class { setMap() {} }, MarkerImage: class {}, Size: class {}, Point: class {},
    CustomOverlay: class {
      content: HTMLElement;
      xAnchor: number;
      yAnchor: number;
      setMap = vi.fn((map: unknown) => { if (map === null) this.content.remove(); });
      constructor(options: { content: HTMLElement; xAnchor: number; yAnchor: number }) {
        this.content = options.content; this.xAnchor = options.xAnchor; this.yAnchor = options.yAnchor; overlays.push(this);
        container.querySelector(".kakao-map")!.appendChild(this.content);
      }
    },
    services: { Places: class { keywordSearch = probes.search; }, Status: { OK: "OK" } },
    event: { addListener: (_target: unknown, name: string, callback: MapEvent) => listeners.set(name, callback), removeListener: (_target: unknown, name: string) => listeners.delete(name) },
  } } as unknown as KakaoApi;
}
function button(text: string) {
  const found = [...container.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent?.trim() === text);
  if (!found) throw new Error(`Missing button: ${text}`);
  return found;
}
async function query(value: string) {
  const input = container.querySelector("input")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
async function search(value = "지역 문화유산") { await query(value); await act(async () => button("검색").click()); }
const places: KakaoPlace[] = [
  { id: "first", x: "126.7", y: "37.5", place_name: "같은 이름의 유산", road_address_name: "인천광역시 첫 번째 길 1" },
  { id: "second", x: "126.8", y: "37.6", place_name: "원하는 문화유산", address_name: "인천광역시 두 번째 동 2" },
];
async function results(values = places, index = 0, pagination?: unknown) {
  await act(async () => probes.search.mock.calls[index][1](values, "OK", pagination));
}
beforeEach(async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.stubGlobal("ResizeObserver", class { observe() {} disconnect() {} });
  vi.stubEnv("NEXT_PUBLIC_KAKAO_JAVASCRIPT_KEY", "test-key");
  KakaoMap = (await import("../src/components/KakaoMap")).default;
  probes.search.mockReset(); probes.locate.mockReset(); onPick.mockReset(); setCenter.mockReset(); listeners.clear(); overlays.length = 0;
  window.kakao = sdk(); container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  await act(async () => root.render(<KakaoMap onPick={onPick}/>));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); delete window.kakao; vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("heritage location selection without GPS", () => {
  it("renders weather values as safe clickable text, reports selection, and removes outdated overlays without GPS", async () => {
    const onSelect = vi.fn(), label = '<img src=x onerror="alert(1)"> 18°C';
    const points = [{ id: "weather-point", title: "가상 관측 지역", emoji: "🌡️", color: "#0369A1", label, location: { lat: 37.5, lng: 126.7 } }];
    await act(async () => root.render(<KakaoMap autoLocate={false} points={points} onSelectPoint={onSelect}/>));
    const first = overlays.at(-1)!, content = first.content;
    expect(first.xAnchor).toBe(.5); expect(first.yAnchor).toBe(0);
    expect(content.className).toBe("map-point-value");
    expect(content.tagName).toBe("BUTTON"); expect(content.textContent).toBe(label); expect(content.querySelector("img")).toBeNull();
    expect(content.getAttribute("aria-label")).toBe("가상 관측 지역"); expect(content.getAttribute("aria-pressed")).toBe("false");
    await act(async () => content.click()); expect(onSelect).toHaveBeenCalledExactlyOnceWith("weather-point");
    await act(async () => root.render(<KakaoMap autoLocate={false} points={points} selectedId="weather-point" onSelectPoint={onSelect}/>));
    expect(first.setMap).toHaveBeenCalledWith(null); expect(content.isConnected).toBe(false);
    await act(async () => content.click()); expect(onSelect).toHaveBeenCalledTimes(1);
    const selected = overlays.at(-1)!; expect(selected.content.getAttribute("aria-pressed")).toBe("true");
    await act(async () => root.render(<KakaoMap autoLocate={false} points={[]} onSelectPoint={onSelect}/>));
    expect(selected.setMap).toHaveBeenCalledWith(null); expect(container.querySelector(".map-point-value")).toBeNull();
    expect(probes.locate).not.toHaveBeenCalled();
  });

  it("never requests GPS on opening and accepts a map tap directly", async () => {
    expect(probes.locate).not.toHaveBeenCalled();
    await act(async () => listeners.get("click")?.({ latLng: { getLat: () => 37.6, getLng: () => 126.8 } }));
    expect(onPick).toHaveBeenCalledExactlyOnceWith({ lat: 37.6, lng: 126.8 }, "manual");
    expect(probes.locate).not.toHaveBeenCalled();
  });

  it("shows names and addresses and selects only the result the user chooses", async () => {
    await search(); await results();
    expect(container.textContent).toContain(places[0].road_address_name);
    expect(container.textContent).toContain(places[1].address_name);
    expect(onPick).not.toHaveBeenCalled(); expect(setCenter).not.toHaveBeenCalled();
    await act(async () => container.querySelectorAll<HTMLButtonElement>(".kakao-place-result")[1].click());
    expect(onPick).toHaveBeenCalledExactlyOnceWith({ lat: 37.6, lng: 126.8 }, "search", "원하는 문화유산");
    expect(container.querySelector(".kakao-place-results")).toBeNull();
    expect(probes.locate).not.toHaveBeenCalled();
  });

  it("invalidates a pending search when the text changes, even before a new request", async () => {
    await search(); await query("다른 문화유산"); await results();
    expect(container.querySelector(".kakao-place-results")).toBeNull(); expect(onPick).not.toHaveBeenCalled();
    await search("새 문화유산"); await results([places[1]], 1);
    expect(container.querySelectorAll(".kakao-place-result")).toHaveLength(1);
    expect(container.textContent).toContain("원하는 문화유산");
  });

  it("keeps a manual selection when an older search finishes later", async () => {
    await search();
    await act(async () => listeners.get("click")?.({ latLng: { getLat: () => 35.1, getLng: () => 129.1 } }));
    await results();
    expect(onPick).toHaveBeenCalledExactlyOnceWith({ lat: 35.1, lng: 129.1 }, "manual");
    expect(container.querySelector(".kakao-place-results")).toBeNull(); expect(setCenter).not.toHaveBeenCalled();
  });

  it("discards invalid coordinates without hiding valid places", async () => {
    await search(); await results([{ ...places[0], x: "NaN" }, { ...places[0], y: "91" }, { ...places[0], x: "" }, places[1]]);
    expect(container.querySelectorAll(".kakao-place-result")).toHaveLength(1);
    await act(async () => container.querySelector<HTMLButtonElement>(".kakao-place-result")!.click());
    expect(onPick).toHaveBeenCalledExactlyOnceWith({ lat: 37.6, lng: 126.8 }, "search", "원하는 문화유산");
  });

  it("offers result pages and ignores a page response after a manual map tap", async () => {
    const nextPage = vi.fn(), prevPage = vi.fn();
    await search(); await results(places, 0, { current: 1, hasPrevPage: false, hasNextPage: true, prevPage, nextPage });
    expect(button("이전 결과").disabled).toBe(true);
    await act(async () => button("다음 결과").click()); expect(nextPage).toHaveBeenCalledOnce();
    await act(async () => listeners.get("click")?.({ latLng: { getLat: () => 37.6, getLng: () => 126.8 } }));
    await results([places[1]], 0, { current: 2, hasPrevPage: true, hasNextPage: false, prevPage, nextPage });
    expect(container.querySelector(".kakao-place-results")).toBeNull();
    expect(onPick).toHaveBeenCalledExactlyOnceWith({ lat: 37.6, lng: 126.8 }, "manual");
  });
});
