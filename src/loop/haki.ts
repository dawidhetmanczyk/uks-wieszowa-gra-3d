/**
 * Haki deweloperskie na `window.__sw3d` (docs/22 §1 i §8). Czyta je harness
 * Playwright (perf, przyjęcie, zrzuty) i człowiek w konsoli. Instalowane zawsze,
 * także w buildzie produkcyjnym – harness gra na `vite preview`.
 */
import { DT, reachWindow, type PlayerId, type SimState, type TeamId } from '../sim/index';
import type { FramingStats, ResolvedRenderOptions } from '../render/index';

export const DEV_HOOKS_VERSION = '0.0.1-f0';

export interface NewSetOptions {
  /** Domyślnie poprzednie ziarno + 1. */
  seed?: number;
  servingTeam?: TeamId;
  humanControl?: boolean;
}

/** Okno zasięgu w sekundach względem teraz (ujemne = już minęło). */
export interface ReachWindowSeconds {
  enterInS: number;
  exitInS: number;
}

export interface RenderInfo {
  calls: number;
  triangles: number;
  programs: number;
}

export interface DevHooks {
  version: string;
  /** Żywa referencja stanu sim – tylko do odczytu. */
  state(): SimState;
  newSet(opts?: NewSetOptions): void;
  /** Czasy klatek w ms (delta rAF), bufor 16384, od najstarszej. */
  frameTimes(): number[];
  resetFrameTimes(): void;
  renderInfo(): RenderInfo;
  reachWindow(player: PlayerId): ReachWindowSeconds | null;
  /**
   * Przełączniki jakości, z którymi rysuje render (?jakosc, ?dpr, ?aa, ?cien) – harness
   * zapisuje je obok wyniku, żeby pomiar dało się porównać. Rozszerzenie F0 poza kontrakt.
   */
  renderOptions(): ResolvedRenderOptions;
  /**
   * Kadr od ostatniego resetFraming(): ile klatek obaj zawodnicy drużyny gracza byli
   * w oknie w całości (harness/kadr.ts, pomiar 844 × 390). Rozszerzenie F0 poza kontrakt.
   */
  framing(): FramingStats;
  resetFraming(): void;
  /** Stopy zawodnika w px CSS okna – test sterowania „w prawo na ekranie” (harness/sterowanie.ts). */
  screenPos(player: PlayerId): { x: number; y: number } | null;
  /** Czy pętla stoi (nakładka „Obróć telefon” na telefonie w pionie). */
  paused(): boolean;
}

declare global {
  interface Window {
    __sw3d?: DevHooks;
  }
}

/** Okno zasięgu z sim (w tickach bezwzględnych) przeliczone na sekundy od bieżącego ticku. */
export function reachWindowInSeconds(state: SimState, player: PlayerId): ReachWindowSeconds | null {
  const win = reachWindow(state, player);
  if (win === null) return null;
  return {
    enterInS: (win.enterTick - state.tick) * DT,
    exitInS: (win.exitTick - state.tick) * DT,
  };
}

/** Wystawia haki i zwraca funkcję, która je zdejmuje (tylko jeśli to wciąż te same). */
export function installDevHooks(hooks: DevHooks): () => void {
  window.__sw3d = hooks;
  return () => {
    if (window.__sw3d === hooks) delete window.__sw3d;
  };
}
