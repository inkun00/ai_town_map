"use client";

import { useEffect, useRef, useState } from "react";
import { themes, themeByKey } from "@/lib/demo-data";
import { MapPager, mapListUrl, type LiveMap, type PageState } from "@/lib/map-directory";

const symbols = { ecology: "🌳", safety: "🚸", universal_design: "♿", weather_life: "☀️", custom: "✨" };
export type DirectoryScope = "public" | "mine";
const scopeTitles = { public: "함께 떠날 탐험 지도", mine: "내가 참여한 탐험" };

function DirectorySection({ scope, active, query, themeKey, onOpen }: {
  scope: DirectoryScope; active: boolean; query: string; themeKey: string; onOpen: (map: LiveMap) => void;
}) {
  const [page, setPage] = useState<PageState<LiveMap>>({ items: [], nextCursor: null, busy: true, error: "", loaded: false });
  const pager = useRef<MapPager<LiveMap> | null>(null);
  useEffect(() => {
    const current = new MapPager<LiveMap>(async (cursor, signal) => {
      const response = await fetch(mapListUrl(scope, query, themeKey, cursor), {
        cache: "no-store", signal: AbortSignal.any([signal, AbortSignal.timeout(15000)]),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error?.message ?? "목록을 불러오지 못했습니다.");
      return payload.data;
    }, setPage);
    pager.current = current;
    void current.load();
    return () => current.dispose();
  }, [scope, query, themeKey]);

  const title = scope === "public" ? "공개 지도" : "내가 참여한 지도";
  return <div id={`directory-panel-${scope}`} role="tabpanel" aria-labelledby={`directory-tab-${scope}`} hidden={!active}>
    <div className="directory-scroll" role="region" aria-label={`${scopeTitles[scope]} 목록`} tabIndex={0}>
    <div className="my-map-list" aria-busy={page.busy}>
      {page.items.map(map => <button type="button" key={map.id} onClick={() => onOpen(map)}>
        <span className={`my-map-list__emoji adventure-theme--${map.themeKey}`} aria-hidden="true">{symbols[map.themeKey]}</span>
        <span><strong>{map.title}</strong><small>{themeByKey[map.themeKey].label} · {map.location}</small><small>{map.status === "archived" ? "보관 중 · " : ""}{map.visibility === "invite_only" ? "초대 전용" : "공개 지도"}</small></span>
        <span className="map-entry-arrow" aria-hidden="true">›</span>
      </button>)}
    </div>
    <p className="directory-status" role="status">{page.busy ? "지도를 불러오고 있어요…" : page.loaded ? page.items.length ? `${page.items.length}개 표시${page.nextCursor ? " · 더 불러올 지도가 있어요" : " · 마지막 목록이에요"}` : "조건에 맞는 지도가 없어요." : ""}</p>
    {page.error && <p className="directory-error" role="alert">목록을 불러오지 못했어요. {page.error}</p>}
    {(page.error || page.nextCursor) && <button type="button" className="button button--light button--full" disabled={page.busy} onClick={() => void pager.current?.load()}>{page.busy ? "불러오는 중…" : page.error ? `${title} 다시 불러오기` : `${title} 더 보기`}</button>}
    </div>
  </div>;
}

export function MapDirectory({ signedIn, scope, onScopeChange, onOpen }: { signedIn: boolean; scope: DirectoryScope; onScopeChange: (scope: DirectoryScope) => void; onOpen: (map: LiveMap) => void }) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState("");
  useEffect(() => { const timer = setTimeout(() => setQuery(input.trim()), 300); return () => clearTimeout(timer); }, [input]);
  return <div id="map-directory">
    <section className="home-section directory-filters" aria-label="지도 검색 조건">
      <label className="search-field"><span aria-hidden="true">🔎</span><span className="sr-only">지도 검색</span><input maxLength={100} value={input} onChange={event => setInput(event.target.value)} placeholder="어디로 탐험을 떠날까요?" /></label>
      <label className="directory-theme">탐험 주제<select aria-label="주제" value={theme} onChange={event => setTheme(event.target.value)}><option value="">모든 주제</option>{themes.map(item => <option key={item.key} value={item.key}>{symbols[item.key]} {item.label}</option>)}</select></label>
      <p className="directory-status">지도 이름이나 지역으로 탐험할 곳을 찾아요.</p>
    </section>
    <section className="home-section map-directory-section" aria-label="탐험 지도 목록">
      <div className="directory-tabs" role="tablist" aria-label="탐험 지도 종류">
        {(["public", "mine"] as const).map(item => <button key={item} type="button" id={`directory-tab-${item}`} role="tab" aria-selected={scope === item} aria-controls={`directory-panel-${item}`} tabIndex={scope === item ? 0 : -1} onClick={() => onScopeChange(item)} onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? "public" : event.key === "End" ? "mine" : item === "public" ? "mine" : "public";
          onScopeChange(next);
          document.getElementById(`directory-tab-${next}`)?.focus();
        }}>{scopeTitles[item]}</button>)}
      </div>
      <div className="section-heading"><div><span className="eyebrow">{scope === "public" ? "🧭 새로운 탐험을 찾아서" : "🎒 나의 탐험 일지"}</span><h2>{scopeTitles[scope]}</h2></div><span className="section-stamp" aria-hidden="true">{scope === "public" ? "MAP" : "MY"}</span></div>
      <DirectorySection key={`public:${query}:${theme}`} scope="public" active={scope === "public"} query={query} themeKey={theme} onOpen={onOpen} />
      {signedIn ? <DirectorySection key={`mine:${query}:${theme}`} scope="mine" active={scope === "mine"} query={query} themeKey={theme} onOpen={onOpen} /> : <div id="directory-panel-mine" role="tabpanel" aria-labelledby="directory-tab-mine" hidden={scope !== "mine"}><div className="directory-scroll" role="region" aria-label="내가 참여한 탐험 목록" tabIndex={0}><p>로그인하거나 <a href="/join">초대 코드로 참여</a>해 주세요.</p></div></div>}
    </section>
  </div>;
}
