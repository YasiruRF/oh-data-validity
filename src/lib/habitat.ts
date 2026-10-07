import { DataBundle, FishingRow, GridMeta, valueAt, valueNear } from "./data";

export interface Criterion {
  key: string;
  label: string;
  unit: string;
  enabled: boolean;
  min: number | null;
  max: number | null;
  hasMin: boolean;
  hasMax: boolean;
  step: number;
  hint: string;
}

export type Criteria = Record<string, Criterion>;
export type PresetId = "general" | "strict" | "lenient";
export type Metric = "fishing" | "longline";

export const PRESET_LABELS: Record<PresetId, string> = {
  general: "General",
  strict: "Strict",
  lenient: "Lenient",
};

interface PresetValue {
  enabled: boolean;
  min?: number;
  max?: number;
}

const PRESETS: Record<PresetId, Record<string, PresetValue>> = {
  general: {
    o2: { enabled: true, min: 100 },
    temp: { enabled: true, min: 22, max: 31 },
    sal: { enabled: true, min: 32.5, max: 36.5 },
    sst: { enabled: false, min: 24, max: 31 },
    chl_sat: { enabled: true, min: 0.1 },
    chl: { enabled: false, min: 0.1 },
    kd490: { enabled: false, max: 0.2 },
    npp: { enabled: false, min: 5 },
    ph: { enabled: false, min: 7.9 },
    current: { enabled: false, max: 1 },
    bathy: { enabled: false, min: 20, max: 2000 },
  },
  strict: {
    o2: { enabled: true, min: 150 },
    temp: { enabled: true, min: 24, max: 30 },
    sal: { enabled: true, min: 33, max: 36 },
    sst: { enabled: true, min: 26, max: 30.5 },
    chl_sat: { enabled: true, min: 0.15 },
    chl: { enabled: false, min: 0.15 },
    kd490: { enabled: true, max: 0.12 },
    npp: { enabled: false, min: 10 },
    ph: { enabled: true, min: 8.0 },
    current: { enabled: true, max: 0.8 },
    bathy: { enabled: true, min: 30, max: 1500 },
  },
  lenient: {
    o2: { enabled: true, min: 60 },
    temp: { enabled: true, min: 18, max: 32 },
    sal: { enabled: false, min: 30, max: 37 },
    sst: { enabled: false, min: 20, max: 32 },
    chl_sat: { enabled: false, min: 0.05 },
    chl: { enabled: false, min: 0.05 },
    kd490: { enabled: false, max: 0.4 },
    npp: { enabled: false, min: 2 },
    ph: { enabled: false, min: 7.7 },
    current: { enabled: false, max: 1.5 },
    bathy: { enabled: false, min: 10, max: 4000 },
  },
};

const DEFS: Omit<Criterion, "enabled" | "min" | "max">[] = [
  { key: "o2", label: "Dissolved oxygen", unit: "mmol/m³", hasMin: true, hasMax: false, step: 5, hint: "Below about 60 is hypoxic for most fish; pelagic fish avoid roughly under 100 to 150." },
  { key: "temp", label: "Temperature at depth", unit: "°C", hasMin: true, hasMax: true, step: 0.5, hint: "Copernicus model temperature at the selected depth. Most tropical pelagic fish sit within about 22 to 31 °C." },
  { key: "sst", label: "Sea-surface temperature (satellite)", unit: "°C", hasMin: true, hasMax: true, step: 0.5, hint: "1 to 4 km satellite surface temperature. Independent of the depth slider." },
  { key: "sal", label: "Salinity", unit: "PSU", hasMin: true, hasMax: true, step: 0.1, hint: "Open-ocean fish tolerate roughly 33 to 36.5; low values flag river or monsoon plumes." },
  { key: "chl_sat", label: "Chlorophyll-a (satellite)", unit: "mg/m³", hasMin: true, hasMax: false, step: 0.01, hint: "4 km satellite chlorophyll: food supply at the base of the food web. Independent of the depth slider." },
  { key: "chl", label: "Chlorophyll-a (model)", unit: "mg/m³", hasMin: true, hasMax: false, step: 0.01, hint: "Coarse model chlorophyll at the selected depth." },
  { key: "kd490", label: "Water clarity Kd490 (satellite)", unit: "1/m", hasMin: false, hasMax: true, step: 0.01, hint: "Higher means murkier water. Very turbid water holds sediment or plumes." },
  { key: "npp", label: "Primary production", unit: "mg C/m³/day", hasMin: true, hasMax: false, step: 1, hint: "How fast the food web is producing biomass." },
  { key: "ph", label: "pH", unit: "", hasMin: true, hasMax: false, step: 0.05, hint: "Open-ocean pH is about 8.0 to 8.1; low values flag acidified or upwelled water." },
  { key: "current", label: "Current speed", unit: "m/s", hasMin: false, hasMax: true, step: 0.1, hint: "Very strong currents make water hard to hold station in." },
  { key: "bathy", label: "Seabed depth (GEBCO)", unit: "m", hasMin: true, hasMax: true, step: 50, hint: "Shelf water is shallower than ~200 m; use min and max to focus on shelf, slope or deep ocean." },
];

