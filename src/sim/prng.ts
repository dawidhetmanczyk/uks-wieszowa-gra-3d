/**
 * mulberry32 – jedyne źródło losowości w sim i ai (CLAUDE.md, zasada 4).
 *
 * Generator jest bezstanowy: stan trzyma wołający (pole `rng` w SimState albo
 * w stanie AI). Skopiowanie stanu kopiuje losowość, więc powtórka na tym samym
 * ziarnie jest wierna co do bitu. Operacje na uint32 – wynik nie zależy od
 * reprezentacji zmiennoprzecinkowej silnika.
 */

export interface RngHolder {
  rng: number;
}

const UINT32 = 4294967296;

/** Ziarno startowe z liczby całkowitej (mieszanie, żeby seed 1 i 2 nie były sąsiadami). */
export function seedRng(seed: number): number {
  let s = (seed | 0) >>> 0;
  s = (s ^ 0x9e3779b9) >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x85ebca6b) >>> 0;
  s = Math.imul(s ^ (s >>> 13), 0xc2b2ae35) >>> 0;
  return (s ^ (s >>> 16)) >>> 0;
}

/** Kolejna liczba uint32. Mutuje stan generatora. */
export function nextUint32(holder: RngHolder): number {
  holder.rng = (holder.rng + 0x6d2b79f5) >>> 0;
  let t = holder.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

/** Ułamek z przedziału [0, 1). */
export function nextFloat(holder: RngHolder): number {
  return nextUint32(holder) / UINT32;
}

/** Liczba z przedziału [lo, hi). */
export function nextRange(holder: RngHolder, lo: number, hi: number): number {
  return lo + (hi - lo) * nextFloat(holder);
}

/** Liczba z przedziału [-1, 1) o rozkładzie trójkątnym (średnia dwóch) – łagodniejszy szum niż jednostajny. */
export function nextTriangular(holder: RngHolder): number {
  return nextFloat(holder) + nextFloat(holder) - 1;
}
