/**
 * Zasada „nie zabieraj gry” (docs/20 §3.2, docs/22 §6): partner-AI ustępuje
 * człowiekowi, gdy ten zdąży do piłki; przejmuje, gdy człowiek jest daleko
 * albo już odbił.
 *
 * Serwis rywali jest tu zadawany ręcznie (komenda swing z jawnym celem i siłą,
 * jakość serwisu = 1, więc piłka ląduje dokładnie w celu) – serwis AI celuje
 * „między rywalami”, czyli odsuwanie człowieka przesuwałoby też lądowanie.
 * Lista controlled = [1, 2, 3] jest stała (człowiek = 0) niezależnie od tego,
 * co sim zrobi z `active` – sprawdzamy regułę AI, nie przełączanie aktywnego.
 */
import { describe, expect, it } from 'vitest';
import { canReach, createSimState, step } from '../../src/sim';
import { PLAYER_MAX_SPEED } from '../../src/sim/constants';
import { setterSpot } from '../../src/sim/spots';
import type { Command, PlayerId, SimState, Vec2 } from '../../src/sim/types';
import { distXZ } from '../../src/sim/vec';
import { aiCommands, createAi } from '../../src/ai';
import type { AiState } from '../../src/ai';

const CONTROLLED: readonly PlayerId[] = [1, 2, 3];
/** Bezpiecznik na pętle: 10 s symulacji. */
const MAX_TICKS = 1200;
/** Serwis 1,35 m od człowieka stojącego w bazie (−2,25, −6): zdąży, ale piłka nie trafi w kapsułę. */
const SERVE_NEAR_HUMAN: Vec2 = { x: -1.0, z: -6.5 };
/** Serwis w okolice partnera (2,25, −6). */
const SERVE_NEAR_PARTNER: Vec2 = { x: 1.5, z: -6.5 };

interface Trace {
  /** Ticki, w których zawodnik 1 wysłał swing. */
  swings1: number[];
  /** Ticki kontaktów zawodnika 1. */
  contacts1: number[];
  /** Najmniejsza odległość zawodnika 1 od miejsca rozgrywającego w trakcie lotu. */
  minSetterDist: number;
  /** Tick, w którym piłka spadła na podłogę (event floor); -1 = nie spadła. */
  floorTick: number;
}

/** Rywal serwuje natychmiast w zadany punkt. Zwraca odległość człowieka od lądowania. */
function serveAt(sim: SimState, aim: Vec2): number {
  step(sim, [{ type: 'swing', player: sim.rally.server, aim, power: 0.4 }]);
  expect(sim.rally.phase).toBe('rally');
  expect(sim.landing.valid).toBe(true);
  return distXZ(sim.players[0].pos, sim.landing.pos);
}

/** Gra do pierwszego lądowania piłki (albo do punktu); człowiek nic nie robi. */
function playUntilFloor(sim: SimState, ai: AiState): Trace {
  const t: Trace = { swings1: [], contacts1: [], minSetterDist: Infinity, floorTick: -1 };
  for (let i = 0; i < MAX_TICKS; i++) {
    const cmds: Command[] = aiCommands(ai, sim, CONTROLLED);
    for (const c of cmds) {
      if (c.type === 'swing' && c.player === 1) t.swings1.push(sim.tick);
    }
    step(sim, cmds);
    for (const e of sim.events) {
      if (e.type === 'contact' && e.player === 1) t.contacts1.push(sim.tick - 1);
      if (e.type === 'floor' && t.floorTick < 0) t.floorTick = sim.tick - 1;
    }
    if (t.floorTick < 0) {
      const p1 = sim.players[1];
      t.minSetterDist = Math.min(t.minSetterDist, distXZ(p1.pos, setterSpot(0, p1.pos.x)));
    }
    if (t.floorTick >= 0 || sim.rally.phase !== 'rally') break;
  }
  return t;
}

