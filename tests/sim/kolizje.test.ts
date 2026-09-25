import { describe, expect, it } from 'vitest';
import {
  BALL_R,
  BODY_IMMUNITY_S,
  PLAYER_H,
  PLAYER_R,
  TICK_HZ,
  type SimEvent,
  type SimState,
} from '../../src/sim';
import {
  ballCapsuleDistance,
  launchBallTo,
  makeState,
  move,
  ofType,
  placePlayer,
  run,
  setRallyBall,
  type TickEvent,
} from './pomocnicze';

const IMMUNITY_TICKS = Math.round(BODY_IMMUNITY_S * TICK_HZ);

/** Niezmienniki „brak przenikania” sprawdzane po każdym ticku. */
function checkInvariants(state: SimState, tickBefore: number, prevBallZ: number): void {
  if (state.ball.held === -1) {
    expect(state.ball.pos.y).toBeGreaterThanOrEqual(BALL_R - 1e-6);
    for (const p of state.players) {
      const immune = p.lastHitTick >= 0 && tickBefore - p.lastHitTick < IMMUNITY_TICKS;
      const swinging = p.swingStartTick >= 0;
      if (immune || swinging) continue;
      expect(ballCapsuleDistance(state, p.id, PLAYER_R, PLAYER_H)).toBeGreaterThanOrEqual(
        PLAYER_R + BALL_R - 0.03,
      );
    }
    if (state.events.some((e) => e.type === 'net')) {
      expect(Math.sign(state.ball.pos.z)).toBe(Math.sign(prevBallZ));
    }
  }
  for (const p of state.players) expect(Math.abs(p.pos.z)).toBeGreaterThanOrEqual(PLAYER_R);
  const d01 = Math.hypot(
    state.players[0].pos.x - state.players[1].pos.x,
    state.players[0].pos.z - state.players[1].pos.z,
  );
  const d23 = Math.hypot(
    state.players[2].pos.x - state.players[3].pos.x,
    state.players[2].pos.z - state.players[3].pos.z,
  );
  expect(d01).toBeGreaterThanOrEqual(2 * PLAYER_R - 0.05);
  expect(d23).toBeGreaterThanOrEqual(2 * PLAYER_R - 0.05);
}

function runChecked(state: SimState, ticks: number, commandsAt?: Parameters<typeof run>[2]) {
  let prevZ = state.ball.pos.z;
  return run(
    state,
    ticks,
    (t, s) => {
      prevZ = s.ball.pos.z;
      return commandsAt?.(t, s) ?? [];
    },
    (s, t) => {
      checkInvariants(s, t, prevZ);
    },
  );
}

/** Jak runChecked, ale zatrzymuje się na pierwszym zdarzeniu danego typu (cały tick trafia do listy). */
function runCheckedUntil(state: SimState, type: SimEvent['type'], maxTicks: number) {
  const events: TickEvent[] = [];
  for (let i = 0; i < maxTicks; i++) {
    const tick = runChecked(state, 1);
    events.push(...tick);
    const found = tick.find((e) => e.event.type === type);
    if (found) return { found, events, ticks: i + 1 };
  }
  return { found: null, events, ticks: maxTicks };
}

