"use client";

import { useEffect, useMemo, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { CrosshairSimple } from "@phosphor-icons/react";
import { MapboxOverlay } from "@deck.gl/mapbox";
import { BitmapLayer, ScatterplotLayer } from "@deck.gl/layers";
import type { Layer } from "@deck.gl/core";
import type { Settings } from "./Dashboard";
import { DataBundle, fieldSlice, fmt, gridBounds, monthLabel, resolutionLabel } from "@/lib/data";
import { Criteria, effort, scoreGrid } from "@/lib/habitat";
import { RAMPS, VAR_RAMP, rampColor, rampCss } from "@/lib/colors";

export interface LatLon {
  lat: number;
  lon: number;
}

interface Props {
  bundle: DataBundle;
  settings: Settings;
  criteria: Criteria;
  inspect: LatLon | null;
  onInspect: (p: LatLon) => void;
  onHover: (p: LatLon | null) => void;
}

interface FishPoint {
  lat: number;
  lon: number;
  fishing: number;
  longline: number;
  land: boolean;
}

const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    base: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 16,
      attribution: "Esri, HERE, Garmin, © OpenStreetMap contributors",
    },
    labels: {
      type: "raster",
      tiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"],
      tileSize: 256,
      maxzoom: 16,
    },
  },
  layers: [
    { id: "bg", type: "background", paint: { "background-color": "#0b1220" } },
    { id: "base", type: "raster", source: "base" },
    { id: "labels", type: "raster", source: "labels" },
  ],
};

// Turbopack rewrites MapLibre's default worker URL to a path that does not exist,
// so the worker is served as a plain static file (see the `predev`/`prebuild` scripts).
maplibregl.setWorkerUrl("/maplibre-gl-worker.mjs");

export function envRange(bundle: DataBundle, s: Settings): [number, number] {
  if (s.layer === "habitat") return [0, 1];
  const v = bundle.meta.vars[s.layer];
  if (!v) return [0, 1];
  return s.rangeMode === "manual" ? s.range : [v.p02, v.p98];
}

