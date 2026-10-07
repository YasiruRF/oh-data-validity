"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CaretLeft, CaretRight, FishSimple, Pause, Play, SidebarSimple } from "@phosphor-icons/react";
import MapView, { LatLon } from "./MapView";
import Controls from "./Controls";
import Insights from "./Insights";
import { Callout, Chip, IconButton } from "./ui";
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

function Skeleton() {
  const bar = "rounded-md bg-white/[.06] motion-safe:animate-pulse";
  return (
    <div className="flex h-dvh flex-col bg-bg" role="status" aria-label="Loading ocean data">
      <div className="flex h-14 items-center gap-3 border-b border-line bg-panel px-4">
        <div className={`${bar} size-8`} />
        <div className={`${bar} h-4 w-56`} />
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-[22rem] space-y-4 border-r border-line bg-panel p-4 lg:block">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="space-y-2.5">
              <div className={`${bar} h-4 w-32`} />
              <div className={`${bar} h-9 w-full`} />
              <div className={`${bar} h-9 w-full`} />
            </div>
          ))}
        </div>
        <div className="flex flex-1 items-center justify-center text-sm text-ink-3">Loading ocean data</div>
        <div className="hidden w-[26rem] space-y-3 border-l border-line bg-panel p-4 lg:block">
          <div className={`${bar} h-9 w-full`} />
          <div className="grid grid-cols-3 gap-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className={`${bar} h-16`} />
            ))}
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className={`${bar} h-16 w-full`} />
          ))}
        </div>
      </div>
    </div>
  );
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
      <div className="flex h-dvh items-center justify-center bg-bg p-6">
        <div className="max-w-md space-y-3">
          <Callout tone="bad">
            <p className="font-medium">The dashboard data could not be loaded.</p>
            <p className="num mt-1 text-ink-2">{error}</p>
          </Callout>
          <p className="text-xs leading-relaxed text-ink-3">
            Generate it with <code className="num rounded bg-white/[.08] px-1.5 py-0.5 text-ink-2">npm run data:fetch</code>,{" "}
            <code className="num rounded bg-white/[.08] px-1.5 py-0.5 text-ink-2">npm run data:fetch:sat</code>, then{" "}
            <code className="num rounded bg-white/[.08] px-1.5 py-0.5 text-ink-2">npm run data:build</code>.
          </p>
        </div>
      </div>
    );
  }
  if (!bundle) return <Skeleton />;
  return <Workspace bundle={bundle} />;
}

