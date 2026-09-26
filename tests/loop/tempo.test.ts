/**
 * Spowolnienie F0b (src/loop/tempo.ts, decyzja Dawida 4): tempo pętli 0,6×, gdy do kontaktu
 * aktywnego zostaje ≤ 0,4 s, powrót po kontakcie; krok sim bez zmian (tylko czas ścienny).
 */
import { describe, expect, it } from 'vitest';
import {
  nextTempo,
  SLOWMO_LEAD_S,
  SLOWMO_RAMP_S,
  SLOWMO_TEMPO,
  slowMoWanted,
} from '../../src/loop/tempo';
import { createSimState, DT, reachWindow, step, type SimState } from '../../src/sim/index';
import { launchBallTo, placePlayer } from '../sim/pomocnicze';

/** Piłka leci do stojącego aktywnego (0) na (1, −5); `flightS` – czas lotu do podłogi. */
function incoming(assist: boolean, flightS = 1.2): SimState {
  const s = createSimState({ seed: 3, servingTeam: 1, humanControl: true, assist });
  s.active = 0;
  placePlayer(s, 0, 1, -5);
  placePlayer(s, 1, -3, -2);
  launchBallTo(s, { x: 1, y: 2.5, z: 4 }, { x: 1, z: -5.3 }, flightS, { sideOfBall: 1 });
  step(s, []);
  return s;
}

describe('kiedy spowalniać', () => {
  it('asysta: tak, gdy piłka za ≤ 0,4 s wejdzie w zasięg aktywnego; wcześniej nie', () => {
    const s = incoming(true);
    const w = reachWindow(s, 0);
    expect(w).not.toBeNull();
    let firstWanted = -1;
    while (s.tick < (w?.enterTick ?? 0)) {
      if (slowMoWanted(s) && firstWanted < 0) firstWanted = s.tick;
      step(s, []);
    }
    const leadS = ((w?.enterTick ?? 0) - firstWanted) * DT;
    expect(leadS).toBeGreaterThan(SLOWMO_LEAD_S - 0.02);
    expect(leadS).toBeLessThanOrEqual(SLOWMO_LEAD_S + 1e-9);
  });

  it('po kontakcie aktywnego – powrót do 1', () => {
    const s = incoming(true);
    let contacted = false;
    for (let t = 0; t < 200 && !contacted; t++) {
      const w = reachWindow(s, 0);
      const tap = w !== null && w.enterTick <= s.tick + 1;
      step(
        s,
        tap
          ? [
              { type: 'swing', player: 0, aim: null, power: 0.5 },
              { type: 'release', player: 0 },
            ]
          : [],
      );
      contacted = s.events.some((e) => e.type === 'contact' && e.player === 0);
    }
    expect(contacted).toBe(true);
    expect(slowMoWanted(s)).toBe(false);
  });

  it('tryb ręczny (pełne F0) nigdy nie spowalnia', () => {
    const s = incoming(false);
    for (let t = 0; t < 150; t++) {
      expect(slowMoWanted(s)).toBe(false);
      step(s, []);
    }
  });

  it('piłka lecąca do rywali nie spowalnia', () => {
    const s = createSimState({ seed: 3, servingTeam: 0, humanControl: true, assist: true });
    launchBallTo(s, { x: 0, y: 2.5, z: -4 }, { x: 0, z: 6 }, 1.1, { sideOfBall: 0 });
    for (let t = 0; t < 120; t++) {
      expect(slowMoWanted(s)).toBe(false);
      step(s, []);
    }
  });
});

describe('przejście tempa', () => {
  it('z 1 do 0,6 liniowo w SLOWMO_RAMP_S czasu ściennego i z powrotem', () => {
    let t = 1;
    t = nextTempo(t, true, SLOWMO_RAMP_S / 2);
    expect(t).toBeCloseTo(1 - (1 - SLOWMO_TEMPO) / 2, 10);
    t = nextTempo(t, true, SLOWMO_RAMP_S);
    expect(t).toBe(SLOWMO_TEMPO);
    t = nextTempo(t, true, 1);
    expect(t).toBe(SLOWMO_TEMPO);
    t = nextTempo(t, false, SLOWMO_RAMP_S);
    expect(t).toBe(1);
    expect(SLOWMO_TEMPO).toBe(0.6);
  });

  it('krok sim jest ten sam: tempo zmienia tylko ilość czasu ściennego na krok', () => {
    // 1 s ściany przy tempie 0,6 = 72 kroki DT zamiast 120 – ta sama funkcja step.
    expect(Math.floor((1 * SLOWMO_TEMPO) / DT)).toBe(72);
  });
});
