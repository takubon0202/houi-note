import type { Metadata, Viewport } from "next";
import { Noto_Sans_JP } from "next/font/google";
import { headers } from "next/headers";
import "maplibre-gl/dist/maplibre-gl.css";
import "./globals.css";

const noto = Noto_Sans_JP({ subsets: ["latin"], variable: "--font-noto" });

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost:3001";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og.png`;
  return {
    title: "方位ノート",
    description: "複数の基準地点を保存して、目的地の方位と距離を確認できる地図アプリ。",
    manifest: "/manifest.webmanifest",
    icons: { icon: "/favicon.svg", shortcut: "/favicon.svg" },
    openGraph: { title: "方位ノート", description: "基準を変えて、方角を見る。", locale: "ja_JP", type: "website", images: [{ url: image, width: 1200, height: 630, alt: "方位ノート" }] },
    twitter: { card: "summary_large_image", title: "方位ノート", description: "基準を変えて、方角を見る。", images: [image] },
  };
}

export const viewport: Viewport = {
  themeColor: "#f4f1e8",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ja">
      <body className={noto.variable}>{children}</body>
    </html>
  );
}
