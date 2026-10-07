"use client";

import { ArrowCounterClockwise, Clock, FishSimple, Funnel, Stack } from "@phosphor-icons/react";
import type { Settings, TimeMode } from "./Dashboard";
import { Chip, NumberField, RangeField, Section, Segmented, Switch } from "./ui";
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

const QUICK_LAYERS: { value: string; label: string }[] = [
  { value: "o2", label: "Oxygen" },
  { value: "sst", label: "Sea temp" },
  { value: "chl_sat", label: "Chlorophyll" },
  { value: "bathy", label: "Seabed" },
  { value: "habitat", label: "Habitat" },
  { value: "none", label: "None" },
];

const fieldSelect =
  "w-full rounded-md border border-line bg-panel-2 px-2.5 py-2 text-xs text-ink focus-visible:border-accent";

export default function Controls({ bundle, settings, update, criteria, patchCriterion, preset, applyPreset }: Props) {
  const { meta } = bundle;
  const layerVar = meta.vars[settings.layer];
  const depthMatters = settings.layer === "habitat" || layerVar?.depth;
  const activeCount = Object.values(criteria).filter((c) => c.enabled).length;

  const sourceGroups = Object.entries(
    Object.entries(meta.vars).reduce<Record<string, [string, (typeof meta.vars)[string]][]>>((acc, e) => {
      (acc[e[1].source] ??= []).push(e);
      return acc;
    }, {}),
  );

  return (
    <div>
      <Section title="Time and depth" icon={<Clock className="size-4" />}>
        <RangeField
          label="Month"
          display={meta.months[settings.t]}
          value={settings.t}
          min={0}
          max={meta.months.length - 1}
          onChange={(t) => update({ t })}
        />
        <RangeField
          label="Depth"
          display={`${meta.depths[settings.d]} m`}
          value={settings.d}
          min={0}
          max={meta.depths.length - 1}
          onChange={(d) => update({ d })}
        />
        <p className="text-[11px] leading-relaxed text-ink-3">
          {depthMatters
            ? "Oxygen drops sharply with depth in the Arabian Sea and Bay of Bengal. Slide deeper to see where water becomes unlivable."
            : "This layer has no depth axis, so the depth slider only affects the habitat score and the charts."}
        </p>
      </Section>

      <Section title="Environment layer" icon={<Stack className="size-4" />}>
        <div role="radiogroup" aria-label="Quick layer" className="grid grid-cols-3 gap-1.5">
          {QUICK_LAYERS.map((q) => {
            const active = settings.layer === q.value;
            return (
              <button
                key={q.value}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => update({ layer: q.value })}
                className={`rounded-md border px-2 py-1.5 text-xs transition-colors ${
                  active
                    ? "border-accent/60 bg-accent/15 font-medium text-accent"
                    : "border-line text-ink-2 hover:bg-white/[.05] hover:text-ink"
                }`}
              >
                {q.label}
              </button>
            );
          })}
        </div>

        <label className="block text-xs text-ink-2">
          <span className="mb-2 block">All layers</span>
          <select value={settings.layer} onChange={(e) => update({ layer: e.target.value })} className={fieldSelect}>
            <option value="none">None</option>
            <option value="habitat">Habitat suitability (from criteria)</option>
            {sourceGroups.map(([source, entries]) => (
              <optgroup key={source} label={source}>
                {entries.map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                    {v.unit ? ` (${v.unit})` : ""}
                    {v.depth ? "" : v.static ? " - static" : " - surface only"}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>
        </label>

        {layerVar && (
          <p className="text-[11px] leading-relaxed text-ink-3">
            {layerVar.source}, native resolution <span className="num">{resolutionLabel(layerVar.grid)}</span>
          </p>
        )}

        <RangeField
          label="Opacity"
          display={`${Math.round(settings.opacity * 100)}%`}
          value={settings.opacity}
          min={0.1}
          max={1}
          step={0.05}
          onChange={(opacity) => update({ opacity })}
        />

        {layerVar && (
          <div className="space-y-2.5">
            <Switch
              label="Automatic colour range"
              checked={settings.rangeMode === "auto"}
              onChange={(v) => update({ rangeMode: v ? "auto" : "manual", range: [layerVar.p02, layerVar.p98] })}
              hint="Auto clips to the 2nd to 98th percentile so outliers do not wash out the map."
            />
            <div className="flex gap-2">
              <NumberField
                prefix="min"
                ariaLabel="Colour range minimum"
                disabled={settings.rangeMode === "auto"}
                step={(layerVar.p98 - layerVar.p02) / 50 || 0.1}
                value={settings.rangeMode === "auto" ? Number(fmt(layerVar.p02, 3)) : settings.range[0]}
                onChange={(v) => v != null && update({ range: [v, settings.range[1]] })}
              />
              <NumberField
                prefix="max"
                ariaLabel="Colour range maximum"
                disabled={settings.rangeMode === "auto"}
                step={(layerVar.p98 - layerVar.p02) / 50 || 0.1}
                value={settings.rangeMode === "auto" ? Number(fmt(layerVar.p98, 3)) : settings.range[1]}
                onChange={(v) => v != null && update({ range: [settings.range[0], v] })}
              />
            </div>
          </div>
        )}
      </Section>

      <Section title="Fishing effort" icon={<FishSimple className="size-4" />}>
        <Switch label="Show fishing effort" checked={settings.showFishing} onChange={(v) => update({ showFishing: v })} />
        <Segmented<Metric>
          label="Effort measure"
          value={settings.metric}
          onChange={(metric) => update({ metric })}
          options={[
            { value: "fishing", label: "All fishing" },
            { value: "longline", label: "Longline" },
          ]}
        />
        <Segmented<TimeMode>
          label="Time window"
          value={settings.timeMode}
          onChange={(timeMode) => update({ timeMode })}
          options={[
            { value: "month", label: "Month", title: "Selected month only" },
            { value: "cumulative", label: "To date", title: "Cumulative up to the selected month" },
            { value: "all", label: "All", title: "All months combined" },
          ]}
        />
        <RangeField
          label="Marker size"
          display={`${settings.radius}x`}
          value={settings.radius}
          min={1}
          max={10}
          step={0.5}
          onChange={(radius) => update({ radius })}
        />
        <Switch
          label="Show zero-effort cells"
          hint="Grey dots where the file records no fishing."
          checked={settings.showZero}
          onChange={(v) => update({ showZero: v })}
        />
        <Switch
          label="Ring points on land"
          hint="Red ring where a record falls on land in the GEBCO coastline."
          checked={settings.flagLand}
          onChange={(v) => update({ flagLand: v })}
        />
      </Section>

      <Section
        title="Habitat criteria"
        icon={<Funnel className="size-4" />}
        badge={<Chip tone={activeCount ? "info" : "neutral"}>{activeCount} active</Chip>}
      >
        <Segmented<PresetId>
          label="Preset"
          value={preset}
          onChange={applyPreset}
          options={(Object.keys(PRESET_LABELS) as PresetId[]).map((p) => ({ value: p, label: PRESET_LABELS[p] }))}
        />
        <p className="text-[11px] leading-relaxed text-ink-3">
          No target species. These are generic limits for tropical marine fish: switch on the conditions a cell must meet, then tune the numbers.
        </p>
        <div className="space-y-2.5">
          {CRITERION_ORDER.map((key) => {
            const c = criteria[key];
            return (
              <div
                key={key}
                className={`rounded-lg border p-3 transition-colors ${c.enabled ? "border-accent/30 bg-accent/[.04]" : "border-line"}`}
              >
                <Switch
                  label={c.label}
                  hint={c.hint}
                  checked={c.enabled}
                  onChange={(v) => patchCriterion(key, { enabled: v })}
                />
                {c.enabled && (
                  <div className="mt-3 flex gap-2 pl-11">
                    {c.hasMin && (
                      <NumberField
                        prefix="min"
                        ariaLabel={`${c.label} minimum`}
                        step={c.step}
                        value={c.min}
                        unit={c.unit}
                        onChange={(v) => patchCriterion(key, { min: v })}
                      />
                    )}
                    {c.hasMax && (
                      <NumberField
                        prefix="max"
                        ariaLabel={`${c.label} maximum`}
                        step={c.step}
                        value={c.max}
                        unit={c.unit}
                        onChange={(v) => patchCriterion(key, { max: v })}
                      />
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => update({ layer: "habitat" })}
            className="flex-1 rounded-md bg-accent px-3 py-2 text-xs font-medium text-accent-ink hover:brightness-110"
          >
            Show habitat on map
          </button>
          <button
            type="button"
            onClick={() => applyPreset(preset)}
            className="inline-flex items-center gap-1.5 rounded-md border border-line px-3 py-2 text-xs text-ink-2 hover:bg-white/[.06] hover:text-ink"
          >
            <ArrowCounterClockwise className="size-3.5" aria-hidden />
            Reset
          </button>
        </div>
      </Section>
    </div>
  );
}
