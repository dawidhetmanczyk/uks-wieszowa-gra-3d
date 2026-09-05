import { describe, expect, it } from 'vitest';
import {
  BALL_R,
  canReach,
  COURT_HALF_L,
  COURT_HALF_W,
  playersOf,
  POINT_FREEZE_S,
  positionAt,
  TICK_HZ,
  type PlayerId,
  type SimState,
  type TeamId,
} from '../../src/sim';
import { awardPoint, setWinnerFor } from '../../src/sim/rules';
import {
  launchBallTo,
  makeState,
  ofType,
  placePlayer,
  run,
  runUntil,
  setRallyBall,
  swing,
} from './pomocnicze';

/** Piłka tuż nad zawodnikiem w pasmie przyjęcia, zaraz wejdzie w kontakt po zamachu. */
function ballAt(state: SimState, id: PlayerId, opts: Parameters<typeof setRallyBall>[3]): void {
  const p = state.players[id];
  setRallyBall(state, { x: p.pos.x, y: 1.2, z: p.pos.z }, { x: 0, y: -0.5, z: 0 }, opts);
}

describe('zasady – odbicia', () => {
  it('trzy odbicia są legalne, czwarte to four-touches dla rywali', () => {
    const state = makeState(5);
    // 1. odbicie – zawodnik 0
    ballAt(state, 0, { touches: 0, lastToucher: 3, sideOfBall: 0 });
    let ev = run(state, 1, () => [swing(0)]);
    expect(ofType(ev, 'contact')[0]!.event.touchNo).toBe(1);
    expect(ofType(ev, 'point')).toHaveLength(0);
    // 2. – zawodnik 1
    ballAt(state, 1, { touches: 1, lastToucher: 0, sideOfBall: 0 });
    ev = run(state, 1, () => [swing(1)]);
    expect(ofType(ev, 'contact')[0]!.event.touchNo).toBe(2);
    expect(ofType(ev, 'point')).toHaveLength(0);
    // 3. – zawodnik 0 (atak)
    ballAt(state, 0, { touches: 2, lastToucher: 1, sideOfBall: 0 });
    ev = run(state, 1, () => [swing(0)]);
    expect(ofType(ev, 'contact')[0]!.event.touchNo).toBe(3);
    expect(ofType(ev, 'contact')[0]!.event.kind).toBe('attack');
    expect(ofType(ev, 'point')).toHaveLength(0);
    // 4. – zawodnik 1: błąd
    ballAt(state, 1, { touches: 3, lastToucher: 0, sideOfBall: 0 });
    ev = run(state, 1, () => [swing(1)]);
    const point = ofType(ev, 'point');
    expect(point).toHaveLength(1);
    expect(point[0]!.event.reason).toBe('four-touches');
    expect(point[0]!.event.winner).toBe(1);
    expect(state.score.points).toEqual([0, 1]);
    // Piłka mimo błędu odleciała (ma prędkość), a faza to point.
    expect(Math.abs(state.ball.vel.y) + Math.abs(state.ball.vel.z)).toBeGreaterThan(0.5);
    expect(state.rally.phase).toBe('point');
  });

  it('ten sam zawodnik dwa razy z rzędu to double-touch (stan wstrzyknięty)', () => {
    const state = makeState(6);
    ballAt(state, 0, { touches: 1, lastToucher: 0, sideOfBall: 0 });
    const ev = run(state, 1, () => [swing(0)]);
    const point = ofType(ev, 'point');
    expect(point).toHaveLength(1);
    expect(point[0]!.event.reason).toBe('double-touch');
    expect(point[0]!.event.winner).toBe(1);
  });

  it('double-touch wytworzony przez sim: dwa prawdziwe kontakty zawodnika 0 z rzędu', () => {
    // Test powyżej wstrzykuje touches/lastToucher; ten sprawdza, że sim sam tak księguje
    // pierwszy kontakt, że drugi kontakt tego samego zawodnika jest błędem.
    const state = makeState(12);
    placePlayer(state, 0, -2.25, -6);
    // Partner i rywale z drogi – tor przyjęcia (setterSpot, |x| ≤ 2,5) nie ma w nikogo trafić.
    placePlayer(state, 1, 4.5, -8.5);
    placePlayer(state, 2, -6, 8);
    placePlayer(state, 3, 6, 8);
    setRallyBall(state, { x: -2.25, y: 1.2, z: -6 }, { x: 0, y: -1, z: 0 }, { lastToucher: 2 });
    const first = run(state, 1, () => [swing(0)]);
    const c1 = ofType(first, 'contact');
    expect(c1).toHaveLength(1);
    expect(c1[0]!.event.player).toBe(0);
    expect(c1[0]!.event.touchNo).toBe(1);
    expect(ofType(first, 'point')).toHaveLength(0);
    expect(state.rally.lastToucher).toBe(0);
    expect(state.rally.touches).toBe(1);
    const firstTick = c1[0]!.tick;

    // Zawodnik 0 „dobiega” pod własne przyjęcie: staje tam, gdzie opadająca piłka przecina
    // wysokość przyjęcia, i zamachuje się, gdy tylko piłka wejdzie w zasięg.
    expect(state.landing.valid).toBe(true);
    placePlayer(state, 0, state.landing.intercept.x, state.landing.intercept.z);
    const { found, events } = runUntil(state, 'point', 600, (t, s) =>
      // ≥ 40 ticków po własnym kontakcie: poza immunitetem (0,3 s) i poza zasięgiem
      // odlatującej piłki – drugi kontakt ma być osobną, świadomą decyzją.
      t - firstTick >= 40 && canReach(s, 0) ? [swing(0)] : [],
    );
    expect(found).not.toBeNull();
    const point = ofType(events, 'point');
    expect(point).toHaveLength(1);
    expect(point[0]!.event.reason).toBe('double-touch');
    expect(point[0]!.event.winner).toBe(1);
    const c2 = ofType(events, 'contact');
    expect(c2).toHaveLength(1);
    expect(c2[0]!.event.player).toBe(0);
    expect(c2[0]!.event.touchNo).toBe(2);
    expect(c2[0]!.tick).toBe(point[0]!.tick);
    expect(c2[0]!.tick - firstTick).toBeGreaterThanOrEqual(40);
    expect(state.score.points).toEqual([0, 1]);
  });

  it('przejście nad siatką zeruje licznik: po 3 odbiciach rywal przyjmuje jako odbicie nr 1', () => {
    const state = makeState(13);
    placePlayer(state, 0, -6, -8);
    placePlayer(state, 1, 6, -8);
    placePlayer(state, 3, 6, 8);
    // Po trzech odbiciach niebieskich piłka leci nad siatką w (0, 5) – apogeum ~3 m, prześwit
    // nad siatką ~0,7 m, więc tor nie kończy się na siatce.
    launchBallTo(state, { x: 0, y: 2.0, z: -3 }, { x: 0, z: 5 }, 1.4, {
      touches: 3,
      lastToucher: 0,
      sideOfBall: 0,
    });
    run(state, 1);
    expect(state.landing.valid).toBe(true);
    expect(state.landing.hitsNet).toBe(false);
    // Rywal 2 czeka tam, gdzie piłka opadnie do wysokości przyjęcia.
    placePlayer(state, 2, state.landing.intercept.x, state.landing.intercept.z);

    // Do przejścia nad siatką licznik trzyma 3 i strona to 0.
    let guard = 0;
    while (state.ball.pos.z <= 0 && guard++ < 200) {
      expect(state.rally.touches).toBe(3);
      expect(state.rally.sideOfBall).toBe(0);
      run(state, 1);
    }
    expect(state.ball.pos.z).toBeGreaterThan(0);
    expect(state.rally.phase).toBe('rally');
    expect(state.rally.sideOfBall).toBe(1);
    expect(state.rally.touches).toBe(0);
    // Odpowiedzialność za ewentualny aut zostaje przy ostatnim, który dotknął.
    expect(state.rally.lastToucher).toBe(0);

    // Zamach rywala, gdy piłka wchodzi w zasięg: odbicie nr 1, bez punktu.
    const { found, events } = runUntil(state, 'contact', 300, (_t, s) =>
      canReach(s, 2) ? [swing(2)] : [],
    );
    expect(found).not.toBeNull();
    const contact = ofType(events, 'contact')[0]!.event;
    expect(contact.player).toBe(2);
    expect(contact.touchNo).toBe(1);
    expect(contact.kind).toBe('receive');
    expect(ofType(events, 'point')).toHaveLength(0);
    expect(state.rally.phase).toBe('rally');
    expect(state.rally.touches).toBe(1);
    expect(state.rally.lastToucher).toBe(2);
  });

  it('po serwisie serwujący może przyjąć własną piłkę odbitą od siatki (touches = 0)', () => {
    const state = makeState(7);
    ballAt(state, 0, { touches: 0, lastToucher: 0, sideOfBall: 0 });
    const ev = run(state, 1, () => [swing(0)]);
    expect(ofType(ev, 'point')).toHaveLength(0);
    expect(ofType(ev, 'contact')).toHaveLength(1);
  });
});

