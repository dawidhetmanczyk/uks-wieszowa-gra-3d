/**
 * Zasięg zawodnika i predykcja: gdzie piłka wyląduje (state.landing) i kiedy
 * wejdzie w zasięg stojącego zawodnika (reachWindow) – to podstawa AI i przełączania.
 *
 * predictLanding całkuje do 720 kroków – raz na tick, tylko tutaj. AI ma czytać
 * `state.landing`, nie liczyć własnej predykcji.
 */
import { predictLanding, PREDICT_MAX_S, stepBall } from './ballistics';
import {
  BALL_R,
  DT,
  NET_CONTACT_TOLERANCE_Z,
  NET_HALF_W,
  NET_HEIGHT,
  REACH_BOTTOM,
  REACH_H,
  REACH_TOP_JUMP,
  REACH_TOP_STANDING,
} from './constants';
import { sideOf } from './spots';
import type { PlayerId, SimState, TeamId, Vec3 } from './types';

/** Poziomy zasięg od osi kapsuły do środka piłki. */
export const REACH_RADIUS = REACH_H + BALL_R;

/**
 * Warunek zasięgu (docs/22 §3 pkt 2): poziomo ≤ REACH_H + promień piłki, pionowo
 * REACH_BOTTOM..topReach względem stóp, po własnej stronie siatki (albo tuż nad nią).
 */
export function inReach(
  ball: Vec3,
  playerPos: Vec3,
  team: TeamId,
  topReach: number = REACH_TOP_STANDING,
): boolean {
  const dx = ball.x - playerPos.x;
  const dz = ball.z - playerPos.z;
  if (dx * dx + dz * dz > REACH_RADIUS * REACH_RADIUS) return false;
  const rel = ball.y - playerPos.y;
  if (rel < REACH_BOTTOM || rel > topReach) return false;
  return sideOf(ball.z) === team || Math.abs(ball.z) < NET_CONTACT_TOLERANCE_Z;
}

/** Czy piłka jest TERAZ w zasięgu zawodnika (z uwzględnieniem jego wysokości w skoku). */
export function canReach(state: SimState, player: PlayerId): boolean {
  if (state.ball.held !== -1) return false;
  const p = state.players[player];
  return inReach(state.ball.pos, p.pos, p.team);
}

/** Odświeża `state.landing` bez alokacji; piłka w ręce = brak predykcji. */
export function updateLanding(state: SimState): void {
  if (state.ball.held !== -1) {
    state.landing.valid = false;
    state.landing.hitsNet = false;
    return;
  }
  predictLanding(state.ball.pos, state.ball.vel, state.tick, state.landing);
}

const MAX_STEPS = Math.round(PREDICT_MAX_S / DT);
// Bufory robocze – reachWindow woła AI wiele razy na tick, więc bez alokacji.
const scratchPos: Vec3 = { x: 0, y: 0, z: 0 };
const scratchVel: Vec3 = { x: 0, y: 0, z: 0 };
const groundPos: Vec3 = { x: 0, y: 0, z: 0 };

/**
 * Pierwszy tick (bezwzględny), w którym piłka wejdzie w zasięg zawodnika stojącego
 * w miejscu (zasięg pionowy do REACH_TOP_JUMP – zakładamy skok), i pierwszy tick,
 * w którym z niego wyjdzie. Tor kończy podłoga albo siatka – wtedy okno kończy się
 * razem z torem. null = piłka nie wejdzie w zasięg.
 */
export function reachWindow(
  state: SimState,
  player: PlayerId,
): { enterTick: number; exitTick: number } | null {
  const ball = state.ball;
  if (ball.held !== -1) return null;
  const p = state.players[player];
  groundPos.x = p.pos.x;
  groundPos.y = 0;
  groundPos.z = p.pos.z;
  scratchPos.x = ball.pos.x;
  scratchPos.y = ball.pos.y;
  scratchPos.z = ball.pos.z;
  scratchVel.x = ball.vel.x;
  scratchVel.y = ball.vel.y;
  scratchVel.z = ball.vel.z;

  let enter = -1;
  // Krok 0 = stan bieżący (piłka może już być w zasięgu).
  if (inReach(scratchPos, groundPos, p.team, REACH_TOP_JUMP)) enter = 0;

  for (let i = 1; i <= MAX_STEPS; i++) {
    const prevZ = scratchPos.z;
    stepBall(scratchPos, scratchVel);
    const floor = scratchPos.y - BALL_R <= 0;
    const net =
      prevZ !== 0 &&
      Math.sign(scratchPos.z) !== Math.sign(prevZ) &&
      Math.abs(scratchPos.x) <= NET_HALF_W &&
      scratchPos.y - BALL_R < NET_HEIGHT;
    if (floor || net) {
      return enter < 0 ? null : { enterTick: state.tick + enter, exitTick: state.tick + i };
    }
    const reach = inReach(scratchPos, groundPos, p.team, REACH_TOP_JUMP);
    if (enter < 0) {
      if (reach) enter = i;
    } else if (!reach) {
      return { enterTick: state.tick + enter, exitTick: state.tick + i };
    }
  }
  return enter < 0 ? null : { enterTick: state.tick + enter, exitTick: state.tick + MAX_STEPS };
}
