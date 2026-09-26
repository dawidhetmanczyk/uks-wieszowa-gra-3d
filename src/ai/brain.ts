/**
 * Mózg AI – jeden algorytm dla partnera i rywali (docs/20 §6, docs/22 §6).
 *
 * Trzy warstwy, każda liczona wyłącznie z danych sim (nigdy z zegara):
 * 1. percepcja – co `reactionTicks` odczyt lądowania z błędem; między odczytami
 *    AI „widzi” stary punkt, bo tak działa czas reakcji;
 * 2. rola w parze – kto idzie do piłki, kto na wystawę / atak / asekurację;
 *    liczona raz na tick dla drużyny, z histerezą, żeby dwójka nie wymieniała
 *    się rolami co tick;
 * 3. komendy – ruch do celu roli, zamach gdy piłka wchodzi w zasięg, serwis po
 *    opóźnieniu.
 *
 * Stan AI jest zwykłym obiektem bez metod (JSON), więc razem ze stanem sim daje
 * pełny obraz meczu i da się go porównać w testach determinizmu.
 */
import type { Command, PlayerId, PlayerState, SimState, TeamId, Vec2 } from '../sim/index';
import {
  AI_SERVE_DELAY_S,
  ALL_PLAYERS,
  attackSpot,
  basePosition,
  canReach,
  clamp,
  clampTargetToOpponentHalf,
  COURT_HALF_L,
  COURT_HALF_W,
  defaultAttackTarget,
  distXZ,
  DT,
  MAX_TOUCHES,
  nextRange,
  nextTriangular,
  partnerOf,
  PLAYER_MAX_SPEED,
  playersOf,
  positionAt,
  REACH_TOP_STANDING,
  reachWindow,
  seedRng,
  setterSpot,
  sideSign,
  slotOf,
  teamOf,
  TICK_HZ,
} from '../sim/index';
import type { AiProfile } from './profile';
import {
  AI_ARRIVE_RADIUS_M,
  AI_COURT_MARGIN_M,
  AI_DUMP_PARTNER_DIST_M,
  AI_DUMP_POWER,
  AI_JUMP_LEAD_S,
  AI_MIN_NET_DIST_M,
  AI_MOVE_QUANTUM,
  AI_PASS_POWER,
  AI_RELEASE_TIMEOUT_S,
  AI_ROLE_HYSTERESIS_S,
  AI_STAND_BEHIND_INTERCEPT_M,
  AI_STAND_BEHIND_M,
  AI_SWING_LEAD_S,
  AI_YIELD_MARGIN_S,
  NOWICJUSZ,
} from './profile';

/**
 * Rola zawodnika w bieżącym ticku:
 * - idle: stoi (set-over, człowiek w parze);
 * - serve: serwujący czeka na swój serwis;
 * - base / cover: pozycja bazowa (piłka po drugiej stronie, asekuracja przed 3. odbiciem);
 * - ball: idzie do piłki i odbija;
 * - setter: przed 1. odbiciem – miejsce rozgrywającego;
 * - attacker: przed 2. odbiciem – miejsce ataku.
 */
export type AiRole = 'idle' | 'serve' | 'base' | 'ball' | 'setter' | 'attacker' | 'cover';

export interface PlayerBrain {
  id: PlayerId;
  /** Tick ostatniego odczytu lądowania; -1 = nigdy. */
  lastReadTick: number;
  /** Postrzegany punkt (z błędem) albo null, gdy piłka nie leci: lądowanie przed atakiem, inaczej punkt przyjęcia. */
  perceived: Vec2 | null;
  /** Tick lądowania z ostatniego odczytu (bez błędu); -1 gdy brak. */
  perceivedLandingTick: number;
  /** Ile metrów za postrzeganym punktem stanąć (zależy od tego, który punkt odczytano). */
  perceivedBehindM: number;
  role: AiRole;
  /** Ostatni wysłany wektor move (po kwantyzacji) – nowa komenda tylko przy zmianie. */
  lastMove: Vec2;
  /** Tick wysłania bieżącego zamachu; -1 = brak. */
  swingTick: number;
  /** Czy dla bieżącego zamachu poszło już release. */
  releaseSent: boolean;
  /** phaseTick fazy serwisu, w której ten zawodnik już zaserwował; -1 = brak. */
  servedPhaseTick: number;
  /** Ostatni tick, w którym AI sterowało tym zawodnikiem; -1 = nigdy. */
  lastControlledTick: number;
}

