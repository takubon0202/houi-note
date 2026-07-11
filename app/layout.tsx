import type { Metadata, Viewport } from "next";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "方位ノート",
  description: "複数の基準地点を保存して、目的地の方位と距離を確認できる地図アプリ。",
  manifest: "/manifest.webmanifest",
  icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
  openGraph: { title: "方位ノート", description: "基準を変えて、方角を見る。", locale: "ja_JP", type: "website", images: [{ url: "/og.png", width: 1200, height: 630, alt: "方位ノート" }] },
  twitter: { card: "summary_large_image", title: "方位ノート", description: "基準を変えて、方角を見る。", images: ["/og.png"] },
};

export const viewport: Viewport = {
  themeColor: "#f4f1e8",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
