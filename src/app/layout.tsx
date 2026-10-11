import type { Metadata, Viewport } from "next";
import "./globals.css";
import "./adventure.css";
import "./map-workbench.css";
import "./exploration-games.css";
import "./point-details.css";
import "./map-merge.css";
import "./home.css";
import "./home-join.css";
import "./start-screen.css";
import "./account-auth.css";
import "./location-quality.css";
import "./ai-analysis.css";

export const metadata: Metadata = {
  title: "모두의 지도 · 우리 동네 탐험대",
  description: "주제에 맞는 지도를 만들고, 동네의 발견을 함께 기록하는 커뮤니티 지도",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="ko"><body>{children}</body></html>;
}
