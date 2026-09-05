/**
 * Budowanie scenariuszy testowych sim: piłka w locie do punktu, zawodnik w miejscu,
 * przebieg N ticków z komendami i zbieraniem zdarzeń.
 */
import {
  BALL_R,
  createSimState,
  launchVelocity,
  sideOf,
  step,
  type Command,
  type PlayerId,
  type SimEvent,
  type SimState,
  type TeamId,
  type Vec2,
  type Vec3,
} from '../../src/sim';

export function makeState(seed = 1, servingTeam: TeamId = 0, humanControl = true): SimState {
  return createSimState({ seed, servingTeam, humanControl });
}

/** Stawia zawodnika w punkcie, bez prędkości i bez ruchu. */
export function placePlayer(state: SimState, id: PlayerId, x: number, z: number): void {
  const p = state.players[id];
  p.pos.x = x;
  p.pos.y = 0;
  p.pos.z = z;
  p.vel.x = 0;
  p.vel.y = 0;
  p.vel.z = 0;
  p.grounded = true;
  p.move.x = 0;
  p.move.z = 0;
}

export interface RallyOpts {
  touches?: number;
  lastToucher?: PlayerId | -1;
  sideOfBall?: TeamId;
}

/** Przełącza stan w fazę rally z piłką w podanym miejscu i prędkości (omija serwis). */
export function setRallyBall(state: SimState, pos: Vec3, vel: Vec3, opts: RallyOpts = {}): void {
  state.rally.phase = 'rally';
  state.rally.phaseTick = state.tick;
  state.ball.held = -1;
  state.ball.pos = { ...pos };
  state.ball.vel = { ...vel };
  state.rally.touches = opts.touches ?? 0;
  state.rally.lastToucher = opts.lastToucher ?? -1;
  state.rally.sideOfBall = opts.sideOfBall ?? sideOf(pos.z);
  // Serwujący już nie trzyma piłki – immunitet z serwisu też nie obowiązuje.
  for (const p of state.players) p.lastHitTick = -1;
}

/** Piłka wystrzelona z `from` tak, by po czasie T wylądować (środek na y = BALL_R) w `to`. */
export function launchBallTo(
  state: SimState,
  from: Vec3,
  to: Vec2,
  T: number,
  opts: RallyOpts = {},
): Vec3 {
  const vel = launchVelocity(from, { x: to.x, y: BALL_R, z: to.z }, T);
  setRallyBall(state, from, vel, opts);
  return vel;
}

export interface TickEvent {
  tick: number;
  event: SimEvent;
}

/**
 * Wykonuje N ticków; `commandsAt(tick)` daje komendy dla danego ticku.
 * Zwraca wszystkie zdarzenia z tickiem, w którym zaszły (tick sprzed inkrementacji).
 */
export function run(
  state: SimState,
  ticks: number,
  commandsAt?: (tick: number, state: SimState) => Command[] | undefined,
  onTick?: (state: SimState, tickBefore: number) => void,
): TickEvent[] {
  const out: TickEvent[] = [];
  for (let i = 0; i < ticks; i++) {
    const t = state.tick;
    const cmds = commandsAt?.(t, state) ?? [];
    step(state, cmds);
    for (const event of state.events) out.push({ tick: t, event });
    onTick?.(state, t);
  }
  return out;
}

/** Wykonuje ticki aż zajdzie zdarzenie danego typu (albo skończy się limit). */
export function runUntil(
  state: SimState,
  type: SimEvent['type'],
  maxTicks: number,
  commandsAt?: (tick: number, state: SimState) => Command[] | undefined,
): { found: TickEvent | null; events: TickEvent[] } {
  const events: TickEvent[] = [];
  for (let i = 0; i < maxTicks; i++) {
    const t = state.tick;
    step(state, commandsAt?.(t, state) ?? []);
    let found: TickEvent | null = null;
    // Cały tick trafia do listy – zdarzenie `point` idzie tuż za `floor` w tym samym ticku.
    for (const event of state.events) {
      const te = { tick: t, event };
      events.push(te);
      if (event.type === type && !found) found = te;
    }
    if (found) return { found, events };
  }
  return { found: null, events };
}

export function ofType<T extends SimEvent['type']>(
  events: TickEvent[],
  type: T,
): (TickEvent & { event: Extract<SimEvent, { type: T }> })[] {
  return events.filter((e) => e.event.type === type) as (TickEvent & {
    event: Extract<SimEvent, { type: T }>;
  })[];
}

/** Komenda serwisu z siłą (jak AI) – serwis natychmiast. */
export function serveCommand(state: SimState, power: number, aim: Vec2 | null = null): Command {
  return { type: 'swing', player: state.rally.server, aim, power };
}

export function swing(player: PlayerId, aim: Vec2 | null = null, power?: number): Command {
  return power === undefined
    ? { type: 'swing', player, aim }
    : { type: 'swing', player, aim, power };
}

export function release(player: PlayerId): Command {
  return { type: 'release', player };
}

export function move(player: PlayerId, x: number, z: number): Command {
  return { type: 'move', player, x, z };
}

/** Odległość środka piłki od odcinka kapsuły zawodnika (do testów przenikania). */
export function ballCapsuleDistance(state: SimState, id: PlayerId, r: number, h: number): number {
  const p = state.players[id];
  const b = state.ball.pos;
  const bottom = p.pos.y + r;
  const top = p.pos.y + h - r;
  const cy = Math.min(Math.max(b.y, bottom), top);
  const dx = b.x - p.pos.x;
  const dy = b.y - cy;
  const dz = b.z - p.pos.z;
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}