export interface TeamBrain {
  /** Kto z pary idzie do piłki; -1 = nikt (piłka po drugiej stronie, brak percepcji, ustępujemy człowiekowi). */
  chaser: PlayerId | -1;
}

export interface AiState {
  /** Stan mulberry32 – własny strumień, niezależny od sim (docs/20 §3.4). */
  rng: number;
  profile: AiProfile;
  brains: [PlayerBrain, PlayerBrain, PlayerBrain, PlayerBrain];
  teams: [TeamBrain, TeamBrain];
  /** Ostatni tick sim, dla którego liczono komendy; -1 = nigdy. */
  lastTick: number;
}

/** Stała mieszana z ziarnem meczu: AI i sim mają osobne strumienie losowości z tego samego seeda. */
const AI_SEED_MIX = 0x5bd1e995;
const SERVE_DELAY_TICKS = Math.round(AI_SERVE_DELAY_S * TICK_HZ);
const SWING_LEAD_TICKS = Math.round(AI_SWING_LEAD_S * TICK_HZ);
const JUMP_LEAD_TICKS = Math.round(AI_JUMP_LEAD_S * TICK_HZ);
const RELEASE_TIMEOUT_TICKS = Math.round(AI_RELEASE_TIMEOUT_S * TICK_HZ);
/** Odwrotność kwantu jako liczba całkowita – dzielenie przez nią daje „ładne” ułamki (0.78, nie 0.7800000001). */
const MOVE_STEPS = Math.round(1 / AI_MOVE_QUANTUM);

function createBrain(id: PlayerId): PlayerBrain {
  return {
    id,
    lastReadTick: -1,
    perceived: null,
    perceivedLandingTick: -1,
    perceivedBehindM: 0,
    role: 'idle',
    lastMove: { x: 0, z: 0 },
    swingTick: -1,
    releaseSent: false,
    servedPhaseTick: -1,
    lastControlledTick: -1,
  };
}

/** Własny strumień losowości: ziarno meczu zmieszane stałą, żeby AI i sim nie ciągnęły tych samych liczb. */
export function createAi(seed: number, profile: AiProfile = NOWICJUSZ): AiState {
  return {
    rng: seedRng(seed ^ AI_SEED_MIX),
    // Kopia, żeby późniejsza zmiana obiektu profilu u wołającego nie zmieniła przebiegu meczu.
    profile: {
      ...profile,
      servePower: [profile.servePower[0], profile.servePower[1]],
      attackPower: [profile.attackPower[0], profile.attackPower[1]],
    },
    brains: [createBrain(0), createBrain(1), createBrain(2), createBrain(3)],
    teams: [{ chaser: -1 }, { chaser: -1 }],
    lastTick: -1,
  };
}

/**
 * Komendy AI dla zawodników z `controlled` na bieżący tick. Nie mutuje sim.
 * Iteracja zawsze w kolejności id 0..3 – porządek losowań musi być stały.
 */
