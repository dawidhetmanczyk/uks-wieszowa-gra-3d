import { describe, expect, it } from 'vitest';
import { ACTIVE_HYSTERESIS_M, ACTIVE_MIN_DWELL_S, TICK_HZ, type SimState } from '../../src/sim';
import { launchBallTo, makeState, ofType, placePlayer, run, serveCommand } from './pomocnicze';

const DWELL_TICKS = Math.round(ACTIVE_MIN_DWELL_S * TICK_HZ);

/** Serwis czerwonych w podany punkt naszej połowy; zwraca zdarzenia do pierwszego kontaktu/podłogi. */
function rivalServeTo(state: SimState, target: { x: number; z: number }) {
  const events = run(state, 600, (t, s) => {
    if (t === 0) return [serveCommand(s, 0.5, target)];
    return [];
  });
  const end = events.find((e) => e.event.type === 'contact' && e.event.kind !== 'serve');
  const floor = events.find((e) => e.event.type === 'floor');
  const stop = Math.min(end?.tick ?? Infinity, floor?.tick ?? Infinity);
  return events.filter((e) => e.tick <= stop);
}

describe('aktywny zawodnik', () => {
  it('serwis rywali w punkt równoodległy od 0 i 1 → zero przełączeń', () => {
    const state = makeState(31, 1);
    expect(state.active).toBe(0);
    // Pozycje bazowe: (−2,25, −6) i (2,25, −6) – punkt (0, −6) jest równoodległy.
    const events = rivalServeTo(state, { x: 0, z: -6 });
    expect(ofType(events, 'active-switch')).toHaveLength(0);
    expect(state.active).toBe(0);
  });

  it('serwis bliżej zawodnika 1 → dokładnie jedno przełączenie na 1', () => {
    const state = makeState(32, 1);
    const events = rivalServeTo(state, { x: 2.5, z: -5.5 });
    const switches = ofType(events, 'active-switch');
    expect(switches).toHaveLength(1);
    expect(switches[0]!.event.from).toBe(0);
    expect(switches[0]!.event.to).toBe(1);
    // Poprzednio aktywny traci komendę ruchu.
    expect(state.players[0].move).toEqual({ x: 0, z: 0 });
  });

  it('w dowolnym oknie 0,5 s najwyżej jedno przełączenie (granica histerezy, kilka ziaren)', () => {
    for (const seed of [41, 42, 43, 44, 45, 46]) {
      const state = makeState(seed, 1);
      // Zawodnik 1 na granicy histerezy względem lądowania w (0, −6): |d0 − d1| ≈ 0,75.
      const eps = ((seed % 3) - 1) * 0.004; // −0,004, 0, +0,004
      placePlayer(state, 0, -2.25, -6);
      placePlayer(state, 1, 2.25 - ACTIVE_HYSTERESIS_M + eps, -6);
      const events = rivalServeTo(state, { x: 0, z: -6 });
      const switches = ofType(events, 'active-switch').map((e) => e.tick);
      for (let i = 1; i < switches.length; i++) {
        expect(switches[i]! - switches[i - 1]!).toBeGreaterThanOrEqual(DWELL_TICKS);
      }
      // Przy stałym torze decyzja jest jedna: albo przełączy raz, albo nigdy.
      expect(switches.length).toBeLessThanOrEqual(1);
    }
  });

  it('w trakcie naszej akcji (touches ≥ 1) brak przełączeń, chyba że ratunek', () => {
    // Bez ratunku: aktywny 0 stoi blisko lądowania (zdąży), choć partner też by zdążył.
    const a = makeState(51);
    placePlayer(a, 0, 1.5, -2.8);
    placePlayer(a, 1, 3.5, -2.5);
    launchBallTo(a, { x: -3, y: 1.0, z: -7 }, { x: 2.0, z: -2.2 }, 1.8, {
      touches: 1,
      lastToucher: 0,
      sideOfBall: 0,
    });
    const evA = run(a, 240);
    expect(ofType(evA, 'active-switch')).toHaveLength(0);
    expect(a.active).toBe(0);

    // Ratunek: aktywny 0 stoi w rogu (nie zdąży), partner przy lądowaniu.
    const b = makeState(52);
    placePlayer(b, 0, -6.4, -11.4);
    placePlayer(b, 1, 3.5, -2.5);
    launchBallTo(b, { x: 0, y: 1.0, z: -4 }, { x: 3.5, z: -2.2 }, 1.0, {
      touches: 1,
      lastToucher: 1,
      sideOfBall: 0,
    });
    // Ratunek też respektuje minimalny czas od ostatniego przełączenia (0,5 s od serwisu).
    const evB = run(b, 80);
    const switches = ofType(evB, 'active-switch');
    expect(switches).toHaveLength(1);
    expect(switches[0]!.tick).toBe(DWELL_TICKS);
    expect(switches[0]!.event.to).toBe(1);
  });

  it('gdy serwują niebiescy zawodnikiem 1, aktywny = 1', () => {
    const state = makeState(53);
    state.rally.servesByTeam = [1, 0];
    // Wymuszamy serwis drużyny 0 drugi raz z rzędu przez punkt dla niebieskich.
    state.rally.phase = 'rally';
    state.rally.sideOfBall = 1;
    state.ball.held = -1;
    state.ball.pos = { x: 0, y: 0.5, z: 5 };
    state.ball.vel = { x: 0, y: 0, z: 0 };
    run(state, 260);
    expect(state.rally.phase).toBe('serve');
    expect(state.rally.server).toBe(1);
    expect(state.active).toBe(1);
  });
});