export const CRITERION_ORDER = DEFS.map((d) => d.key);

export function makeCriteria(preset: PresetId): Criteria {
  const out: Criteria = {};
  for (const d of DEFS) {
    const p = PRESETS[preset][d.key];
    out[d.key] = {
      ...d,
      enabled: p.enabled,
      min: d.hasMin ? (p.min ?? null) : null,
      max: d.hasMax ? (p.max ?? null) : null,
    };
  }
  return out;
}

export interface PointEval {
  score: number; // share of enabled criteria passed, NaN if undefined
  pass: boolean;
  failed: string[];
}

export function enabledKeys(criteria: Criteria): string[] {
  return Object.values(criteria)
    .filter((c) => c.enabled)
    .map((c) => c.key);
}

export function evalValues(values: Record<string, number>, criteria: Criteria): PointEval {
  let considered = 0;
  let passed = 0;
  const failed: string[] = [];
  for (const c of Object.values(criteria)) {
    if (!c.enabled) continue;
    const v = values[c.key];
    if (!Number.isFinite(v)) return { score: NaN, pass: false, failed: [] };
    considered++;
    const ok = (c.min == null || v >= c.min) && (c.max == null || v <= c.max);
    if (ok) passed++;
    else failed.push(c.key);
  }
  if (considered === 0) return { score: NaN, pass: false, failed: [] };
  return { score: passed / considered, pass: passed === considered, failed };
}

export interface Window {
  y0: number;
  y1: number;
  x0: number;
  x1: number;
}

/** Habitat score on the analysis grid for one month and depth, optionally limited to a window. */
export function scoreGrid(b: DataBundle, criteria: Criteria, t: number, d: number, win?: Window): Float32Array {
  const { ny, nx, lat0, lon0, dlat, dlon } = b.meta.analysis;
  const out = new Float32Array(ny * nx).fill(NaN);
  const active = Object.values(criteria).filter((c) => c.enabled);
  if (active.length === 0) return out;
  const { y0, y1, x0, x1 } = win ?? { y0: 0, y1: ny - 1, x0: 0, x1: nx - 1 };
  for (let iy = y0; iy <= y1; iy++) {
    const lat = lat0 + iy * dlat;
    for (let ix = x0; ix <= x1; ix++) {
      const lon = lon0 + ix * dlon;
      let passed = 0;
      let bad = false;
      for (const c of active) {
        const v = valueAt(b, c.key, t, d, lat, lon, 0);
        if (!Number.isFinite(v)) {
          bad = true;
          break;
        }
        if ((c.min == null || v >= c.min) && (c.max == null || v <= c.max)) passed++;
      }
      if (!bad) out[iy * nx + ix] = passed / active.length;
    }
  }
  return out;
}

export function effort(row: Pick<FishingRow, "fishing" | "longline">, metric: Metric): number {
  return metric === "fishing" ? row.fishing : row.longline;
}

export function monthlyEffort(b: DataBundle, metric: Metric): number[] {
  const out = new Array<number>(b.meta.months.length).fill(0);
  for (const r of b.fishing) if (r.mi >= 0) out[r.mi] += effort(r, metric);
  return out;
}

