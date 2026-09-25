/**
 * Przełączanie aktywnego zawodnika drużyny 0 (docs/22 §5).
 *
 * Liczone zawsze – także w AI vs AI – bo testy migotania muszą widzieć te same
 * decyzje, jakie zobaczy człowiek. Kto faktycznie jest sterowany, decyduje loop.
 */
import {
  ACTIVE_HYSTERESIS_M,
  ACTIVE_MIN_DWELL_S,
  ACTIVE_RESCUE_MARGIN_S,
  DT,
  PLAYER_MAX_SPEED,
  TICK_HZ,
} from './constants';
import { partnerOf, sideOf } from './spots';
import type { PlayerId, SimState } from './types';
import { distXZ } from './vec';

const DWELL_TICKS = Math.round(ACTIVE_MIN_DWELL_S * TICK_HZ);

function switchActive(state: SimState, to: PlayerId): void {
  const from = state.active;
  // Poprzednio aktywny przestaje biec tam, gdzie kazał mu palec – teraz steruje nim AI.
  state.players[from].move.x = 0;
  state.players[from].move.z = 0;
  state.active = to;
  state.activeSinceTick = state.tick;
  state.events.push({ type: 'active-switch', from, to });
}

export function updateActive(state: SimState): void {
  const rally = state.rally;
  if (rally.phase !== 'rally') return;
  const landing = state.landing;
  if (!landing.valid) return;
  if (sideOf(landing.pos.z) !== 0) return; // piłka nie leci na naszą stronę
  if (state.tick - state.activeSinceTick < DWELL_TICKS) return;

  const active = state.active;
  const partner = partnerOf(active);
  const dActive = distXZ(state.players[active].pos, landing.pos);
  const dPartner = distXZ(state.players[partner].pos, landing.pos);

  const ourActionStarted = rally.sideOfBall === 0 && rally.touches > 0;
  if (!ourActionStarted) {
    // Serwis albo atak rywali: bliższy lądowania przejmuje, z histerezą.
    if (dActive - dPartner >= ACTIVE_HYSTERESIS_M) switchActive(state, partner);
    return;
  }

  // Nasza akcja trwa – aktywny zostaje, chyba że nie zdąży, a partner zdąży (ratunek).
  const timeToLand = (landing.tick - state.tick) * DT + ACTIVE_RESCUE_MARGIN_S;
  const activeNeeds = dActive / PLAYER_MAX_SPEED;
  const partnerNeeds = dPartner / PLAYER_MAX_SPEED;
  if (activeNeeds > timeToLand && partnerNeeds <= timeToLand) switchActive(state, partner);
}
