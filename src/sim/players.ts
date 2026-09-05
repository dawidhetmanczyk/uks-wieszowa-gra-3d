/**
 * Ruch zawodników: przyspieszenie do prędkości zadanej, hamowanie, skok,
 * granice własnej połowy, rozpychanie kapsuł tej samej drużyny.
 *
 * Skok jest tylko automatyczny (contact.ts), tu jest jego całkowanie i lądowanie.
 * Kolejność zawodników zawsze 0..3 – to część determinizmu.
 */
import {
  COURT_HALF_L,
  COURT_HALF_W,
  DT,
  FACING_MIN_SPEED,
  JUMP_SPEED,
  PLAYER_ACCEL,
  PLAYER_DECEL,
  PLAYER_GRAVITY,
  PLAYER_MAX_SPEED,
  PLAYER_NET_MARGIN,
  PLAYER_OUT_X,
  PLAYER_OUT_Z,
  PLAYER_R,
} from './constants';
import { sideSign } from './spots';
import type { PlayerState, SimState } from './types';

/** Zawodnik odbija się od ziemi – używane przez auto-skok. */
export function startJump(p: PlayerState): void {
  if (!p.grounded) return;
  p.grounded = false;
  p.vel.y = JUMP_SPEED;
}

function movePlayer(p: PlayerState, locked: boolean): void {
  if (p.grounded) {
    let mx = locked ? 0 : p.move.x;
    let mz = locked ? 0 : p.move.z;
    const ml = Math.sqrt(mx * mx + mz * mz);
    if (ml > 1) {
      mx /= ml;
      mz /= ml;
    }
    if (ml > 1e-6) {
      // Dojście do prędkości zadanej ze stałym przyspieszeniem – zmiana kierunku
      // w biegu też kosztuje czas, dzięki czemu ruch nie jest „teleportem”.
      const dx = mx * PLAYER_MAX_SPEED - p.vel.x;
      const dz = mz * PLAYER_MAX_SPEED - p.vel.z;
      const d = Math.sqrt(dx * dx + dz * dz);
      const maxStep = PLAYER_ACCEL * DT;
      if (d <= maxStep) {
        p.vel.x += dx;
        p.vel.z += dz;
      } else {
        p.vel.x += (dx / d) * maxStep;
        p.vel.z += (dz / d) * maxStep;
      }
    } else {
      const sp = Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z);
      const dec = PLAYER_DECEL * DT;
      if (sp <= dec) {
        p.vel.x = 0;
        p.vel.z = 0;
      } else {
        const k = (sp - dec) / sp;
        p.vel.x *= k;
        p.vel.z *= k;
      }
    }
  } else {
    // W powietrzu brak sterowania poziomego – prędkość z odbicia zostaje.
    p.vel.y -= PLAYER_GRAVITY * DT;
  }

  p.pos.x += p.vel.x * DT;
  p.pos.z += p.vel.z * DT;
  if (!p.grounded) {
    p.pos.y += p.vel.y * DT;
    if (p.pos.y <= 0) {
      p.pos.y = 0;
      p.vel.y = 0;
      p.grounded = true;
    }
  }

  const sp = Math.sqrt(p.vel.x * p.vel.x + p.vel.z * p.vel.z);
  if (sp > FACING_MIN_SPEED) p.facing = Math.atan2(p.vel.x, p.vel.z);
}

/** Własna połowa z marginesem; przy ścianie zeruje składową prędkości w ścianę. */
function clampToHalf(p: PlayerState): void {
  const xMax = COURT_HALF_W + PLAYER_OUT_X;
  if (p.pos.x > xMax) {
    p.pos.x = xMax;
    if (p.vel.x > 0) p.vel.x = 0;
  } else if (p.pos.x < -xMax) {
    p.pos.x = -xMax;
    if (p.vel.x < 0) p.vel.x = 0;
  }
  const s = sideSign(p.team);
  const depth = p.pos.z * s; // głębokość na własnej połowie (dodatnia)
  const zNear = PLAYER_R + PLAYER_NET_MARGIN;
  const zFar = COURT_HALF_L + PLAYER_OUT_Z;
  if (depth < zNear) {
    p.pos.z = s * zNear;
    if (p.vel.z * s < 0) p.vel.z = 0;
  } else if (depth > zFar) {
    p.pos.z = s * zFar;
    if (p.vel.z * s > 0) p.vel.z = 0;
  }
}

/** Dwie kapsuły tej samej drużyny nie nachodzą na siebie – rozpychanie po połowie. */
function separate(a: PlayerState, b: PlayerState): void {
  const dx = b.pos.x - a.pos.x;
  const dz = b.pos.z - a.pos.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  const min = 2 * PLAYER_R;
  if (d >= min) return;
  let nx = 1;
  let nz = 0;
  if (d > 1e-9) {
    nx = dx / d;
    nz = dz / d;
  }
  const push = (min - d) / 2;
  a.pos.x -= nx * push;
  a.pos.z -= nz * push;
  b.pos.x += nx * push;
  b.pos.z += nz * push;
}

export function stepPlayers(state: SimState): void {
  // Serwujący stoi w miejscu do serwisu (docs/22 §2).
  const locked = state.rally.phase === 'serve' ? state.rally.server : -1;
  for (const p of state.players) movePlayer(p, p.id === locked);
  separate(state.players[0], state.players[1]);
  separate(state.players[2], state.players[3]);
  for (const p of state.players) clampToHalf(p);
}