function toIndex(g: GridMeta, lat: number, lon: number): [number, number] {
  return [Math.round((lat - g.lat0) / g.dlat), Math.round((lon - g.lon0) / g.dlon)];
}

/** Analysis-grid window covering every fishing row, used as the comparison domain. */
export function footprint(b: DataBundle): Window | null {
  if (b.fishing.length === 0) return null;
  const g = b.meta.analysis;
  const lats = b.fishing.map((r) => r.lat);
  const lons = b.fishing.map((r) => r.lon);
  const [y0, x0] = toIndex(g, Math.min(...lats) - 0.05, Math.min(...lons) - 0.05);
  const [y1, x1] = toIndex(g, Math.max(...lats) + 0.05, Math.max(...lons) + 0.05);
  return {
    y0: Math.max(0, y0),
    y1: Math.min(g.ny - 1, y1),
    x0: Math.max(0, x0),
    x1: Math.min(g.nx - 1, x1),
  };
}

function rowValues(b: DataBundle, keys: string[], r: FishingRow, d: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = valueNear(b, k, r.mi, d, r.lat, r.lon);
  return out;
}

export interface MonthStat {
  month: string;
  effort: number;
  passShare: number | null;
  baseline: number | null;
}

export interface Validation {
  nRows: number;
  effortTotal: number;
  passShare: number | null;
  baseline: number | null;
  lift: number | null;
  months: MonthStat[];
}

export function validateHabitat(b: DataBundle, criteria: Criteria, d: number, metric: Metric): Validation {
  const fp = footprint(b);
  const nm = b.meta.months.length;
  const { nx } = b.meta.analysis;
  const keys = enabledKeys(criteria);
  const rowsByMonth: FishingRow[][] = Array.from({ length: nm }, () => []);
  for (const r of b.fishing) if (r.mi >= 0 && effort(r, metric) > 0) rowsByMonth[r.mi].push(r);

  const months: MonthStat[] = [];
  let effPass = 0;
  let effAll = 0;
  let baseWeighted = 0;
  let baseWeight = 0;
  let nRows = 0;

  for (let t = 0; t < nm; t++) {
    const rows = rowsByMonth[t];
    let baseline: number | null = null;
    if (fp && keys.length) {
      const grid = scoreGrid(b, criteria, t, d, fp);
      let cells = 0;
      let ok = 0;
      for (let iy = fp.y0; iy <= fp.y1; iy++) {
        for (let ix = fp.x0; ix <= fp.x1; ix++) {
          const s = grid[iy * nx + ix];
          if (!Number.isFinite(s)) continue;
          cells++;
          if (s === 1) ok++;
        }
      }
      baseline = cells ? ok / cells : null;
    }
    let mEff = 0;
    let mPass = 0;
    let mTotal = 0;
    for (const r of rows) {
      const e = effort(r, metric);
      mTotal += e;
      if (!keys.length) continue;
      const ev = evalValues(rowValues(b, keys, r, d), criteria);
      if (!Number.isFinite(ev.score)) continue;
      mEff += e;
      nRows++;
      if (ev.pass) mPass += e;
    }
    months.push({
      month: b.meta.months[t],
      effort: mTotal,
      passShare: mEff > 0 ? mPass / mEff : null,
      baseline,
    });
    effPass += mPass;
    effAll += mEff;
    if (mEff > 0 && baseline != null) {
      baseWeighted += baseline * mEff;
      baseWeight += mEff;
    }
  }
  const passShare = effAll > 0 ? effPass / effAll : null;
  const baseline = baseWeight > 0 ? baseWeighted / baseWeight : null;
  const lift = passShare != null && baseline ? passShare / baseline : null;
  return { nRows, effortTotal: effAll, passShare, baseline, lift, months };
}

export interface VarStat {
  key: string;
  label: string;
  unit: string;
  fish: number;
  domain: number;
  sd: number;
  z: number;
}

