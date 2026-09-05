/**
 * Parametry startowe z adresu (docs/22 §1): ?seed=123, ?ai=1, ?serwis=1, ?fps=1 oraz
 * przełączniki jakości do pomiarów na telefonie: ?jakosc=niska, ?dpr=1, ?aa=0, ?cien=0.
 * Czysta funkcja od stringa – testowalna bez przeglądarki.
 */
import type { RenderOptions } from '../render/index';
import type { TeamId } from '../sim/index';

export interface UrlParams {
  seed: number;
  humanControl: boolean;
  servingTeam: TeamId;
  showFps: boolean;
  /** Tylko pola podane w adresie – wartości domyślne zna render, nie parser. */
  render: RenderOptions;
}

/** Początek liczenia „ziarna dnia”: 2026-01-01. */
const SEED_EPOCH_UTC = Date.UTC(2026, 0, 1);
const DAY_MS = 86_400_000;
/**
 * Górna granica ?dpr= – 4× to już 16 razy więcej pikseli niż 1×; wyższe wartości
 * zawieszałyby telefon zamiast go mierzyć.
 */
const MAX_URL_PIXEL_RATIO = 4;

/**
 * Liczba dni kalendarzowych od 2026-01-01 według lokalnej daty gracza – „mecz dnia”
 * ma się zmieniać o północy u gracza, nie w UTC. Liczone przez Date.UTC z lokalnych
 * składników, żeby zmiana czasu letniego nie dała ułamka dnia. Wołane raz przy starcie
 * w warstwie loop – sim zegara nie zna.
 */
export function daySeed(now: Date): number {
  const localMidnight = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.floor((localMidnight - SEED_EPOCH_UTC) / DAY_MS);
}

/** Flaga jest włączona, gdy jest w adresie i nie ma jawnie „wyłączonej” wartości. */
function flag(value: string | null): boolean {
  return value !== null && value !== '0' && value !== 'false' && value !== 'nie';
}

/** Przełącznik trójstanowy: brak w adresie = undefined (decyduje render), inaczej jak flag(). */
function toggle(value: string | null): boolean | undefined {
  return value === null ? undefined : flag(value);
}

/** Pixel ratio z adresu: dodatnia liczba (także ułamek, np. 1.5) do 4; inne wartości ignorujemy. */
function parsePixelRatio(raw: string | null): number | undefined {
  if (raw === null) return undefined;
  const trimmed = raw.trim();
  if (!/^\d{1,2}(\.\d{1,3})?$/.test(trimmed)) return undefined;
  const value = Number(trimmed);
  return value > 0 && value <= MAX_URL_PIXEL_RATIO ? value : undefined;
}

/**
 * ?jakosc=niska ustawia komplet dla telefonu klasy średniej (dpr 1, bez MSAA, bez cieni);
 * pojedyncze ?dpr=, ?aa=, ?cien= nadpisują je, więc da się mierzyć wpływ każdego z osobna.
 */
function parseRenderOptions(q: URLSearchParams): RenderOptions {
  const render: RenderOptions = {};
  if (q.get('jakosc')?.trim().toLowerCase() === 'niska') {
    render.antialias = false;
    render.shadows = false;
    render.maxPixelRatio = 1;
  }
  const antialias = toggle(q.get('aa'));
  if (antialias !== undefined) render.antialias = antialias;
  const shadows = toggle(q.get('cien'));
  if (shadows !== undefined) render.shadows = shadows;
  const maxPixelRatio = parsePixelRatio(q.get('dpr'));
  if (maxPixelRatio !== undefined) render.maxPixelRatio = maxPixelRatio;
  return render;
}

export function parseUrlParams(search: string, now: Date): UrlParams {
  const q = new URLSearchParams(search);
  const seedRaw = q.get('seed')?.trim() ?? null;
  // Tylko pełna liczba całkowita – parseInt('12abc') = 12 ukryłoby literówkę w adresie.
  const seed = seedRaw !== null && /^-?\d{1,15}$/.test(seedRaw) ? Number(seedRaw) : daySeed(now);
  return {
    seed,
    humanControl: !flag(q.get('ai')),
    servingTeam: flag(q.get('serwis')) ? 1 : 0,
    showFps: flag(q.get('fps')),
    render: parseRenderOptions(q),
  };
}
