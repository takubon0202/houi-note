import type { Metadata } from "next";
import { DirectionApp } from "./DirectionApp";

export const metadata: Metadata = {
  title: "方位ノート — 基準地点から方角を確認",
  description: "自宅以外も基準地点にできる、シンプルな方位確認アプリ。",
};

export default function Home() {
  return <DirectionApp />;
}
