"use client";

import { useMemo, useState } from "react";
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
import type { Settings } from "./Dashboard";
import type { LatLon } from "./MapView";
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
type Status = "ok" | "warn" | "fail" | "info";

const BADGE: Record<Status, string> = {
  ok: "bg-emerald-500/15 text-emerald-300 border-emerald-500/40",
  warn: "bg-amber-500/15 text-amber-300 border-amber-500/40",
  fail: "bg-red-500/15 text-red-300 border-red-500/40",
  info: "bg-sky-500/15 text-sky-300 border-sky-500/40",
};
const BADGE_TEXT: Record<Status, string> = { ok: "OK", warn: "Check", fail: "Problem", info: "Note" };

const pct = (v: number | null) => (v == null ? "n/a" : `${(v * 100).toFixed(0)}%`);

export default function Insights(props: Props) {
  const [tab, setTab] = useState<Tab>("verify");
  const tabs: [Tab, string][] = [
    ["verify", "Data checks"],
    ["habitat", "Habitat test"],
    ["inspect", "Inspector"],
  ];
  return (
    <div className="text-slate-200">
      <div className="sticky top-0 z-10 flex border-b border-slate-800 bg-slate-950">
        {tabs.map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            className={`flex-1 px-3 py-2.5 text-xs font-medium ${tab === id ? "border-b-2 border-cyan-400 text-cyan-200" : "text-slate-400 hover:text-slate-200"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <div className="p-4">
        {tab === "verify" && <VerifyTab {...props} />}
        {tab === "habitat" && <HabitatTab {...props} />}
        {tab === "inspect" && <InspectTab {...props} />}
      </div>
    </div>
  );
}

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

  const checks: { s: Status; title: string; detail: string }[] = [
    {
      s: v.duplicateKeys === 0 && v.nulls === 0 ? "ok" : "fail",
      title: "File structure",
      detail: `${v.rows} rows, ${v.uniqueCells} grid cells, ${v.monthsInFile} months. ${v.duplicateKeys} duplicate month/cell keys, ${v.nulls} empty values.`,
    },
    {
      s: v.onLandRows === 0 ? "ok" : v.onLandNonZeroRows > 0 ? "fail" : "warn",
      title: "Positions versus coastline",
      detail:
        v.onLandRows === 0
          ? "No row falls on land in the GEBCO 2021 coastline (~5 km grid)."
          : `${v.onLandRows} rows fall on land cells (${v.onLandNonZeroRows} with fishing effort). The coastline grid is ~5 km, so rows within one cell of the shore may be false alarms. They are ringed red on the map.`,
    },
    {
      s: v.outsideEnvGridRows === 0 ? "ok" : "warn",
      title: "Inside the environmental window",
      detail: `${v.outsideEnvGridRows} rows lie outside the downloaded ocean window (${g.lat0}–${envLat1}°N, ${g.lon0}–${envLon1}°E).`,
    },
    {
      s: v.zeroShare > 0.9 ? "warn" : "ok",
      title: "Zero-effort cells",
      detail: `${(v.zeroShare * 100).toFixed(0)}% of rows have 0 fishing hours, leaving only ${v.nonZeroRows} active rows. That is a thin base for any statistics. It may be a sample of the full dataset.`,
    },
    {
      s: v.lkaAllZero ? "warn" : "ok",
      title: "Sri Lankan-flag column (lka_hours)",
      detail: v.lkaAllZero
        ? "Zero in every row. Small Sri Lankan boats rarely carry AIS, so local effort is probably missing and this file shows mostly foreign or large vessels."
        : "Contains values.",
    },
    {
      s: v.topCellShare > 0.25 ? "warn" : "ok",
      title: "Single-cell dominance",
      detail: `Busiest cell (${v.topCell.lat}°N, ${v.topCell.lon}°E, ${monthLabel(v.topCell.month)}) holds ${(v.topCellShare * 100).toFixed(0)}% of all hours (${fmt(v.topCell.hours)} h). ${v.outlierRows} row(s) exceed the outlier fence of ${fmt(v.outlierFence)} h.`,
    },
    {
      s: v.longlineExceedsFishing === 0 ? "ok" : "fail",
      title: "Longline hours ≤ fishing hours",
      detail: v.longlineExceedsFishing === 0 ? "Consistent in every row." : `${v.longlineExceedsFishing} rows violate this.`,
    },
    {
      s: v.monthsMissingFromRange.length === 0 ? "ok" : "warn",
      title: "Month coverage",
      detail:
        v.monthsMissingFromRange.length === 0
          ? "Every month of the environmental record appears."
          : `${v.monthsMissingFromRange.length} of ${bundle.meta.months.length} environmental months have no fishing rows (${v.monthsMissingFromRange.slice(0, 6).join(", ")}${v.monthsMissingFromRange.length > 6 ? ", …" : ""}).`,
    },
    {
      s: areaShare < 0.5 ? "warn" : "ok",
      title: "Spatial coverage",
      detail: `Fishing rows span ${box[0]}–${box[1]}°N, ${box[2]}–${box[3]}°E, about ${(areaShare * 100).toFixed(0)}% of the area downloaded for all Sri Lankan waters.`,
    },
  ];

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Rows" value={String(v.rows)} />
        <Stat label="Active rows" value={String(v.nonZeroRows)} />
        <Stat label="Total hours" value={fmt(v.totalFishingHours, 0)} />
      </div>
      <ul className="space-y-2">
        {checks.map((c) => (
          <li key={c.title} className="rounded border border-slate-800 p-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-medium">{c.title}</span>
              <span className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase ${BADGE[c.s]}`}>{BADGE_TEXT[c.s]}</span>
            </div>
            <p className="mt-1 text-[11px] leading-snug text-slate-400">{c.detail}</p>
          </li>
        ))}
      </ul>
      <div className="rounded border border-slate-800 p-2.5 text-[11px] leading-snug text-slate-400">
        <div className="mb-1 text-xs font-medium text-slate-200">Sources</div>
        {Object.entries(bundle.meta.sources).map(([k, text]) => (
          <p key={k} className="mb-0.5">
            {text}
          </p>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-slate-800 px-2 py-2">
      <div className="text-base font-semibold tabular-nums">{value}</div>
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
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

  let verdict = "Enable at least one habitat criterion to run the test.";
  let tone: Status = "info";
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
      verdict = "Effort sits in suitable water less often than chance. Either the criteria are wrong for this fleet or the data need a closer look.";
      tone = "warn";
    }
  } else if (active.length > 0) {
    verdict = "No fishing rows overlap valid environmental data at this depth. Try a shallower depth or fewer criteria.";
    tone = "warn";
  }

  return (
    <div className="space-y-4">
      <div className={`rounded border p-2.5 text-xs leading-snug ${BADGE[tone]}`}>{verdict}</div>
      <div className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Effort in suitable water" value={pct(val.passShare)} />
        <Stat label="Sea that is suitable" value={pct(val.baseline)} />
        <Stat label="Lift" value={val.lift == null ? "n/a" : `${val.lift.toFixed(2)}×`} />
      </div>
      <p className="text-[11px] leading-snug text-slate-500">
        Based on {val.nRows} active rows at {bundle.meta.depths[settings.d]} m. Lift above 1 means effort favours suitable water. With so few rows this is
        indicative only. Fishing hours show where vessels went, not where fish are.
      </p>

      <div>
        <h3 className="mb-1 text-xs font-medium">Monthly effort versus suitable water</h3>
        <div className="h-52">
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={chart} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 9 }} tickFormatter={(m: string) => m.slice(2)} interval={3} />
              <YAxis yAxisId="l" tick={{ fill: "#94a3b8", fontSize: 10 }} />
              <YAxis yAxisId="r" orientation="right" domain={[0, 100]} tick={{ fill: "#94a3b8", fontSize: 10 }} unit="%" />
              <Tooltip contentStyle={{ background: "#0f172a", border: "1px solid #334155", fontSize: 12 }} />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar yAxisId="l" dataKey="effort" name="Effort (h)" fill="#f97316" />
              <Line yAxisId="r" dataKey="atFishing" name="% effort in suitable" stroke="#22d3ee" dot={false} connectNulls />
              <Line yAxisId="r" dataKey="available" name="% sea suitable" stroke="#a78bfa" dot={false} strokeDasharray="4 3" connectNulls />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div>
        <h3 className="mb-1 text-xs font-medium">Conditions at fishing cells versus the surrounding sea</h3>
        <table className="w-full text-[11px]">
          <thead>
            <tr className="text-left text-slate-500">
              <th className="py-1 font-normal">Variable</th>
              <th className="py-1 text-right font-normal">At effort</th>
              <th className="py-1 text-right font-normal">Sea</th>
              <th className="py-1 text-right font-normal">Diff (σ)</th>
            </tr>
          </thead>
          <tbody>
            {vars.map((r) => (
              <tr key={r.key} className="border-t border-slate-800">
                <td className="py-1">
                  {r.label} <span className="text-slate-500">{r.unit}</span>
                </td>
                <td className="py-1 text-right tabular-nums">{fmt(r.fish)}</td>
                <td className="py-1 text-right tabular-nums text-slate-400">{fmt(r.domain)}</td>
                <td className={`py-1 text-right tabular-nums ${Math.abs(r.z) >= 1 ? "text-amber-300" : "text-slate-400"}`}>{r.z.toFixed(2)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-xs font-medium">Distribution</h3>
          <select
            value={histKey}
            onChange={(e) => setHistKey(e.target.value)}
            className="rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-[11px]"
          >
            {Object.entries(bundle.meta.vars).map(([k, m]) => (
              <option key={k} value={k}>
                {m.label}
              </option>
            ))}
          </select>
        </div>
        <div className="h-44">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={hist} margin={{ top: 4, right: 4, bottom: 0, left: -18 }}>
              <CartesianGrid stroke="#1e293b" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 9 }} interval={1} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 10 }} tickFormatter={(v: number) => `${Math.round(v * 100)}%`} />
              <Tooltip
                contentStyle={{ background: "#0f172a", border: "1px solid #334155", fontSize: 12 }}
                formatter={(v) => `${(Number(v) * 100).toFixed(0)}%`}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              <Bar dataKey="available" name="Sea available" fill="#64748b" />
              <Bar dataKey="fish" name="Fishing effort" fill="#f97316" />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}