export function aiCommands(ai: AiState, sim: SimState, controlled: readonly PlayerId[]): Command[] {
  const out: Command[] = [];

  // Tick cofnął się = nowy set albo powtórka: mózgi pamiętają nieistniejący mecz.
  // Strumień losowości też startuje od ziarna nowego meczu – inaczej ten sam seed
  // dawałby inny przebieg zależnie od tego, co AI grało wcześniej.
  if (sim.tick < ai.lastTick) {
    ai.rng = seedRng(sim.seed ^ AI_SEED_MIX);
    ai.brains = [createBrain(0), createBrain(1), createBrain(2), createBrain(3)];
    ai.teams = [{ chaser: -1 }, { chaser: -1 }];
  }
  ai.lastTick = sim.tick;

  // Każdy kontakt zmienia tor: to, co AI zapamiętało, jest już nieprawdą. Nowy
  // odczyt przyjdzie w swoim rytmie – tak wygląda czas reakcji na uderzenie.
  const ballHit = sim.events.some((e) => e.type === 'contact');

  for (const team of [0, 1] as const) {
    const [a, b] = playersOf(team);
    const ca = controlled.includes(a);
    const cb = controlled.includes(b);
    if (!ca && !cb) continue;
    if (ca) perceive(ai, sim, a, ballHit);
    if (cb) perceive(ai, sim, b, ballHit);
    assignRoles(ai, sim, team, controlled);
  }

  for (const id of ALL_PLAYERS) {
    if (controlled.includes(id)) act(ai, sim, id, out);
  }
  return out;
}

// Percepcja ---------------------------------------------------------------

function perceive(ai: AiState, sim: SimState, id: PlayerId, ballHit: boolean): void {
  const brain = ai.brains[id];
  if (ballHit) {
    brain.perceived = null;
    brain.perceivedLandingTick = -1;
  }
  const period = Math.max(1, Math.round(ai.profile.reactionTicks));
  // Przesunięcie fazowe per zawodnik: czwórka nie reaguje w tym samym ticku.
  const offset = Math.floor((id * period) / 4);
  const due = brain.lastReadTick < 0 || (sim.tick + offset) % period === 0;
  if (!due) return;
  brain.lastReadTick = sim.tick;

  const flying = sim.rally.phase === 'rally' && sim.ball.held === -1;
  const landing = sim.landing;
  if (!flying || !landing.valid || landing.hitsNet) {
    brain.perceived = null;
    brain.perceivedLandingTick = -1;
    return;
  }
  const err = ai.profile.positionErrorM;
  const ex = nextTriangular(ai) * err;
  const ez = nextTriangular(ai) * err;
  // Przed własnym 3. odbiciem (atak) kontakt ma być wysoko – celem jest lądowanie.
  // W pozostałych przypadkach (przyjęcie, obrona) – punkt, gdzie piłka przecina 1,1 m:
  // przy płaskim torze leży metry przed lądowaniem, a stojąc na lądowaniu zawodnik
  // dostaje piłkę przy kolanach na ~40 ms.
  const attacking = sim.rally.sideOfBall === teamOf(id) && sim.rally.touches === 2;
  const point = attacking ? landing.pos : landing.intercept;
  brain.perceived = { x: point.x + ex, z: point.z + ez };
  brain.perceivedLandingTick = landing.tick;
  brain.perceivedBehindM = attacking ? AI_STAND_BEHIND_M : AI_STAND_BEHIND_INTERCEPT_M;
}

// Role w parze -------------------------------------------------------------

/** Czy postrzegany punkt leży po naszej stronie (z tolerancją na błąd odczytu tuż przy siatce). */
function perceivedOnOwnSide(perceived: Vec2, team: TeamId): boolean {
  return sideSign(team) * perceived.z > -AI_STAND_BEHIND_M;
}

/** Czas dojścia do postrzeganego lądowania; Infinity = ten zawodnik nie może iść do piłki. */
function arrivalTime(ai: AiState, sim: SimState, id: PlayerId): number {
  const brain = ai.brains[id];
  if (brain.perceived === null) return Infinity;
  // Drugi kontakt z rzędu tego samego zawodnika to punkt dla rywali – nie kandyduje.
  if (sim.rally.lastToucher === id) return Infinity;
  if (!perceivedOnOwnSide(brain.perceived, teamOf(id))) return Infinity;
  return distXZ(sim.players[id].pos, brain.perceived) / ai.profile.maxSpeed;
}

/**
 * „Nie zabieraj gry” (docs/20 §3.2, docs/22 §6): partner idzie do piłki tylko,
 * gdy człowiek nie zdąży albo nie może (już ją dotknął). Ocena z percepcji
 * partnera – to on decyduje, a nie wszechwiedzący sim.
 */
