"use client";

import { useEffect, useMemo, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
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
    map.on("mousemove", (e) => cbRef.current.onHover({ lat: e.lngLat.lat, lon: e.lngLat.lng }));
    map.on("mouseout", () => cbRef.current.onHover(null));
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
          style: { background: "#0f172a", color: "#e2e8f0", fontSize: "12px", border: "1px solid #334155" },
        };
      },
    });
  }, [layers]);

  const meta = settings.layer === "habitat" ? null : bundle.meta.vars[settings.layer];
  const ramp = RAMPS[VAR_RAMP[settings.layer] ?? "viridis"];

  return (
    <div className="relative h-full w-full">
      <div className="absolute inset-0">
        <div ref={box} className="h-full w-full" />
      </div>
      <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-slate-950/80 px-3 py-1.5 text-xs text-slate-300 backdrop-blur">
        {monthLabel(bundle.meta.months[settings.t])}
        {meta?.depth || settings.layer === "habitat" ? ` · ${bundle.meta.depths[settings.d]} m` : ""}
        {meta?.static ? " · static" : ""}
      </div>
      {settings.layer !== "none" && (
        <div className="pointer-events-none absolute bottom-6 left-3 w-60 rounded-md bg-slate-950/85 p-2.5 text-xs text-slate-300 backdrop-blur">
          <div className="mb-1 font-medium">
            {settings.layer === "habitat" ? "Habitat criteria met" : `${meta?.label} (${meta?.unit || "-"})`}
          </div>
          {envGrid && (
            <div className="mb-1 text-[10px] text-slate-500">
              {meta?.source ?? "Dashboard criteria"} · {resolutionLabel(envGrid)}
            </div>
          )}
          <div className="h-2.5 rounded" style={{ background: rampCss(ramp) }} />
          <div className="mt-1 flex justify-between tabular-nums">
            <span>{settings.layer === "habitat" ? "0%" : fmt(lo)}</span>
            <span>{settings.layer === "habitat" ? "100%" : fmt(hi)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
