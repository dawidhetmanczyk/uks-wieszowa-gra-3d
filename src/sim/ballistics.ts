/**
 * Balistyka piłki z tłumieniem liniowym: dv/dt = a − k·v, a = (0, −G, 0).
 *
 * Krok całkowany DOKŁADNIE (rozwiązanie analityczne na odcinku dt), więc:
 * - `stepBall` w sim i `predictLanding` liczą identyczny tor bit w bit,
 * - `launchVelocity` daje prędkość, po której piłka wyląduje dokładnie w celu
 *   po czasie T (bez iteracji).
 *
 *   v(t) = a/k + (v0 − a/k)·e^(−kt)
 *   p(t) = p0 + (a/k)·t + (v0 − a/k)·(1 − e^(−kt))/k
 */
import {
  BALL_DRAG as K,
  BALL_R,
  DT,
  GRAVITY as G,
  NET_CLEARANCE,
  NET_HALF_W,
  NET_HEIGHT,
} from './constants';
import type { LandingPrediction, Vec3 } from './types';

/** e^(−k·dt) – stała kroku. */
export const E_DT = Math.exp(-K * DT);
/** (1 − e^(−k·dt))/k – „efektywny dt” dla składowej prędkości. */
export const F_DT = (1 - E_DT) / K;
/** Składowa y wektora a/k (prędkość graniczna spadania, ze znakiem). */
export const AK_Y = -G / K;

/** Jeden krok toru swobodnego. Mutuje pos i vel. */
export function stepBall(pos: Vec3, vel: Vec3): void {
  pos.x += vel.x * F_DT;
  pos.y += AK_Y * DT + (vel.y - AK_Y) * F_DT;
  pos.z += vel.z * F_DT;
  vel.x *= E_DT;
  vel.y = AK_Y + (vel.y - AK_Y) * E_DT;
  vel.z *= E_DT;
}

/** Prędkość początkowa, po której piłka z `from` znajdzie się w `to` po czasie T. */
export function launchVelocity(from: Vec3, to: Vec3, T: number): Vec3 {
  const c = K / (1 - Math.exp(-K * T));
  return {
    x: (to.x - from.x) * c,
    y: AK_Y + (to.y - from.y - AK_Y * T) * c,
    z: (to.z - from.z) * c,
  };
}

/** Czas lotu dla łuku o apogeum ~`apex` metrów nad punktem startu (przybliżenie bez tłumienia). */
export function flightTimeForApex(from: Vec3, to: Vec3, apex: number): number {
  const up = Math.sqrt((2 * Math.max(apex, 0.05)) / G);
  const drop = Math.max(from.y + apex - to.y, 0.05);
  const down = Math.sqrt((2 * drop) / G);
  return up + down;
}

/** Łuk „miękki” (przyjęcie, wystawa): trafia w `to` z apogeum ~`apex` nad startem. */
export function solveArc(from: Vec3, to: Vec3, apex: number): Vec3 {
  return launchVelocity(from, to, flightTimeForApex(from, to, apex));
}

/** Czas, po którym tor przecina płaszczyznę z = 0; null gdy nie przecina. */
export function timeToNetPlane(from: Vec3, vel: Vec3): number | null {
  if (from.z === 0) return 0;
  if (vel.z === 0 || Math.sign(vel.z) === Math.sign(from.z)) return null;
  // z(t) = z0 + vz·(1 − e^(−kt))/k = 0 → e^(−kt) = 1 + k·z0/vz
  const inner = 1 + (K * from.z) / vel.z;
  if (inner <= 0) return null; // tłumienie zatrzyma piłkę przed siatką
  return -Math.log(inner) / K;
}

/** Wysokość i x piłki po czasie t swobodnego lotu. */
export function positionAt(from: Vec3, vel: Vec3, t: number): Vec3 {
  const f = (1 - Math.exp(-K * t)) / K;
  return {
    x: from.x + vel.x * f,
    y: from.y + AK_Y * t + (vel.y - AK_Y) * f,
    z: from.z + vel.z * f,
  };
}

/** Czy tor z `from` z prędkością `vel` przechodzi nad siatką z zapasem (albo jej nie dotyka). */
export function clearsNet(from: Vec3, vel: Vec3): boolean {
  const t = timeToNetPlane(from, vel);
  if (t === null) return true;
  const p = positionAt(from, vel, t);
  if (Math.abs(p.x) > NET_HALF_W) return true;
  return p.y - BALL_R >= NET_HEIGHT + NET_CLEARANCE;
}

/**
 * Strzał „twardy” (atak, serwis): najpłaszczy łuk do `to`, którego prędkość
 * początkowa nie przekracza `speed` i który przechodzi nad siatką.
 * Skanuje czas lotu od krótkiego do długiego; gdy żaden łuk nie mieści się
 * w prędkości (cel za daleko), bierze łuk o najmniejszej prędkości.
 */
export function solveShot(from: Vec3, to: Vec3, speed: number): Vec3 {
  const T_MIN = 0.2;
  const T_MAX = 3.0;
  const STEP = 1 / 60;
  let best: Vec3 | null = null;
  let bestSpeed = Infinity;
  for (let T = T_MIN; T <= T_MAX; T += STEP) {
    const v = launchVelocity(from, to, T);
    const s = Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
    if (s <= speed && clearsNet(from, v)) return v;
    if (s < bestSpeed && clearsNet(from, v)) {
      bestSpeed = s;
      best = v;
    }
  }
  return best ?? launchVelocity(from, to, 1.0);
}

/** Maksymalny czas przewidywania toru (s). */
export const PREDICT_MAX_S = 6;

/**
 * Przewidywane lądowanie: całkuje tor tym samym krokiem co sim (bez zawodników).
 * Zatrzymuje się na podłodze albo na siatce (ten sam warunek co kolizja w sim:
 * przejście przez z = 0 poniżej NET_HEIGHT w pasie |x| ≤ NET_HALF_W).
 * `tick` = tick bezwzględny, jeśli podasz `nowTick`.
 */
export function predictLanding(
  pos: Vec3,
  vel: Vec3,
  nowTick: number,
  out?: LandingPrediction,
): LandingPrediction {
  const res: LandingPrediction = out ?? {
    valid: false,
    pos: { x: 0, z: 0 },
    tick: 0,
    hitsNet: false,
  };
  const p = { x: pos.x, y: pos.y, z: pos.z };
  const v = { x: vel.x, y: vel.y, z: vel.z };
  const maxSteps = Math.round(PREDICT_MAX_S / DT);
  for (let i = 1; i <= maxSteps; i++) {
    const prevZ = p.z;
    stepBall(p, v);
    if (p.y - BALL_R <= 0) {
      res.valid = true;
      res.pos.x = p.x;
      res.pos.z = p.z;
      res.tick = nowTick + i;
      res.hitsNet = false;
      return res;
    }
    if (prevZ !== 0 && Math.sign(p.z) !== Math.sign(prevZ) && Math.abs(p.x) <= NET_HALF_W) {
      if (p.y - BALL_R < NET_HEIGHT) {
        res.valid = true;
        res.pos.x = p.x;
        res.pos.z = prevZ; // punkt przy siatce po stronie, z której leciała
        res.tick = nowTick + i;
        res.hitsNet = true;
        return res;
      }
    }
  }
  res.valid = false;
  res.hitsNet = false;
  return res;
}
