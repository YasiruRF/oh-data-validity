"use client";

import { useId, type CSSProperties, type ReactNode } from "react";
import { CaretDown, CheckCircle, Info, Warning, XCircle } from "@phosphor-icons/react";

export type Tone = "ok" | "warn" | "bad" | "info" | "neutral";

const TONE_CLASS: Record<Tone, string> = {
  ok: "border-ok/35 bg-ok/10 text-ok",
  warn: "border-warn/35 bg-warn/10 text-warn",
  bad: "border-bad/40 bg-bad/10 text-bad",
  info: "border-info/35 bg-info/10 text-info",
  neutral: "border-line bg-white/[.04] text-ink-2",
};

export const TONE_TEXT: Record<Tone, string> = {
  ok: "text-ok",
  warn: "text-warn",
  bad: "text-bad",
  info: "text-info",
  neutral: "text-ink-2",
};

export function ToneIcon({ tone, className = "size-4" }: { tone: Tone; className?: string }) {
  const props = { weight: "fill" as const, className: `${className} shrink-0 ${TONE_TEXT[tone]}`, "aria-hidden": true };
  if (tone === "ok") return <CheckCircle {...props} />;
  if (tone === "warn") return <Warning {...props} />;
  if (tone === "bad") return <XCircle {...props} />;
  return <Info {...props} />;
}

export function Chip({ tone = "neutral", children, title }: { tone?: Tone; children: ReactNode; title?: string }) {
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${TONE_CLASS[tone]}`}
    >
      {children}
    </span>
  );
}

export function Callout({ tone, children }: { tone: Tone; children: ReactNode }) {
  return (
    <div className={`flex gap-2.5 rounded-lg border p-3 text-xs leading-relaxed ${TONE_CLASS[tone]}`}>
      <ToneIcon tone={tone} />
      <div className="text-ink">{children}</div>
    </div>
  );
}

export function Section({
  title,
  icon,
  badge,
  children,
  open = true,
}: {
  title: string;
  icon: ReactNode;
  badge?: ReactNode;
  children: ReactNode;
  open?: boolean;
}) {
  return (
    <details open={open} className="group border-b border-line">
      <summary className="flex cursor-pointer list-none items-center gap-2.5 px-4 py-3 text-[13px] font-medium text-ink select-none hover:bg-white/[.03] focus-visible:outline-offset-[-2px] [&::-webkit-details-marker]:hidden">
        <span className="text-ink-3" aria-hidden>
          {icon}
        </span>
        <span className="flex-1">{title}</span>
        {badge}
        <CaretDown className="size-3.5 text-ink-3 transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-4 px-4 pt-1 pb-4">{children}</div>
    </details>
  );
}

export function RangeField({
  label,
  display,
  value,
  min,
  max,
  step = 1,
  onChange,
}: {
  label: string;
  display: string;
  value: number;
  min: number;
  max: number;
  step?: number;
  onChange: (v: number) => void;
}) {
  const id = useId();
  const fill = ((value - min) / (max - min || 1)) * 100;
  return (
    <div>
      <div className="mb-2 flex items-baseline justify-between text-xs">
        <label htmlFor={id} className="text-ink-2">
          {label}
        </label>
        <span className="num text-ink">{display}</span>
      </div>
      <input
        id={id}
        type="range"
        className="range"
        min={min}
        max={max}
        step={step}
        value={value}
        style={{ "--fill": `${fill}%` } as CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

export function Segmented<T extends string>({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; title?: string }[];
}) {
  return (
    <div>
      <div className="mb-2 text-xs text-ink-2">{label}</div>
      <div role="radiogroup" aria-label={label} className="grid auto-cols-fr grid-flow-col gap-0.5 rounded-lg bg-white/[.05] p-0.5">
        {options.map((o) => {
          const active = o.value === value;
          return (
            <button
              key={o.value}
              type="button"
              role="radio"
              aria-checked={active}
              title={o.title}
              onClick={() => onChange(o.value)}
              className={`rounded-md px-2 py-1.5 text-xs transition-colors ${
                active ? "bg-accent font-medium text-accent-ink" : "text-ink-2 hover:bg-white/[.06] hover:text-ink"
              }`}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function Switch({
  label,
  checked,
  onChange,
  hint,
}: {
  label: ReactNode;
  checked: boolean;
  onChange: (v: boolean) => void;
  hint?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className="flex w-full items-start gap-3 rounded-md text-left"
    >
      <span
        aria-hidden
        className={`mt-0.5 inline-flex h-[18px] w-8 shrink-0 items-center rounded-full p-0.5 transition-colors ${
          checked ? "bg-accent" : "bg-white/[.16]"
        }`}
      >
        <span
          className={`size-[14px] rounded-full bg-white shadow transition-transform ${checked ? "translate-x-[14px]" : "translate-x-0"}`}
        />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-xs text-ink">{label}</span>
        {hint && <span className="mt-0.5 block text-[11px] leading-snug text-ink-3">{hint}</span>}
      </span>
    </button>
  );
}

export function NumberField({
  prefix,
  value,
  onChange,
  step,
  disabled,
  unit,
  ariaLabel,
}: {
  prefix: string;
  value: number | null;
  onChange: (v: number | null) => void;
  step: number;
  disabled?: boolean;
  unit?: string;
  ariaLabel: string;
}) {
  return (
    <label
      className={`flex flex-1 items-center gap-1.5 rounded-md border border-line bg-white/[.04] px-2 py-1 text-xs focus-within:border-accent ${
        disabled ? "opacity-40" : ""
      }`}
    >
      <span className="text-ink-3">{prefix}</span>
      <input
        type="number"
        aria-label={ariaLabel}
        disabled={disabled}
        step={step}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
        className="num w-full min-w-0 bg-transparent text-ink outline-none"
      />
      {unit && <span className="truncate text-[10px] text-ink-3">{unit}</span>}
    </label>
  );
}

export function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-lg border border-line bg-panel-2 px-3 py-2.5">
      <div className="num text-xl leading-none font-semibold text-ink">{value}</div>
      <div className="mt-1.5 text-[11px] leading-tight text-ink-3">{label}</div>
      {sub && <div className="num mt-0.5 text-[10px] text-ink-3">{sub}</div>}
    </div>
  );
}

export function IconButton({
  label,
  onClick,
  children,
  active,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      aria-pressed={active}
      onClick={onClick}
      className={`inline-flex size-8 items-center justify-center rounded-md border transition-colors ${
        active ? "border-accent/50 bg-accent/15 text-accent" : "border-line text-ink-2 hover:bg-white/[.06] hover:text-ink"
      }`}
    >
      {children}
    </button>
  );
}