function partnerShouldChase(
  sim: SimState,
  human: PlayerId,
  partner: PlayerId,
  ai: AiState,
): boolean {
  // Tryb asysty F0b: pierwsze odbicie naszej akcji należy do człowieka – bez jego stuknięcia
  // drużyna gracza nie może odbić piłki (decyzja Dawida, pomiar „gra nie gra sama”). Asysta
  // i tak prowadzi aktywnego do piłki, więc ratunek partnera przestaje być potrzebny.
  const team = teamOf(partner);
  if (sim.assist && !(sim.rally.sideOfBall === team && sim.rally.touches > 0)) return false;
  const pb = ai.brains[partner];
  if (pb.perceived === null) return false;
  if (sim.rally.lastToucher === partner) return false;
  if (!perceivedOnOwnSide(pb.perceived, team)) return false;
  if (sim.rally.lastToucher === human) return true;
  const timeToLanding = Math.max(0, (pb.perceivedLandingTick - sim.tick) / TICK_HZ);
  const humanTime = distXZ(sim.players[human].pos, pb.perceived) / PLAYER_MAX_SPEED;
  return humanTime > timeToLanding + AI_YIELD_MARGIN_S;
}

/**
 * Dotychczasowy „do piłki” zostaje, o ile wolno mu jeszcze dotknąć piłki. Używane,
 * gdy para nie ma świeżego odczytu (czas reakcji po kontakcie) – brak danych to nie
 * powód, żeby zmieniać decyzję.
 */
function keepChaser(sim: SimState, chaser: PlayerId | -1): PlayerId | -1 {
  return chaser !== -1 && sim.rally.lastToucher !== chaser ? chaser : -1;
}

/** Role „miejscowe” – zawodnik stoi albo idzie na stałe miejsce, nie do piłki. */
function isPositional(role: AiRole): boolean {
  return role === 'setter' || role === 'attacker' || role === 'cover' || role === 'base';
}

/** Miejsce drugiego z pary wg numeru nadchodzącego odbicia. */
function roleByTouches(touches: number): AiRole {
  if (touches === 0) return 'setter';
  if (touches === 1) return 'attacker';
  return 'cover';
}

function roleFor(
  id: PlayerId,
  brain: PlayerBrain,
  chaser: PlayerId | -1,
  human: PlayerId | -1,
  touches: number,
): AiRole {
  if (id === chaser) return 'ball';
  if (id === human) return 'idle';
  if (brain.perceived === null) {
    // Czas reakcji po kontakcie (odczyt jeszcze nie przyszedł): dotychczasowe miejsce
    // zostaje – bieg do bazy po każdym odbiciu rozbijał ustawienie pary na ~0,25 s.
    if (isPositional(brain.role)) return brain.role;
    // Zawodnik, który właśnie odbił (albo zaserwował): miejsce wg numeru odbicia;
    // przy 0 odbić (po serwisie, po ataku rywali) – baza, bo nie wiadomo, gdzie piłka poleci.
    return touches === 0 ? 'base' : roleByTouches(touches);
  }
  // Odczyt mówi, że piłka leci na drugą stronę (własny serwis albo atak przed przelotem
  // nad siatką) i nikt z pary do niej nie idzie: baza, nie miejsce rozgrywającego.
  if (chaser === -1 && !perceivedOnOwnSide(brain.perceived, teamOf(id))) return 'base';
  return roleByTouches(touches);
}

