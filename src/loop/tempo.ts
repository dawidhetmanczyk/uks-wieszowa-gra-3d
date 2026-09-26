/**
 * Lekkie spowolnienie F0b (decyzja Dawida 4 z 2026-09-26): gdy do kontaktu aktywnego zostaje
 * ≤ 0,4 s, tempo pętli spada do 0,6×, a po kontakcie wraca do 1. Zmienia się WYŁĄCZNIE ilość
 * czasu ściennego podawana akumulatorowi – krok sim (1/120 s), kolejność kroków i komendy są
 * te same, więc determinizm i nagrania zostają nietknięte.
 *
 * „Kontakt aktywnego” = chwila, w której piłka wejdzie w jego zasięg (reachWindow) – od niej
 * stuknięcie trafia. Po kontakcie aktywny jest ostatnim dotykającym i warunek gaśnie; po
 * pudle gaśnie, gdy piłka opuści zasięg albo spadnie. Tylko tryb asysty – w trybie ręcznym
 * (pełne F0) tempo jest zawsze 1.
 *
 * Czysta logika bez DOM – testowalna w Node (tests/loop/tempo.test.ts).
 */
import { DT, reachWindow, sideOf, type SimState } from '../sim/index';

/** Tempo pętli w spowolnieniu. */
export const SLOWMO_TEMPO = 0.6;
/** Spowolnienie rusza, gdy do wejścia piłki w zasięg aktywnego zostaje tyle sekundy sim. */
export const SLOWMO_LEAD_S = 0.4;
/**
 * Przejście 1 ↔ 0,6 trwa tyle czasu ściennego – skok tempa z klatki na klatkę wygląda jak
 * zacięcie. [F0b, założenie wykonawcze – w raporcie]
 */
export const SLOWMO_RAMP_S = 0.1;

/** Czy teraz spowalniać: piłka za ≤ 0,4 s wejdzie w zasięg aktywnego, który może ją odbić. */
export function slowMoWanted(state: SimState): boolean {
  if (!state.assist) return false;
  const rally = state.rally;
  if (rally.phase !== 'rally' || state.ball.held !== -1) return false;
  const active = state.active;
  // Po kontakcie aktywnego (także po jego pierwszym z dwóch) – powrót do 1.
  if (rally.lastToucher === active) return false;
  const team = state.players[active].team;
  const landing = state.landing;
  const incoming =
    landing.valid && !landing.hitsNet ? sideOf(landing.pos.z) === team : rally.sideOfBall === team;
  if (!incoming) return false;
  const w = reachWindow(state, active);
  if (w === null || state.tick > w.exitTick) return false;
  return (w.enterTick - state.tick) * DT <= SLOWMO_LEAD_S;
}

/** Następne tempo: liniowo w stronę celu (0,6 albo 1), pełna zmiana w SLOWMO_RAMP_S. */
export function nextTempo(current: number, wanted: boolean, wallDtSeconds: number): number {
  const target = wanted ? SLOWMO_TEMPO : 1;
  const step = ((1 - SLOWMO_TEMPO) / SLOWMO_RAMP_S) * Math.max(0, wallDtSeconds);
  if (current < target) return Math.min(target, current + step);
  return Math.max(target, current - step);
}
