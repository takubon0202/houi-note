"use client";

import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker as MapLibreMarker } from "maplibre-gl";

type Point = { id: string; name: string; address?: string; lat: number; lng: number };
type Preset = "equal" | "kigaku";
type PickMode = "origin" | "destination" | null;
type Toast = { message: string; action?: string } | null;

type SearchResult = { place_id: number; display_name: string; lat: string; lon: string; name?: string };

const STORAGE_KEY = "houi-note:v1";
const DEFAULT_ORIGIN: Point = { id: "tokyo", name: "東京駅", address: "東京都千代田区", lat: 35.681236, lng: 139.767125 };
const DEFAULT_DESTINATION: Point = { id: "asakusa", name: "浅草寺", address: "東京都台東区", lat: 35.714765, lng: 139.796655 };

const PRESETS = {
  equal: {
    label: "45°均等",
    short: "一般的な8方位",
    sectors: [
      ["北", 337.5, 22.5], ["北東", 22.5, 67.5], ["東", 67.5, 112.5], ["南東", 112.5, 157.5],
      ["南", 157.5, 202.5], ["南西", 202.5, 247.5], ["西", 247.5, 292.5], ["北西", 292.5, 337.5],
    ] as [string, number, number][],
    boundaries: [22.5, 67.5, 112.5, 157.5, 202.5, 247.5, 292.5, 337.5],
  },
  kigaku: {
    label: "30° / 60°",
    short: "氣学で使われる8方位",
    sectors: [
      ["北", 345, 15], ["北東", 15, 75], ["東", 75, 105], ["南東", 105, 165],
      ["南", 165, 195], ["南西", 195, 255], ["西", 255, 285], ["北西", 285, 345],
    ] as [string, number, number][],
    boundaries: [15, 75, 105, 165, 195, 255, 285, 345],
  },
};

const toRad = (n: number) => (n * Math.PI) / 180;
const toDeg = (n: number) => (n * 180) / Math.PI;
const normalize = (n: number) => ((n % 360) + 360) % 360;

function distanceKm(a: Point, b: Point) {
  const r = 6371.0088;
  const p1 = toRad(a.lat);
  const p2 = toRad(b.lat);
  const dp = toRad(b.lat - a.lat);
  const dl = toRad(b.lng - a.lng);
  const h = Math.sin(dp / 2) ** 2 + Math.cos(p1) * Math.cos(p2) * Math.sin(dl / 2) ** 2;
  return 2 * r * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function initialBearing(a: Point, b: Point) {
  const p1 = toRad(a.lat);
  const p2 = toRad(b.lat);
  const dl = toRad(b.lng - a.lng);
  return normalize(toDeg(Math.atan2(Math.sin(dl) * Math.cos(p2), Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl))));
}

function destinationPoint(origin: Point, bearing: number, distance: number): [number, number] {
  const r = 6371.0088;
  const d = distance / r;
  const t = toRad(bearing);
  const p1 = toRad(origin.lat);
  const l1 = toRad(origin.lng);
  const p2 = Math.asin(Math.sin(p1) * Math.cos(d) + Math.cos(p1) * Math.sin(d) * Math.cos(t));
  const l2 = l1 + Math.atan2(Math.sin(t) * Math.sin(d) * Math.cos(p1), Math.cos(d) - Math.sin(p1) * Math.sin(p2));
  return [normalize(toDeg(l2) + 180) - 180, toDeg(p2)];
}

function geodesicLine(origin: Point, bearing: number, distance = 1400) {
  const coords: [number, number][] = [];
  for (let km = 0; km <= distance; km += 25) coords.push(destinationPoint(origin, bearing, km));
  return coords;
}

function sectorFor(bearing: number, preset: Preset) {
  const found = PRESETS[preset].sectors.find(([, start, end]) => start <= end ? bearing >= start && bearing < end : bearing >= start || bearing < end);
  return found?.[0] ?? "北";
}

function formatDistance(km: number) {
  if (km < 1) return `${Math.round(km * 1000)} m`;
  if (km < 100) return `${km.toFixed(1)} km`;
  return `${Math.round(km).toLocaleString("ja-JP")} km`;
}

