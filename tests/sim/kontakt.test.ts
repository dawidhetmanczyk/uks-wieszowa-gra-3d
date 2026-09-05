import { describe, expect, it } from 'vitest';
import {
  attackSpot,
  canReach,
  defaultAttackTarget,
  reachWindow,
  setterSpot,
  SWING_HOLD_MAX_S,
  SWING_WHIFF_COOLDOWN_S,
  TICK_HZ,
  type SimState,
} from '../../src/sim';
import { powerFromHold } from '../../src/sim/contact';
import { inReach } from '../../src/sim/predict';
import { stepBall } from '../../src/sim/ballistics';
import {
  launchBallTo,
  makeState,
  ofType,
  placePlayer,
  release,
  run,
  runUntil,
  setRallyBall,
  swing,
} from './pomocnicze';

const HOLD_MAX_TICKS = Math.round(SWING_HOLD_MAX_S * TICK_HZ);
const COOLDOWN_TICKS = Math.round(SWING_WHIFF_COOLDOWN_S * TICK_HZ);

/** Po kontakcie: gdzie piłka faktycznie spadła (zdarzenie floor). */
function landAfterContact(state: SimState) {
  const { found } = runUntil(state, 'floor', 720);
  expect(found).not.toBeNull();
  return (found!.event as Extract<NonNullable<typeof found>['event'], { type: 'floor' }>).pos;
}

