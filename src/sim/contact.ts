/**
 * Model uderzenia „przytrzymaj do kontaktu” (docs/22 §3): okno zamachu, zasięg,
 * jakość timingu, siła z czasu trzymania, rodzaj kontaktu, cel z szumem,
 * prędkość wyjściowa, auto-skok, pudło. Także serwis i bierny kontakt (zasady).
 *
 * Jedyne miejsce, w którym sim sięga po PRNG – szum celu. Każdy kontakt pobiera
 * dokładnie dwie liczby (także przy zerowym szumie), żeby strumień losowości
 * nie zależał od jakości i dało się go rozumować w testach.
 */
import { clearsNet, positionAt, solveArc, solveShot } from './ballistics';
import {
  ATTACK_SPEED_MAX,
  ATTACK_SPEED_MIN,
  AUTO_JUMP_ABOVE,
  AUTO_JUMP_H_EXTRA,
  AUTO_JUMP_MAX_VY,
  AUTO_JUMP_TOP_EXTRA,
  BALL_R,
  BAND_ATTACK,
  BAND_RECEIVE,
  BAND_SET,
  COURT_HALF_L,
  COURT_HALF_W,
  DEFAULT_TARGET_MIN_Z,
  DT,
  JUMP_SPEED,
  NOISE_MAX_PLAYER_M,
  OWN_TARGET_MIN_Z,
  PLAYER_GRAVITY,
  POWER_FULL_HOLD_S,
  POWER_MIN_HOLD_S,
  QUALITY_EDGE,
  REACH_BOTTOM,
  REACH_H,
  REACH_TOP_JUMP,
  REACH_TOP_STANDING,
  RECEIVE_APEX,
  SERVE_LOB_APEX_MAX,
  SERVE_LOB_APEX_MIN,
  SERVE_LOB_POWER,
  SERVE_SPEED_MAX,
  SERVE_SPEED_MIN,
  SET_APEX,
  SWING_GRACE_S,
  SWING_HOLD_MAX_S,
  SWING_WHIFF_COOLDOWN_S,
  TICK_HZ,
} from './constants';
import { startJump } from './players';
import { nextTriangular } from './prng';
import { awardPoint, checkTouchRules } from './rules';
import {
  attackSpot,
  clampTargetToOpponentHalf,
  opponentsOf,
  otherTeam,
  partnerOf,
  setterSpot,
  sideSign,
} from './spots';
import { inReach, REACH_RADIUS } from './predict';
import type { HitKind, PlayerState, SimState, TeamId, Vec2, Vec3 } from './types';
import { clamp, lerp } from './vec';

const HOLD_MAX_TICKS = SWING_HOLD_MAX_S * TICK_HZ;
const GRACE_TICKS = SWING_GRACE_S * TICK_HZ;
const WHIFF_COOLDOWN_TICKS = Math.round(SWING_WHIFF_COOLDOWN_S * TICK_HZ);

// Komendy ----------------------------------------------------------------

export function clearSwing(p: PlayerState): void {
  p.swingStartTick = -1;
  p.swingReleaseTick = -1;
  p.swingPower = null;
}

/** Początek zamachu. Ignorowany w pauzie, w blokadzie po pudle, w trakcie zamachu
 *  i w fazie serwisu przez kogoś innego niż serwujący. */
export function beginSwing(
  state: SimState,
  p: PlayerState,
  aim: Vec2 | null,
  power: number | undefined,
): void {
  const phase = state.rally.phase;
  if (phase === 'point' || phase === 'set-over') return;
  if (phase === 'serve' && p.id !== state.rally.server) return;
  if (state.tick < p.cooldownUntilTick) return;
  if (p.swingStartTick >= 0) return;
  p.swingStartTick = state.tick;
  p.swingReleaseTick = -1;
  p.swingPower = power === undefined ? null : clamp(power, 0, 1);
  setAim(p, aim);
}

export function releaseSwing(state: SimState, p: PlayerState): void {
  if (p.swingStartTick < 0 || p.swingReleaseTick >= 0) return;
  p.swingReleaseTick = state.tick;
}

/** Cel można ustawiać zawsze – także przed zamachem (celownik prowadzi palec). */
export function setAim(p: PlayerState, aim: Vec2 | null): void {
  if (aim === null) {
    p.aim = null;
  } else if (p.aim === null) {
    p.aim = { x: aim.x, z: aim.z };
  } else {
    p.aim.x = aim.x;
    p.aim.z = aim.z;
  }
}

// Okno, siła, jakość -----------------------------------------------------