describe('Partner-AI – „nie zabieraj gry”', () => {
  it('człowiek zdąży → partner nie zamachuje się, idzie na miejsce rozgrywającego', () => {
    const sim = createSimState({ seed: 11, servingTeam: 1, humanControl: true });
    const ai = createAi(11);
    const humanDist = serveAt(sim, SERVE_NEAR_HUMAN);
    // Warunek scenariusza: człowiek zdążyłby z dużym zapasem (lot serwisu ~1,5 s).
    expect(humanDist / PLAYER_MAX_SPEED).toBeLessThan(0.5);

    const t = playUntilFloor(sim, ai);
    // Piłka spadła po naszej stronie – nikt jej nie odbił, punkt dla rywali.
    expect(t.floorTick).toBeGreaterThan(0);
    expect(sim.rally.pointWinner).toBe(1);
    // Partner ani razu nie zamachnął się przed lądowaniem i niczego nie dotknął.
    expect(t.swings1.filter((tick) => tick <= t.floorTick)).toEqual([]);
    expect(t.contacts1).toEqual([]);
    // I szedł na miejsce rozgrywającego: z bazy (3,8 m od tego miejsca) zbliżył się wyraźnie.
    expect(t.minSetterDist).toBeLessThan(2.0);
  });

  it('człowiek 8 m od lądowania → partner idzie do piłki i się zamachuje', () => {
    const sim = createSimState({ seed: 11, servingTeam: 1, humanControl: true });
    const ai = createAi(11);
    // Człowiek w dalekim rogu własnej połowy (sim ma margines 2 m za liniami).
    sim.players[0].pos.x = -6;
    sim.players[0].pos.z = -10.5;
    const humanDist = serveAt(sim, SERVE_NEAR_PARTNER);
    expect(humanDist).toBeGreaterThan(7);

    const t = playUntilFloor(sim, ai);
    // Partner zamachnął się i trafił w piłkę, zanim spadła.
    expect(t.swings1.length).toBeGreaterThan(0);
    expect(t.contacts1.length).toBeGreaterThan(0);
    if (t.floorTick >= 0) expect(t.contacts1[0]).toBeLessThan(t.floorTick);
  });

  it('po odbiciu człowieka partner przejmuje piłkę (wystawa), nie czeka', () => {
    const sim = createSimState({ seed: 11, servingTeam: 1, humanControl: true });
    const ai = createAi(11);
    serveAt(sim, SERVE_NEAR_HUMAN);
    let humanHit = -1;
    let humanSwung = false;
    let partnerSwingAfter = -1;
    let partnerContactAfter = -1;

    for (let i = 0; i < MAX_TICKS; i++) {
      const cmds: Command[] = aiCommands(ai, sim, CONTROLLED);
      const p0 = sim.players[0];
      if (humanHit < 0 && sim.landing.valid && !sim.landing.hitsNet) {
        // Człowiek biegnie pod piłkę (0,3 m za lądowaniem) i macha, gdy sim mówi, że sięga.
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
      if (humanHit >= 0 && partnerSwingAfter < 0) {
        if (cmds.some((c) => c.type === 'swing' && c.player === 1)) partnerSwingAfter = sim.tick;
      }
      step(sim, cmds);
      for (const e of sim.events) {
        if (e.type === 'contact' && e.player === 0 && humanHit < 0) humanHit = sim.tick - 1;
        if (e.type === 'contact' && e.player === 1 && humanHit >= 0 && partnerContactAfter < 0) {
          partnerContactAfter = sim.tick - 1;
        }
      }
      if (partnerContactAfter >= 0 || sim.rally.phase !== 'rally') break;
    }

    expect(humanHit).toBeGreaterThanOrEqual(0);
    expect(partnerSwingAfter).toBeGreaterThan(humanHit);
    expect(partnerContactAfter).toBeGreaterThan(humanHit);
    // Wystawa partnera to drugie odbicie po naszej stronie.
    expect(sim.lastContact?.player).toBe(1);
    expect(sim.lastContact?.touchNo).toBe(2);
  });
});
