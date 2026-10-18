"use client";

import dynamic from "next/dynamic";

const WeatherExplorer = dynamic(() => import("@/components/WeatherExplorer").then(module => module.WeatherExplorer), {
  loading: () => <p role="status">날씨 지도를 불러오고 있어요…</p>,
});

export default function WeatherPage() {
  return <div className="site-shell"><main className="app-frame"><WeatherExplorer onClose={() => window.location.assign("/")} /></main></div>;
}