/** Ręce w górze: trzyma (≤ SWING_HOLD_MAX_S) albo puścił przed chwilą (≤ SWING_GRACE_S). */
export function isSwingActive(state: SimState, p: PlayerState): boolean {
  if (p.swingStartTick < 0) return false;
  if (p.swingReleaseTick < 0) return state.tick - p.swingStartTick <= HOLD_MAX_TICKS;
  return state.tick - p.swingReleaseTick <= GRACE_TICKS;
}

/** Czas trzymania (w tickach) do teraz albo do puszczenia. */
export function holdTicks(state: SimState, p: PlayerState): number {
  const end = p.swingReleaseTick < 0 ? state.tick : p.swingReleaseTick;
  return end - p.swingStartTick;
}

/** Siła 0..1 z czasu trzymania: ≤ POWER_MIN_HOLD_S → 0 (plas), ≥ POWER_FULL_HOLD_S → 1 (bomba). */
export function powerFromHold(ticks: number): number {
  const s = ticks * DT;
  return clamp((s - POWER_MIN_HOLD_S) / (POWER_FULL_HOLD_S - POWER_MIN_HOLD_S), 0, 1);
}

function heightBand(kind: HitKind): readonly [number, number] {
  switch (kind) {
    case 'receive':
      return BAND_RECEIVE;
    case 'set':
      return BAND_SET;
    default:
      return BAND_ATTACK;
  }
}

/**
 * Jakość timingu 0..1 (docs/22 §3 pkt 3): odległość pozioma (1 w osi, QUALITY_EDGE
 * na krawędzi) × pasmo wysokości rodzaju (1 w pasmie, liniowo do QUALITY_EDGE na granicy zasięgu).
 */
export function timingQuality(horizontalDist: number, relHeight: number, kind: HitKind): number {
  const h = clamp(horizontalDist / REACH_RADIUS, 0, 1);
  const fH = 1 - (1 - QUALITY_EDGE) * h;
  const [lo, hi] = heightBand(kind);
  let fV = 1;
  if (relHeight < lo) {
    fV = QUALITY_EDGE + (1 - QUALITY_EDGE) * ((relHeight - REACH_BOTTOM) / (lo - REACH_BOTTOM));
  } else if (relHeight > hi && hi < REACH_TOP_STANDING) {
    fV =
      QUALITY_EDGE +
      (1 - QUALITY_EDGE) * ((REACH_TOP_STANDING - relHeight) / (REACH_TOP_STANDING - hi));
  }
  return clamp(fH * clamp(fV, QUALITY_EDGE, 1), 0, 1);
}

// Cele ---------------------------------------------------------------------

/** „Między rywalami”: środek odcinka między rywalami, przycięty do ich połowy, ≥ 2 m od siatki. */
export function defaultAttackTarget(state: SimState, team: TeamId): Vec2 {
  const [a, b] = opponentsOf(team);
  const pa = state.players[a].pos;
  const pb = state.players[b].pos;
  const t = clampTargetToOpponentHalf({ x: (pa.x + pb.x) / 2, z: (pa.z + pb.z) / 2 }, team);
  const s = -sideSign(team);
  if (Math.abs(t.z) < DEFAULT_TARGET_MIN_Z) t.z = s * DEFAULT_TARGET_MIN_Z;
  return t;
}

/** Szum celu: NOISE_MAX_PLAYER_M × (1 − jakość), rozkład trójkątny, osobno x i z. */
function addNoise(state: SimState, target: Vec2, quality: number): void {
  const noise = NOISE_MAX_PLAYER_M * (1 - quality);
  const nx = nextTriangular(state);
  const nz = nextTriangular(state);
  target.x += nx * noise;
  target.z += nz * noise;
}

/** Przyjęcie i wystawa mają zostać po naszej stronie, w boisku, nie w siatce. */
function clampToOwnHalf(target: Vec2, team: TeamId): void {
  const s = sideSign(team);
  target.x = clamp(target.x, -COURT_HALF_W, COURT_HALF_W);
  target.z = s * clamp(Math.abs(target.z), OWN_TARGET_MIN_Z, COURT_HALF_L);
}

// Kontakt ------------------------------------------------------------------

function finishContact(
  state: SimState,
  p: PlayerState,
  kind: HitKind,
  quality: number,
  touchNo: number,
  target: Vec2,
  power: number,
): void {
  p.lastHitTick = state.tick;
  clearSwing(p);
  state.rally.touches = touchNo;
  state.rally.lastToucher = p.id;
  state.lastContact = {
    tick: state.tick,
    player: p.id,
    kind,
    quality,
    touchNo,
    target: { x: target.x, z: target.z },
    power,
  };
  state.events.push({ type: 'contact', player: p.id, kind, quality, touchNo });
}

const scratchTo: Vec3 = { x: 0, y: BALL_R, z: 0 };