describe('zasady – aut i boisko', () => {
  const OUT = 0.03;
  const drop = (x: number, z: number, lastToucher: PlayerId) => {
    const state = makeState(8);
    // Zawodnicy z dala od miejsca spadania.
    for (const p of state.players) p.pos.x = p.team === 0 ? -6 : 6;
    setRallyBall(state, { x, y: 1.0, z }, { x: 0, y: 0, z: 0 }, { lastToucher, touches: 1 });
    const { events } = runUntil(state, 'floor', 300);
    const floor = ofType(events, 'floor')[0];
    const point = ofType(events, 'point')[0];
    expect(floor).toBeDefined();
    expect(point).toBeDefined();
    return { state, floor: floor!.event, point: point!.event };
  };

  const edgeX = COURT_HALF_W + BALL_R;
  const edgeZ = COURT_HALF_L + BALL_R;

  it('tuż za każdą z 4 linii → floor-out dla rywali ostatniego kontaktu', () => {
    const cases: [number, number, PlayerId, TeamId][] = [
      [edgeX + OUT, -5, 2, 0], // prawa linia boczna, strona 0, ostatni dotknął czerwony → punkt niebieskich
      [-(edgeX + OUT), -5, 0, 1], // lewa linia boczna, strona 0, ostatni niebieski → punkt czerwonych
      [1, -(edgeZ + OUT), 3, 0], // linia końcowa niebieskich, ostatni czerwony → punkt niebieskich
      [-1, edgeZ + OUT, 1, 1], // linia końcowa czerwonych, ostatni niebieski → punkt czerwonych
    ];
    for (const [x, z, last, expectedWinner] of cases) {
      const { floor, point } = drop(x, z, last);
      expect(floor.inCourt).toBe(false);
      expect(point.reason).toBe('floor-out');
      expect(point.winner).toBe(expectedWinner);
      // Reguła w jednym miejscu: wygrywa drużyna przeciwna do ostatniego kontaktu.
      expect(point.winner).toBe(last < 2 ? 1 : 0);
    }
  });

  it('tuż wewnątrz linii → floor-in dla drużyny z drugiej strony', () => {
    const cases: [number, number, TeamId][] = [
      [edgeX - OUT, -5, 1],
      [-(edgeX - OUT), -5, 1],
      [1, -(edgeZ - OUT), 1],
      [-1, edgeZ - OUT, 0],
      [edgeX - OUT, 5, 0],
    ];
    for (const [x, z, expectedWinner] of cases) {
      const { floor, point } = drop(x, z, 0);
      expect(floor.inCourt).toBe(true);
      expect(point.reason).toBe('floor-in');
      expect(point.winner).toBe(expectedWinner);
    }
  });

  it('miejsce upadku jest interpolowane – cień decyduje tam, gdzie piłka dotknęła podłogi', () => {
    // Piłka leci płasko i szybko (12 m/s = 10 cm na tick): bez interpolacji punkt upadku
    // byłby przesunięty nawet o 10 cm względem chwili dotknięcia podłogi.
    const state = makeState(9);
    for (const p of state.players) p.pos.z = p.team === 0 ? -10 : 10;
    const from = { x: 4.0, y: 0.3, z: -3 };
    const vel = { x: 12, y: -2, z: 0 };
    setRallyBall(state, from, vel, { lastToucher: 2 });
    // Analityczna chwila dotknięcia: bisekcja y(t) = BALL_R na torze z tłumieniem.
    let lo = 0;
    let hi = 0.5;
    for (let i = 0; i < 60; i++) {
      const mid = (lo + hi) / 2;
      if (positionAt(from, vel, mid).y > BALL_R) lo = mid;
      else hi = mid;
    }
    const exact = positionAt(from, vel, hi);
    const { events } = runUntil(state, 'floor', 100);
    const floor = ofType(events, 'floor')[0]!.event;
    expect(Math.abs(floor.pos.x - exact.x)).toBeLessThan(0.002);
    expect(Math.abs(floor.pos.z - exact.z)).toBeLessThan(0.002);
  });
});