function assignRoles(
  ai: AiState,
  sim: SimState,
  team: TeamId,
  controlled: readonly PlayerId[],
): void {
  const [a, b] = playersOf(team);
  const tb = ai.teams[team];
  const ba = ai.brains[a];
  const bb = ai.brains[b];
  const phase = sim.rally.phase;

  if (phase === 'serve') {
    tb.chaser = -1;
    ba.role = sim.rally.server === a ? 'serve' : 'base';
    bb.role = sim.rally.server === b ? 'serve' : 'base';
    return;
  }
  if (phase !== 'rally') {
    tb.chaser = -1;
    // Po punkcie dwójka wraca do bazy; po secie stoi.
    const role: AiRole = phase === 'point' ? 'base' : 'idle';
    ba.role = role;
    bb.role = role;
    return;
  }

  const landing = sim.landing;
  const incoming =
    sim.rally.sideOfBall === team || (landing.valid && sideSign(team) * landing.pos.z > 0);
  // Po naszych trzech odbiciach czwarte i tak jest błędem – lepiej dać piłce spaść.
  // Licznik dotyczy strony, po której jest piłka: trzy odbicia RYWALI to ich atak,
  // do którego trzeba ruszyć, zanim piłka przeleci nad siatką.
  const ourSideExhausted = sim.rally.sideOfBall === team && sim.rally.touches >= MAX_TOUCHES;
  if (!incoming || ourSideExhausted) {
    tb.chaser = -1;
    ba.role = 'base';
    bb.role = 'base';
    return;
  }

  // Człowiek w parze = ten, kogo AI nie steruje. Gdy loop każe sterować obydwoma
  // (AI vs AI), zasada „nie zabieraj gry” nie ma adresata.
  const human: PlayerId | -1 =
    sim.humanControl && teamOf(sim.active) === team && !controlled.includes(sim.active)
      ? sim.active
      : -1;

  if (human !== -1) {
    const partner = partnerOf(human);
    tb.chaser =
      ai.brains[partner].perceived === null
        ? keepChaser(sim, tb.chaser)
        : partnerShouldChase(sim, human, partner, ai)
          ? partner
          : -1;
  } else {
    const ta = arrivalTime(ai, sim, a);
    const tbb = arrivalTime(ai, sim, b);
    let chaser: PlayerId | -1 = -1;
    if (ta < Infinity || tbb < Infinity) {
      // Histereza na rzecz aktualnego: zmiana tylko, gdy drugi jest wyraźnie szybszy.
      if (tb.chaser === a && ta <= tbb + AI_ROLE_HYSTERESIS_S) chaser = a;
      else if (tb.chaser === b && tbb <= ta + AI_ROLE_HYSTERESIS_S) chaser = b;
      else chaser = ta <= tbb ? a : b;
    } else if (ba.perceived === null || bb.perceived === null) {
      // Para nie ma pełnego odczytu (czas reakcji po kontakcie): decyzja zostaje.
      chaser = keepChaser(sim, tb.chaser);
    }
    tb.chaser = chaser;
  }

  const touches = sim.rally.touches;
  ba.role = roleFor(a, ba, tb.chaser, human, touches);
  bb.role = roleFor(b, bb, tb.chaser, human, touches);
}

// Komendy ------------------------------------------------------------------

function quantize(v: number): number {
  const q = Math.round(v * MOVE_STEPS) / MOVE_STEPS;
  return q === 0 ? 0 : q; // bez -0 w nagraniach
}

/** Kwantyzacja w dół (ku zeru) – nigdy nie wydłuża składowej. */
function quantizeDown(v: number): number {
  const q = Math.trunc(v * MOVE_STEPS) / MOVE_STEPS;
  return q === 0 ? 0 : q;
}

/**
 * Wektor move na siatce AI_MOVE_QUANTUM o długości ≤ `limit`. Zaokrąglenie per składowa
 * potrafi wydłużyć wektor (0,7889 zamiast 0,7826 → sim biegłby 3,63 m/s zamiast 3,6);
 * wtedy skalujemy do limitu i ucinamy w dół, żeby na pewno go nie przekroczyć.
 */
function quantizeMove(v: Vec2, limit: number): Vec2 {
  let x = quantize(v.x);
  let z = quantize(v.z);
  const l = Math.sqrt(x * x + z * z);
  if (l > limit) {
    const k = limit / l;
    x = quantizeDown(x * k);
    z = quantizeDown(z * k);
  }
  return { x, z };
}

