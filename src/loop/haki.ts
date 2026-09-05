/**
 * Haki deweloperskie na `window.__sw3d` (docs/22 §1 i §8). Czyta je harness
 * Playwright (perf, przyjęcie, zrzuty) i człowiek w konsoli. Instalowane zawsze,
 * także w buildzie produkcyjnym – harness gra na `vite preview`.
 */
import { DT, reachWindow, type PlayerId, type SimState, type TeamId } from '../sim/index';

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
