/**
 * Serwis AI (docs/22 §2 i §6): po 1,0 s od gotowości, nad siatką, na boisko rywali.
 */
import { describe, expect, it } from 'vitest';
import { createSimState, step } from '../../src/sim';
import { AI_SERVE_DELAY_S, BALL_R, TICK_HZ } from '../../src/sim/constants';
import { isInCourt } from '../../src/sim/spots';
import type { PlayerId } from '../../src/sim/types';
import { aiCommands, createAi } from '../../src/ai';

const ALL: readonly PlayerId[] = [0, 1, 2, 3];
const SEEDS = Array.from({ length: 20 }, (_, i) => 100 + i);
const EXPECTED_DELAY_TICKS = Math.round(AI_SERVE_DELAY_S * TICK_HZ);

interface ServeResult {
  seed: number;
  /** Ticki od wejścia w fazę serwisu do kontaktu; -1 = brak serwisu. */
  delayTicks: number;
  server: PlayerId | -1;
  /** Predykcja tuż po kontakcie: bez siatki, na połowie rywali, w boisku. */
  landsOnOpponentCourt: boolean;
}

function serveOnce(seed: number): ServeResult {
  const sim = createSimState({ seed, humanControl: false });
  const ai = createAi(seed);
  const phaseTick = sim.rally.phaseTick;
  const servingTeam = sim.rally.servingTeam;
  const res: ServeResult = { seed, delayTicks: -1, server: -1, landsOnOpponentCourt: false };
  // 3 s zapasu – serwis ma przyjść po ~1 s.
  for (let i = 0; i < 3 * TICK_HZ; i++) {
    step(sim, aiCommands(ai, sim, ALL));
    const serve = sim.events.find((e) => e.type === 'contact' && e.kind === 'serve');
    if (serve && serve.type === 'contact') {
      res.delayTicks = sim.tick - 1 - phaseTick;
      res.server = serve.player;
      const l = sim.landing;
      const opponentSide = servingTeam === 0 ? l.pos.z > 0 : l.pos.z < 0;
      res.landsOnOpponentCourt =
        l.valid && !l.hitsNet && opponentSide && isInCourt(l.pos.x, l.pos.z, BALL_R);
      break;
    }
  }
  return res;
}

describe('AI – serwis', () => {
  const results = SEEDS.map(serveOnce);

  it('serwuje po ~1,0 s od gotowości', () => {
    for (const r of results) {
      expect(r.delayTicks).toBeGreaterThanOrEqual(EXPECTED_DELAY_TICKS);
      expect(r.delayTicks).toBeLessThanOrEqual(EXPECTED_DELAY_TICKS + 6);
    }
  });

  it('serwuje zawodnik wskazany przez sim jako server', () => {
    for (const r of results) expect([0, 1]).toContain(r.server);
  });

  it('≥ 80 % serwisów przechodzi nad siatką i ląduje na boisku rywali', () => {
    const ok = results.filter((r) => r.landsOnOpponentCourt).length;
    console.log(`serwis: ${ok}/${results.length} w boisku rywali`);
    expect(ok / results.length).toBeGreaterThanOrEqual(0.8);
  });
});