/** Cel zostaje na własnej połowie i w rozsądnej odległości od linii. */
function clampToOwnHalf(target: Vec2, team: TeamId): Vec2 {
  const s = sideSign(team);
  const zAbs = clamp(s * target.z, AI_MIN_NET_DIST_M, COURT_HALF_L + AI_COURT_MARGIN_M);
  const xMax = COURT_HALF_W + AI_COURT_MARGIN_M;
  return { x: clamp(target.x, -xMax, xMax), z: s * zAbs };
}

/** Ułamek prędkości sim, jaki wolno zadać profilowi (sim skaluje move × PLAYER_MAX_SPEED). */
function speedLimit(maxSpeed: number): number {
  return Math.min(1, maxSpeed / PLAYER_MAX_SPEED);
}

/** Wektor move do celu: pełna prędkość profilu, zero w promieniu dojścia. */
function moveToward(player: PlayerState, target: Vec2, limit: number): Vec2 {
  const dx = target.x - player.pos.x;
  const dz = target.z - player.pos.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d <= AI_ARRIVE_RADIUS_M) return { x: 0, z: 0 };
  const s = limit / d;
  return { x: dx * s, z: dz * s };
}

/** Cel „między rywalami” z szumem profilu, przycięty do boiska rywali. */
function noisyTarget(ai: AiState, sim: SimState, team: TeamId): Vec2 {
  const base = defaultAttackTarget(sim, team);
  const n = ai.profile.noiseM;
  const x = base.x + nextTriangular(ai) * n;
  const z = base.z + nextTriangular(ai) * n;
  return clampTargetToOpponentHalf({ x, z }, team);
}

/** Cel i siła odbicia w roli „do piłki” (docs/22 §6 „Zamach”). */
function chooseShot(ai: AiState, sim: SimState, id: PlayerId): { aim: Vec2 | null; power: number } {
  const team = teamOf(id);
  if (sim.rally.touches >= MAX_TOUCHES - 1) {
    // Trzecie odbicie: atak.
    const aim = noisyTarget(ai, sim, team);
    const [lo, hi] = ai.profile.attackPower;
    return { aim, power: nextRange(ai, lo, hi) };
  }
  // Przyjęcie / wystawa do partnera – chyba że partner jest za daleko od miejsca ataku, wtedy kiwka.
  const partnerPos = sim.players[partnerOf(id)].pos;
  if (distXZ(partnerPos, attackSpot(team, partnerPos.x)) > AI_DUMP_PARTNER_DIST_M) {
    return { aim: defaultAttackTarget(sim, team), power: AI_DUMP_POWER };
  }
  return { aim: null, power: AI_PASS_POWER };
}

/**
 * Piłka jest w zasięgu albo wejdzie w niego w czasie wyprzedzenia. Gdy wejdzie od góry
 * (wyżej niż zasięg z ziemi), sim zrobi auto-skok, a ten musi ruszyć o czas wznoszenia
 * wcześniej – zamach otwieramy więc z większym wyprzedzeniem, inaczej kontakt wypada
 * tuż nad ziemią i atak jest lobem.
 */
function ballWithinLead(sim: SimState, id: PlayerId): boolean {
  if (canReach(sim, id)) return true;
  const w = reachWindow(sim, id);
  if (w === null || w.exitTick < sim.tick) return false;
  const untilEnter = w.enterTick - sim.tick;
  const player = sim.players[id];
  const atEnter = positionAt(sim.ball.pos, sim.ball.vel, untilEnter * DT);
  const needsJump = atEnter.y - player.pos.y > REACH_TOP_STANDING;
  return untilEnter <= (needsJump ? JUMP_LEAD_TICKS : SWING_LEAD_TICKS);
}

