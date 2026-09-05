/**
 * Geometria drużyn i miejsca na boisku (docs/22 §5). Wspólne dla sim, ai, render, input.
 */
import {
  ATTACK_DEPTH,
  ATTACK_MAX_X,
  BASE_DEPTH,
  BASE_SPREAD_X,
  COURT_HALF_L,
  COURT_HALF_W,
  SERVE_DEPTH,
  SERVE_X,
  SETTER_DEPTH,
  SETTER_MAX_X,
  TARGET_MARGIN,
} from './constants';
import type { PlayerId, TeamId, Vec2 } from './types';
import { clamp } from './vec';

export const ALL_PLAYERS: readonly PlayerId[] = [0, 1, 2, 3];

export function teamOf(id: PlayerId): TeamId {
  return id < 2 ? 0 : 1;
}

/** Miejsce w parze: 0 = pierwszy, 1 = drugi. Gracz to (0,0), partner (0,1). */
export function slotOf(id: PlayerId): 0 | 1 {
  return (id % 2) as 0 | 1;
}

export function partnerOf(id: PlayerId): PlayerId {
  return (id ^ 1) as PlayerId;
}

export function opponentsOf(team: TeamId): [PlayerId, PlayerId] {
  return team === 0 ? [2, 3] : [0, 1];
}

export function playersOf(team: TeamId): [PlayerId, PlayerId] {
  return team === 0 ? [0, 1] : [2, 3];
}

export function otherTeam(team: TeamId): TeamId {
  return team === 0 ? 1 : 0;
}

/** Znak z połowy drużyny: −1 dla drużyny 0, +1 dla drużyny 1. */
export function sideSign(team: TeamId): -1 | 1 {
  return team === 0 ? -1 : 1;
}

/** Po której stronie siatki jest punkt (z = 0 liczy się jako strona drużyny 0). */
export function sideOf(z: number): TeamId {
  return z > 0 ? 1 : 0;
}

/** Pozycja bazowa (przyjęcie): dwójka w połowie głębokości, rozstawiona w x. */
export function basePosition(team: TeamId, slot: 0 | 1): Vec2 {
  const s = sideSign(team);
  // Slot 0 (gracz) stoi po prawej stronie ekranu (x < 0 dla drużyny 0 – prawo ekranu to −x),
  // slot 1 (partner) po lewej. Dla drużyny 1 lustrzanie.
  const x = (slot === 0 ? -BASE_SPREAD_X : BASE_SPREAD_X) * -s;
  return { x, z: s * BASE_DEPTH };
}

/** Pozycja serwującego (za linią końcową) i jego partnera przy serwisie. */
export function servePosition(team: TeamId, slot: 0 | 1): Vec2 {
  const s = sideSign(team);
  return { x: (slot === 0 ? -SERVE_X : SERVE_X) * -s, z: s * SERVE_DEPTH };
}

/** Miejsce rozgrywającego = cel przyjęcia bez celowania: blisko siatki, w x rozgrywającego. */
export function setterSpot(team: TeamId, setterX: number): Vec2 {
  return { x: clamp(setterX, -SETTER_MAX_X, SETTER_MAX_X), z: sideSign(team) * SETTER_DEPTH };
}

/** Miejsce ataku = cel wystawy: tuż przy siatce, w x atakującego. */
export function attackSpot(team: TeamId, attackerX: number): Vec2 {
  return { x: clamp(attackerX, -ATTACK_MAX_X, ATTACK_MAX_X), z: sideSign(team) * ATTACK_DEPTH };
}

/** Przycina cel do połowy rywali z marginesem od linii. */
export function clampTargetToOpponentHalf(target: Vec2, team: TeamId): Vec2 {
  const s = -sideSign(team); // znak połowy rywali
  const zMin = 0.8;
  const zMax = COURT_HALF_L - TARGET_MARGIN;
  const zAbs = clamp(Math.abs(target.z), zMin, zMax);
  return {
    x: clamp(target.x, -(COURT_HALF_W - TARGET_MARGIN), COURT_HALF_W - TARGET_MARGIN),
    z: s * zAbs,
  };
}

/** Czy cień piłki (koło o promieniu r) dotyka boiska – dotknięcie linii = w boisku. */
export function isInCourt(x: number, z: number, r: number): boolean {
  return Math.abs(x) <= COURT_HALF_W + r && Math.abs(z) <= COURT_HALF_L + r;
}
