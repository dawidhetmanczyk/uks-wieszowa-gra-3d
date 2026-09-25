/**
 * Przegląd AI po F0 – po jednym teście na każde naprawione znalezisko:
 * 1. reużyty AiState po cofnięciu ticku gra jak świeży (reset rng, nie tylko mózgów);
 * 2. obrona rusza do ataku rywali, zanim piłka przeleci nad siatką;
 * 3. po własnym 1. odbiciu drugi z pary nie ucieka do bazy na czas reakcji;
 * 4. po każdym kontakcie AI wysyła release w następnym ticku;
 * 5. kwantyzacja move nie przekracza prędkości profilu.
 *
 * Asercje dotyczą decyzji AI (komendy, role), nie dokładnych ticków kontaktów sim –
 * sim jest strojony równolegle i te testy mają to przetrwać.
 */
import { describe, expect, it } from 'vitest';
import {
  BASE_DEPTH,
  basePosition,
  canReach,
  createSimState,
  distXZ,
  MAX_TOUCHES,
  nextFloat,
  partnerOf,
  PLAYER_MAX_SPEED,
  seedRng,
  setterSpot,
  sideOf,
  step,
  TICK_HZ,
  type Command,
  type PlayerId,
  type SimState,
  type Vec2,
} from '../../src/sim';
import { aiCommands, createAi, NOWICJUSZ } from '../../src/ai';
import type { AiRole } from '../../src/ai';
import { launchBallTo, placePlayer } from '../sim/pomocnicze';

const ALL: readonly PlayerId[] = [0, 1, 2, 3];
/** Bezpiecznik na pętle: 10 s symulacji. */
const MAX_TICKS = 10 * TICK_HZ;

/** Rywal serwuje natychmiast w zadany punkt (jakość 1 – piłka ląduje dokładnie w celu). */
function serveAt(sim: SimState, aim: Vec2): void {
  step(sim, [{ type: 'swing', player: sim.rally.server, aim, power: 0.4 }]);
  expect(sim.rally.phase).toBe('rally');
}

/** Gra AI vs AI do pierwszego kontaktu zawodnika z `team`; zwraca kto odbił (-1 = nikt). */
function playUntilFirstTouch(sim: SimState, ai: ReturnType<typeof createAi>, team: 0 | 1) {
  for (let i = 0; i < MAX_TICKS; i++) {
    step(sim, aiCommands(ai, sim, ALL));
    for (const e of sim.events) {
      if (e.type === 'contact' && sim.players[e.player].team === team) return e.player;
    }
    if (sim.rally.phase !== 'rally') break;
  }
  return -1;
}