function Workspace({ bundle }: { bundle: DataBundle }) {
  const [settings, setSettings] = useState<Settings>(() => initialSettings(bundle));
  const [preset, setPreset] = useState<PresetId>("general");
  const [criteria, setCriteria] = useState<Criteria>(() => makeCriteria("general"));
  const [inspect, setInspect] = useState<LatLon | null>(null);
  const [hover, setHover] = useState<LatLon | null>(null);
  const [playing, setPlaying] = useState(false);
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);

  const nm = bundle.meta.months.length;

  const update = useCallback(
    (patch: Partial<Settings>) => {
      setSettings((s) => {
        const next = { ...s, ...patch };
        if (patch.layer && patch.layer !== s.layer) {
          const v = bundle.meta.vars[patch.layer];
          if (v) next.range = [v.p02, v.p98];
        }
        return next;
      });
    },
    [bundle.meta.vars],
  );

  const patchCriterion = useCallback((key: string, patch: Partial<Criterion>) => {
    setCriteria((c) => ({ ...c, [key]: { ...c[key], ...patch } }));
  }, []);

  const applyPreset = useCallback((p: PresetId) => {
    setPreset(p);
    setCriteria(makeCriteria(p));
  }, []);

  const step = useCallback((delta: number) => setSettings((s) => ({ ...s, t: (s.t + delta + nm) % nm })), [nm]);

  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => step(1), 900);
    return () => clearInterval(id);
  }, [playing, step]);

  // left and right arrow keys step through months unless the user is typing or using a slider
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.tagName === "TEXTAREA")) return;
      if (e.key === "ArrowLeft") step(-1);
      if (e.key === "ArrowRight") step(1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  const effort = useMemo(() => monthlyEffort(bundle, settings.metric), [bundle, settings.metric]);
  const maxEffort = Math.max(...effort, 1e-9);
  const yearMarks = useMemo(
    () =>
      bundle.meta.months
        .map((m, i) => ({ year: m.slice(0, 4), i }))
        .filter((m, idx, arr) => idx === 0 || arr[idx - 1].year !== m.year),
    [bundle.meta.months],
  );
  const v = bundle.verification;

  return (
    <div className="flex min-h-dvh flex-col bg-bg text-ink lg:h-dvh">
      <header className="flex min-h-14 flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-panel px-4 py-2">
        <div className="flex items-center gap-3">
          <span className="inline-flex size-8 items-center justify-center rounded-md bg-accent/15 text-accent" aria-hidden>
            <FishSimple className="size-[18px]" weight="fill" />
          </span>
          <div>
            <h1 className="text-sm leading-tight font-semibold tracking-tight">Sri Lanka fishing verification</h1>
            <p className="text-xs leading-tight text-ink-3">Fishing effort checked against ocean conditions</p>
          </div>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Chip title="Rows in Fishing_sl.csv">
            <span className="num">{v.rows}</span> rows
          </Chip>
          <Chip tone={v.nonZeroRows < 30 ? "warn" : "neutral"} title="Rows with any fishing hours">
            <span className="num">{v.nonZeroRows}</span> with effort
          </Chip>
          <Chip>
            {monthLabel(v.monthRange[0])} to {monthLabel(v.monthRange[1])}
          </Chip>
          <span className="mx-1 hidden h-5 w-px bg-line lg:block" />
          <IconButton label={leftOpen ? "Hide settings panel" : "Show settings panel"} active={leftOpen} onClick={() => setLeftOpen((o) => !o)}>
            <SidebarSimple className="size-4" aria-hidden />
          </IconButton>
          <IconButton label={rightOpen ? "Hide results panel" : "Show results panel"} active={rightOpen} onClick={() => setRightOpen((o) => !o)}>
            <SidebarSimple className="size-4 -scale-x-100" aria-hidden />
          </IconButton>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        {leftOpen && (
          <aside className="scroll-thin w-full shrink-0 overflow-y-auto border-line bg-panel lg:w-[22rem] lg:border-r">
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
        )}

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

          <div className="border-t border-line bg-panel px-4 pt-3 pb-2">
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <IconButton label="Previous month (left arrow)" onClick={() => step(-1)}>
                  <CaretLeft className="size-4" aria-hidden />
                </IconButton>
                <button
                  type="button"
                  onClick={() => setPlaying((p) => !p)}
                  aria-label={playing ? "Pause animation" : "Play through months"}
                  className="inline-flex h-8 w-[4.5rem] items-center justify-center gap-1.5 rounded-md bg-accent text-xs font-medium text-accent-ink hover:brightness-110"
                >
                  {playing ? <Pause weight="fill" className="size-3.5" aria-hidden /> : <Play weight="fill" className="size-3.5" aria-hidden />}
                  {playing ? "Pause" : "Play"}
                </button>
                <IconButton label="Next month (right arrow)" onClick={() => step(1)}>
                  <CaretRight className="size-4" aria-hidden />
                </IconButton>
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex h-9 items-end gap-px" role="group" aria-label="Fishing effort by month, select a month">
                  {effort.map((e, i) => {
                    const active = i === settings.t;
                    return (
                      <button
                        key={bundle.meta.months[i]}
                        type="button"
                        aria-label={`${monthLabel(bundle.meta.months[i])}: ${e.toFixed(1)} hours`}
                        aria-current={active}
                        title={`${monthLabel(bundle.meta.months[i])}: ${e.toFixed(1)} h`}
                        onClick={() => update({ t: i })}
                        className="group flex h-full flex-1 items-end"
                      >
                        <span
                          className={`block w-full rounded-t-sm transition-colors ${
                            active ? "bg-accent" : e > 0 ? "bg-effort/70 group-hover:bg-effort" : "bg-white/[.14] group-hover:bg-white/30"
                          }`}
                          style={{ height: `${Math.max(10, (e / maxEffort) * 100)}%` }}
                        />
                      </button>
                    );
                  })}
                </div>
                <div className="relative mt-1 h-4">
                  {yearMarks.map((m) => (
                    <span
                      key={m.year}
                      className="num absolute top-0 text-[10px] text-ink-3"
                      style={{ left: `${(m.i / nm) * 100}%` }}
                    >
                      {m.year}
                    </span>
                  ))}
                </div>
              </div>

              <div className="num w-20 shrink-0 text-right text-sm font-medium">{monthLabel(bundle.meta.months[settings.t])}</div>
            </div>
          </div>
        </main>

        {rightOpen && (
          <aside className="scroll-thin w-full shrink-0 overflow-y-auto border-line bg-panel lg:w-[26rem] lg:border-l">
            <Insights
              bundle={bundle}
              settings={settings}
              criteria={criteria}
              point={inspect ?? hover}
              pinned={inspect != null}
              onClearPin={() => setInspect(null)}
            />
          </aside>
        )}
      </div>
    </div>
  );
}