describe('kolizje – brak przenikania', () => {
  it('piłka spuszczona na głowę stojącego zawodnika odbija się i liczy jako bierny kontakt', () => {
    const state = makeState(21);
    placePlayer(state, 0, -1, -5);
    setRallyBall(state, { x: -1 + 0.05, y: 3.0, z: -5 }, { x: 0, y: 0, z: 0 }, { lastToucher: 2 });
    const TOTAL = 240;
    const { found, events, ticks } = runCheckedUntil(state, 'contact', TOTAL);
    expect(found).not.toBeNull();
    const contact = ofType(events, 'contact');
    expect(contact).toHaveLength(1);
    expect(contact[0]!.event.kind).toBe('passive');
    expect(contact[0]!.event.player).toBe(0);
    expect(contact[0]!.event.quality).toBe(0);
    expect(contact[0]!.event.touchNo).toBe(1);
    // Zaraz po kontakcie księgowość jest jednoznaczna: pierwsze odbicie zawodnika 0, akcja trwa.
    expect(state.rally.lastToucher).toBe(0);
    expect(state.rally.touches).toBe(1);
    expect(state.rally.phase).toBe('rally');
    expect(ofType(events, 'point')).toHaveLength(0);
    // Piłka odbiła się od głowy w górę (nie przeniknęła i nie przykleiła się).
    expect(state.ball.vel.y).toBeGreaterThan(0);
    expect(state.ball.pos.y).toBeGreaterThan(PLAYER_H);
    // Reszta przebiegu tylko z niezmiennikami – co dalej z piłką, nie jest tu tematem.
    runChecked(state, TOTAL - ticks);
  });

  it('piłka wystrzelona w siatkę z obu stron odbija się na tę samą stronę', () => {
    for (const side of [-1, 1] as const) {
      const state = makeState(22);
      for (const p of state.players) p.pos.x = p.team === 0 ? -6 : 6;
      // Płasko, nisko, w środek siatki.
      launchBallTo(state, { x: 0, y: 1.2, z: side * 4 }, { x: 0, z: -side * 4 }, 1.0, {
        lastToucher: side < 0 ? 0 : 2,
      });
      const events = runChecked(state, 240);
      const net = ofType(events, 'net');
      expect(net.length).toBeGreaterThanOrEqual(1);
      // Po odbiciu piłka jest po stronie, z której leciała.
      const netTick = net[0]!.tick;
      const floor = ofType(events, 'floor')[0];
      expect(floor).toBeDefined();
      expect(floor!.tick).toBeGreaterThan(netTick);
      expect(Math.sign(floor!.event.pos.z)).toBe(side);
    }
  });

  it('piłka rzucona w podłogę nie przenika i zatrzymuje się', () => {
    const state = makeState(23);
    setRallyBall(state, { x: 1, y: 2, z: -5 }, { x: 2, y: -8, z: 3 }, { lastToucher: 3 });
    const events = runChecked(state, 600);
    expect(ofType(events, 'floor')).toHaveLength(1);
    expect(ofType(events, 'point')).toHaveLength(1);
    // Po pauzie: serwis – piłka w ręce. Wcześniej leżała spokojnie na podłodze.
    expect(state.rally.phase).toBe('serve');
  });

  it('piłka rzucona w podłogę w fazie point toczy się i zatrzymuje bez drgań', () => {
    const state = makeState(24);
    setRallyBall(state, { x: 1, y: 2, z: -5 }, { x: 2, y: -8, z: 3 }, { lastToucher: 3 });
    // Trzymamy fazę point sztucznie długo – pauza „nigdy się nie kończy” przez zmianę phaseTick.
    // Piłka z 9 m/s odbija się na 2 m i potrzebuje ~5 s, żeby się uspokoić.
    runChecked(state, 30);
    const events = runChecked(state, 900, () => {
      state.rally.phaseTick = state.tick; // pauza nigdy się nie kończy
      return [];
    });
    expect(ofType(events, 'floor')).toHaveLength(0);
    expect(state.rally.phase).toBe('point');
    expect(Math.abs(state.ball.vel.x) + Math.abs(state.ball.vel.z)).toBeLessThan(1e-6);
    expect(state.ball.pos.y).toBeCloseTo(BALL_R, 6);
  });

  it('zawodnik biegnący na partnera nie nachodzi na niego, biegnący do siatki nie przechodzi', () => {
    const state = makeState(25);
    placePlayer(state, 0, -1, -6);
    placePlayer(state, 1, 1, -6);
    placePlayer(state, 2, -1, 6);
    placePlayer(state, 3, 1, 6);
    // Piłka wysoko w górze, żeby nie przeszkadzała: spada po ~2,8 s, a wznowienie (teleport
    // do pozycji serwisu) przyszłoby dopiero 1,5 s później – po końcu testu.
    setRallyBall(state, { x: 0, y: 30, z: -8.5 }, { x: 0, y: 0, z: 0 }, { lastToucher: 2 });
    runChecked(state, 360, (t) => {
      if (t === 0) return [move(0, 1, 0), move(2, 0, -1), move(3, 0, -1)];
      if (t === 180) return [move(0, 0, 1), move(1, 0, 1)];
      return [];
    });
    // Zawodnik 0 pcha partnera – obaj przesunęli się w prawo, ale nie nachodzą.
    expect(state.players[1].pos.x).toBeGreaterThan(1);
    // Rywale biegnący do siatki stoją przy niej po swojej stronie.
    expect(state.players[2].pos.z).toBeGreaterThanOrEqual(PLAYER_R);
    expect(state.players[2].pos.z).toBeLessThan(0.5);
  });
});
