/**
 * Haki deweloperskie na `window.__sw3d` (docs/22 §1 i §8). Czyta je harness
 * Playwright (perf, przyjęcie, zrzuty) i człowiek w konsoli. Instalowane zawsze,
 * także w buildzie produkcyjnym – harness gra na `vite preview`.
 */
import { DT, reachWindow, type PlayerId, type SimState, type TeamId } from '../sim/index';
import type { FramingStats, ResolvedRenderOptions } from '../render/index';
import type { ControlMode } from '../input/index';
import type { HintId, TutorialCounts } from '../ui/index';

export const DEV_HOOKS_VERSION = '0.0.2-f0b';

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
  /** F0b: 'assist' (domyślnie) albo 'manual' – pełne F0 pod ?sterowanie=reczne. */
  controlMode(): ControlMode;
  /** F0b: bieżące tempo pętli – 1, a tuż przed kontaktem aktywnego w stronę 0,6. */
  tempo(): number;
  /** F0b: czy ruchem steruje teraz palec / klawisze (asysta czeka). Poza trybem asysty false. */
  manualSteering(): boolean;
  /** F0b: szansa na atak ze skokiem – pierścień jasnoniebieski i napis w HUD. */
  jumpChance(): boolean;
  /** F0b: liczniki samouczka i bieżąca podpowiedź; null w trybie ręcznym (bez samouczka). */
  tutorial(): { counts: TutorialCounts; current: HintId | null } | null;
  /** F0b: czy po pierwszym dotyku poszła prośba o pełny ekran (Android). */
  fullscreenRequested(): boolean;
  /** F0b: widoczny prostokąt okna (visualViewport) w px CSS, w którym leży gra. */
  viewport(): { width: number; height: number; top: number; left: number };
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