/** Aktywny kontakt: piłka jest w zasięgu zawodnika z otwartym oknem zamachu. */
function performContact(state: SimState, p: PlayerState): void {
  const ball = state.ball;
  const rally = state.rally;
  const team = p.team;
  const touchNo = rally.touches + 1;
  // Rodzaj (docs/22 §3 pkt 7): 3. odbicie i każde z celem = atak; 1. = przyjęcie; 2. = wystawa.
  const kind: HitKind =
    touchNo >= 3 || p.aim !== null ? 'attack' : touchNo === 1 ? 'receive' : 'set';

  const dx = ball.pos.x - p.pos.x;
  const dz = ball.pos.z - p.pos.z;
  const quality = timingQuality(Math.sqrt(dx * dx + dz * dz), ball.pos.y - p.pos.y, kind);
  const power = p.swingPower ?? powerFromHold(holdTicks(state, p));
  const violation = checkTouchRules(state, p.id, touchNo);

  const partner = state.players[partnerOf(p.id)];
  let target: Vec2;
  if (kind === 'receive') target = setterSpot(team, partner.pos.x);
  else if (kind === 'set') target = attackSpot(team, partner.pos.x);
  else target = p.aim ? { x: p.aim.x, z: p.aim.z } : defaultAttackTarget(state, team);
  addNoise(state, target, quality);
  if (kind !== 'attack') clampToOwnHalf(target, team);

  scratchTo.x = target.x;
  scratchTo.y = BALL_R;
  scratchTo.z = target.z;
  let v: Vec3;
  if (kind === 'receive') v = solveArc(ball.pos, scratchTo, RECEIVE_APEX);
  else if (kind === 'set') v = solveArc(ball.pos, scratchTo, SET_APEX);
  else v = solveShot(ball.pos, scratchTo, lerp(ATTACK_SPEED_MIN, ATTACK_SPEED_MAX, power));
  ball.vel.x = v.x;
  ball.vel.y = v.y;
  ball.vel.z = v.z;

  finishContact(state, p, kind, quality, touchNo, target, power);
  // Piłka odlatuje jak zwykle (widać błąd), ale punkt idzie do rywali.
  if (violation) awardPoint(state, otherTeam(team), violation);
}

/**
 * Prędkość serwisu z siły: krótkie przytrzymanie = lob (wysoki łuk, jak serwis dzieci –
 * piłka opada stromo, więc pierścień lądowania jest miejscem przyjęcia), długie =
 * płaski strzał. Lob, który nie przeszedłby nad siatką (krótki cel), zastępuje strzał.
 */
function serveVelocity(from: Vec3, to: Vec3, power: number): Vec3 {
  if (power < SERVE_LOB_POWER) {
    const apex = lerp(SERVE_LOB_APEX_MAX, SERVE_LOB_APEX_MIN, power / SERVE_LOB_POWER);
    const lob = solveArc(from, to, apex);
    if (clearsNet(from, lob)) return lob;
  }
  const t = clamp((power - SERVE_LOB_POWER) / (1 - SERVE_LOB_POWER), 0, 1);
  return solveShot(from, to, lerp(SERVE_SPEED_MIN, SERVE_SPEED_MAX, t));
}

/** Serwis: jakość 1 (bez paska timingu w F0), siła z power albo czasu trzymania. */
function performServe(state: SimState, p: PlayerState, power: number): void {
  const ball = state.ball;
  const target = p.aim ? { x: p.aim.x, z: p.aim.z } : defaultAttackTarget(state, p.team);
  addNoise(state, target, 1);
  scratchTo.x = target.x;
  scratchTo.y = BALL_R;
  scratchTo.z = target.z;
  const v = serveVelocity(ball.pos, scratchTo, power);
  ball.vel.x = v.x;
  ball.vel.y = v.y;
  ball.vel.z = v.z;
  ball.held = -1;

  state.rally.phase = 'rally';
  state.rally.phaseTick = state.tick;
  state.rally.sideOfBall = p.team;
  finishContact(state, p, 'serve', 1, 0, target, power);
  // Serwis nie jest odbiciem – licznik po stronie serwujących zaczyna od zera.
  state.rally.touches = 0;
}

/**
 * Bierny kontakt (piłka trafiła w kapsułę bez zamachu) – liczy się jako odbicie
 * ze wszystkimi zasadami [F0]. Prędkość nadaje ball.ts; tu tylko księgowość.
 */
