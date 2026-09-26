/**
 * Tor piłki i kolizje: siatka, podłoga, kapsuły. Kolizja z kapsułą bez zamachu
 * to bierny kontakt (zasady w contact.ts). Piłka w ręce serwującego nie jest całkowana.
 *
 * Przejście przez płaszczyznę siatki jest tu, bo decyduje o nim ten sam krok
 * całkowania: nad siatką = zmiana strony (touches = 0), pod – odbicie albo błąd.
 */
import { stepBall } from './ballistics';
import {
  BALL_BODY_RESTITUTION,
  BALL_FLOOR_FRICTION,
  BALL_FLOOR_RESTITUTION,
  BALL_NET_SPEED_FACTOR,
  BALL_R,
  BALL_REST_VXZ,
  BALL_REST_VY,
  BODY_IMMUNITY_TICKS,
  NET_HALF_W,
  NET_HEIGHT,
  NET_THICKNESS,
  PLAYER_H,
  PLAYER_R,
} from './constants';
import { isSwingActive, registerPassiveTouch } from './contact';
import { awardPoint } from './rules';
import { isInCourt, otherTeam, sideOf, teamOf } from './spots';
import { heldBallPosition } from './state';
import type { SimState, TeamId, Vec3 } from './types';
import { clamp } from './vec';

const BODY_HIT_DIST = PLAYER_R + BALL_R;
/** Piłka odsunięta od płaszczyzny siatki na własną stronę: promień + pół grubości siatki. */
const NET_STANDOFF_Z = BALL_R + NET_THICKNESS / 2;

// Pozycja sprzed kroku – do wykrycia przejścia przez siatkę i interpolacji na podłodze.
const prev: Vec3 = { x: 0, y: 0, z: 0 };

/** Drużyna, która traci punkt za ostatni kontakt; gdy nikt nie dotknął – ta po stronie piłki. */
function loserByLastTouch(state: SimState): TeamId {
  const last = state.rally.lastToucher;
  return last === -1 ? state.rally.sideOfBall : teamOf(last);
}

/** @returns true, gdy piłka odbiła się od siatki (pozycja z nie jest już ciągła z prev). */
function collideNet(state: SimState): boolean {
  const ball = state.ball;
  const z = ball.pos.z;
  if (prev.z === 0 || Math.sign(z) === Math.sign(prev.z)) return false;
  const belowTop = ball.pos.y - BALL_R < NET_HEIGHT;
  if (belowTop && Math.abs(ball.pos.x) <= NET_HALF_W) {
    // Cofamy na stronę, z której piłka leciała – odbicie, wymiana trwa.
    // Cały wektor × √0,4, żeby utrata energii wynosiła 60 % (docs/20 §5) niezależnie od kąta
    // wpadnięcia – osobne tłumienie składowych stycznych zachowywało do 64 % przy stromym torze.
    ball.pos.z = Math.sign(prev.z) * NET_STANDOFF_Z;
    ball.vel.z = -ball.vel.z * BALL_NET_SPEED_FACTOR;
    ball.vel.x *= BALL_NET_SPEED_FACTOR;
    ball.vel.y *= BALL_NET_SPEED_FACTOR;
    state.events.push({ type: 'net' });
    return true;
  }
  if (state.rally.phase === 'rally') {
    // Przejście nad siatką (albo poza słupkami): piłka zmienia stronę, licznik odbić od zera,
    // lastToucher zostaje – to on odpowiada za aut. Strona z kierunku lotu, nie z sideOf(z):
    // piłka może skończyć tick dokładnie na z = 0, a wtedy sideOf(0) zwraca drużynę 0
    // niezależnie od kierunku i następny tick (prev.z === 0) przejścia już nie wykryje.
    state.rally.sideOfBall = otherTeam(sideOf(prev.z));
    state.rally.touches = 0;
    if (belowTop) awardPoint(state, otherTeam(loserByLastTouch(state)), 'under-net');
  }
  return false;
}