describe('AI – przegląd F0', () => {
  it('1. reużyty AiState po nowym secie (tick cofnięty) gra identycznie jak świeży createAi', () => {
    // AI „zużyte” na 300 tickach innego meczu – rng odjechał od ziarna.
    const reused = createAi(5);
    const sim5 = createSimState({ seed: 5, humanControl: false });
    for (let i = 0; i < 300; i++) step(sim5, aiCommands(reused, sim5, ALL));
    expect(reused.lastTick).toBe(299);

    const simReused = createSimState({ seed: 9, humanControl: false });
    const simFresh = createSimState({ seed: 9, humanControl: false });
    const fresh = createAi(9);
    const cmdsReused: Command[][] = [];
    const cmdsFresh: Command[][] = [];
    for (let i = 0; i < 10 * TICK_HZ; i++) {
      const a = aiCommands(reused, simReused, ALL);
      cmdsReused.push(a);
      step(simReused, a);
      const b = aiCommands(fresh, simFresh, ALL);
      cmdsFresh.push(b);
      step(simFresh, b);
    }
    // Test ma sens tylko, gdy AI w ogóle losowało (serwis po 1 s ciągnie szum celu i siłę).
    expect(cmdsFresh.flat().some((c) => c.type === 'swing')).toBe(true);
    expect(JSON.stringify(simReused)).toBe(JSON.stringify(simFresh));
    expect(JSON.stringify(reused)).toBe(JSON.stringify(fresh));
    expect(JSON.stringify(cmdsReused)).toBe(JSON.stringify(cmdsFresh));
  });

  it('2. po ataku rywali (3 odbicia po ich stronie) para rusza do piłki przed przelotem nad siatką', () => {
    const sim = createSimState({ seed: 21, humanControl: false });
    const ai = createAi(21);
    // Pierwszy odczyt w fazie serwisu = brak percepcji; kolejne przyjdą w rytmie reactionTicks.
    step(sim, aiCommands(ai, sim, [0, 1]));
    // Piłka po stronie czerwonych po ich 3. odbiciu, leci na naszą połowę: lot 1 s, siatka po ~0,5 s.
    launchBallTo(sim, { x: 0, y: 2.8, z: 3.0 }, { x: 0.5, z: -3.0 }, 1.0, {
      touches: MAX_TOUCHES,
      lastToucher: 2,
      sideOfBall: 1,
    });
    step(sim, []);
    expect(sim.landing.valid).toBe(true);
    expect(sim.landing.hitsNet).toBe(false);
    expect(sideOf(sim.landing.pos.z)).toBe(0);
    expect(sim.rally.sideOfBall).toBe(1);

    const limit = NOWICJUSZ.reactionTicks + 2;
    let firstMoveAfter = -1;
    let ballStillOnTheirSide = false;
    for (let i = 0; i < limit && firstMoveAfter < 0; i++) {
      const cmds = aiCommands(ai, sim, [0, 1]);
      for (const c of cmds) {
        if (c.type !== 'move' || (c.x === 0 && c.z === 0)) continue;
        const p = sim.players[c.player].pos;
        const toIntercept = {
          x: sim.landing.intercept.x - p.x,
          z: sim.landing.intercept.z - p.z,
        };
        // Ruch „w stronę” = dodatni iloczyn skalarny (błąd odczytu 0,6 m nie odwraca kierunku z 4 m).
        if (c.x * toIntercept.x + c.z * toIntercept.z > 0) {
          firstMoveAfter = i;
          ballStillOnTheirSide = sim.rally.sideOfBall === 1;
        }
      }
      step(sim, cmds);
    }
    expect(firstMoveAfter, 'ruch w stronę piłki w czasie reakcji').toBeGreaterThanOrEqual(0);
    expect(firstMoveAfter).toBeLessThan(limit);
    expect(ballStillOnTheirSide, 'ruch zanim piłka przeleci nad siatką').toBe(true);
  });

  it('3a. AI vs AI: po 1. odbiciu drugi z pary trzyma miejsce rozgrywającego albo idzie do piłki', () => {
    const sim = createSimState({ seed: 11, servingTeam: 1, humanControl: false });
    const ai = createAi(11);
    serveAt(sim, { x: -1.0, z: -6.5 });
    const receiver = playUntilFirstTouch(sim, ai, 0);
    expect(receiver).toBeGreaterThanOrEqual(0);
    expect(sim.rally.touches).toBe(1);
    const partner = partnerOf(receiver as PlayerId);
    // Warunek scenariusza: przyjęcie leci ku siatce (nie w okolice bazy).
    expect(sim.landing.valid).toBe(true);
    expect(Math.abs(sim.landing.pos.z)).toBeLessThan(BASE_DEPTH - 1);

    const p = sim.players[partner];
    const d0 = distXZ(p.pos, setterSpot(0, p.pos.x));
    const roles: AiRole[] = [];
    let dMaxWhileSetter = d0;
    for (let i = 0; i < NOWICJUSZ.reactionTicks; i++) {
      const cmds = aiCommands(ai, sim, ALL);
      const role = ai.brains[partner].role;
      roles.push(role);
      step(sim, cmds);
      if (role === 'setter') {
        dMaxWhileSetter = Math.max(dMaxWhileSetter, distXZ(p.pos, setterSpot(0, p.pos.x)));
      }
    }
    // Przez czas reakcji: miejsce rozgrywającego; po odczycie: do piłki. Nigdy baza ani atak.
    for (const r of roles) expect(['setter', 'ball'], roles.join(',')).toContain(r);
    expect(roles, 'partner przejmuje piłkę po odczycie').toContain('ball');
    // Trzymając miejsce, nie oddala się od niego (bieg do bazy dawał +0,5 m w 30 tickach).
    expect(dMaxWhileSetter).toBeLessThanOrEqual(d0 + 0.1);
  });

  it('3b. człowiek przyjmuje → partner-AI trzyma miejsce rozgrywającego, potem idzie do piłki', () => {
    const sim = createSimState({ seed: 11, servingTeam: 1, humanControl: true });
    const ai = createAi(11);
    serveAt(sim, { x: -1.0, z: -6.5 });
    let humanHit = -1;
    let humanSwung = false;
    const roles: AiRole[] = [];
    for (let i = 0; i < MAX_TICKS && roles.length < NOWICJUSZ.reactionTicks; i++) {
      const cmds = aiCommands(ai, sim, [1, 2, 3]);
      if (humanHit >= 0) roles.push(ai.brains[1].role);
      const p0 = sim.players[0];
      if (humanHit < 0 && sim.landing.valid && !sim.landing.hitsNet) {
        // Człowiek biegnie 0,3 m za lądowanie i macha, gdy sim mówi, że sięga (jak w partner.test.ts).
        const dx = sim.landing.pos.x - p0.pos.x;
        const dz = sim.landing.pos.z - 0.3 - p0.pos.z;
        const d = Math.hypot(dx, dz);
        if (d > 0.15) cmds.push({ type: 'move', player: 0, x: dx / d, z: dz / d });
        else cmds.push({ type: 'move', player: 0, x: 0, z: 0 });
        if (!humanSwung && canReach(sim, 0)) {
          cmds.push({ type: 'swing', player: 0, aim: null });
          humanSwung = true;
        }
      }
      if (humanHit >= 0 && p0.lastHitTick === sim.tick - 1) {
        cmds.push({ type: 'release', player: 0 }, { type: 'move', player: 0, x: 0, z: 0 });
      }
      step(sim, cmds);
      for (const e of sim.events) {
        if (e.type === 'contact' && e.player === 0 && humanHit < 0) humanHit = sim.tick - 1;
      }
      if (sim.rally.phase !== 'rally') break;
    }
    expect(humanHit).toBeGreaterThanOrEqual(0);
    expect(roles.length).toBe(NOWICJUSZ.reactionTicks);
    for (const r of roles) expect(['setter', 'ball'], roles.join(',')).toContain(r);
    expect(roles, 'partner przejmuje piłkę po odczycie').toContain('ball');
  });

  it('4. po każdym kontakcie z otwartego zamachu AI wysyła release w następnym ticku', () => {
    const sim = createSimState({ seed: 3, humanControl: false });
    const ai = createAi(3);
    /** Zamach wysłany przez AI, po którym nie poszło jeszcze release. */
    const openSwing = [false, false, false, false];
    let checked = 0;
    let alreadyReleased = 0;
    let pending: PlayerId | -1 = -1;
    for (let i = 0; i < 60 * TICK_HZ; i++) {
      const cmds = aiCommands(ai, sim, ALL);
      if (pending !== -1) {
        const released = cmds.some((c) => c.type === 'release' && c.player === pending);
        expect(released, `tick ${sim.tick}: brak release zawodnika ${pending}`).toBe(true);
        checked++;
        pending = -1;
      }
      for (const c of cmds) {
        if (c.type === 'swing') openSwing[c.player] = true;
        else if (c.type === 'release') openSwing[c.player] = false;
      }
      step(sim, cmds);
      for (const e of sim.events) {
        // Bierny kontakt (piłka w kapsułę) nie jest zamachem AI – nie ma czego puszczać.
        if (e.type !== 'contact' || e.kind === 'passive') continue;
        // Release należy się po kontakcie z otwartego zamachu. Gdy AI puściło już po limicie
        // 0,5 s (sim trzyma okno otwarte w skoku do lądowania), drugi release nie ma sensu.
        if (openSwing[e.player]) pending = e.player;
        else alreadyReleased++;
      }
    }
    console.log(
      `release po kontakcie: ${checked} kontaktów z otwartego zamachu, ${alreadyReleased} po wcześniejszym release (limit 0,5 s), 60 s`,
    );
    expect(checked).toBeGreaterThanOrEqual(10);
  });

  it('5. |move| po kwantyzacji nie przekracza maxSpeed / PLAYER_MAX_SPEED dla 1000 kierunków', () => {
    const sim = createSimState({ seed: 1, humanControl: false });
    const ai = createAi(1);
    // Faza point: rola „base”, cel = pozycja bazowa; zawodnik 2 stawiany 3 m od niej pod kolejnymi kątami.
    sim.rally.phase = 'point';
    sim.rally.phaseTick = sim.tick;
    const base = basePosition(1, 0);
    const limit = Math.min(1, NOWICJUSZ.maxSpeed / PLAYER_MAX_SPEED);
    expect(limit).toBeCloseTo(0.7826, 4);
    const rng = { rng: seedRng(42) };
    let maxLen = 0;
    let minLen = Infinity;
    let moves = 0;
    for (let i = 0; i < 1000; i++) {
      const angle = nextFloat(rng) * 2 * Math.PI;
      placePlayer(sim, 2, base.x + 3 * Math.cos(angle), base.z + 3 * Math.sin(angle));
      const mv = aiCommands(ai, sim, [2]).find((c) => c.type === 'move' && c.player === 2);
      if (!mv || mv.type !== 'move') continue;
      moves++;
      // Siatka 0,01 na każdej składowej (zwięzłe nagrania).
      expect(Math.round(mv.x * 100) / 100).toBe(mv.x);
      expect(Math.round(mv.z * 100) / 100).toBe(mv.z);
      const l = Math.hypot(mv.x, mv.z);
      maxLen = Math.max(maxLen, l);
      minLen = Math.min(minLen, l);
    }
    console.log(
      `kwantyzacja: ${moves} ruchów, |move| ∈ [${minLen.toFixed(4)}, ${maxLen.toFixed(4)}], limit ${limit.toFixed(4)}`,
    );
    expect(moves).toBe(1000);
    expect(maxLen).toBeLessThanOrEqual(0.7826 + 1e-9);
    expect(maxLen).toBeLessThanOrEqual(limit + 1e-9);
    // I nie za wolno: ucięcie w dół kosztuje najwyżej dwa kwanty.
    expect(minLen).toBeGreaterThanOrEqual(limit - 0.02);
  });
});
