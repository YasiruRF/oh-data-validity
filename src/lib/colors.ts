export type RGB = [number, number, number];

const hex = (h: string): RGB => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];

export const RAMPS: Record<string, RGB[]> = {
  viridis: ["#440154", "#414487", "#2a788e", "#22a884", "#7ad151", "#fde725"].map(hex),
  plasma: ["#0d0887", "#6a00a8", "#b12a90", "#e16462", "#fca636", "#f0f921"].map(hex),
  ocean: ["#081d58", "#225ea8", "#1d91c0", "#41b6c4", "#c7e9b4", "#ffffd9"].map(hex),
  thermal: ["#2b1b6b", "#2a5db0", "#35a7a5", "#c9d96b", "#f0a63b", "#d6392a"].map(hex),
  // low values red, high values blue: low oxygen reads as a warning
  oxygen: ["#7f1d1d", "#d9482b", "#f2b84b", "#7fc8a9", "#3a8fb7", "#1d4e89"].map(hex),
  suitability: ["#7f1d1d", "#c2410c", "#eab308", "#65a30d", "#16a34a", "#15803d"].map(hex),
};

export const VAR_RAMP: Record<string, string> = {
  o2: "oxygen",
  temp: "thermal",
  sal: "ocean",
  chl: "viridis",
  npp: "viridis",
  ph: "plasma",
  no3: "plasma",
  po4: "plasma",
  current: "ocean",
  mld: "ocean",
  sst: "thermal",
  chl_sat: "viridis",
  kd490: "plasma",
  bathy: "ocean",
  habitat: "suitability",
};

export function rampColor(ramp: RGB[], t: number): RGB {
  const x = Math.min(1, Math.max(0, t)) * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(x));
  const f = x - i;
  const a = ramp[i];
  const b = ramp[i + 1];
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
}

export function rampCss(ramp: RGB[]): string {
  const stops = ramp.map((c, i) => `rgb(${c[0]},${c[1]},${c[2]}) ${(i / (ramp.length - 1)) * 100}%`);
  return `linear-gradient(to right, ${stops.join(", ")})`;
}
