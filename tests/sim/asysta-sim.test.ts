/**
 * Zmiany sim w trybie asysty F0b (SimState.assist): ciało pary człowieka nie odbija piłki,
 * zamach aktywnego ma dłuższe okno po puszczeniu. Tryb ręczny (assist = false) i rywale –
 * bez zmian względem F0.
 */
import { describe, expect, it } from 'vitest';
import {
  appendTick,
  ASSIST_SWING_GRACE_S,
  createRecording,
  createSimState,
  replay,
  step,
  SWING_GRACE_S,
  TICK_HZ,
  type Command,
  type PlayerId,
  type SimState,
} from '../../src/sim';
import { launchBallTo, ofType, placePlayer, release, run, swing } from './pomocnicze';

function stateWith(assist: boolean): SimState {
  const s = createSimState({ seed: 7, servingTeam: 1, humanControl: true, assist });
  s.active = 0;
  return s;
}

/** Piłka rzucona prosto w kapsułę zawodnika `id` (na wysokości ~1 m), bez zamachu. */
function throwAtBody(s: SimState, id: PlayerId): void {
  const p = s.players[id];
  const side = p.team === 0 ? -1 : 1;
  placePlayer(s, id, 1, side * 5);
  // Start 3 m przed zawodnikiem, lądowanie 1 m za nim – tor przechodzi przez kapsułę.
  launchBallTo(s, { x: 1, y: 1.4, z: side * 2 }, { x: 1, z: side * 6.2 }, 0.45);
}

describe('ciało zawodnika a tryb asysty', () => {
  it('F0 (assist = false): piłka odbija się od kapsuły gracza – bierny kontakt', () => {
    const s = stateWith(false);
    throwAtBody(s, 0);
    const contacts = ofType(run(s, 60), 'contact');
    expect(contacts.map((c) => c.event.kind)).toContain('passive');
  });

  it('asysta: piłka przelatuje przez kapsułę gracza i partnera – zero kontaktów', () => {
    for (const id of [0, 1] as const) {
      const s = stateWith(true);
      throwAtBody(s, id);
      const events = run(s, 90);
      expect(ofType(events, 'contact')).toHaveLength(0);
      expect(ofType(events, 'floor')).toHaveLength(1);
    }
  });

  it('asysta: rywale nadal odbijają piłkę ciałem (jak w F0)', () => {
    const s = stateWith(true);
    throwAtBody(s, 2);
    const contacts = ofType(run(s, 60), 'contact');
    expect(contacts.map((c) => c.event.kind)).toContain('passive');
  });
});

describe('okno po stuknięciu', () => {
  const assistTicks = Math.round(ASSIST_SWING_GRACE_S * TICK_HZ);
  const f0Ticks = SWING_GRACE_S * TICK_HZ;

  function tapAt(s: SimState, id: PlayerId): number {
    // Piłka po drugiej stronie, daleko – zamach nie trafi, liczy się tylko okno.
    launchBallTo(s, { x: 0, y: 3, z: 6 }, { x: 0, z: 8 }, 1.2);
    step(s, [swing(id), release(id)]);
    return s.players[id].swingGraceTicks;
  }

  it('asysta: zamach aktywnego człowieka trzyma okno ASSIST_SWING_GRACE_S', () => {
    const s = stateWith(true);
    expect(tapAt(s, 0)).toBe(assistTicks);
    expect(assistTicks).toBeGreaterThan(f0Ticks);
  });

  it('asysta: zamach AI (partner, rywal) ma okno z F0', () => {
    const s = stateWith(true);
    expect(tapAt(s, 1)).toBe(f0Ticks);
    const r = stateWith(true);
    expect(tapAt(r, 2)).toBe(f0Ticks);
  });

  it('F0 (assist = false): zamach gracza ma okno z F0', () => {
    expect(tapAt(stateWith(false), 0)).toBe(f0Ticks);
  });

  it('asysta: pudło dopiero po ASSIST_SWING_GRACE_S od puszczenia', () => {
    const s = stateWith(true);
    tapAt(s, 0);
    const events = run(s, assistTicks + 5);
    const whiff = ofType(events, 'whiff')[0];
    expect(whiff).toBeDefined();
    // Tap w ticku 0 (swing + release), okno do ticku 0 + assistTicks włącznie, pudło tick później.
    expect(whiff?.tick).toBe(assistTicks + 1);
  });
});

describe('nagranie z asystą', () => {
  it('assist trafia do nagrania i powtórka jest bit w bit', () => {
    const s = createSimState({ seed: 11, servingTeam: 1, humanControl: true, assist: true });
    const rec = createRecording(s);
    expect(rec.assist).toBe(true);
    const cmds: Command[] = [{ type: 'move', player: 0, x: 0.5, z: 0 }];
    for (let t = 0; t < 600; t++) {
      const c = t === 10 ? cmds : [];
      appendTick(rec, s.tick, c);
      step(s, c);
    }
    const again = replay(rec, s.tick);
    expect(JSON.stringify(again)).toBe(JSON.stringify(s));
  });
});
