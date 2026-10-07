"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import MapView, { LatLon } from "./MapView";
import Controls from "./Controls";
import Insights from "./Insights";
import { DataBundle, loadData, monthLabel } from "@/lib/data";
import { Criterion, Criteria, Metric, PresetId, makeCriteria, monthlyEffort } from "@/lib/habitat";

export type TimeMode = "month" | "cumulative" | "all";

export interface Settings {
  t: number;
  d: number;
  layer: string; // variable key, "habitat" or "none"
  opacity: number;
  rangeMode: "auto" | "manual";
  range: [number, number];
  showFishing: boolean;
  metric: Metric;
  timeMode: TimeMode;
  radius: number;
  showZero: boolean;
  flagLand: boolean;
}

function initialSettings(b: DataBundle): Settings {
  const eff = monthlyEffort(b, "fishing");
  const best = eff.indexOf(Math.max(...eff));
  const o2 = b.meta.vars.o2;
  return {
    t: Math.max(0, best),
    d: Math.min(3, b.meta.depths.length - 1),
    layer: "o2",
    opacity: 0.75,
    rangeMode: "auto",
    range: [o2.p02, o2.p98],
    showFishing: true,
    metric: "fishing",
    timeMode: "month",
    radius: 3,
    showZero: true,
    flagLand: true,
  };
}

export default function Dashboard() {
  const [bundle, setBundle] = useState<DataBundle | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    loadData()
      .then((b) => alive && setBundle(b))
      .catch((e) => alive && setError(String(e)));
    return () => {
      alive = false;
    };
  }, []);

  if (error) {
    return (
      <div className="flex h-dvh items-center justify-center bg-slate-950 p-8 text-slate-200">
        <div className="max-w-md space-y-2 text-sm">
          <h1 className="text-lg font-semibold text-red-300">Dashboard data not found</h1>
          <p>{error}</p>
          <p className="text-slate-400">
            Generate it with <code className="rounded bg-slate-800 px-1">npm run data:fetch</code> then{" "}
            <code className="rounded bg-slate-800 px-1">npm run data:build</code>.
          </p>
        </div>
      </div>
    );
  }
  if (!bundle) {
    return <div className="flex h-dvh items-center justify-center bg-slate-950 text-slate-400">Loading ocean data…</div>;
  }
  return <Workspace bundle={bundle} />;
}

function Workspace({ bundle }: { bundle: DataBundle }) {
  const [settings, setSettings] = useState<Settings>(() => initialSettings(bundle));
  const [preset, setPreset] = useState<PresetId>("general");
  const [criteria, setCriteria] = useState<Criteria>(() => makeCriteria("general"));
  const [inspect, setInspect] = useState<LatLon | null>(null);
  const [hover, setHover] = useState<LatLon | null>(null);
  const [playing, setPlaying] = useState(false);

  const update = useCallback((patch: Partial<Settings>) => {
    setSettings((s) => {
      const next = { ...s, ...patch };
      if (patch.layer && patch.layer !== s.layer) {
        const v = bundle.meta.vars[patch.layer];
        if (v) next.range = [v.p02, v.p98];
      }
      return next;
    });
  }, [bundle.meta.vars]);

  const patchCriterion = useCallback((key: string, patch: Partial<Criterion>) => {
    setCriteria((c) => ({ ...c, [key]: { ...c[key], ...patch } }));
  }, []);

  const applyPreset = useCallback((p: PresetId) => {
    setPreset(p);
    setCriteria(makeCriteria(p));
  }, []);

  const nm = bundle.meta.months.length;
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => setSettings((s) => ({ ...s, t: (s.t + 1) % nm })), 900);
    return () => clearInterval(id);
  }, [playing, nm]);

  const effort = useMemo(() => monthlyEffort(bundle, settings.metric), [bundle, settings.metric]);
  const maxEffort = Math.max(...effort, 1e-9);

  return (
    <div className="flex min-h-dvh flex-col bg-slate-950 text-slate-100 lg:h-dvh">
      <header className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-slate-800 px-4 py-2.5">
        <h1 className="text-base font-semibold tracking-tight">Sri Lanka fishing-effort verification</h1>
        <p className="text-xs text-slate-400">
          Fishing_sl.csv overlaid on Copernicus Marine oxygen, temperature, salinity, chlorophyll and more · {bundle.verification.rows} rows ·{" "}
          {monthLabel(bundle.verification.monthRange[0])} – {monthLabel(bundle.verification.monthRange[1])}
        </p>
      </header>
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <aside className="w-full shrink-0 overflow-y-auto border-slate-800 lg:w-80 lg:border-r">
          <Controls
            bundle={bundle}
            settings={settings}
            update={update}
            criteria={criteria}
            patchCriterion={patchCriterion}
            preset={preset}
            applyPreset={applyPreset}
          />
        </aside>
        <main className="flex min-h-[70vh] min-w-0 flex-1 flex-col lg:min-h-0">
          <div className="relative min-h-0 flex-1">
            <MapView
              bundle={bundle}
              settings={settings}
              criteria={criteria}
              inspect={inspect}
              onInspect={setInspect}
              onHover={setHover}
            />
          </div>
          <div className="flex items-center gap-3 border-t border-slate-800 bg-slate-900 px-3 py-2">
            <button
              type="button"
              onClick={() => setPlaying((p) => !p)}
              className="w-16 rounded bg-cyan-600 px-2 py-1 text-xs font-medium text-white hover:bg-cyan-500"
            >
              {playing ? "Pause" : "Play"}
            </button>
            <div className="min-w-0 flex-1">
              <div className="flex h-8 items-end gap-px">
                {effort.map((e, i) => (
                  <div
                    key={bundle.meta.months[i]}
                    className={`flex-1 rounded-t-sm ${i === settings.t ? "bg-cyan-400" : e > 0 ? "bg-orange-500/70" : "bg-slate-700"}`}
                    style={{ height: `${Math.max(8, (e / maxEffort) * 100)}%` }}
                    title={`${monthLabel(bundle.meta.months[i])}: ${e.toFixed(1)} h`}
                  />
                ))}
              </div>
              <input
                type="range"
                min={0}
                max={nm - 1}
                value={settings.t}
                onChange={(e) => update({ t: Number(e.target.value) })}
                className="w-full accent-cyan-400"
                aria-label="Month"
              />
            </div>
            <div className="w-20 text-right text-xs tabular-nums text-slate-300">{monthLabel(bundle.meta.months[settings.t])}</div>
          </div>
        </main>
        <aside className="w-full shrink-0 overflow-y-auto border-slate-800 lg:w-[26rem] lg:border-l">
          <Insights
            bundle={bundle}
            settings={settings}
            criteria={criteria}
            point={inspect ?? hover}
            pinned={inspect != null}
            onClearPin={() => setInspect(null)}
          />
        </aside>
      </div>
    </div>
  );
}