describe('kontakt', () => {
  it('swing gdy piłka w zasięgu → contact z jakością w (0, 1]', () => {
    const state = makeState(61);
    placePlayer(state, 0, -1, -5);
    setRallyBall(state, { x: -1 + 0.5, y: 1.0, z: -5 }, { x: 0, y: -1, z: 0 }, { lastToucher: 2 });
    const ev = run(state, 1, () => [swing(0)]);
    const contact = ofType(ev, 'contact');
    expect(contact).toHaveLength(1);
    expect(contact[0]!.event.quality).toBeGreaterThan(0);
    expect(contact[0]!.event.quality).toBeLessThanOrEqual(1);
    expect(contact[0]!.event.kind).toBe('receive');
    expect(state.players[0].swingStartTick).toBe(-1);
    expect(state.players[0].lastHitTick).toBe(0);
  });

  it('swing gdy piłka daleko → whiff po SWING_HOLD_MAX_S i blokada zamachu', () => {
    const state = makeState(62);
    placePlayer(state, 0, -1, -5);
    // Piłka wysoko i daleko, spadnie po długim czasie.
    setRallyBall(state, { x: 4, y: 12, z: -8 }, { x: 0, y: 3, z: 0 }, { lastToucher: 2 });
    const ev = run(state, HOLD_MAX_TICKS + 2, (t) => (t === 0 ? [swing(0)] : []));
    const whiff = ofType(ev, 'whiff');
    expect(whiff).toHaveLength(1);
    expect(whiff[0]!.tick).toBe(HOLD_MAX_TICKS + 1);
    expect(state.players[0].cooldownUntilTick).toBe(HOLD_MAX_TICKS + 1 + COOLDOWN_TICKS);
    // W blokadzie zamach jest ignorowany, po niej działa.
    run(state, 1, () => [swing(0)]);
    expect(state.players[0].swingStartTick).toBe(-1);
    run(state, COOLDOWN_TICKS, () => []);
    run(state, 1, () => [swing(0)]);
    expect(state.players[0].swingStartTick).toBeGreaterThan(0);
  });

  it('tapnięcie (swing + release w tym ticku), piłka w zasięgu za 0,08 s → kontakt', () => {
    const state = makeState(63);
    placePlayer(state, 0, 0, -6);
    // Piłka spada z boku; w zasięg STOJĄCEGO (2,35 m) wejdzie po ~10 tickach.
    const from = { x: 0.6, y: 2.6, z: -6 };
    const vel = { x: 0, y: -3, z: 0 };
    setRallyBall(state, from, vel, { lastToucher: 2 });
    let standingEnter = -1;
    const p = { ...from };
    const v = { ...vel };
    for (let i = 1; i <= 30 && standingEnter < 0; i++) {
      stepBall(p, v);
      if (inReach(p, state.players[0].pos, 0)) standingEnter = i;
    }
    expect(standingEnter).toBeGreaterThan(5);
    expect(standingEnter).toBeLessThanOrEqual(14);
    // reachWindow zakłada skok, więc dla niego piłka jest w zasięgu od razu.
    const win = reachWindow(state, 0);
    expect(win).not.toBeNull();
    expect(win!.enterTick).toBe(state.tick);
    const ev = run(state, 30, (t) => (t === 0 ? [swing(0), release(0)] : []));
    const contact = ofType(ev, 'contact');
    expect(contact).toHaveLength(1);
    expect(contact[0]!.tick).toBeLessThanOrEqual(standingEnter);
    expect(ofType(ev, 'whiff')).toHaveLength(0);
  });

  it('siła z czasu trzymania: 0,08 s → ~0, 0,6 s → 1', () => {
    expect(powerFromHold(Math.round(0.08 * TICK_HZ))).toBeLessThan(0.02);
    expect(powerFromHold(Math.round(0.6 * TICK_HZ))).toBe(1);
    expect(powerFromHold(Math.round(0.34 * TICK_HZ))).toBeCloseTo(0.5, 1);

    // Integracja: zamach zaczyna się N ticków przed wejściem piłki w zasięg.
    const attackAt = (holdTicks: number) => {
      const state = makeState(64);
      placePlayer(state, 0, 0, -6);
      launchBallTo(state, { x: 0, y: 1.5, z: 4 }, { x: 0, z: -6.3 }, 1.6, { lastToucher: 2 });
      const win = reachWindow(state, 0)!;
      expect(win).not.toBeNull();
      const start = win.enterTick - holdTicks;
      expect(start).toBeGreaterThan(0);
      const ev = run(state, win.exitTick + 5, (t) =>
        t === start ? [swing(0, { x: 0, z: 5 })] : [],
      );
      const contact = ofType(ev, 'contact');
      expect(contact).toHaveLength(1);
      expect(contact[0]!.event.kind).toBe('attack');
      return state.lastContact!.power;
    };
    expect(attackAt(Math.round(0.08 * TICK_HZ))).toBeLessThan(0.1);
    expect(attackAt(Math.round(0.6 * TICK_HZ) + 2)).toBe(1);
  });

  it('1. odbicie bez celu przy idealnym timingu ląduje dokładnie na setterSpot', () => {
    const state = makeState(65);
    placePlayer(state, 0, -2.25, -6);
    placePlayer(state, 1, 1.5, -5);
    for (const id of [2, 3] as const) state.players[id].pos.x = 6;
    setRallyBall(state, { x: -2.25, y: 1.2, z: -6 }, { x: 0, y: -1, z: 0 }, { lastToucher: 2 });
    const ev = run(state, 1, () => [swing(0)]);
    const contact = ofType(ev, 'contact')[0]!.event;
    expect(contact.kind).toBe('receive');
    expect(contact.quality).toBe(1);
    const expected = setterSpot(0, state.players[1].pos.x);
    expect(state.lastContact!.target).toEqual(expected);
    // Partner stoi z boku, więc piłka nie trafia w niego – spada tam, gdzie miała.
    state.players[1].pos.x = -4;
    const land = landAfterContact(state);
    expect(Math.abs(land.x - expected.x)).toBeLessThan(0.02);
    expect(Math.abs(land.z - expected.z)).toBeLessThan(0.02);
  });

  it('2. odbicie bez celu ląduje na attackSpot partnera', () => {
    const state = makeState(66);
    placePlayer(state, 1, 1.0, -3);
    placePlayer(state, 0, -2.0, -5);
    setRallyBall(
      state,
      { x: 1.0, y: 2.0, z: -3 },
      { x: 0, y: -1, z: 0 },
      {
        touches: 1,
        lastToucher: 0,
        sideOfBall: 0,
      },
    );
    const ev = run(state, 1, () => [swing(1)]);
    const contact = ofType(ev, 'contact')[0]!.event;
    expect(contact.kind).toBe('set');
    expect(contact.touchNo).toBe(2);
    expect(contact.quality).toBe(1);
    const expected = attackSpot(0, -2.0);
    expect(state.lastContact!.target).toEqual(expected);
    state.players[0].pos.x = -5.5; // odsuwamy atakującego, żeby piłka spadła na podłogę
    const land = landAfterContact(state);
    expect(Math.abs(land.x - expected.x)).toBeLessThan(0.02);
    expect(Math.abs(land.z - expected.z)).toBeLessThan(0.02);
  });

  it('3. odbicie bez celu leci na defaultAttackTarget („między rywalami”)', () => {
    const state = makeState(67);
    placePlayer(state, 0, -1.0, -2);
    placePlayer(state, 2, -1.0, 6.5);
    placePlayer(state, 3, 3.0, 4.5);
    setRallyBall(
      state,
      { x: -1.0, y: 2.2, z: -2 },
      { x: 0, y: -1, z: 0 },
      {
        touches: 2,
        lastToucher: 1,
        sideOfBall: 0,
      },
    );
    const expected = defaultAttackTarget(state, 0);
    expect(expected).toEqual({ x: 1.0, z: 5.5 });
    const ev = run(state, 1, () => [swing(0)]);
    const contact = ofType(ev, 'contact')[0]!.event;
    expect(contact.kind).toBe('attack');
    expect(contact.quality).toBe(1);
    expect(state.lastContact!.target).toEqual(expected);
    // Rywale z drogi – sprawdzamy sam tor.
    placePlayer(state, 2, -4, 8);
    placePlayer(state, 3, 4, 8);
    const land = landAfterContact(state);
    expect(Math.abs(land.x - expected.x)).toBeLessThan(0.03);
    expect(Math.abs(land.z - expected.z)).toBeLessThan(0.03);
  });

  it('auto-skok, gdy piłka nad głową w zamachu', () => {
    const state = makeState(68);
    placePlayer(state, 0, 0, -4);
    setRallyBall(state, { x: 0.2, y: 2.8, z: -4 }, { x: 0, y: -0.5, z: 0 }, { lastToucher: 2 });
    run(state, 1, () => [swing(0)]);
    expect(state.players[0].grounded).toBe(false);
    expect(state.players[0].vel.y).toBeGreaterThan(0);
    // W skoku dochodzi do kontaktu.
    const { found } = runUntil(state, 'contact', 60);
    expect(found).not.toBeNull();
    expect(state.players[0].pos.y).toBeGreaterThan(0);
  });

  it('reachWindow jest niepuste dla piłki lecącej na zawodnika, a canReach true w oknie', () => {
    const state = makeState(69);
    placePlayer(state, 1, 2, -6);
    launchBallTo(state, { x: 0, y: 1.0, z: 5 }, { x: 2, z: -6.2 }, 1.5, { lastToucher: 3 });
    const win = reachWindow(state, 1);
    expect(win).not.toBeNull();
    expect(win!.enterTick).toBeGreaterThan(state.tick);
    expect(win!.exitTick).toBeGreaterThan(win!.enterTick);
    expect(canReach(state, 1)).toBe(false);
    // Nikt się nie zamachuje, ale bierny kontakt zepsułby tor – zawodnik 1 „nie stoi” w torze:
    // sprawdzamy canReach zanim piłka dotknie kapsuły (pierwszy tick okna).
    run(state, win!.enterTick - state.tick);
    expect(canReach(state, 1)).toBe(true);
  });

  it('w fazie serve zamach nie-serwującego jest ignorowany, serwis z power leci natychmiast', () => {
    const state = makeState(70);
    run(state, 1, () => [swing(1, null, 0.5)]);
    expect(state.rally.phase).toBe('serve');
    expect(state.players[1].swingStartTick).toBe(-1);
    const ev = run(state, 1, () => [swing(0, { x: 0, z: 5 }, 0.5)]);
    expect(state.rally.phase).toBe('rally');
    expect(state.ball.held).toBe(-1);
    const contact = ofType(ev, 'contact')[0]!.event;
    expect(contact.kind).toBe('serve');
    expect(contact.quality).toBe(1);
    expect(state.rally.lastToucher).toBe(0);
    expect(state.rally.touches).toBe(0);
  });

  it('serwis bez power: siła z czasu trzymania przy release', () => {
    const state = makeState(71);
    const ev = run(state, 80, (t) => (t === 0 ? [swing(0)] : t === 72 ? [release(0)] : []));
    const contact = ofType(ev, 'contact');
    expect(contact).toHaveLength(1);
    expect(contact[0]!.tick).toBe(72);
    expect(state.lastContact!.power).toBe(1);
  });
});
