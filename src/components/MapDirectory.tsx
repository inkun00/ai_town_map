"use client";

import { useEffect, useRef, useState } from "react";
import { themes, themeByKey } from "@/lib/demo-data";
import { MapPager, mapListUrl, type LiveMap, type PageState } from "@/lib/map-directory";

const symbols = { ecology: "🌳", safety: "🚸", universal_design: "♿", weather_life: "☀️", tourism: "🏯", heritage: "🏛️", weather_data: "🌦️", custom: "✨" };
export type DirectoryScope = "public" | "mine";
const scopeTitles = { public: "전체 지도", mine: "참여한 지도" };

function contributionLabel(map: LiveMap) {
  if (map.status === "archived") return "보관 중 · 보기만 가능";
  if (map.participation === "closed") return "등록 마감";
  if (map.participation === "admin_only") return "관리자만 기록";
  return map.visibility === "invite_only" ? "인증 후 기록 가능" : "누구나 기록 가능";
}

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

  const title = scopeTitles[scope];
  return <div className="home-directory__panel" id={`directory-panel-${scope}`} role="tabpanel" aria-labelledby={`directory-tab-${scope}`} hidden={!active}>
    <div className="directory-scroll home-directory__scroll" role="region" aria-label={`${scopeTitles[scope]} 목록`} tabIndex={0}>
    <div className="my-map-list home-directory__maps" aria-busy={page.busy}>
      {page.items.map(map => <button className="home-directory__map" type="button" key={map.id} onClick={() => onOpen(map)}>
        <span className={`my-map-list__emoji adventure-theme--${map.themeKey}`} aria-hidden="true">{symbols[map.themeKey]}</span>
        <span className="home-directory__map-info"><strong>{map.title}</strong><small>{themeByKey[map.themeKey].label} · {map.location}</small><small className="home-directory__permission" data-registration={map.status === "archived" ? "archived" : map.participation}>{contributionLabel(map)}</small></span>
        <span className="map-entry-arrow" aria-hidden="true">›</span>
      </button>)}
    </div>
    <p className="directory-status" role="status">{page.busy ? "지도를 불러오고 있어요…" : page.loaded ? page.items.length ? `${page.items.length}개 표시${page.nextCursor ? " · 더 불러올 지도가 있어요" : " · 마지막 목록이에요"}` : "조건에 맞는 지도가 없어요." : ""}</p>
    {page.error && <p className="directory-error" role="alert">목록을 불러오지 못했어요. {page.error}</p>}
    {(page.error || page.nextCursor) && <button type="button" className="button button--light button--full" disabled={page.busy} onClick={() => void pager.current?.load()}>{page.busy ? "불러오는 중…" : page.error ? `${title} 다시 불러오기` : `${title} 더 보기`}</button>}
    </div>
  </div>;
}

export function MapDirectory({ signedIn, scope, onScopeChange, onOpen, onCreate }: { signedIn: boolean; scope: DirectoryScope; onScopeChange: (scope: DirectoryScope) => void; onOpen: (map: LiveMap) => void; onCreate?: () => void }) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState("");
  useEffect(() => { const timer = setTimeout(() => setQuery(input.trim()), 300); return () => clearTimeout(timer); }, [input]);
  return <section id="map-directory" className="home-directory" aria-labelledby="home-directory-heading">
    <div className="home-directory__heading"><h2 id="home-directory-heading">탐험 지도</h2>{onCreate && <button className="home-directory__create" type="button" aria-label="지도 만들기" onClick={onCreate}><span aria-hidden="true">＋</span> 지도 만들기</button>}</div>
      <div className="directory-tabs home-directory__tabs" role="tablist" aria-label="탐험 지도 종류">
        {(["public", "mine"] as const).map(item => <button key={item} type="button" id={`directory-tab-${item}`} role="tab" aria-selected={scope === item} aria-controls={`directory-panel-${item}`} tabIndex={scope === item ? 0 : -1} onClick={() => onScopeChange(item)} onKeyDown={event => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const next = event.key === "Home" ? "public" : event.key === "End" ? "mine" : item === "public" ? "mine" : "public";
          onScopeChange(next);
          document.getElementById(`directory-tab-${next}`)?.focus();
        }}>{scopeTitles[item]}</button>)}
      </div>
    <div className="directory-filters home-directory__filters" role="group" aria-label="지도 검색 조건">
      <label className="search-field home-directory__search"><span aria-hidden="true">🔎</span><span className="sr-only">지도 검색</span><input maxLength={100} value={input} onChange={event => setInput(event.target.value)} placeholder="지도 이름·지역 검색" /></label>
      <label className="directory-theme home-directory__theme"><span className="sr-only">탐험 주제</span><select aria-label="주제" value={theme} onChange={event => setTheme(event.target.value)}><option value="">모든 주제</option>{themes.map(item => <option key={item.key} value={item.key}>{symbols[item.key]} {item.label}</option>)}</select></label>
    </div>
    <div className="map-directory-section home-directory__panels" aria-label="탐험 지도 목록">
      <DirectorySection key={`public:${query}:${theme}`} scope="public" active={scope === "public"} query={query} themeKey={theme} onOpen={onOpen} />
      {signedIn ? <DirectorySection key={`mine:${query}:${theme}`} scope="mine" active={scope === "mine"} query={query} themeKey={theme} onOpen={onOpen} /> : <div className="home-directory__panel" id="directory-panel-mine" role="tabpanel" aria-labelledby="directory-tab-mine" hidden={scope !== "mine"}><div className="directory-scroll home-directory__scroll home-directory__empty" role="region" aria-label="참여한 지도 목록" tabIndex={0}><p>전체공개 지도에서 닉네임을 정해 기록에 참여하면 여기에 보여요.</p><p>일부공개 지도는 비밀번호나 교사 인증코드로 참여해요.</p><button className="home-directory__browse" type="button" onClick={() => onScopeChange("public")}>전체 지도 보기</button><a href="/join">지도 인증코드로 참여</a></div></div>}
    </div>
  </section>;
}