function act(ai: AiState, sim: SimState, id: PlayerId, out: Command[]): void {
  const brain = ai.brains[id];
  const player = sim.players[id];
  const team = teamOf(id);

  // Zawodnik dopiero co przejęty przez AI (np. po przełączeniu aktywnego): jego
  // move w sim mógł ustawić człowiek albo wyzerować sim – synchronizacja, żeby
  // „komenda tylko przy zmianie” dalej znaczyła zmianę.
  if (brain.lastControlledTick !== sim.tick - 1) {
    brain.lastMove = { x: quantize(player.move.x), z: quantize(player.move.z) };
    brain.swingTick = -1;
    brain.releaseSent = false;
  } else if (player.move.x !== brain.lastMove.x || player.move.z !== brain.lastMove.z) {
    // Ktoś zmienił move za plecami AI (sim zeruje go przy active-switch, także w AI vs AI).
    // Bez tej synchronizacji zawodnik stałby, aż zmieni się jego cel.
    brain.lastMove = { x: quantize(player.move.x), z: quantize(player.move.z) };
  }
  brain.lastControlledTick = sim.tick;

  // Release: tick po kontakcie albo po limicie trzymania (docs/22 §6). Sprawdzane PRZED
  // zamknięciem zamachu poniżej – kontakt czyści zamach w sim w tym samym ticku, więc
  // odwrotna kolejność gubiła release po każdym trafieniu.
  if (brain.swingTick >= 0 && !brain.releaseSent && sim.tick > brain.swingTick) {
    const justHit = player.lastHitTick === sim.tick - 1;
    const timedOut = sim.tick - brain.swingTick >= RELEASE_TIMEOUT_TICKS;
    if (justHit || timedOut) {
      out.push({ type: 'release', player: id });
      brain.releaseSent = true;
    }
  }
  // Sim zamknął okno zamachu (kontakt, pudło, koniec łaski) → wolno zamachnąć się znów.
  if (brain.swingTick >= 0 && sim.tick > brain.swingTick && player.swingStartTick === -1) {
    brain.swingTick = -1;
    brain.releaseSent = false;
  }
  const canSwing =
    brain.swingTick < 0 && player.swingStartTick === -1 && player.cooldownUntilTick <= sim.tick;

  let target: Vec2 | null = null;
  switch (brain.role) {
    case 'serve': {
      const rally = sim.rally;
      if (
        canSwing &&
        brain.servedPhaseTick !== rally.phaseTick &&
        sim.tick - rally.phaseTick >= SERVE_DELAY_TICKS
      ) {
        const aim = noisyTarget(ai, sim, team);
        const [lo, hi] = ai.profile.servePower;
        out.push({ type: 'swing', player: id, aim, power: nextRange(ai, lo, hi) });
        brain.servedPhaseTick = rally.phaseTick;
        brain.swingTick = sim.tick;
        brain.releaseSent = false;
      }
      break;
    }
    case 'ball': {
      // „Do piłki” bez odczytu = czas reakcji po kontakcie kogoś innego: stoi, aż zobaczy,
      // gdzie piłka poleciała (bieg do bazy oddalał go od akcji).
      if (brain.perceived === null) break;
      target = clampToOwnHalf(
        { x: brain.perceived.x, z: brain.perceived.z + sideSign(team) * brain.perceivedBehindM },
        team,
      );
      if (canSwing && ballWithinLead(sim, id)) {
        const shot = chooseShot(ai, sim, id);
        out.push({ type: 'swing', player: id, aim: shot.aim, power: shot.power });
        brain.swingTick = sim.tick;
        brain.releaseSent = false;
      }
      break;
    }
    case 'setter':
      target = setterSpot(team, player.pos.x);
      break;
    case 'attacker':
      target = attackSpot(team, player.pos.x);
      break;
    case 'base':
    case 'cover':
      target = basePosition(team, slotOf(id));
      break;
    case 'idle':
      break;
  }

  const limit = speedLimit(ai.profile.maxSpeed);
  const desired = target === null ? { x: 0, z: 0 } : moveToward(player, target, limit);
  const q = quantizeMove(desired, limit);
  if (q.x !== brain.lastMove.x || q.z !== brain.lastMove.z) {
    out.push({ type: 'move', player: id, x: q.x, z: q.z });
    brain.lastMove = q;
  }
}
