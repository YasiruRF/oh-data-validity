"use client";

import type { ReactNode } from "react";
import type { Settings, TimeMode } from "./Dashboard";
import { DataBundle, fmt, resolutionLabel } from "@/lib/data";
import { CRITERION_ORDER, Criteria, Criterion, Metric, PRESET_LABELS, PresetId } from "@/lib/habitat";

interface Props {
  bundle: DataBundle;
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  criteria: Criteria;
  patchCriterion: (key: string, patch: Partial<Criterion>) => void;
  preset: PresetId;
  applyPreset: (p: PresetId) => void;
}

function Section({ title, children, open = true }: { title: string; children: ReactNode; open?: boolean }) {
  return (
    <details open={open} className="group border-b border-slate-800">
      <summary className="cursor-pointer select-none px-4 py-2.5 text-xs font-semibold uppercase tracking-wider text-slate-400 hover:text-slate-200">
        {title}
      </summary>
      <div className="space-y-3 px-4 pb-4">{children}</div>
    </details>
  );
}

function Field({ label, value, children }: { label: string; value?: string; children: ReactNode }) {
  return (
    <label className="block text-xs text-slate-300">
      <span className="mb-1 flex justify-between">
        <span>{label}</span>
        {value && <span className="tabular-nums text-slate-400">{value}</span>}
      </span>
      {children}
    </label>
  );
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-300">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="accent-cyan-400" />
      {label}
    </label>
  );
}

const selectCls = "w-full rounded border border-slate-700 bg-slate-900 px-2 py-1.5 text-xs text-slate-100";
const numCls = "w-20 rounded border border-slate-700 bg-slate-900 px-1.5 py-1 text-xs tabular-nums text-slate-100 disabled:opacity-40";