export function DirectionApp() {
  const mapNode = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<MapLibreMarker[]>([]);
  const pickModeRef = useRef<PickMode>(null);
  const originRef = useRef<Point>(DEFAULT_ORIGIN);
  const [origin, setOrigin] = useState<Point>(DEFAULT_ORIGIN);
  const [destination, setDestination] = useState<Point>(DEFAULT_DESTINATION);
  const [saved, setSaved] = useState<Point[]>([DEFAULT_ORIGIN]);
  const [preset, setPreset] = useState<Preset>("kigaku");
  const [pickMode, setPickMode] = useState<PickMode>(null);
  const [panel, setPanel] = useState<"none" | "places" | "settings" | "help">("none");
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [toast, setToast] = useState<Toast>(null);
  const [ready, setReady] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [previousOrigin, setPreviousOrigin] = useState<Point | null>(null);

  const bearing = useMemo(() => initialBearing(origin, destination), [origin, destination]);
  const distance = useMemo(() => distanceKm(origin, destination), [origin, destination]);
  const sector = sectorFor(bearing, preset);

  useEffect(() => { pickModeRef.current = pickMode; }, [pickMode]);
  useEffect(() => { originRef.current = origin; }, [origin]);

  useEffect(() => {
    queueMicrotask(() => {
      try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (raw) {
          const data = JSON.parse(raw) as { version?: number; origin?: Point; destination?: Point; saved?: Point[]; preset?: Preset };
          if (data.version === 1) {
            if (data.origin) setOrigin(data.origin);
            if (data.destination) setDestination(data.destination);
            if (Array.isArray(data.saved)) setSaved(data.saved);
            if (data.preset === "equal" || data.preset === "kigaku") setPreset(data.preset);
            setToast({ message: "前回の基準地点と設定を復元しました" });
          }
        }
      } catch {
        setToast({ message: "保存データを読み込めなかったため、初期状態で開きました" });
      } finally {
        setHydrated(true);
      }
    });
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, origin, destination, saved, preset }));
    } catch {
      queueMicrotask(() => setToast({ message: "端末への保存に失敗しました。バックアップを書き出してください" }));
    }
  }, [origin, destination, saved, preset, hydrated]);

  const changeOrigin = useCallback((point: Point) => {
    setPreviousOrigin(origin);
    setOrigin(point);
    setToast({ message: `基準地点を「${point.name}」に変更しました`, action: "元に戻す" });
  }, [origin]);

  useEffect(() => {
    if (!mapNode.current || mapRef.current) return;
    let cancelled = false;
    void import("maplibre-gl").then((maplibre) => {
      if (cancelled || !mapNode.current) return;
      const map = new maplibre.Map({
        container: mapNode.current,
        style: "https://tiles.openfreemap.org/styles/positron",
        center: [DEFAULT_ORIGIN.lng, DEFAULT_ORIGIN.lat],
        zoom: 11.4,
        attributionControl: false,
      });
      map.addControl(new maplibre.NavigationControl({ showCompass: false }), "bottom-right");
      map.addControl(new maplibre.AttributionControl({ compact: true }), "bottom-left");
      map.on("load", () => { mapRef.current = map; setReady(true); });
      map.on("click", (event) => {
        const mode = pickModeRef.current;
        if (!mode) return;
        const point: Point = { id: crypto.randomUUID(), name: "地図で選んだ地点", lat: event.lngLat.lat, lng: event.lngLat.lng };
        if (mode === "origin") {
          setPreviousOrigin(originRef.current);
          setOrigin(point);
          setToast({ message: "地図上の地点を基準に設定しました", action: "元に戻す" });
        } else setDestination(point);
        setPickMode(null);
      });
    });
    return () => { cancelled = true; mapRef.current?.remove(); mapRef.current = null; };
  }, []); // 初回だけ地図を生成する

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    let active = true;
    void import("maplibre-gl").then((maplibre) => {
      if (!active) return;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = [];
      const makeMarker = (point: Point, role: "origin" | "destination") => {
        const el = document.createElement("button");
        el.className = `map-marker ${role}`;
        el.type = "button";
        el.setAttribute("aria-label", `${role === "origin" ? "基準地点" : "目的地"}: ${point.name}`);
        el.textContent = role === "origin" ? "基" : "目";
        return new maplibre.Marker({ element: el }).setLngLat([point.lng, point.lat]).addTo(map);
      };
      markersRef.current = [makeMarker(origin, "origin"), makeMarker(destination, "destination")];
    });

    const data = {
      type: "FeatureCollection" as const,
      features: PRESETS[preset].boundaries.map((angle) => ({
        type: "Feature" as const,
        properties: { angle },
        geometry: { type: "LineString" as const, coordinates: geodesicLine(origin, angle) },
      })),
    };
    const route = { type: "FeatureCollection" as const, features: [{ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: [geodesicLine(origin, bearing, Math.max(distance, 10)).at(0)!, [destination.lng, destination.lat]] } }] };
    const source = map.getSource("directions") as { setData: (d: typeof data) => void } | undefined;
    if (source) source.setData(data);
    else {
      map.addSource("directions", { type: "geojson", data });
      map.addLayer({ id: "directions-lines", type: "line", source: "directions", paint: { "line-color": "#365c50", "line-width": 1.6, "line-opacity": 0.58, "line-dasharray": [3, 2] } });
    }
    const routeSource = map.getSource("route") as { setData: (d: typeof route) => void } | undefined;
    if (routeSource) routeSource.setData(route);
    else {
      map.addSource("route", { type: "geojson", data: route });
      map.addLayer({ id: "route-line", type: "line", source: "route", paint: { "line-color": "#d86542", "line-width": 4, "line-opacity": 0.9 } });
    }
    return () => { active = false; };
  }, [origin, destination, preset, bearing, distance, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    map.getCanvas().style.cursor = pickMode ? "crosshair" : "grab";
  }, [pickMode, ready]);

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (!query.trim() || searching) return;
    setSearching(true); setSearchError(""); setResults([]);
    try {
      const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=5&countrycodes=jp&accept-language=ja&q=${encodeURIComponent(query.trim())}`;
      const response = await fetch(url, { headers: { Accept: "application/json" } });
      if (!response.ok) throw new Error();
      const data = await response.json() as SearchResult[];
      setResults(data);
      if (!data.length) setSearchError("見つかりませんでした。地名を変えてお試しください。");
    } catch { setSearchError("検索できませんでした。地図上で地点を選ぶこともできます。"); }
    finally { setSearching(false); }
  };

  const chooseSearchResult = (result: SearchResult, role: "origin" | "destination") => {
    const point: Point = { id: String(result.place_id), name: result.name || result.display_name.split(",")[0], address: result.display_name, lat: Number(result.lat), lng: Number(result.lon) };
    if (role === "origin") changeOrigin(point); else setDestination(point);
    mapRef.current?.flyTo({ center: [point.lng, point.lat], zoom: 12 });
    setPanel("none"); setResults([]); setQuery("");
  };

  const getCurrentLocation = (role: "origin" | "destination") => {
    if (!navigator.geolocation) { setToast({ message: "この端末では現在地を利用できません" }); return; }
    navigator.geolocation.getCurrentPosition((position) => {
      const point: Point = { id: crypto.randomUUID(), name: "現在地", lat: position.coords.latitude, lng: position.coords.longitude };
      if (role === "origin") changeOrigin(point); else setDestination(point);
      mapRef.current?.flyTo({ center: [point.lng, point.lat], zoom: 13 });
      setPanel("none");
    }, () => setToast({ message: "現在地を取得できませんでした。権限設定をご確認ください" }), { timeout: 8000, enableHighAccuracy: true });
  };

  const saveCurrentOrigin = () => {
    if (saved.some((item) => Math.abs(item.lat - origin.lat) < 1e-7 && Math.abs(item.lng - origin.lng) < 1e-7)) { setToast({ message: "この基準地点は保存済みです" }); return; }
    const name = window.prompt("保存する地点の名前", origin.name);
    if (!name?.trim()) return;
    const point = { ...origin, id: crypto.randomUUID(), name: name.trim() };
    setOrigin(point); setSaved((items) => [...items, point]); setToast({ message: `「${point.name}」を保存しました` });
  };

  const deleteSaved = (point: Point) => {
    if (!window.confirm(`「${point.name}」を削除しますか？`)) return;
    setSaved((items) => items.filter((item) => item.id !== point.id));
  };

  const exportData = () => {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), origin, destination, saved, preset }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a"); anchor.href = url; anchor.download = `houi-note-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}.json`; anchor.click(); URL.revokeObjectURL(url);
    setToast({ message: "バックアップを書き出しました" });
  };

  const importData = (file: File | undefined) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result)) as { version?: number; origin?: Point; destination?: Point; saved?: Point[]; preset?: Preset };
        if (data.version !== 1 || !data.origin || !data.destination || !Array.isArray(data.saved)) throw new Error();
        setOrigin(data.origin); setDestination(data.destination); setSaved(data.saved); if (data.preset) setPreset(data.preset);
        setToast({ message: "バックアップを復元しました" });
      } catch { setToast({ message: "このファイルは読み込めませんでした" }); }
    };
    reader.readAsText(file);
  };

  const swap = () => { const oldOrigin = origin; setPreviousOrigin(origin); setOrigin(destination); setDestination(oldOrigin); setToast({ message: "基準地点と目的地を入れ替えました", action: "元に戻す" }); };

  const undoOrigin = () => {
    if (!previousOrigin) return;
    const current = origin; setOrigin(previousOrigin); setPreviousOrigin(current); setToast({ message: "基準地点を元に戻しました" });
  };

  return (
    <main className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="方位ノート ホーム"><span className="brand-mark">方</span><span><strong>方位ノート</strong><small>基準を変えて、方角を見る。</small></span></a>
        <nav className="top-actions" aria-label="アプリメニュー">
          <button className="icon-button" onClick={() => setPanel("help")} aria-label="使い方">?</button>
          <button className="icon-button" onClick={() => setPanel("settings")} aria-label="設定">⚙</button>
        </nav>
      </header>

      <section className="workspace" id="top">
        <div className="map-column">
          <div ref={mapNode} className="map" aria-label="基準地点と目的地を示す地図" />
          {!ready && <div className="map-loading"><span />地図を準備しています</div>}
          <div className="map-tools">
            <button onClick={() => { setPickMode("origin"); setToast({ message: "地図上で基準地点を選んでください" }); }} className={pickMode === "origin" ? "active" : ""}>＋ 基準を地図で選ぶ</button>
            <button onClick={() => { setPickMode("destination"); setToast({ message: "地図上で目的地を選んでください" }); }} className={pickMode === "destination" ? "active" : ""}>＋ 目的地を地図で選ぶ</button>
          </div>
          <div className="mode-badge"><span className="pulse" />測地線・真北</div>
        </div>

        <aside className="result-panel" aria-label="方位計算結果">
          <div className="step-label">現在のルート</div>
          <div className="location-row origin-row">
            <span className="point-symbol origin">基</span>
            <button className="location-button" onClick={() => setPanel("places")}><small>基準地点</small><strong>{origin.name}</strong><span>{origin.address || `${origin.lat.toFixed(5)}, ${origin.lng.toFixed(5)}`}</span></button>
            <button className="change-button" onClick={() => setPanel("places")}>変更</button>
          </div>
          <div className="route-stem"><span /></div>
          <div className="location-row">
            <span className="point-symbol destination">目</span>
            <button className="location-button" onClick={() => setPanel("places")}><small>目的地</small><strong>{destination.name}</strong><span>{destination.address || `${destination.lat.toFixed(5)}, ${destination.lng.toFixed(5)}`}</span></button>
            <button className="change-button" onClick={() => setPanel("places")}>変更</button>
          </div>

          <section className="answer-card" aria-live="polite">
            <div><span>方位</span><strong className="direction-answer">{sector}</strong><small>{PRESETS[preset].label}</small></div>
            <div className="answer-metrics"><p><span>方位角</span><strong>{bearing.toFixed(1)}°</strong></p><p><span>距離</span><strong>{formatDistance(distance)}</strong></p></div>
            <div className="compass" style={{ transform: `rotate(${bearing}deg)` }}><span>↑</span></div>
          </section>

          <div className="preset-switch" role="group" aria-label="方位区分">
            {(Object.keys(PRESETS) as Preset[]).map((key) => <button key={key} onClick={() => setPreset(key)} className={preset === key ? "selected" : ""}><strong>{PRESETS[key].label}</strong><small>{PRESETS[key].short}</small></button>)}
          </div>

          <div className="primary-actions">
            <button className="save-button" onClick={saveCurrentOrigin}>＋ この基準地点を保存</button>
            <button className="swap-button" onClick={swap}>⇅ 入れ替える</button>
          </div>
          <p className="privacy-note">位置情報と保存地点は、この端末内に保存されます。</p>
        </aside>
      </section>

      <section className="how-it-works" aria-labelledby="guide-title">
        <div><span className="eyebrow">かんたん3ステップ</span><h2 id="guide-title">迷わず、何度でも<br />基準を変えられます。</h2></div>
        <ol><li><b>01</b><strong>基準を選ぶ</strong><span>自宅・職場・旅先など、好きな場所から。</span></li><li><b>02</b><strong>目的地を選ぶ</strong><span>検索、現在地、または地図をタップ。</span></li><li><b>03</b><strong>方位を確認</strong><span>方位角と距離を、地図と数字で。</span></li></ol>
      </section>

      {panel !== "none" && <div className="modal-backdrop" onMouseDown={() => setPanel("none")}>
        <section className="sheet" role="dialog" aria-modal="true" aria-label={panel === "places" ? "地点を選ぶ" : panel === "settings" ? "設定" : "使い方"} onMouseDown={(event) => event.stopPropagation()}>
          <header><div><span className="eyebrow">方位ノート</span><h2>{panel === "places" ? "地点を選ぶ" : panel === "settings" ? "設定とデータ" : "使い方と注意"}</h2></div><button onClick={() => setPanel("none")} aria-label="閉じる">×</button></header>
          {panel === "places" && <>
            <form className="search-form" onSubmit={search}><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="住所・施設名・駅名を入力" aria-label="地点を検索" /><button disabled={searching}>{searching ? "検索中" : "検索"}</button></form>
            {searchError && <p className="error-message">{searchError}</p>}
            {results.length > 0 && <div className="search-results">{results.map((result) => <article key={result.place_id}><div><strong>{result.name || result.display_name.split(",")[0]}</strong><span>{result.display_name}</span></div><button onClick={() => chooseSearchResult(result, "origin")}>基準にする</button><button onClick={() => chooseSearchResult(result, "destination")}>目的地にする</button></article>)}</div>}
            <div className="quick-location"><button onClick={() => getCurrentLocation("origin")}><span>◎</span><strong>現在地を基準にする</strong></button><button onClick={() => getCurrentLocation("destination")}><span>◎</span><strong>現在地を目的地にする</strong></button></div>
            <h3>保存済みの基準地点</h3>
            <div className="saved-list">{saved.length ? saved.map((point) => <article key={point.id}><button className="saved-main" onClick={() => { changeOrigin(point); mapRef.current?.flyTo({ center: [point.lng, point.lat], zoom: 12 }); setPanel("none"); }}><span className="point-symbol origin">基</span><span><strong>{point.name}</strong><small>{point.address || `${point.lat.toFixed(4)}, ${point.lng.toFixed(4)}`}</small></span></button><button className="delete-button" onClick={() => deleteSaved(point)} aria-label={`${point.name}を削除`}>削除</button></article>) : <p className="empty-state">まだ保存地点はありません。</p>}</div>
          </>}
          {panel === "settings" && <div className="settings-content">
            <section><h3>方位区分</h3><div className="preset-switch wide">{(Object.keys(PRESETS) as Preset[]).map((key) => <button key={key} onClick={() => setPreset(key)} className={preset === key ? "selected" : ""}><strong>{PRESETS[key].label}</strong><small>{PRESETS[key].short}</small></button>)}</div></section>
            <section><h3>バックアップ</h3><p>ブラウザの保存データは、端末の設定や容量不足などで消える可能性があります。大切な地点はファイルに保存してください。</p><div className="backup-actions"><button onClick={exportData}>バックアップを書き出す</button><label>バックアップを読み込む<input type="file" accept="application/json" onChange={(event) => importData(event.target.files?.[0])} /></label></div></section>
            <section><h3>端末データ</h3><button className="danger-button" onClick={() => { if (window.confirm("保存地点と設定をすべて消去しますか？")) { localStorage.removeItem(STORAGE_KEY); setSaved([]); setOrigin(DEFAULT_ORIGIN); setDestination(DEFAULT_DESTINATION); setPreset("kigaku"); setToast({ message: "端末データを消去しました" }); } }}>保存データをすべて消去</button></section>
          </div>}
          {panel === "help" && <div className="help-content">
            <section><b>01</b><div><h3>基準地点を選ぶ</h3><p>「変更」から検索・現在地・保存済み地点を選べます。地図上から直接選ぶこともできます。</p></div></section>
            <section><b>02</b><div><h3>目的地を選ぶ</h3><p>同じ地点選択画面から目的地を指定します。基準と目的地はいつでも入れ替えられます。</p></div></section>
            <section><b>03</b><div><h3>方位を確認する</h3><p>結果は真北を基準とする測地計算です。45°均等と、氣学で用いられる30°/60°を切り替えられます。</p></div></section>
            <div className="notice"><strong>大切なご案内</strong><p>このアプリは地点間の方位と距離を確認する道具です。吉凶や移動時期を判定するものではありません。結果は参考情報としてご利用ください。</p></div>
            <p className="data-flow">地図表示にはOpenFreeMap、地図データにはOpenStreetMap、地点検索にはNominatimを利用します。検索時は検索文字列、地図表示時は表示範囲等が各提供者へ送信されます。</p>
          </div>}
        </section>
      </div>}

      {toast && <div className="toast" role="status"><span>{toast.message}</span>{toast.action && <button onClick={undoOrigin}>{toast.action}</button>}<button className="toast-close" onClick={() => setToast(null)} aria-label="通知を閉じる">×</button></div>}
    </main>
  );
}
