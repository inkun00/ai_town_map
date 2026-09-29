"use client";

import { useEffect, useRef, useState } from "react";
import { themes, themeByKey } from "@/lib/demo-data";
import { MapPager, mapListUrl, type LiveMap, type PageState } from "@/lib/map-directory";

const symbols = { ecology: "🌳", safety: "🚸", universal_design: "♿", weather_life: "☀️", custom: "✨" };

function DirectorySection({ scope, query, themeKey, onOpen }: {
  scope: "public" | "mine"; query: string; themeKey: string; onOpen: (map: LiveMap) => void;
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
  return <section className="home-section map-directory-section" id={scope === "mine" ? "my-maps" : "public-maps"} aria-label={title}>
    <div className="section-heading"><div><span className="eyebrow">{scope === "public" ? "EXPLORE" : "MY MAPS"}</span><h2>{title}</h2></div></div>
    <div className="my-map-list" aria-busy={page.busy}>
      {page.items.map(map => <button type="button" key={map.id} onClick={() => onOpen(map)}>
        <span className="my-map-list__emoji" aria-hidden="true">{symbols[map.themeKey]}</span>
        <span><strong>{map.title}</strong><small>{themeByKey[map.themeKey].label} · {map.location}</small><small>{map.status === "archived" ? "보관 중 · " : ""}{map.visibility === "invite_only" ? "초대 전용" : "공개 지도"}</small></span>
        <span aria-hidden="true">›</span>
      </button>)}
    </div>
    <p className="directory-status" role="status">{page.busy ? "지도를 불러오고 있어요…" : page.loaded ? page.items.length ? `${page.items.length}개 표시${page.nextCursor ? " · 더 불러올 지도가 있어요" : " · 마지막 목록이에요"}` : "조건에 맞는 지도가 없어요." : ""}</p>
    {page.error && <p className="directory-error" role="alert">목록을 불러오지 못했어요. {page.error}</p>}
    {(page.error || page.nextCursor) && <button type="button" className="button button--light button--full" disabled={page.busy} onClick={() => void pager.current?.load()}>{page.busy ? "불러오는 중…" : page.error ? `${title} 다시 불러오기` : `${title} 더 보기`}</button>}
  </section>;
}

export function MapDirectory({ signedIn, onOpen }: { signedIn: boolean; onOpen: (map: LiveMap) => void }) {
  const [input, setInput] = useState("");
  const [query, setQuery] = useState("");
  const [theme, setTheme] = useState("");
  useEffect(() => { const timer = setTimeout(() => setQuery(input.trim()), 300); return () => clearTimeout(timer); }, [input]);
  return <>
    <section className="home-section directory-filters" aria-label="지도 검색 조건">
      <label className="search-field"><span className="sr-only">지도 검색</span><input maxLength={100} value={input} onChange={event => setInput(event.target.value)} placeholder="지도 이름이나 지역으로 찾아요" /></label>
      <label className="directory-theme">주제<select value={theme} onChange={event => setTheme(event.target.value)}><option value="">모든 주제</option>{themes.map(item => <option key={item.key} value={item.key}>{item.label}</option>)}</select></label>
      <p className="directory-status">공개 지도와 내가 참여한 지도 전체에서 검색해요.</p>
    </section>
    <DirectorySection key={`public:${query}:${theme}`} scope="public" query={query} themeKey={theme} onOpen={onOpen} />
    {signedIn ? <DirectorySection key={`mine:${query}:${theme}`} scope="mine" query={query} themeKey={theme} onOpen={onOpen} /> : <section className="home-section" id="my-maps"><h2>내가 참여한 지도</h2><p>로그인하거나 <a href="/join">초대 코드로 참여</a>해 주세요.</p></section>}
  </>;
}