export default function MapView({ bundle, settings, criteria, inspect, onInspect, onHover }: Props) {
  const box = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const overlayRef = useRef<MapboxOverlay | null>(null);
  const cbRef = useRef({ onInspect, onHover });

  useEffect(() => {
    cbRef.current = { onInspect, onHover };
  }, [onInspect, onHover]);

  useEffect(() => {
    if (!box.current) return;
    const map = new maplibregl.Map({
      container: box.current,
      style: STYLE,
      center: [81.0, 7.6],
      zoom: 6.1,
      attributionControl: { compact: true },
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    const overlay = new MapboxOverlay({ interleaved: false, layers: [] });
    map.addControl(overlay as unknown as maplibregl.IControl);
    // Report hover only when the pointer moves into a new 0.05 degree cell, not on every pixel.
    let lastCell = "";
    map.on("mousemove", (e) => {
      const cell = `${Math.round(e.lngLat.lat * 20)},${Math.round(e.lngLat.lng * 20)}`;
      if (cell === lastCell) return;
      lastCell = cell;
      cbRef.current.onHover({ lat: e.lngLat.lat, lon: e.lngLat.lng });
    });
    map.on("mouseout", () => {
      lastCell = "";
      cbRef.current.onHover(null);
    });
    map.on("click", (e) => cbRef.current.onInspect({ lat: e.lngLat.lat, lon: e.lngLat.lng }));
    mapRef.current = map;
    overlayRef.current = overlay;
    return () => {
      map.remove();
      mapRef.current = null;
      overlayRef.current = null;
    };
  }, []);

  const [lo, hi] = envRange(bundle, settings);

  const envGrid = settings.layer === "habitat" ? bundle.meta.analysis : bundle.meta.vars[settings.layer]?.grid;

  const envImage = useMemo(() => {
    if (settings.layer === "none" || !envGrid) return null;
    const { ny, nx } = envGrid;
    const field =
      settings.layer === "habitat"
        ? scoreGrid(bundle, criteria, settings.t, settings.d)
        : fieldSlice(bundle, settings.layer, settings.t, settings.d);
    const ramp = RAMPS[VAR_RAMP[settings.layer] ?? "viridis"];
    const canvas = document.createElement("canvas");
    canvas.width = nx;
    canvas.height = ny;
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    const img = ctx.createImageData(nx, ny);
    for (let iy = 0; iy < ny; iy++) {
      for (let ix = 0; ix < nx; ix++) {
        const v = field[iy * nx + ix];
        const p = ((ny - 1 - iy) * nx + ix) * 4;
        if (!Number.isFinite(v)) continue;
        const [r, g, b] = rampColor(ramp, (v - lo) / (hi - lo || 1));
        img.data[p] = r;
        img.data[p + 1] = g;
        img.data[p + 2] = b;
        img.data[p + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    return canvas.toDataURL();
  }, [bundle, criteria, envGrid, settings.layer, settings.t, settings.d, lo, hi]);

  const points = useMemo(() => {
    const map = new Map<string, FishPoint>();
    for (const r of bundle.fishing) {
      if (settings.timeMode === "month" && r.mi !== settings.t) continue;
      if (settings.timeMode === "cumulative" && (r.mi < 0 || r.mi > settings.t)) continue;
      const key = `${r.lat},${r.lon}`;
      const p = map.get(key) ?? { lat: r.lat, lon: r.lon, fishing: 0, longline: 0, land: false };
      p.fishing += r.fishing;
      p.longline += r.longline;
      p.land = p.land || r.land;
      map.set(key, p);
    }
    return [...map.values()];
  }, [bundle.fishing, settings.timeMode, settings.t]);

  const layers = useMemo(() => {
    const out: Layer[] = [];
    if (envImage && envGrid) {
      out.push(
        new BitmapLayer({
          id: "env",
          image: envImage,
          bounds: gridBounds(envGrid),
          opacity: settings.opacity,
          pickable: false,
        }),
      );
    }
    if (settings.showFishing) {
      const val = (p: FishPoint) => effort(p, settings.metric);
      const active = points.filter((p) => val(p) > 0);
      const idle = points.filter((p) => val(p) <= 0);
      const fill: [number, number, number, number] = settings.metric === "fishing" ? [255, 122, 26, 210] : [236, 72, 153, 220];
      if (settings.showZero) {
        out.push(
          new ScatterplotLayer<FishPoint>({
            id: "idle",
            data: idle,
            getPosition: (d) => [d.lon, d.lat],
            getRadius: 2.5,
            radiusUnits: "pixels",
            getFillColor: [148, 163, 184, 120],
            pickable: true,
          }),
        );
      }
      out.push(
        new ScatterplotLayer<FishPoint>({
          id: "effort",
          data: active,
          getPosition: (d) => [d.lon, d.lat],
          getRadius: (d) => Math.sqrt(val(d)),
          radiusUnits: "pixels",
          radiusScale: settings.radius,
          radiusMinPixels: 4,
          radiusMaxPixels: 70,
          getFillColor: fill,
          getLineColor: [255, 255, 255, 230],
          lineWidthMinPixels: 1,
          stroked: true,
          pickable: true,
          updateTriggers: { getRadius: [settings.metric] },
        }),
      );
      if (settings.flagLand) {
        out.push(
          new ScatterplotLayer<FishPoint>({
            id: "land-flag",
            data: points.filter((p) => p.land),
            getPosition: (d) => [d.lon, d.lat],
            getRadius: 14,
            radiusUnits: "pixels",
            stroked: true,
            filled: false,
            getLineColor: [239, 68, 68, 255],
            lineWidthMinPixels: 3,
          }),
        );
      }
    }
    if (inspect) {
      out.push(
        new ScatterplotLayer<LatLon>({
          id: "inspect",
          data: [inspect],
          getPosition: (d) => [d.lon, d.lat],
          getRadius: 9,
          radiusUnits: "pixels",
          stroked: true,
          filled: false,
          getLineColor: [255, 255, 255, 255],
          lineWidthMinPixels: 2,
        }),
      );
    }
    return out;
  }, [envGrid, envImage, points, settings.opacity, settings.showFishing, settings.metric, settings.radius, settings.showZero, settings.flagLand, inspect]);

  useEffect(() => {
    overlayRef.current?.setProps({
      layers,
      getTooltip: ({ object }: { object?: unknown }) => {
        const p = object as FishPoint | undefined;
        if (!p || p.fishing === undefined) return null;
        return {
          text: `${p.lat.toFixed(2)}°N ${p.lon.toFixed(2)}°E\nFishing ${fmt(p.fishing)} h\nLongline ${fmt(p.longline)} h${p.land ? "\nFlagged: on land" : ""}`,
          style: {
            background: "#0d1424",
            color: "#e6edf7",
            fontSize: "12px",
            border: "1px solid rgba(148,163,184,0.28)",
            borderRadius: "8px",
            padding: "8px 10px",
          },
        };
      },
    });
  }, [layers]);

  const meta = settings.layer === "habitat" ? null : bundle.meta.vars[settings.layer];
  const ramp = RAMPS[VAR_RAMP[settings.layer] ?? "viridis"];

  const layerName = settings.layer === "habitat" ? "Habitat suitability" : meta?.label;
  const showDepth = meta?.depth || settings.layer === "habitat";
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) =>
    settings.layer === "habitat" ? `${Math.round(f * 100)}%` : fmt(lo + (hi - lo) * f),
  );
  const effortColor = settings.metric === "fishing" ? "#ff7a1a" : "#ec4899";
  const sizeKey = [1, 10, 100].map((h) => ({
    h,
    d: 2 * Math.min(70, Math.max(4, Math.sqrt(h) * settings.radius)),
  }));

  const resetView = () => mapRef.current?.flyTo({ center: [81.0, 7.6], zoom: 6.1, duration: 700 });

  return (
    <div className="relative h-full w-full">
      {/* isolate: the map and its deck.gl canvas get their own stacking context, so overlays always paint above */}
      <div className="absolute inset-0 isolate">
        <div ref={box} className="h-full w-full" />
      </div>

      <div className="pointer-events-none absolute top-3 left-3 z-10 flex max-w-[calc(100%-6rem)] flex-wrap gap-1.5">
        <span className="num rounded-full border border-line bg-panel px-3 py-1 text-xs font-medium text-ink">
          {monthLabel(bundle.meta.months[settings.t])}
        </span>
        {showDepth && (
          <span className="num rounded-full border border-line bg-panel px-3 py-1 text-xs text-ink-2">
            {bundle.meta.depths[settings.d]} m
          </span>
        )}
        {layerName && settings.layer !== "none" && (
          <span className="rounded-full border border-line bg-panel px-3 py-1 text-xs text-ink-2">
            {layerName}
          </span>
        )}
      </div>

      <button
        type="button"
        onClick={resetView}
        aria-label="Recentre map on Sri Lanka"
        title="Recentre map on Sri Lanka"
        className="absolute top-[84px] right-[10px] z-10 inline-flex size-[29px] items-center justify-center rounded-lg border border-line bg-panel text-ink-2 hover:text-ink"
      >
        <CrosshairSimple className="size-4" aria-hidden />
      </button>

      <div className="pointer-events-none absolute bottom-6 left-3 z-10 flex w-64 flex-col gap-2.5 rounded-lg border border-line bg-panel p-3 text-xs text-ink-2">
        {settings.layer !== "none" && (
          <div>
            <div className="mb-0.5 font-medium text-ink">
              {layerName}
              {meta?.unit ? <span className="font-normal text-ink-3"> ({meta.unit})</span> : null}
            </div>
            {envGrid && (
              <div className="mb-2 text-[10px] text-ink-3">
                {meta?.source ?? "Dashboard criteria"}, <span className="num">{resolutionLabel(envGrid)}</span>
              </div>
            )}
            <div className="h-2.5 rounded-sm" style={{ background: rampCss(ramp) }} />
            <div className="num mt-1.5 flex justify-between text-[10px] text-ink-3">
              {ticks.map((t, i) => (
                <span key={i}>{t}</span>
              ))}
            </div>
          </div>
        )}
        {settings.showFishing && (
          <div className={settings.layer !== "none" ? "border-t border-line pt-2.5" : ""}>
            <div className="mb-1.5 font-medium text-ink">
              {settings.metric === "fishing" ? "Fishing hours" : "Longline hours"}
            </div>
            <div className="flex items-end gap-4">
              {sizeKey.map((s) => (
                <div key={s.h} className="flex flex-col items-center gap-1">
                  <span
                    className="block rounded-full border border-white/80"
                    style={{ width: s.d, height: s.d, background: effortColor }}
                  />
                  <span className="num text-[10px] text-ink-3">{s.h} h</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
