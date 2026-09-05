/**
 * Testy poprawek z przeglądu kodu F0 (moduł sim). Każdy `it` odpowiada jednemu
 * znalezisku; komentarz przy teście mówi, co było źle przed poprawką.
 */
import { describe, expect, it } from 'vitest';
import {
  BALL_NET_SPEED_FACTOR,
  BALL_R,
  BODY_IMMUNITY_S,
  canReach,
  F_DT,
  NET_THICKNESS,
  stepBall,
  TICK_HZ,
  type Vec3,
} from '../../src/sim';
import { makeState, ofType, placePlayer, release, run, setRallyBall, swing } from './pomocnicze';

const IMMUNITY_TICKS = Math.round(BODY_IMMUNITY_S * TICK_HZ);

describe('przegląd F0 – sim', () => {
  it('1a. aktywny kontakt zza siatki (blok) liczy się jako 1. odbicie bloku, nie 4. rywali', () => {
    const state = makeState(101);
    placePlayer(state, 0, 0, -0.35);
    for (const id of [1, 2, 3] as const) placePlayer(state, id, 4, state.players[id].pos.z);
    // Rywale mają już 3 odbicia, piłka tuż za siatką leci na naszą stronę.
    setRallyBall(
      state,
      { x: 0, y: 2.3, z: 0.3 },
      { x: 0, y: 0, z: -3 },
      { touches: 3, lastToucher: 3, sideOfBall: 1 },
    );
    const ev = run(state, 1, () => [swing(0)]);
    const contact = ofType(ev, 'contact');
    expect(contact).toHaveLength(1);
    expect(contact[0]!.event.player).toBe(0);
    expect(contact[0]!.event.touchNo).toBe(1);
    expect(ofType(ev, 'point')).toHaveLength(0);
    expect(state.rally.sideOfBall).toBe(0);
    expect(state.rally.touches).toBe(1);
    expect(state.rally.phase).toBe('rally');
  });

  it('1b. bierny kontakt zza siatki też zmienia stronę – bez four-touches i double-touch', () => {
    const state = makeState(102);
    placePlayer(state, 0, 0, -0.35);
    for (const id of [1, 2, 3] as const) placePlayer(state, id, 4, state.players[id].pos.z);
    // lastToucher = 0 z „poprzedniej strony” nie może dać double-touch po zmianie strony.
    setRallyBall(
      state,
      { x: 0, y: 1.6, z: 0.1 },
      { x: 0, y: 0, z: -3 },
      { touches: 3, lastToucher: 0, sideOfBall: 1 },
    );
    const ev = run(state, 3);
    const contact = ofType(ev, 'contact');
    expect(contact).toHaveLength(1);
    expect(contact[0]!.event.kind).toBe('passive');
    expect(contact[0]!.event.touchNo).toBe(1);
    expect(ofType(ev, 'point')).toHaveLength(0);
    expect(state.rally.sideOfBall).toBe(0);
  });

  it('2. tapnięcie na wysoką piłkę: auto-skok trzyma okno do lądowania → kontakt w skoku, zero pudeł', () => {
    const state = makeState(103);
    placePlayer(state, 0, 0, -4);
    setRallyBall(state, { x: 0, y: 3.6, z: -4 }, { x: 0, y: -0.5, z: 0 }, { lastToucher: 2 });
    // swing + release w tym samym ticku = tapnięcie; okno po puszczeniu ma tylko 0,12 s,
    // a skok trwa ~0,39 s do apogeum – przed poprawką gwarantowane pudło w powietrzu.
    const ev = run(state, 120, (t) => (t === 0 ? [swing(0), release(0)] : []));
    expect(state.players[0].jumpSwing).toBe(false);
    const contact = ofType(ev, 'contact');
    expect(contact).toHaveLength(1);
    expect(contact[0]!.event.kind).not.toBe('passive');
    expect(contact[0]!.event.player).toBe(0);
    expect(ofType(ev, 'whiff')).toHaveLength(0);
    expect(ofType(ev, 'point')).toHaveLength(0);
    // Kontakt zaszedł w powietrzu, dobrze po końcu okna 0,12 s.
    expect(contact[0]!.tick).toBeGreaterThan(Math.round(0.12 * TICK_HZ));
  });

  it('2b. skok z zamachu bez kontaktu kończy się pudłem dopiero po wylądowaniu', () => {
    const state = makeState(104);
    placePlayer(state, 0, 0, -4);
    // Piłka nad głową, ale odlatuje w bok szybciej, niż zawodnik zdąży – auto-skok literalny.
    setRallyBall(state, { x: 0.3, y: 2.9, z: -4 }, { x: 6, y: -0.3, z: 0 }, { lastToucher: 2 });
    let landedTick = -1;
    const ev = run(
      state,
      200,
      (t) => (t === 0 ? [swing(0), release(0)] : []),
      (s, t) => {
        if (landedTick < 0 && t > 0 && s.players[0].grounded) landedTick = t;
      },
    );
    expect(state.players[0].grounded).toBe(true);
    expect(landedTick).toBeGreaterThan(Math.round(0.12 * TICK_HZ));
    expect(ofType(ev, 'contact')).toHaveLength(0);
    const whiff = ofType(ev, 'whiff');
    expect(whiff).toHaveLength(1);
    expect(whiff[0]!.tick).toBeGreaterThanOrEqual(landedTick);
  });

  it('3. zamach tuż po własnym kontakcie (immunitet 0,3 s) nie daje drugiego kontaktu', () => {
    const state = makeState(105);
    placePlayer(state, 0, 0, -5);
    placePlayer(state, 1, 4, -6);
    setRallyBall(state, { x: 0.3, y: 1.2, z: -5 }, { x: 0, y: -1, z: 0 }, { lastToucher: 2 });
    let reachableAfterContact = false;
    const ev = run(
      state,
      IMMUNITY_TICKS + 4,
      (t) => (t === 0 || (t >= 1 && t <= IMMUNITY_TICKS - 1) ? [swing(0)] : []),
      (s, t) => {
        // Bez immunitetu drugi zamach trafiłby piłkę: po kontakcie jest jeszcze w zasięgu.
        if (t === 0) reachableAfterContact = canReach(s, 0);
      },
    );
    expect(reachableAfterContact).toBe(true);
    const contact = ofType(ev, 'contact');
    expect(contact).toHaveLength(1);
    expect(contact[0]!.tick).toBe(0);
    expect(ofType(ev, 'point')).toHaveLength(0);
    // Okno drugiego zamachu zostało otwarte (czeka), nie zostało skasowane pudłem.
    expect(state.players[0].swingStartTick).toBe(1);
    expect(ofType(ev, 'whiff')).toHaveLength(0);
  });

  it('4. dwóch zawodników w zasięgu w tym samym ticku → dokładnie jeden kontakt', () => {
    const state = makeState(106);
    placePlayer(state, 0, -0.5, -5);
    placePlayer(state, 1, 0.5, -5);
    setRallyBall(state, { x: 0, y: 1.2, z: -5 }, { x: 0, y: -1, z: 0 }, { lastToucher: 2 });
    const ev = run(state, 1, () => [swing(0), swing(1)]);
    const contact = ofType(ev, 'contact');
    expect(contact).toHaveLength(1);
    expect(contact[0]!.event.player).toBe(0);
    expect(state.rally.touches).toBe(1);
    expect(ofType(ev, 'point')).toHaveLength(0);
    // Drugi zachowuje otwarte okno.
    expect(state.players[1].swingStartTick).toBe(0);
    expect(ofType(ev, 'whiff')).toHaveLength(0);
  });

  it('5. odbicie od siatki tłumi cały wektor prędkości: |v_po|/|v_przed| = √0,4', () => {
    const dirs: Vec3[] = [
      { x: 0, y: 0, z: 4 }, // prostopadle
      { x: 0, y: -6, z: 1.5 }, // stromo w dół (tu stary kod zachowywał 57 % energii)
      { x: 3, y: 2, z: 2 }, // ukośnie
      { x: -5, y: -1, z: 0.5 }, // niemal wzdłuż siatki
    ];
    for (const vel of dirs) {
      const state = makeState(107);
      for (const p of state.players) p.pos.x = p.team === 0 ? -6 : 6;
      // Tuż przed siatką – najmniejsze vz (0,5 m/s) daje 4,2 mm na tick, więc każdy kierunek przechodzi.
      const from = { x: 0, y: 1.5, z: -0.003 };
      setRallyBall(state, from, vel, { lastToucher: 0 });
      // Prędkość „przed” = po całkowaniu kroku (z tłumieniem), tuż przed kolizją.
      const p = { ...from };
      const v = { ...vel };
      stepBall(p, v);
      expect(p.z).toBeGreaterThan(0);
      const before = Math.hypot(v.x, v.y, v.z);
      const ev = run(state, 1);
      expect(ofType(ev, 'net')).toHaveLength(1);
      const after = Math.hypot(state.ball.vel.x, state.ball.vel.y, state.ball.vel.z);
      expect(Math.abs(after / before - BALL_NET_SPEED_FACTOR)).toBeLessThan(1e-9);
      expect(Math.abs(after / before - Math.sqrt(0.4))).toBeLessThan(1e-9);
      expect(state.ball.pos.z).toBeLessThan(0);
    }
  });

  it('6. wypchnięcie piłki z kapsuły przy siatce nie przenosi jej na drugą stronę', () => {
    const state = makeState(108);
    placePlayer(state, 0, 0, -0.35);
    for (const id of [1, 2, 3] as const) placePlayer(state, id, 4, state.players[id].pos.z);
    setRallyBall(state, { x: 0, y: 1.0, z: -0.05 }, { x: 0, y: -3, z: 0.5 }, { lastToucher: 2 });
    const ev = run(state, 1);
    const contact = ofType(ev, 'contact');
    expect(contact).toHaveLength(1);
    expect(contact[0]!.event.kind).toBe('passive');
    expect(state.ball.pos.z).toBeLessThan(0);
    expect(state.ball.pos.z).toBeCloseTo(-(BALL_R + NET_THICKNESS / 2), 12);
    expect(state.rally.sideOfBall).toBe(0);
    expect(ofType(ev, 'point')).toHaveLength(0);
  });

  it('7. piłka kończąca tick dokładnie na z = 0 zmienia stronę wg kierunku lotu', () => {
    const state = makeState(109);
    for (const p of state.players) p.pos.x = p.team === 0 ? -6 : 6;
    const vz = 4;
    // pos.z + vz·F_DT = 0 bit w bit (a + (−a) = 0 w IEEE 754).
    setRallyBall(
      state,
      { x: 0, y: 3.0, z: -(vz * F_DT) },
      { x: 0, y: 0, z: vz },
      { touches: 2, lastToucher: 0, sideOfBall: 0 },
    );
    const ev = run(state, 1);
    expect(state.ball.pos.z).toBe(0);
    expect(ofType(ev, 'net')).toHaveLength(0);
    expect(ofType(ev, 'point')).toHaveLength(0);
    expect(state.rally.sideOfBall).toBe(1);
    expect(state.rally.touches).toBe(0);
    // Następny tick: piłka już po stronie 1, strona się nie cofa.
    run(state, 1);
    expect(state.ball.pos.z).toBeGreaterThan(0);
    expect(state.rally.sideOfBall).toBe(1);
  });
});