describe('zasady – punktacja', () => {
  it('7:5 kończy, 6:6 nie, 7:6 nie, 8:6 kończy, 10:9 kończy', () => {
    expect(setWinnerFor([7, 5])).toBe(0);
    expect(setWinnerFor([5, 7])).toBe(1);
    expect(setWinnerFor([6, 6])).toBe(-1);
    expect(setWinnerFor([7, 6])).toBe(-1);
    expect(setWinnerFor([8, 6])).toBe(0);
    expect(setWinnerFor([9, 9])).toBe(-1);
    expect(setWinnerFor([10, 9])).toBe(0);
    expect(setWinnerFor([9, 10])).toBe(1);
    expect(setWinnerFor([0, 0])).toBe(-1);
  });

  it('punkt kończący set daje set-over od razu i fazę set-over po pauzie', () => {
    const state = makeState(10);
    state.score.points = [6, 4];
    setRallyBall(state, { x: 0, y: 1, z: -5 }, { x: 0, y: 0, z: 0 }, { lastToucher: 0 });
    const { events } = runUntil(state, 'point', 300);
    expect(ofType(events, 'set-over')).toHaveLength(0); // 6:5 – gra trwa

    // Drugi punkt dla czerwonych: 6:6 – nie kończy; trzeci i czwarty 6:8 – kończy.
    state.rally.phase = 'rally';
    awardPoint(state, 1, 'floor-in');
    expect(state.score.setWinner).toBe(-1);
    state.rally.phase = 'rally';
    awardPoint(state, 1, 'floor-in');
    expect(state.score.setWinner).toBe(-1);
    state.rally.phase = 'rally';
    awardPoint(state, 1, 'floor-in');
    expect(state.score.points).toEqual([6, 8]);
    expect(state.score.setWinner).toBe(1);
    expect(state.events.some((e) => e.type === 'set-over')).toBe(true);
    run(state, Math.round(POINT_FREEZE_S * TICK_HZ) + 1);
    expect(state.rally.phase).toBe('set-over');
  });

  it('po punkcie po 1,5 s faza serve, serwuje zwycięzca, w drużynie naprzemiennie', () => {
    const state = makeState(11); // drużyna 0 serwowała zawodnikiem 0 (servesByTeam[0] = 1)
    expect(state.rally.server).toBe(0);
    expect(state.rally.servesByTeam).toEqual([1, 0]);

    const freeze = Math.round(POINT_FREEZE_S * TICK_HZ);
    const dropFor = (winner: TeamId) => {
      // Piłka spada w boisko po stronie przegranych.
      const z = winner === 0 ? 5 : -5;
      setRallyBall(state, { x: 0, y: 1, z }, { x: 0, y: 0, z: 0 }, { lastToucher: 0 });
      const { found } = runUntil(state, 'point', 300);
      expect(found).not.toBeNull();
      const pointTick = found!.tick;
      // Zmiana fazy w kroku o ticku pointTick + freeze; krok wcześniej jeszcze pauza.
      run(state, pointTick + freeze - state.tick);
      expect(state.rally.phase).toBe('point');
      run(state, 1);
      expect(state.rally.phase).toBe('serve');
      expect(state.rally.servingTeam).toBe(winner);
      expect(state.ball.held).toBe(state.rally.server);
      expect(state.events.some((e) => e.type === 'serve-ready')).toBe(true);
      return state.rally.server;
    };

    // Czerwoni wygrywają dwa punkty z rzędu: serwują 2, potem 3.
    expect(dropFor(1)).toBe(playersOf(1)[0]);
    expect(dropFor(1)).toBe(playersOf(1)[1]);
    // Niebiescy wygrywają: serwował już 0, więc teraz 1 – i aktywny staje się 1.
    expect(dropFor(0)).toBe(1);
    expect(state.active).toBe(1);
    expect(dropFor(0)).toBe(0);
    expect(state.active).toBe(0);
    expect(state.rally.servesByTeam).toEqual([3, 2]);
  });
});