/** Values of one variable over the footprint (analysis-grid cells) for one month. */
function domainValues(b: DataBundle, key: string, t: number, d: number, fp: Window): number[] {
  const { lat0, lon0, dlat, dlon } = b.meta.analysis;
  const vals: number[] = [];
  for (let iy = fp.y0; iy <= fp.y1; iy++) {
    for (let ix = fp.x0; ix <= fp.x1; ix++) {
      const v = valueAt(b, key, t, d, lat0 + iy * dlat, lon0 + ix * dlon, 0);
      if (Number.isFinite(v)) vals.push(v);
    }
  }
  return vals;
}

/** Effort-weighted mean of each variable at fishing cells versus the same-month domain mean. */
export function compareVars(b: DataBundle, d: number, metric: Metric): VarStat[] {
  const fp = footprint(b);
  if (!fp) return [];
  const nm = b.meta.months.length;
  const monthEffort = monthlyEffort(b, metric);
  const out: VarStat[] = [];
  for (const [key, meta] of Object.entries(b.meta.vars)) {
    let fishSum = 0;
    let fishW = 0;
    for (const r of b.fishing) {
      const e = effort(r, metric);
      if (r.mi < 0 || e <= 0) continue;
      const v = valueNear(b, key, r.mi, d, r.lat, r.lon);
      if (!Number.isFinite(v)) continue;
      fishSum += e * v;
      fishW += e;
    }
    if (fishW === 0) continue;
    let domSum = 0;
    let domW = 0;
    let n = 0;
    let s1 = 0;
    let s2 = 0;
    for (let t = 0; t < nm; t++) {
      if (monthEffort[t] <= 0) continue;
      const vals = domainValues(b, key, t, d, fp);
      if (!vals.length) continue;
      let sum = 0;
      for (const v of vals) {
        sum += v;
        s1 += v;
        s2 += v * v;
      }
      n += vals.length;
      domSum += (sum / vals.length) * monthEffort[t];
      domW += monthEffort[t];
    }
    if (domW === 0 || n < 2) continue;
    const mean = s1 / n;
    const sd = Math.sqrt(Math.max(0, s2 / n - mean * mean));
    const fish = fishSum / fishW;
    const domain = domSum / domW;
    out.push({ key, label: meta.label, unit: meta.unit, fish, domain, sd, z: sd > 0 ? (fish - domain) / sd : 0 });
  }
  return out;
}

export interface HistBin {
  label: string;
  fish: number;
  available: number;
}

/** Distribution of a variable at fishing cells versus what the footprint offered in those months. */
export function histogram(b: DataBundle, key: string, d: number, metric: Metric, nb = 12): HistBin[] {
  const fp = footprint(b);
  const meta = b.meta.vars[key];
  if (!fp || !meta) return [];
  const lo = meta.p02;
  const hi = meta.p98 > meta.p02 ? meta.p98 : meta.p02 + 1;
  const step = (hi - lo) / nb;
  const bin = (v: number) => Math.min(nb - 1, Math.max(0, Math.floor((v - lo) / step)));
  const fish = new Array<number>(nb).fill(0);
  const avail = new Array<number>(nb).fill(0);
  const monthEffort = monthlyEffort(b, metric);
  let fishTotal = 0;
  let availTotal = 0;
  for (const r of b.fishing) {
    const e = effort(r, metric);
    if (r.mi < 0 || e <= 0) continue;
    const v = valueNear(b, key, r.mi, d, r.lat, r.lon);
    if (!Number.isFinite(v)) continue;
    fish[bin(v)] += e;
    fishTotal += e;
  }
  for (let t = 0; t < b.meta.months.length; t++) {
    if (monthEffort[t] <= 0) continue;
    const vals = domainValues(b, key, t, d, fp);
    for (const v of vals) {
      const w = monthEffort[t] / vals.length;
      avail[bin(v)] += w;
      availTotal += w;
    }
  }
  return fish.map((f, i) => ({
    label: (lo + step * (i + 0.5)).toFixed(step < 0.1 ? 3 : step < 1 ? 2 : 1),
    fish: fishTotal ? f / fishTotal : 0,
    available: availTotal ? avail[i] / availTotal : 0,
  }));
}
