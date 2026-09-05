/**
 * Tworzenie, kopiowanie i ustawianie stanu do serwisu.
 *
 * Stan jest zwykłym obiektem (docs/22 §1), więc kopia głęboka jest ręczna –
 * `structuredClone` nie istnieje w lib ES2022 bez DOM, a JSON gubi -1/null
 * niuanse i alokuje dużo. Ręczna kopia jest też najszybsza dla powtórek.
 */
import { BALL_R, SERVE_BALL_FORWARD, SERVE_BALL_HEIGHT } from './constants';
import { seedRng } from './prng';
import { basePosition, playersOf, servePosition, sideSign, slotOf, teamOf } from './spots';
import type { PlayerId, PlayerState, SimEvent, SimState, TeamId, Vec2, Vec3 } from './types';

export interface SimOptions {
  seed: number;
  servingTeam?: TeamId;
  humanControl?: boolean;
}

function createPlayer(id: PlayerId): PlayerState {
  const team = teamOf(id);
  const base = basePosition(team, slotOf(id));
  return {
    id,
    team,
    pos: { x: base.x, y: 0, z: base.z },
    vel: { x: 0, y: 0, z: 0 },
    grounded: true,
    // Na starcie każdy patrzy w stronę siatki (w głąb własnej połowy = −sideSign).
    facing: team === 0 ? 0 : Math.PI,
    move: { x: 0, z: 0 },
    aim: null,
    swingStartTick: -1,
    swingReleaseTick: -1,
    swingPower: null,
    cooldownUntilTick: 0,
    lastHitTick: -1,
  };
}

export function createSimState(opts: SimOptions): SimState {
  const servingTeam: TeamId = opts.servingTeam ?? 0;
  const humanControl = opts.humanControl ?? true;
  const state: SimState = {
    tick: 0,
    seed: opts.seed,
    rng: seedRng(opts.seed),
    players: [createPlayer(0), createPlayer(1), createPlayer(2), createPlayer(3)],
    ball: { pos: { x: 0, y: BALL_R, z: 0 }, vel: { x: 0, y: 0, z: 0 }, held: -1 },
    rally: {
      phase: 'serve',
      phaseTick: 0,
      servingTeam,
      server: playersOf(servingTeam)[0],
      touches: 0,
      lastToucher: -1,
      sideOfBall: servingTeam,
      pointWinner: -1,
      pointReason: null,
      servesByTeam: [0, 0],
    },
    score: { points: [0, 0], setWinner: -1 },
    active: 0,
    activeSinceTick: 0,
    humanControl,
    landing: {
      valid: false,
      pos: { x: 0, z: 0 },
      tick: 0,
      hitsNet: false,
      intercept: { x: 0, z: 0 },
      interceptTick: 0,
    },
    lastContact: null,
    events: [],
  };
  resetForServe(state, servingTeam);
  return state;
}

/**
 * Nowy set w istniejącym obiekcie stanu (komenda `new-set`) – pętla i HUD trzymają
 * referencję do stanu, więc podmieniamy pola, nie obiekt.
 */
export function resetSimState(state: SimState, opts: SimOptions): void {
  const fresh = createSimState(opts);
  Object.assign(state, fresh);
}

/** Pozycja piłki w ręce serwującego: na wysokości ręki, lekko w stronę siatki. */
export function heldBallPosition(out: Vec3, server: PlayerState): Vec3 {
  out.x = server.pos.x;
  out.y = server.pos.y + SERVE_BALL_HEIGHT;
  out.z = server.pos.z - sideSign(server.team) * SERVE_BALL_FORWARD;
  return out;
}

/**
 * Ustawia serwis drużyny `team`: wybiera serwującego naprzemiennie, rozstawia
 * czwórkę, wkłada piłkę do ręki i czyści zamachy. Wspólne dla startu setu
 * i wznowienia po punkcie (docs/22 §2).
 */
