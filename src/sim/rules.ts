/**
 * Zasady: odbicia, punkt, set, zmiana fazy po pauzie (docs/22 §2).
 *
 * Kolizje i kontakt wołają `awardPoint`; ono jest idempotentne w obrębie akcji
 * (punkt tylko w fazie rally), więc drugi błąd w tym samym ticku nie liczy się podwójnie.
 */
import {
  MAX_TOUCHES,
  POINT_FREEZE_S,
  SET_CAP,
  SET_MIN_LEAD,
  SET_TARGET_POINTS,
  TICK_HZ,
} from './constants';
import { resetForServe } from './state';
import type { PlayerId, PointReason, SimState, TeamId } from './types';

const FREEZE_TICKS = Math.round(POINT_FREEZE_S * TICK_HZ);

/** Kto wygrał set przy takim wyniku; -1 = gra trwa. Do 7, przewaga 2, limit 10. */
export function setWinnerFor(points: readonly [number, number]): TeamId | -1 {
  const [a, b] = points;
  const leader: TeamId = a > b ? 0 : 1;
  if (a >= SET_CAP || b >= SET_CAP) return leader;
  if (Math.max(a, b) >= SET_TARGET_POINTS && Math.abs(a - b) >= SET_MIN_LEAD) return leader;
  return -1;
}

/**
 * Błąd odbicia, jeśli zawodnik `player` dotknie teraz piłki jako odbicie nr `touchNo`.
 * Sprawdzane PRZED nadaniem prędkości – piłka i tak odlatuje, żeby było widać, co się stało.
 */
export function checkTouchRules(
  state: SimState,
  player: PlayerId,
  touchNo: number,
): PointReason | null {
  const rally = state.rally;
  if (rally.lastToucher === player && rally.touches > 0) return 'double-touch';
  if (touchNo > MAX_TOUCHES) return 'four-touches';
  return null;
}

/** Przyznaje punkt: faza point, wynik, ewentualnie rozstrzygnięcie setu. */
export function awardPoint(state: SimState, winner: TeamId, reason: PointReason): void {
  const rally = state.rally;
  if (rally.phase !== 'rally') return;
  rally.phase = 'point';
  rally.phaseTick = state.tick;
  rally.pointWinner = winner;
  rally.pointReason = reason;
  state.score.points[winner]++;
  state.events.push({ type: 'point', winner, reason });

  // Po punkcie ramiona w dół – piłka jeszcze leci, ale zamachy nie mają już znaczenia.
  for (const p of state.players) {
    p.swingStartTick = -1;
    p.swingReleaseTick = -1;
    p.swingPower = null;
    p.jumpSwing = false;
  }

  const setWinner = setWinnerFor(state.score.points);
  if (setWinner !== -1) {
    state.score.setWinner = setWinner;
    state.events.push({ type: 'set-over', winner: setWinner });
  }
}

/** Po pauzie POINT_FREEZE_S: koniec setu albo serwis zwycięzcy punktu. */
export function updatePhase(state: SimState): void {
  const rally = state.rally;
  if (rally.phase !== 'point') return;
  if (state.tick - rally.phaseTick < FREEZE_TICKS) return;
  if (state.score.setWinner !== -1) {
    rally.phase = 'set-over';
    rally.phaseTick = state.tick;
    return;
  }
  const team: TeamId = rally.pointWinner === -1 ? rally.servingTeam : rally.pointWinner;
  resetForServe(state, team);
}
