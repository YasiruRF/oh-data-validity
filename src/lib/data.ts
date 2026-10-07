export interface GridMeta {
  lat0: number;
  lon0: number;
  dlat: number;
  dlon: number;
  ny: number;
  nx: number;
}

export interface VarMeta {
  label: string;
  unit: string;
  depth: boolean; // has a depth axis
  static: boolean; // no time axis (e.g. seabed depth)
  source: string;
  grid: GridMeta; // each variable keeps its own native grid
  scale: number;
  offset: number;
  min: number;
  max: number;
  p02: number;
  p98: number;
  coverage: number;
}

export interface Meta {
  months: string[];
  depths: number[];
  analysis: GridMeta; // common grid used for habitat scoring
  vars: Record<string, VarMeta>;
  sources: Record<string, string>;
}

export interface Verification {
  rows: number;
  monthsInFile: number;
  monthRange: [string, string];
  uniqueCells: number;
  duplicateKeys: number;
  nulls: number;
  nonZeroRows: number;
  zeroShare: number;
  totalFishingHours: number;
  totalLonglineHours: number;
  lkaAllZero: boolean;
  longlineExceedsFishing: number;
  onLandRows: number;
  onLandNonZeroRows: number;
  outsideEnvGridRows: number;
  outlierFence: number;
  outlierRows: number;
  topCell: { month: string; lat: number; lon: number; hours: number };
  topCellShare: number;
  monthsMissingFromRange: string[];
}

export interface FishingRow {
  mi: number; // month index into Meta.months, -1 if outside the environmental record
  lat: number;
  lon: number;
  fishing: number;
  longline: number;
  lka: number;
  land: boolean;
}

export interface DataBundle {
  meta: Meta;
  fields: Record<string, Int16Array>;
  fishing: FishingRow[];
  verification: Verification;
}

export const NODATA = -32768;

async function getJson<T>(url: string): Promise<T> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.json() as Promise<T>;
}

async function getBin(url: string): Promise<ArrayBuffer> {
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status}`);
  return r.arrayBuffer();
}

export async function loadData(base = "/data"): Promise<DataBundle> {
  const meta = await getJson<Meta>(`${base}/meta.json`);
  const keys = Object.keys(meta.vars);
  const [bins, rawFishing, verification] = await Promise.all([
    Promise.all(keys.map((k) => getBin(`${base}/${k}.bin`))),
    getJson<number[][]>(`${base}/fishing.json`),
    getJson<Verification>(`${base}/verification.json`),
  ]);
  const fields: Record<string, Int16Array> = {};
  keys.forEach((k, i) => {
    fields[k] = new Int16Array(bins[i]);
  });
  const fishing: FishingRow[] = rawFishing.map(([mi, lat, lon, fishingH, longlineH, lkaH, land]) => ({
    mi,
    lat,
    lon,
    fishing: fishingH,
    longline: longlineH,
    lka: lkaH,
    land: land === 1,
  }));
  return { meta, fields, fishing, verification };
}

/** Raw value at a native-grid cell of one variable; NaN where there is no data. */
export function getValue(b: DataBundle, key: string, t: number, d: number, iy: number, ix: number): number {
  const v = b.meta.vars[key];
  const g = v.grid;
  if (iy < 0 || iy >= g.ny || ix < 0 || ix >= g.nx) return NaN;
  const nd = v.depth ? b.meta.depths.length : 1;
  const tt = v.static ? 0 : t;
  const dd = v.depth ? d : 0;
  const q = b.fields[key][((tt * nd + dd) * g.ny + iy) * g.nx + ix];
  return q === NODATA ? NaN : q * v.scale + v.offset;
}

/** Value at a lat/lon, taking the nearest valid cell within `radius` native cells. */
export function valueAt(b: DataBundle, key: string, t: number, d: number, lat: number, lon: number, radius = 0): number {
  const g = b.meta.vars[key].grid;
  const iy = Math.round((lat - g.lat0) / g.dlat);
  const ix = Math.round((lon - g.lon0) / g.dlon);
  if (radius === 0) return getValue(b, key, t, d, iy, ix);
  let best = NaN;
  let bestDist = Infinity;
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const v = getValue(b, key, t, d, iy + dy, ix + dx);
      const dist = dy * dy + dx * dx;
      if (Number.isFinite(v) && dist < bestDist) {
        best = v;
        bestDist = dist;
      }
    }
  }
  return best;
}

/**
 * Value for a fishing record: the closest valid cell within about 0.1 degrees. Coarse model grids are
 * empty right at the coast, where much of the effort sits, so a strict lookup would drop those records.
 */
export function valueNear(b: DataBundle, key: string, t: number, d: number, lat: number, lon: number): number {
  const g = b.meta.vars[key].grid;
  return valueAt(b, key, t, d, lat, lon, Math.max(1, Math.ceil(0.1 / g.dlat)));
}

/** Full native-grid slice [ny*nx] for one variable at one month and depth. */
export function fieldSlice(b: DataBundle, key: string, t: number, d: number): Float32Array {
  const { ny, nx } = b.meta.vars[key].grid;
  const out = new Float32Array(ny * nx);
  for (let iy = 0; iy < ny; iy++) {
    for (let ix = 0; ix < nx; ix++) out[iy * nx + ix] = getValue(b, key, t, d, iy, ix);
  }
  return out;
}

/** [west, south, east, north] edges of a grid, treating coordinates as cell centres. */
export function gridBounds(g: GridMeta): [number, number, number, number] {
  return [g.lon0 - g.dlon / 2, g.lat0 - g.dlat / 2, g.lon0 + (g.nx - 0.5) * g.dlon, g.lat0 + (g.ny - 0.5) * g.dlat];
}

/** Ocean where the GEBCO seabed-depth grid has a value. */
export function isOcean(b: DataBundle, lat: number, lon: number): boolean {
  return b.meta.vars.bathy ? Number.isFinite(valueAt(b, "bathy", 0, 0, lat, lon, 0)) : false;
}

/** All variables at a point, for the inspector. */
export function sampleAt(b: DataBundle, lat: number, lon: number, t: number, d: number): Record<string, number> {
  const out: Record<string, number> = {};
  for (const key of Object.keys(b.meta.vars)) out[key] = valueAt(b, key, t, d, lat, lon, 0);
  return out;
}

export function resolutionLabel(g: GridMeta): string {
  const km = g.dlat * 111;
  return `${g.dlat.toFixed(g.dlat < 0.1 ? 3 : 2)}° (~${Math.round(km)} km)`;
}

export function fmt(v: number, digits = 2): string {
  if (!Number.isFinite(v)) return "n/a";
  const a = Math.abs(v);
  if (a !== 0 && (a < 0.01 || a >= 10000)) return v.toExponential(1);
  return v.toFixed(a >= 100 ? 0 : digits);
}

export function monthLabel(key: string): string {
  const [y, m] = key.split("-");
  const names = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${names[Number(m) - 1]} ${y}`;
}