function collideFloor(state: SimState, netBounced: boolean): void {
  const ball = state.ball;
  if (ball.pos.y - BALL_R > 0) return;
  // Punkt dotknięcia z interpolacji między krokami – aut ocenia się tam, gdzie piłka
  // faktycznie dotknęła podłogi, nie tam, gdzie zastał ją koniec ticku.
  let x = ball.pos.x;
  let z = ball.pos.z;
  const yPrev = prev.y - BALL_R;
  const yCur = ball.pos.y - BALL_R;
  if (!netBounced && yPrev > 0 && yPrev - yCur > 1e-12) {
    const f = yPrev / (yPrev - yCur);
    x = prev.x + (ball.pos.x - prev.x) * f;
    z = prev.z + (ball.pos.z - prev.z) * f;
  }
  ball.pos.x = x;
  ball.pos.y = BALL_R;
  ball.pos.z = z;

  if (state.rally.phase === 'rally') {
    const inCourt = isInCourt(x, z, BALL_R);
    state.events.push({ type: 'floor', pos: { x, z }, inCourt });
    if (inCourt) awardPoint(state, otherTeam(state.rally.sideOfBall), 'floor-in');
    else awardPoint(state, otherTeam(loserByLastTouch(state)), 'floor-out');
  }

  // Odbicie od podłogi – tylko wygląd (faza point); tarcie przy każdym dotknięciu,
  // więc piłka szybko się zatrzymuje zamiast toczyć w nieskończoność.
  if (ball.vel.y < 0) ball.vel.y = -ball.vel.y * BALL_FLOOR_RESTITUTION;
  ball.vel.x *= BALL_FLOOR_FRICTION;
  ball.vel.z *= BALL_FLOOR_FRICTION;
  if (ball.vel.y < BALL_REST_VY) ball.vel.y = 0;
  if (Math.sqrt(ball.vel.x * ball.vel.x + ball.vel.z * ball.vel.z) < BALL_REST_VXZ) {
    ball.vel.x = 0;
    ball.vel.z = 0;
  }
}

function collideBodies(state: SimState): void {
  const ball = state.ball;
  for (const p of state.players) {
    // Tryb asysty (decyzja Dawida 2026-09-26): kapsuły pary człowieka nie odbijają piłki –
    // asysta stawia zawodnika na torze, a bez stuknięcia drużyna gracza nie może odbić piłki.
    if (state.assist && p.team === 0) continue;
    // Po własnym uderzeniu kapsuła nie koliduje; w oknie zamachu rozstrzyga contact.ts.
    if (p.lastHitTick >= 0 && state.tick - p.lastHitTick < BODY_IMMUNITY_TICKS) continue;
    if (isSwingActive(state, p)) continue;

    // Kapsuła = odcinek od PLAYER_R do PLAYER_H − PLAYER_R nad stopami + promień PLAYER_R.
    const bottom = p.pos.y + PLAYER_R;
    const top = p.pos.y + PLAYER_H - PLAYER_R;
    const cy = clamp(ball.pos.y, bottom, top);
    const dx = ball.pos.x - p.pos.x;
    const dy = ball.pos.y - cy;
    const dz = ball.pos.z - p.pos.z;
    const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (d >= BODY_HIT_DIST) continue;

    let nx = 0;
    let ny = 1;
    let nz = 0;
    if (d > 1e-9) {
      nx = dx / d;
      ny = dy / d;
      nz = dz / d;
    }
    const zBefore = ball.pos.z;
    ball.pos.x = p.pos.x + nx * BODY_HIT_DIST;
    ball.pos.y = cy + ny * BODY_HIT_DIST;
    ball.pos.z = p.pos.z + nz * BODY_HIT_DIST;
    if (ball.pos.y < BALL_R) ball.pos.y = BALL_R;
    // Wypchnięcie nie może przenieść piłki na drugą stronę płaszczyzny siatki: zawodnik
    // przy siatce (|z| = 0,35) wypycha o 0,405 m, a collideNet już w tym ticku nie zadziała –
    // sideOfBall zostałby stary i punkt poszedłby do złej drużyny. Piłka zostaje tuż przy
    // siatce po swojej stronie; ewentualne przejście wykryje collideNet w następnym ticku.
    if (ball.pos.z !== 0 && Math.sign(ball.pos.z) !== (zBefore > 0 ? 1 : -1)) {
      ball.pos.z = (zBefore > 0 ? 1 : -1) * NET_STANDOFF_Z;
    }

    const rvx = ball.vel.x - p.vel.x;
    const rvy = ball.vel.y - p.vel.y;
    const rvz = ball.vel.z - p.vel.z;
    const vn = rvx * nx + rvy * ny + rvz * nz;
    if (vn < 0) {
      const j = (1 + BALL_BODY_RESTITUTION) * vn;
      ball.vel.x -= j * nx;
      ball.vel.y -= j * ny;
      ball.vel.z -= j * nz;
    }
    registerPassiveTouch(state, p);
  }
}

/** Krok toru i wszystkie kolizje piłki w jednym ticku. */
export function stepBallAndCollide(state: SimState): void {
  const ball = state.ball;
  if (ball.held !== -1) {
    heldBallPosition(ball.pos, state.players[ball.held]);
    ball.vel.x = 0;
    ball.vel.y = 0;
    ball.vel.z = 0;
    return;
  }
  prev.x = ball.pos.x;
  prev.y = ball.pos.y;
  prev.z = ball.pos.z;
  stepBall(ball.pos, ball.vel);
  const netBounced = collideNet(state);
  collideFloor(state, netBounced);
  collideBodies(state);
}