export function resetForServe(state: SimState, team: TeamId): void {
  const rally = state.rally;
  const pair = playersOf(team);
  const server = pair[(rally.servesByTeam[team] % 2) as 0 | 1];
  rally.servesByTeam[team]++;

  for (const p of state.players) {
    const spot: Vec2 =
      p.id === server ? servePosition(p.team, slotOf(p.id)) : basePosition(p.team, slotOf(p.id));
    p.pos.x = spot.x;
    p.pos.y = 0;
    p.pos.z = spot.z;
    p.vel.x = 0;
    p.vel.y = 0;
    p.vel.z = 0;
    p.grounded = true;
    p.facing = p.team === 0 ? 0 : Math.PI;
    p.aim = null;
    p.swingStartTick = -1;
    p.swingReleaseTick = -1;
    p.swingPower = null;
    p.cooldownUntilTick = 0;
    p.lastHitTick = -1;
  }

  rally.phase = 'serve';
  rally.phaseTick = state.tick;
  rally.servingTeam = team;
  rally.server = server;
  rally.touches = 0;
  rally.lastToucher = -1;
  rally.sideOfBall = team;
  rally.pointWinner = -1;
  rally.pointReason = null;

  const ball = state.ball;
  ball.held = server;
  heldBallPosition(ball.pos, state.players[server]);
  ball.vel.x = 0;
  ball.vel.y = 0;
  ball.vel.z = 0;

  state.landing.valid = false;
  state.landing.hitsNet = false;
  state.lastContact = null;
  // Gdy serwują niebiescy, człowiek steruje serwującym (może to być zawodnik 1).
  if (team === 0) state.active = server;
  state.activeSinceTick = state.tick;
  state.events.push({ type: 'serve-ready', server });
}

function clonePlayer(p: PlayerState): PlayerState {
  return {
    id: p.id,
    team: p.team,
    pos: { x: p.pos.x, y: p.pos.y, z: p.pos.z },
    vel: { x: p.vel.x, y: p.vel.y, z: p.vel.z },
    grounded: p.grounded,
    facing: p.facing,
    move: { x: p.move.x, z: p.move.z },
    aim: p.aim ? { x: p.aim.x, z: p.aim.z } : null,
    swingStartTick: p.swingStartTick,
    swingReleaseTick: p.swingReleaseTick,
    swingPower: p.swingPower,
    cooldownUntilTick: p.cooldownUntilTick,
    lastHitTick: p.lastHitTick,
  };
}

function cloneEvent(e: SimEvent): SimEvent {
  if (e.type === 'floor') return { ...e, pos: { x: e.pos.x, z: e.pos.z } };
  return { ...e };
}

/** Głęboka kopia stanu – powtórki, testy, snapshoty. */
export function cloneState(s: SimState): SimState {
  return {
    tick: s.tick,
    seed: s.seed,
    rng: s.rng,
    players: [
      clonePlayer(s.players[0]),
      clonePlayer(s.players[1]),
      clonePlayer(s.players[2]),
      clonePlayer(s.players[3]),
    ],
    ball: {
      pos: { x: s.ball.pos.x, y: s.ball.pos.y, z: s.ball.pos.z },
      vel: { x: s.ball.vel.x, y: s.ball.vel.y, z: s.ball.vel.z },
      held: s.ball.held,
    },
    rally: { ...s.rally, servesByTeam: [s.rally.servesByTeam[0], s.rally.servesByTeam[1]] },
    score: { points: [s.score.points[0], s.score.points[1]], setWinner: s.score.setWinner },
    active: s.active,
    activeSinceTick: s.activeSinceTick,
    humanControl: s.humanControl,
    landing: {
      valid: s.landing.valid,
      pos: { x: s.landing.pos.x, z: s.landing.pos.z },
      tick: s.landing.tick,
      hitsNet: s.landing.hitsNet,
      intercept: { x: s.landing.intercept.x, z: s.landing.intercept.z },
      interceptTick: s.landing.interceptTick,
    },
    lastContact: s.lastContact
      ? { ...s.lastContact, target: { x: s.lastContact.target.x, z: s.lastContact.target.z } }
      : null,
    events: s.events.map(cloneEvent),
  };
}
