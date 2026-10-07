"use client";

import { useMemo, useState, type ReactNode } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { ChartLineUp, CheckCircle, ListChecks, MapPin, XCircle } from "@phosphor-icons/react";
import type { Settings } from "./Dashboard";
import type { LatLon } from "./MapView";
import { Callout, Chip, Stat, ToneIcon, type Tone } from "./ui";
import { DataBundle, fmt, isOcean, monthLabel, sampleAt } from "@/lib/data";
import { Criteria, compareVars, evalValues, histogram, validateHabitat } from "@/lib/habitat";

interface Props {
  bundle: DataBundle;
  settings: Settings;
  criteria: Criteria;
  point: LatLon | null;
  pinned: boolean;
  onClearPin: () => void;
}

type Tab = "verify" | "habitat" | "inspect";

const pct = (v: number | null) => (v == null ? "n/a" : `${(v * 100).toFixed(0)}%`);

const CHART = {
  effort: "#ff7a1a",
  suitable: "#22d3ee",
  sea: "#b4c0d2",
  tick: "#8c9ab0",
  grid: "rgba(148,163,184,0.14)",
};
const tooltipStyle = {
  background: "#0d1424",
  border: "1px solid rgba(148,163,184,0.28)",
  borderRadius: 8,
  fontSize: 12,
  color: "#e6edf7",
};