export default function Controls({ bundle, settings, update, criteria, patchCriterion, preset, applyPreset }: Props) {
  const { meta } = bundle;
  const layerVar = meta.vars[settings.layer];
  const depthMatters = settings.layer === "habitat" || layerVar?.depth;
  const sourceGroups = Object.entries(
    Object.entries(meta.vars).reduce<Record<string, [string, (typeof meta.vars)[string]][]>>((acc, e) => {
      (acc[e[1].source] ??= []).push(e);
      return acc;
    }, {}),
  );

  return (
    <div>
      <Section title="Time and depth">
        <Field label="Month" value={meta.months[settings.t]}>
          <input
            type="range"
            min={0}
            max={meta.months.length - 1}
            value={settings.t}
            onChange={(e) => update({ t: Number(e.target.value) })}
            className="w-full accent-cyan-400"
          />
        </Field>
        <Field label="Depth" value={`${meta.depths[settings.d]} m${depthMatters ? "" : " (layer is 2-D)"}`}>
          <input
            type="range"
            min={0}
            max={meta.depths.length - 1}
            value={settings.d}
            onChange={(e) => update({ d: Number(e.target.value) })}
            className="w-full accent-cyan-400"
          />
        </Field>
        <p className="text-[11px] leading-snug text-slate-500">
          Oxygen drops sharply with depth in the Arabian Sea and Bay of Bengal. Move the depth slider to see where water becomes unlivable.
        </p>
      </Section>

      <Section title="Environment layer">
        <Field label="Layer">
          <select value={settings.layer} onChange={(e) => update({ layer: e.target.value })} className={selectCls}>
            <option value="none">None</option>
            <option value="habitat">Habitat suitability (from criteria)</option>
            {sourceGroups.map(([source, entries]) => (
              <optgroup key={source} label={source}>
                {entries.map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                    {v.unit ? ` (${v.unit})` : ""}
                    {v.depth ? "" : v.static ? " · static" : " · surface only"}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        <Field label="Opacity" value={`${Math.round(settings.opacity * 100)}%`}>
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={settings.opacity}
            onChange={(e) => update({ opacity: Number(e.target.value) })}
            className="w-full accent-cyan-400"
          />
        </Field>
        {layerVar && (
          <p className="text-[11px] text-slate-500">
            {layerVar.source} · native resolution {resolutionLabel(layerVar.grid)}
          </p>
        )}
        {layerVar && (
          <div className="space-y-2">
            <div className="flex gap-3">
              <Check label="Auto colour range" checked={settings.rangeMode === "auto"} onChange={(v) => update({ rangeMode: v ? "auto" : "manual", range: [layerVar.p02, layerVar.p98] })} />
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <input
                type="number"
                className={numCls}
                disabled={settings.rangeMode === "auto"}
                value={settings.rangeMode === "auto" ? Number(fmt(layerVar.p02, 3)) : settings.range[0]}
                step={(layerVar.p98 - layerVar.p02) / 50 || 0.1}
                onChange={(e) => update({ range: [Number(e.target.value), settings.range[1]] })}
              />
              <span>to</span>
              <input
                type="number"
                className={numCls}
                disabled={settings.rangeMode === "auto"}
                value={settings.rangeMode === "auto" ? Number(fmt(layerVar.p98, 3)) : settings.range[1]}
                step={(layerVar.p98 - layerVar.p02) / 50 || 0.1}
                onChange={(e) => update({ range: [settings.range[0], Number(e.target.value)] })}
              />
              <span>{layerVar.unit}</span>
            </div>
          </div>
        )}
      </Section>

      <Section title="Fishing effort">
        <Check label="Show fishing effort" checked={settings.showFishing} onChange={(v) => update({ showFishing: v })} />
        <Field label="Effort measure">
          <select value={settings.metric} onChange={(e) => update({ metric: e.target.value as Metric })} className={selectCls}>
            <option value="fishing">All fishing hours</option>
            <option value="longline">Longline hours</option>
          </select>
        </Field>
        <Field label="Time window">
          <select value={settings.timeMode} onChange={(e) => update({ timeMode: e.target.value as TimeMode })} className={selectCls}>
            <option value="month">Selected month only</option>
            <option value="cumulative">Cumulative up to selected month</option>
            <option value="all">All months combined</option>
          </select>
        </Field>
        <Field label="Marker size" value={`${settings.radius}×`}>
          <input
            type="range"
            min={1}
            max={10}
            step={0.5}
            value={settings.radius}
            onChange={(e) => update({ radius: Number(e.target.value) })}
            className="w-full accent-cyan-400"
          />
        </Field>
        <Check label="Show zero-effort cells (grey)" checked={settings.showZero} onChange={(v) => update({ showZero: v })} />
        <Check label="Ring points that fall on land (red)" checked={settings.flagLand} onChange={(v) => update({ flagLand: v })} />
      </Section>

      <Section title="Habitat criteria">
        <div className="flex gap-1.5">
          {(Object.keys(PRESET_LABELS) as PresetId[]).map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => applyPreset(p)}
              className={`flex-1 rounded border px-2 py-1 text-xs ${preset === p ? "border-cyan-500 bg-cyan-500/15 text-cyan-200" : "border-slate-700 text-slate-300 hover:bg-slate-800"}`}
            >
              {PRESET_LABELS[p]}
            </button>
          ))}
        </div>
        <p className="text-[11px] leading-snug text-slate-500">
          No target species: these are generic limits for tropical marine fish. Tick the conditions a cell must meet, then tune the numbers.
        </p>
        <div className="space-y-2.5">
          {CRITERION_ORDER.map((key) => {
            const c = criteria[key];
            const step = c.step;
            return (
              <div key={key} className="rounded border border-slate-800 p-2" title={c.hint}>
                <Check label={`${c.label}${c.unit ? ` (${c.unit})` : ""}`} checked={c.enabled} onChange={(v) => patchCriterion(key, { enabled: v })} />
                <div className="mt-1.5 flex items-center gap-2 pl-6 text-xs text-slate-400">
                  {c.hasMin && (
                    <>
                      <span>min</span>
                      <input
                        type="number"
                        className={numCls}
                        disabled={!c.enabled}
                        step={step}
                        value={c.min ?? ""}
                        onChange={(e) => patchCriterion(key, { min: e.target.value === "" ? null : Number(e.target.value) })}
                      />
                    </>
                  )}
                  {c.hasMax && (
                    <>
                      <span>max</span>
                      <input
                        type="number"
                        className={numCls}
                        disabled={!c.enabled}
                        step={step}
                        value={c.max ?? ""}
                        onChange={(e) => patchCriterion(key, { max: e.target.value === "" ? null : Number(e.target.value) })}
                      />
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
        <button
          type="button"
          onClick={() => update({ layer: "habitat" })}
          className="w-full rounded bg-slate-800 px-2 py-1.5 text-xs text-slate-200 hover:bg-slate-700"
        >
          Show habitat suitability on map
        </button>
      </Section>
    </div>
  );
}
