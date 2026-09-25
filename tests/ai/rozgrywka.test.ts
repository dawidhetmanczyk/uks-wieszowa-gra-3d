/**
 * Sanity rozgrywki AI vs AI (progi luźne, F0): set się kończy, punkty padają
 * głównie z piłki na podłodze (nie z błędów regulaminowych), wymiany mają
 * sensowną liczbę kontaktów, obie drużyny punktują.
 */
import { describe, expect, it } from 'vitest';
import { createSimState, step } from '../../src/sim';
import { TICK_HZ } from '../../src/sim/constants';
import type { PlayerId, PointReason } from '../../src/sim/types';
import { aiCommands, createAi } from '../../src/ai';

const ALL: readonly PlayerId[] = [0, 1, 2, 3];
const SEEDS = [1, 2, 3, 4, 5];
/** 6 minut symulowanych. */
const MAX_TICKS = 6 * 60 * TICK_HZ;

interface SetStats {
  seed: number;
  ticks: number;
  finished: boolean;
  points: number;
  reasons: Record<PointReason, number>;
  contacts: number;
  score: [number, number];
}

function playSet(seed: number): SetStats {
  const sim = createSimState({ seed, humanControl: false });
  const ai = createAi(seed);
  const reasons: Record<PointReason, number> = {
    'floor-in': 0,
    'floor-out': 0,
    'four-touches': 0,
    'double-touch': 0,
    'under-net': 0,
  };
  let contacts = 0;
  let points = 0;
  let ticks = 0;
  while (sim.rally.phase !== 'set-over' && ticks < MAX_TICKS) {
    step(sim, aiCommands(ai, sim, ALL));
    ticks++;
    for (const e of sim.events) {
      if (e.type === 'contact') contacts++;
      if (e.type === 'point') {
        points++;
        reasons[e.reason]++;
      }
    }
  }
  return {
    seed,
    ticks,
    finished: sim.rally.phase === 'set-over',
    points,
    reasons,
    contacts,
    score: [sim.score.points[0], sim.score.points[1]],
  };
}

/** Jedna linia pomiaru do komunikatów asercji – padający test ma od razu pokazywać liczby. */
function describeSet(s: SetStats): string {
  return (
    `seed ${s.seed}: ${s.score[0]}:${s.score[1]} po ${(s.ticks / TICK_HZ).toFixed(0)} s ` +
    `(${s.finished ? 'set-over' : 'set trwa'}), ${s.points} pkt, ` +
    `${(s.contacts / Math.max(1, s.points)).toFixed(1)} kontaktów/wymianę, ${JSON.stringify(s.reasons)}`
  );
}

describe('AI vs AI – sanity rozgrywki', () => {
  const stats = SEEDS.map(playSet);

  it.each(stats)('seed $seed: set kończy się w < 6 min', (s) => {
    expect(s.finished, describeSet(s)).toBe(true);
    expect(s.ticks, describeSet(s)).toBeLessThan(MAX_TICKS);
  });

  it.each(stats)('seed $seed: ≥ 60 % punktów z podłogi (floor-in / floor-out)', (s) => {
    const floor = s.reasons['floor-in'] + s.reasons['floor-out'];
    expect(s.points).toBeGreaterThan(0);
    expect(floor / s.points).toBeGreaterThanOrEqual(0.6);
  });

  it.each(stats)('seed $seed: średnio ≥ 2 kontakty na wymianę', (s) => {
    expect(s.contacts / s.points).toBeGreaterThanOrEqual(2);
  });

  it('obie drużyny zdobywają punkty na choć jednym seedzie', () => {
    expect(stats.some((s) => s.score[0] > 0)).toBe(true);
    expect(stats.some((s) => s.score[1] > 0)).toBe(true);
  });

  it('raport (informacyjny)', () => {
    for (const s of stats) console.log(describeSet(s));
  });
}, 300_000);