export default function Insights(props: Props) {
  const [tab, setTab] = useState<Tab>("verify");
  const tabs: { id: Tab; label: string; icon: ReactNode }[] = [
    { id: "verify", label: "Data checks", icon: <ListChecks className="size-4" /> },
    { id: "habitat", label: "Habitat test", icon: <ChartLineUp className="size-4" /> },
    { id: "inspect", label: "Inspector", icon: <MapPin className="size-4" /> },
  ];
  return (
    <div>
      <div role="tablist" aria-label="Results" className="sticky top-0 z-10 flex border-b border-line bg-panel">
        {tabs.map((t) => {
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              id={`tab-${t.id}`}
              aria-selected={active}
              aria-controls={`panel-${t.id}`}
              onClick={() => setTab(t.id)}
              className={`flex flex-1 items-center justify-center gap-2 border-b-2 px-3 py-3 text-xs font-medium transition-colors ${
                active ? "border-accent text-accent" : "border-transparent text-ink-3 hover:text-ink"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel" id={`panel-${tab}`} aria-labelledby={`tab-${tab}`} className="p-4">
        {tab === "verify" && <VerifyTab {...props} />}
        {tab === "habitat" && <HabitatTab {...props} />}
        {tab === "inspect" && <InspectTab {...props} />}
      </div>
    </div>
  );
}

interface Check {
  s: Tone;
  title: string;
  detail: string;
}

const ORDER: Record<Tone, number> = { bad: 0, warn: 1, info: 2, ok: 3, neutral: 4 };

function VerifyTab({ bundle }: Props) {
  const v = bundle.verification;
  const rows = bundle.fishing;
  const box = useMemo(() => {
    const lats = rows.map((r) => r.lat);
    const lons = rows.map((r) => r.lon);
    return [Math.min(...lats), Math.max(...lats), Math.min(...lons), Math.max(...lons)];
  }, [rows]);
  const g = bundle.meta.analysis;
  const envLat1 = g.lat0 + (g.ny - 1) * g.dlat;
  const envLon1 = g.lon0 + (g.nx - 1) * g.dlon;
  const areaShare = ((box[1] - box[0]) * (box[3] - box[2])) / ((envLat1 - g.lat0) * (envLon1 - g.lon0));

  const checks: Check[] = [
    {
      s: v.duplicateKeys === 0 && v.nulls === 0 ? "ok" : "bad",
      title: "File structure",
      detail: `${v.rows} rows, ${v.uniqueCells} grid cells, ${v.monthsInFile} months. ${v.duplicateKeys} duplicate month and cell keys, ${v.nulls} empty values.`,
    },
    {
      s: v.onLandRows === 0 ? "ok" : v.onLandNonZeroRows > 0 ? "bad" : "warn",
      title: "Positions versus coastline",
      detail:
        v.onLandRows === 0
          ? "No row falls on land in the GEBCO 2021 coastline (about 5 km grid)."
          : `${v.onLandRows} rows fall on land (${v.onLandNonZeroRows} with fishing effort). The coastline grid is about 5 km, so rows within one cell of the shore may be false alarms. They are ringed red on the map.`,
    },
    {
      s: v.outsideEnvGridRows === 0 ? "ok" : "warn",
      title: "Inside the ocean-data window",
      detail: `${v.outsideEnvGridRows} rows lie outside the downloaded window (${g.lat0} to ${envLat1} N, ${g.lon0} to ${envLon1} E).`,
    },
    {
      s: v.zeroShare > 0.9 ? "warn" : "ok",
      title: "Zero-effort cells",
      detail: `${(v.zeroShare * 100).toFixed(0)}% of rows record 0 fishing hours, leaving only ${v.nonZeroRows} active rows. That is a thin base for statistics, and the file may be a sample of a larger dataset.`,
    },
    {
      s: v.lkaAllZero ? "warn" : "ok",
      title: "Sri Lankan-flag column (lka_hours)",
      detail: v.lkaAllZero
        ? "Zero in every row. Small Sri Lankan boats rarely carry AIS, so local effort is probably missing and this file mostly shows foreign or large vessels."
        : "Contains values.",
    },
    {
      s: v.topCellShare > 0.25 ? "warn" : "ok",
      title: "Single-cell dominance",
      detail: `The busiest cell (${v.topCell.lat} N, ${v.topCell.lon} E, ${monthLabel(v.topCell.month)}) holds ${(v.topCellShare * 100).toFixed(0)}% of all hours (${fmt(v.topCell.hours)} h). ${v.outlierRows} row(s) exceed the outlier fence of ${fmt(v.outlierFence)} h.`,
    },
    {
      s: v.longlineExceedsFishing === 0 ? "ok" : "bad",
      title: "Longline hours do not exceed fishing hours",
      detail: v.longlineExceedsFishing === 0 ? "Consistent in every row." : `${v.longlineExceedsFishing} rows violate this.`,
    },
    {
      s: v.monthsMissingFromRange.length === 0 ? "ok" : "warn",
      title: "Month coverage",
      detail:
        v.monthsMissingFromRange.length === 0
          ? "Every month of the environmental record appears."
          : `${v.monthsMissingFromRange.length} of ${bundle.meta.months.length} months have no fishing rows (${v.monthsMissingFromRange.slice(0, 6).join(", ")}${v.monthsMissingFromRange.length > 6 ? ", and more" : ""}).`,
    },
    {
      s: areaShare < 0.5 ? "warn" : "ok",
      title: "Spatial coverage",
      detail: `Fishing rows span ${box[0]} to ${box[1]} N and ${box[2]} to ${box[3]} E, about ${(areaShare * 100).toFixed(0)}% of the area downloaded for all Sri Lankan waters.`,
    },
  ];
  checks.sort((a, b) => ORDER[a.s] - ORDER[b.s]);

  const count = (t: Tone) => checks.filter((c) => c.s === t).length;
  const attention = checks.filter((c) => c.s !== "ok");
  const passed = checks.filter((c) => c.s === "ok");

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-2">
        <Stat label="Rows" value={String(v.rows)} />
        <Stat label="With effort" value={String(v.nonZeroRows)} />
        <Stat label="Total hours" value={fmt(v.totalFishingHours, 0)} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {count("bad") > 0 && <Chip tone="bad">{count("bad")} problem</Chip>}
        <Chip tone={count("warn") > 0 ? "warn" : "neutral"}>{count("warn")} to review</Chip>
        <Chip tone="ok">{count("ok")} passed</Chip>
      </div>

      <ul className="space-y-2">
        {attention.map((c) => (
          <li key={c.title} className="flex gap-3 rounded-lg border border-line bg-panel-2 p-3">
            <ToneIcon tone={c.s} className="mt-0.5 size-[18px]" />
            <div className="min-w-0">
              <div className="text-xs font-medium text-ink">{c.title}</div>
              <p className="mt-1 text-xs leading-relaxed text-ink-2">{c.detail}</p>
            </div>
          </li>
        ))}
      </ul>

      <details className="group rounded-lg border border-line">
        <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2.5 text-xs font-medium text-ink-2 select-none hover:text-ink [&::-webkit-details-marker]:hidden">
          <CheckCircle weight="fill" className="size-4 text-ok" aria-hidden />
          {passed.length} checks passed
          <span className="ml-auto text-ink-3 group-open:hidden">Show</span>
          <span className="ml-auto hidden text-ink-3 group-open:inline">Hide</span>
        </summary>
        <ul className="space-y-3 border-t border-line p-3">
          {passed.map((c) => (
            <li key={c.title}>
              <div className="text-xs font-medium text-ink">{c.title}</div>
              <p className="mt-0.5 text-xs leading-relaxed text-ink-3">{c.detail}</p>
            </li>
          ))}
        </ul>
      </details>

      <div className="rounded-lg border border-line p-3">
        <div className="mb-2 text-xs font-medium text-ink">Data sources</div>
        <ul className="space-y-1.5 text-[11px] leading-relaxed text-ink-3">
          {Object.entries(bundle.meta.sources).map(([k, text]) => (
            <li key={k}>{text}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function HabitatTab({ bundle, settings, criteria }: Props) {
  const [histKey, setHistKey] = useState("o2");
  const active = Object.values(criteria).filter((c) => c.enabled);
  const val = useMemo(
    () => validateHabitat(bundle, criteria, settings.d, settings.metric),
    [bundle, criteria, settings.d, settings.metric],
  );
  const vars = useMemo(() => compareVars(bundle, settings.d, settings.metric), [bundle, settings.d, settings.metric]);
  const hist = useMemo(
    () => histogram(bundle, histKey, settings.d, settings.metric),
    [bundle, histKey, settings.d, settings.metric],
  );
  const chart = val.months.map((m) => ({
    month: m.month,
    effort: Number(m.effort.toFixed(2)),
    atFishing: m.passShare == null ? null : Math.round(m.passShare * 100),
    available: m.baseline == null ? null : Math.round(m.baseline * 100),
  }));

  let verdict = "Switch on at least one habitat criterion to run the test.";
  let tone: Tone = "info";
  if (active.length > 0 && val.passShare != null && val.baseline === 0) {
    verdict = `No water in the study area meets these criteria at ${bundle.meta.depths[settings.d]} m, so the test cannot tell anything apart. Try a shallower depth or relax a limit (low oxygen at depth is the usual cause).`;
    tone = "warn";
  } else if (active.length > 0 && val.lift != null) {
    if (val.lift >= 1.3) {
      verdict = "Fishing effort sits in suitable water more often than chance. This supports the data.";
      tone = "ok";
    } else if (val.lift >= 0.8) {
      verdict = "Effort is no more concentrated in suitable water than the surrounding sea. The data neither confirm nor contradict the criteria.";
      tone = "info";
    } else {
      verdict = "Effort sits in suitable water less often than chance. Either the criteria do not fit this fleet or the data need a closer look.";
      tone = "warn";
    }
  } else if (active.length > 0) {
    verdict = "No fishing rows overlap valid environmental data at this depth. Try a shallower depth or fewer criteria.";
    tone = "warn";
  }

  return (
    <div className="space-y-5">
      <Callout tone={tone}>{verdict}</Callout>

      <div className="grid grid-cols-3 gap-2">
        <Stat label="Effort in suitable water" value={pct(val.passShare)} />
        <Stat label="Sea that is suitable" value={pct(val.baseline)} />
        <Stat label="Lift" value={val.lift == null ? "n/a" : `${val.lift.toFixed(2)}x`} />
      </div>
      <p className="text-[11px] leading-relaxed text-ink-3">
        Based on <span className="num">{val.nRows}</span> active rows at <span className="num">{bundle.meta.depths[settings.d]} m</span>. Lift above 1
        means effort favours suitable water. With so few rows this is indicative only, and fishing hours show where vessels went, not where fish are.
      </p>

      <div>
        <h3 className="mb-2 text-xs font-medium text-ink">Monthly effort versus suitable water</h3>
        <div className="h-52 rounded-lg border border-line bg-panel-2 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart} margin={{ top: 6, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="month" tick={{ fill: CHART.tick, fontSize: 10 }} tickFormatter={(m: string) => m.slice(2)} interval={5} stroke={CHART.grid} />
              <YAxis yAxisId="l" tick={{ fill: CHART.tick, fontSize: 10 }} stroke={CHART.grid} />
              <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={{ fill: CHART.tick, fontSize: 10 }} unit="%" stroke={CHART.grid} />
              <Tooltip contentStyle={tooltipStyle} />
              <Legend wrapperStyle={{ fontSize: 11, color: CHART.tick }} />
              <Bar yAxisId="l" dataKey="effort" name="Effort (h)" fill={CHART.effort} radius={[2, 2, 0, 0]} />
              <Line yAxisId="r" dataKey="atFishing" name="% effort in suitable" stroke={CHART.suitable} strokeWidth={2} dot={false} connectNulls />
              <Line yAxisId="r" dataKey="available" name="% sea suitable" stroke={CHART.sea} strokeWidth={1.5} dot={false} strokeDasharray="4 3" connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <h3 className="mb-2 text-xs font-medium text-ink">Conditions at fishing cells versus the surrounding sea</h3>
        <div className="overflow-hidden rounded-lg border border-line">
          <table className="w-full text-xs">
            <thead>
              <tr className="bg-panel-2 text-left text-[11px] text-ink-3">
                <th className="px-3 py-2 font-medium">Variable</th>
                <th className="px-2 py-2 text-right font-medium">At effort</th>
                <th className="px-2 py-2 text-right font-medium">Sea</th>
                <th className="px-3 py-2 text-right font-medium" title="Difference in standard deviations of the sea">
                  Diff
                </th>
              </tr>
            </thead>
            <tbody>
              {vars.map((r) => (
                <tr key={r.key} className="border-t border-line">
                  <td className="px-3 py-1.5 text-ink-2">
                    {r.label} <span className="text-ink-3">{r.unit}</span>
                  </td>
                  <td className="num px-2 py-1.5 text-right text-ink">{fmt(r.fish)}</td>
                  <td className="num px-2 py-1.5 text-right text-ink-3">{fmt(r.domain)}</td>
                  <td className={`num px-3 py-1.5 text-right ${Math.abs(r.z) >= 1 ? "font-medium text-warn" : "text-ink-3"}`}>
                    {r.z > 0 ? "+" : ""}
                    {r.z.toFixed(2)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-1.5 text-[11px] text-ink-3">Diff is in standard deviations of the surrounding sea. Amber means one or more.</p>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between gap-2">
          <h3 className="text-xs font-medium text-ink">Distribution</h3>
          <select
            aria-label="Variable for the distribution chart"
            value={histKey}
            onChange={(e) => setHistKey(e.target.value)}
            className="max-w-[60%] rounded-md border border-line bg-panel-2 px-2 py-1.5 text-xs text-ink"
          >
            {Object.entries(bundle.meta.vars).map(([k, m]) => (
              <option key={k} value={k}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="h-44 rounded-lg border border-line bg-panel-2 p-2">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={hist} margin={{ top: 6, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid stroke={CHART.grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fill: CHART.tick, fontSize: 10 }} interval={1} stroke={CHART.grid} />
              <YAxis tick={{ fill: CHART.tick, fontSize: 10 }} tickFormatter={(x: number) => `${Math.round(x * 100)}%`} stroke={CHART.grid} />
              <Tooltip contentStyle={tooltipStyle} formatter={(x) => `${(Number(x) * 100).toFixed(0)}%`} />
              <Legend wrapperStyle={{ fontSize: 11, color: CHART.tick }} />
              <Bar dataKey="available" name="Sea available" fill={CHART.sea} fillOpacity={0.45} radius={[2, 2, 0, 0]} />
              <Bar dataKey="fish" name="Fishing effort" fill={CHART.effort} radius={[2, 2, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function InspectTab({ bundle, settings, criteria, point, pinned, onClearPin }: Props) {
  if (!point) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-lg border border-dashed border-line px-6 py-10 text-center">
        <MapPin className="size-7 text-ink-3" aria-hidden />
        <p className="text-sm font-medium text-ink">Nothing selected</p>
        <p className="max-w-[16rem] text-xs leading-relaxed text-ink-3">
          Move over the map to read values, or click to pin a location and see how it scores against your habitat criteria.
        </p>
      </div>
    );
  }
  const values = sampleAt(bundle, point.lat, point.lon, settings.t, settings.d);
  const ev = evalValues(values, criteria);
  const ocean = isOcean(bundle, point.lat, point.lon);
  const near = bundle.fishing.filter((r) => Math.abs(r.lat - point.lat) <= 0.06 && Math.abs(r.lon - point.lon) <= 0.06);
  const nearActive = near.filter((r) => r.fishing > 0);

  const verdictTone: Tone = Number.isFinite(ev.score) ? (ev.pass ? "ok" : "warn") : "info";

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="num text-sm font-medium text-ink">
            {point.lat.toFixed(3)} N, {point.lon.toFixed(3)} E
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            <Chip>{monthLabel(bundle.meta.months[settings.t])}</Chip>
            <Chip>
              <span className="num">{bundle.meta.depths[settings.d]} m</span>
            </Chip>
            <Chip tone={ocean ? "info" : "neutral"}>{ocean ? "Ocean" : "Land or no data"}</Chip>
          </div>
        </div>
        {pinned && (
          <button
            type="button"
            onClick={onClearPin}
            className="rounded-md border border-line px-2.5 py-1.5 text-xs text-ink-2 hover:bg-white/[.06] hover:text-ink"
          >
            Unpin
          </button>
        )}
      </div>

      <Callout tone={verdictTone}>
        {Number.isFinite(ev.score)
          ? ev.pass
            ? "Meets every enabled habitat criterion."
            : `Fails: ${ev.failed.map((k) => criteria[k].label).join(", ")}.`
          : "Habitat cannot be scored here (no data, or no criteria switched on)."}
      </Callout>

      <div className="overflow-hidden rounded-lg border border-line">
        <table className="w-full text-xs">
          <tbody>
            {Object.entries(bundle.meta.vars).map(([k, m]) => {
              const c = criteria[k];
              const failed = c?.enabled && ev.failed.includes(k);
              const passed = c?.enabled && Number.isFinite(values[k]) && !failed;
              return (
                <tr key={k} className="border-t border-line first:border-t-0">
                  <td className="w-5 py-1.5 pl-3">
                    {failed && <XCircle weight="fill" className="size-3.5 text-bad" aria-label="Fails criterion" />}
                    {passed && <CheckCircle weight="fill" className="size-3.5 text-ok" aria-label="Meets criterion" />}
                  </td>
                  <td className="px-2 py-1.5 text-ink-2">{m.label}</td>
                  <td className={`num px-3 py-1.5 text-right ${failed ? "font-medium text-bad" : "text-ink"}`}>
                    {fmt(values[k])} <span className="text-ink-3">{m.unit}</span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div>
        <div className="mb-2 text-xs font-medium text-ink">Fishing records within 0.06 degrees</div>
        {near.length === 0 ? (
          <p className="text-xs text-ink-3">None in the file.</p>
        ) : (
          <>
            <p className="mb-2 text-xs text-ink-3">
              <span className="num">{near.length}</span> rows, <span className="num">{nearActive.length}</span> with effort.
            </p>
            <ul className="scroll-thin num max-h-40 space-y-1 overflow-y-auto text-xs text-ink-2">
              {(nearActive.length ? nearActive : near.slice(0, 8)).map((r, i) => (
                <li key={i} className="flex justify-between gap-3 rounded-md bg-white/[.04] px-2.5 py-1.5">
                  <span>{r.mi >= 0 ? bundle.meta.months[r.mi] : "n/a"}</span>
                  <span>
                    {fmt(r.fishing)} h fishing, {fmt(r.longline)} h longline
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
