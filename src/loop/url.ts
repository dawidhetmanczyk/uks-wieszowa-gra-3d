/**
 * Parametry startowe z adresu (docs/22 §1): ?seed=123, ?ai=1, ?serwis=1, ?fps=1.
 * Czysta funkcja od stringa – testowalna bez przeglądarki.
 */
import type { TeamId } from '../sim/index';

export interface UrlParams {
  seed: number;
  humanControl: boolean;
  servingTeam: TeamId;
  showFps: boolean;
}

/** Początek liczenia „ziarna dnia”: 2026-01-01. */
const SEED_EPOCH_UTC = Date.UTC(2026, 0, 1);
const DAY_MS = 86_400_000;

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
  };
}
