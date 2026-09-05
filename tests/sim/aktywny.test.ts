import { describe, expect, it } from 'vitest';
import {
  ACTIVE_HYSTERESIS_M,
  ACTIVE_MIN_DWELL_S,
  distXZ,
  partnerOf,
  PLAYER_MAX_SPEED,
  TICK_HZ,
  type Command,
  type PlayerId,
  type SimState,
  type Vec2,
} from '../../src/sim';
import {
  launchBallTo,
  makeState,
  move,
  ofType,
  placePlayer,
  run,
  serveCommand,
} from './pomocnicze';

const DWELL_TICKS = Math.round(ACTIVE_MIN_DWELL_S * TICK_HZ);

/** Serwis czerwonych w podany punkt naszej połowy; zwraca zdarzenia do pierwszego kontaktu/podłogi. */
function rivalServeTo(
  state: SimState,
  target: { x: number; z: number },
  extra?: (tick: number, state: SimState) => Command[],
  onTick?: (state: SimState, tickBefore: number) => void,
) {
  const events = run(
    state,
    600,
    (t, s) => {
      const cmds = extra?.(t, s) ?? [];
      if (t === 0) cmds.unshift(serveCommand(s, 0.5, target));
      return cmds;
    },
    onTick,
  );
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

  it('serwis bliżej zawodnika 1 → jedno przełączenie na 1, a 0 traci komendę ruchu', () => {
    const state = makeState(32, 1);
    // Zawodnik 0 biegnie w tył (od lądowania) – ma NIEZEROWĄ komendę ruchu, którą przełączenie
    // musi skasować; dla stojącego zawodnika asercja „traci komendę” byłaby prawdziwa zawsze.
    const moves: Vec2[] = [];
    const events = rivalServeTo(
      state,
      { x: 2.5, z: -5.5 },
      (t) => (t === 0 ? [move(0, 0, -0.4)] : []),
      (s, t) => {
        moves[t] = { x: s.players[0].move.x, z: s.players[0].move.z };
      },
    );
    const switches = ofType(events, 'active-switch');
    expect(switches).toHaveLength(1);
    expect(switches[0]!.event.from).toBe(0);
    expect(switches[0]!.event.to).toBe(1);
    const at = switches[0]!.tick;
    // Tick przed przełączeniem komenda jeszcze obowiązuje; w ticku przełączenia sim ją zeruje.
    expect(moves[at - 1]).toEqual({ x: 0, z: -0.4 });
    expect(moves[at]).toEqual({ x: 0, z: 0 });
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

  it('presja na migotanie: histereza i blokada czasowa naprawdę ograniczają przełączenia', () => {
    // Piłka rywali leci 4 s w (0, −6,5); nasi zaczynają równoodlegle (±2,25, −6) i co tick dostają
    // komendy ruchu, które CELOWO prowokują przełączenia: aktywny odbiega od lądowania w x, partner
    // podbiega – w pasie ±0,5 m wokół pozycji bazowej. Po przełączeniu role się odwracają, więc bez
    // histerezy i blokady sterowanie skakałoby między nimi bez przerwy. Cykle naprzemiennie:
    //  P („push”): zaraz po przełączeniu różnica odległości rośnie do ~0,97 m (> 0,75) w 25–55
    //    ticków – jedyne, co wstrzymuje przełączenie do ticku since + DWELL_TICKS, to blokada;
    //  H („hold”): przez 90 ticków różnica trzymana na ~0,49 m (partner bliżej, ale o mniej niż
    //    próg) – jedyne, co wstrzymuje przełączenie po upływie blokady, to histereza; potem push.
    // Liczby pasa (2,5/2,0 → ~0,49 m; 2,75/1,75 → ~0,97 m) są literalne, nie liczone ze stałej –
    // test ma paść, gdy ktoś wyzeruje ACTIVE_HYSTERESIS_M albo ACTIVE_MIN_DWELL_S
    // (docs/22 §5: 0,75 m i 0,5 s).
    const LANDING = { x: 0, z: -6.5 };
    const HOLD_TICKS = 90;
    // Dojazd do zadanego |x| na własnym skrzydle (0 → x < 0, 1 → x > 0), z stałe −6. Prędkość
    // zadana ~ sqrt(2·a·e), żeby nie przestrzelić celu przy hamowaniu 22–30 m/s².
    const driveTo = (s: SimState, id: PlayerId, targetAbsX: number): Command => {
      const p = s.players[id];
      const ex = (id === 0 ? -targetAbsX : targetAbsX) - p.pos.x;
      const ez = -6 - p.pos.z;
      const vx = Math.sign(ex) * Math.min(PLAYER_MAX_SPEED, Math.sqrt(2 * 15 * Math.abs(ex)));
      const vz = Math.sign(ez) * Math.min(PLAYER_MAX_SPEED, Math.sqrt(2 * 15 * Math.abs(ez)));
      return move(id, vx / PLAYER_MAX_SPEED, vz / PLAYER_MAX_SPEED);
    };

    const state = makeState(71, 1);
    placePlayer(state, 0, -2.25, -6);
    placePlayer(state, 1, 2.25, -6);
    launchBallTo(state, { x: 0, y: 2.5, z: 6 }, LANDING, 4.0, { lastToucher: 2, sideOfBall: 1 });

    interface Switch {
      tick: number;
      /** Początek cyklu: poprzednie przełączenie albo start (activeSinceTick). */
      since: number;
      /** d(aktywny) − d(partner) w ticku przełączenia, role sprzed przełączenia. */
      diff: number;
      hold: boolean;
    }
    const switches: Switch[] = [];
    /** Różnica odległości widziana przez sim w danym ticku (pozycje po ruchu w tym ticku). */
    const diffAt: number[] = [];
    let holdCycle = false;
    const events = run(
      state,
      470,
      (_t, s) => {
        const active = s.active;
        const tau = s.tick - s.activeSinceTick;
        holdCycle = switches.length % 2 === 1;
        const hold = holdCycle && tau < HOLD_TICKS;
        return [
          driveTo(s, active, hold ? 2.5 : 2.75),
          driveTo(s, partnerOf(active), hold ? 2.0 : 1.75),
        ];
      },
      (s, t) => {
        const ev = s.events.find((e) => e.type === 'active-switch');
        const active: PlayerId = ev && ev.type === 'active-switch' ? ev.from : s.active;
        const diff =
          distXZ(s.players[active].pos, s.landing.pos) -
          distXZ(s.players[partnerOf(active)].pos, s.landing.pos);
        diffAt[t] = diff;
        if (ev) {
          const since = switches.length ? switches[switches.length - 1]!.tick : 0;
          switches.push({ tick: t, since, diff, hold: holdCycle });
        }
      },
    );

    // Scenariusz jest „czysty”: bez kontaktów i bez punktu – tylko przełączenia.
    expect(events.filter((e) => e.event.type !== 'active-switch')).toHaveLength(0);
    expect(state.rally.phase).toBe('rally');
    // Presja jest realna: kilka przełączeń w 470 tickach (bez ograniczeń byłoby ich kilkanaście).
    expect(switches.length).toBeGreaterThanOrEqual(5);

    for (const sw of switches) {
      const tau = sw.tick - sw.since;
      // 1. Każdy odstęp między przełączeniami ≥ DWELL_TICKS (pierwsze liczone od startu).
      expect(tau).toBeGreaterThanOrEqual(DWELL_TICKS);
      // 2. Przełączenie tylko, gdy partner jest bliżej o co najmniej próg histerezy.
      expect(sw.diff).toBeGreaterThanOrEqual(ACTIVE_HYSTERESIS_M);
      if (sw.hold) {
        // 3. Cykl H: po upływie blokady partner był bliżej o ~0,49 m przez 30 ticków i mimo tej
        //    presji nie przejął sterowania – przełączenie dopiero po pushu (τ ≥ 90).
        expect(tau).toBeGreaterThanOrEqual(HOLD_TICKS);
        for (let t = sw.since + DWELL_TICKS; t < sw.since + HOLD_TICKS - 10; t++) {
          expect(diffAt[t]!).toBeGreaterThan(0.4);
          expect(diffAt[t]!).toBeLessThan(0.6);
        }
      } else {
        // 4. Cykl P: różnica przekroczyła próg PRZED końcem blokady, więc przełączenie wypada
        //    dokładnie w pierwszym dozwolonym ticku – to blokada czasowa je wstrzymywała.
        const pressureTick = diffAt.findIndex((d, t) => t >= sw.since && d >= ACTIVE_HYSTERESIS_M);
        expect(pressureTick).toBeGreaterThanOrEqual(sw.since);
        expect(pressureTick).toBeLessThan(sw.since + DWELL_TICKS);
        expect(tau).toBe(DWELL_TICKS);
      }
    }
    // 5. W dowolnym oknie 60 ticków najwyżej jedno przełączenie.
    const ticks = switches.map((s) => s.tick);
    for (const start of ticks) {
      expect(ticks.filter((t) => t >= start && t < start + 60)).toHaveLength(1);
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