export function registerPassiveTouch(state: SimState, p: PlayerState): void {
  if (state.rally.phase !== 'rally') return;
  const touchNo = state.rally.touches + 1;
  const violation = checkTouchRules(state, p.id, touchNo);
  const target: Vec2 = { x: state.ball.pos.x, z: state.ball.pos.z };
  finishContact(state, p, 'passive', 0, touchNo, target, 0);
  if (violation) awardPoint(state, otherTeam(p.team), violation);
}

function whiff(state: SimState, p: PlayerState): void {
  clearSwing(p);
  p.cooldownUntilTick = state.tick + WHIFF_COOLDOWN_TICKS;
  state.events.push({ type: 'whiff', player: p.id });
}

/** Czas od odbicia do apogeum skoku (players.ts całkuje semi-implicit Euler – różnica ≤ 1 tick). */
const JUMP_RISE_S = JUMP_SPEED / PLAYER_GRAVITY;

/**
 * Auto-skok (docs/22 §3 pkt 6, doprecyzowany w F0): zawodnik ma być w apogeum, gdy
 * piłka schodzi do górnej granicy zasięgu, więc skok rusza wtedy, gdy piłka ZA CZAS
 * WZNOSZENIA znajdzie się nad głową w zasięgu skoku. Literalny warunek „piłka jest
 * teraz ≤ 3,25 m” dawał przy szybko opadającej wystawie (apogeum 3 m nad kontaktem)
 * kontakt 0,26 m nad ziemią i atak z 2,6 m – z tej wysokości żaden tor nie przechodzi
 * nad siatką szybciej niż ~10 m/s, więc siła uderzenia nie miała znaczenia.
 * Pozycja zawodnika w apogeum: prędkość pozioma w powietrzu jest zamrożona (players.ts).
 */
function maybeAutoJump(state: SimState, p: PlayerState): void {
  if (!p.grounded) return;
  const ball = state.ball;
  const rel = ball.pos.y - p.pos.y;
  // Piłka nisko – dosięgnie z ziemi (albo już minęła zawodnika).
  if (rel <= AUTO_JUMP_ABOVE) return;
  const top = REACH_TOP_JUMP + AUTO_JUMP_TOP_EXTRA;

  // 1. Skok „na czas”: w apogeum piłka będzie dokładnie nad zawodnikiem i w zasięgu.
  //    Promień bez zapasu – w powietrzu nie da się już poprawić pozycji, więc skok
  //    z niepewnej pozycji kończy się pudłem (zmierzone w AI vs AI).
  const ahead = positionAt(ball.pos, ball.vel, JUMP_RISE_S);
  const relAhead = ahead.y - p.pos.y;
  if (relAhead > AUTO_JUMP_ABOVE && relAhead <= top) {
    const dx = ahead.x - (p.pos.x + p.vel.x * JUMP_RISE_S);
    const dz = ahead.z - (p.pos.z + p.vel.z * JUMP_RISE_S);
    if (dx * dx + dz * dz <= REACH_RADIUS * REACH_RADIUS) {
      startJump(p);
      return;
    }
  }

  // 2. Reguła literalna z docs/22 §3 pkt 6 (piłka już blisko nad głową, opada albo jest
  //    przy apogeum): gdy zawodnik nie zdążył ustawić się pod piłkę, skacze późno –
  //    kontakt wypada niżej, ale jest.
  if (rel > top || ball.vel.y >= AUTO_JUMP_MAX_VY) return;
  const dx = ball.pos.x - p.pos.x;
  const dz = ball.pos.z - p.pos.z;
  const hMax = REACH_H + AUTO_JUMP_H_EXTRA;
  if (dx * dx + dz * dz > hMax * hMax) return;
  startJump(p);
}

function resolveServeSwing(state: SimState, p: PlayerState): void {
  let power: number | null = null;
  if (p.swingPower !== null) power = p.swingPower;
  else if (p.swingReleaseTick >= 0) power = powerFromHold(p.swingReleaseTick - p.swingStartTick);
  else if (state.tick - p.swingStartTick >= HOLD_MAX_TICKS) power = 1;
  if (power === null) return;
  performServe(state, p, power);
}

/** Rozstrzygnięcie zamachów wszystkich zawodników w kolejności 0..3. */
export function resolveSwings(state: SimState): void {
  for (const p of state.players) {
    if (p.swingStartTick < 0) continue;
    const phase = state.rally.phase;
    if (phase === 'serve') {
      if (p.id === state.rally.server) resolveServeSwing(state, p);
      else clearSwing(p);
      continue;
    }
    if (phase !== 'rally') {
      clearSwing(p);
      continue;
    }
    if (!isSwingActive(state, p)) {
      whiff(state, p);
      continue;
    }
    if (inReach(state.ball.pos, p.pos, p.team)) {
      performContact(state, p);
      continue;
    }
    maybeAutoJump(state, p);
  }
}