function InspectTab({ bundle, settings, criteria, point, pinned, onClearPin }: Props) {
  if (!point) {
    return <p className="text-xs text-slate-400">Hover over the map to read values, or click to pin a location.</p>;
  }
  const values = sampleAt(bundle, point.lat, point.lon, settings.t, settings.d);
  const ev = evalValues(values, criteria);
  const ocean = isOcean(bundle, point.lat, point.lon);
  const near = bundle.fishing.filter((r) => Math.abs(r.lat - point.lat) <= 0.06 && Math.abs(r.lon - point.lon) <= 0.06);
  const nearActive = near.filter((r) => r.fishing > 0);

  return (
    <div className="space-y-3 text-xs">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-medium tabular-nums">
            {point.lat.toFixed(3)}°N, {point.lon.toFixed(3)}°E
          </div>
          <div className="text-slate-400">
            {monthLabel(bundle.meta.months[settings.t])} · {bundle.meta.depths[settings.d]} m · {ocean ? "ocean" : "land or no ocean data"}
          </div>
        </div>
        {pinned && (
          <button type="button" onClick={onClearPin} className="rounded border border-slate-700 px-2 py-1 text-[11px] text-slate-300 hover:bg-slate-800">
            Unpin
          </button>
        )}
      </div>

      <div className={`rounded border p-2 ${Number.isFinite(ev.score) ? (ev.pass ? BADGE.ok : BADGE.warn) : BADGE.info}`}>
        {Number.isFinite(ev.score)
          ? ev.pass
            ? "Meets every enabled habitat criterion."
            : `Fails: ${ev.failed.map((k) => criteria[k].label).join(", ")}.`
          : "Habitat cannot be scored here (no data or no criteria enabled)."}
      </div>

      <table className="w-full text-[11px]">
        <tbody>
          {Object.entries(bundle.meta.vars).map(([k, m]) => {
            const c = criteria[k];
            const v = values[k];
            const bad = c?.enabled && ev.failed.includes(k);
            return (
              <tr key={k} className="border-t border-slate-800">
                <td className="py-1">{m.label}</td>
                <td className={`py-1 text-right tabular-nums ${bad ? "text-red-300" : ""}`}>
                  {fmt(v)} <span className="text-slate-500">{m.unit}</span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>

      <div>
        <div className="mb-1 font-medium">Fishing records within 0.06°</div>
        {near.length === 0 ? (
          <p className="text-slate-500">None in the file.</p>
        ) : (
          <>
            <p className="mb-1 text-slate-500">
              {near.length} rows, {nearActive.length} with effort.
            </p>
            <ul className="max-h-40 space-y-0.5 overflow-y-auto tabular-nums text-slate-300">
              {(nearActive.length ? nearActive : near.slice(0, 8)).map((r, i) => (
                <li key={i}>
                  {r.mi >= 0 ? bundle.meta.months[r.mi] : "n/a"}: {fmt(r.fishing)} h fishing, {fmt(r.longline)} h longline
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}
