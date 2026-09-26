/**
 * Asysta ruchu F0b (src/ai/assist.ts) i pomiar „gra nie gra sama” (docs/21 F0b):
 * bez żadnego dotyku drużyna gracza nie odbija piłki – asysta tylko biega.
 *
 * Pętla jak w src/loop/index.ts: aktywnym steruje asysta, resztą AI. Rywale serwują
 * (serwis niebieskich czeka na stuknięcie człowieka, więc bez dotyku by nie padł).
 */
import { describe, expect, it } from 'vitest';
import {
  basePosition,
  createSimState,
  distXZ,
  INTERCEPT_HEIGHT,
  step,
  TICK_HZ,
  type Command,
  type PlayerId,
  type SimState,
} from '../../src/sim';
import { aiCommands, assistCommands, assistTarget, createAi, createAssist } from '../../src/ai';
import { launchBallTo, placePlayer, setRallyBall } from '../sim/pomocnicze';

const WITHOUT: Readonly<Record<PlayerId, readonly PlayerId[]>> = {
  0: [1, 2, 3],
  1: [0, 2, 3],
  2: [0, 1, 3],
  3: [0, 1, 2],
};
const SEEDS = [1, 2, 3, 4, 5];
const SECONDS = 90;

interface NoTouchRun {
  seed: number;
  blueContacts: number;
  points: [number, number];
  /** Odległość aktywnego od punktu przyjęcia w chwili, gdy piłka przecina INTERCEPT_HEIGHT. */
  ringDistances: number[];
  finalJson: string;
}

/** Mecz z człowiekiem, który niczego nie dotyka: aktywnym steruje tylko asysta. */
function playWithoutTouch(seed: number): NoTouchRun {
  const sim = createSimState({ seed, servingTeam: 1, humanControl: true, assist: true });
  const ai = createAi(seed);
  const assist = createAssist();
  let blueContacts = 0;
  const ringDistances: number[] = [];
  let pendingIntercept: { tick: number; x: number; z: number } | null = null;
  for (let t = 0; t < SECONDS * TICK_HZ && sim.rally.phase !== 'set-over'; t++) {
    const cmds: Command[] = [
      ...assistCommands(assist, sim),
      ...aiCommands(ai, sim, WITHOUT[sim.active]),
    ];
    step(sim, cmds);
    for (const e of sim.events) {
      if (e.type === 'contact' && e.player < 2) blueContacts++;
      // Serwis rywali: zapamiętaj, gdzie i kiedy piłka przetnie wysokość przyjęcia.
      if (e.type === 'contact' && e.kind === 'serve' && sim.landing.valid) {
        pendingIntercept = {
          tick: sim.landing.interceptTick,
          x: sim.landing.intercept.x,
          z: sim.landing.intercept.z,
        };
      }
    }
    if (pendingIntercept !== null && sim.tick >= pendingIntercept.tick) {
      if (sim.landing.intercept.z < 0) {
        ringDistances.push(distXZ(sim.players[sim.active].pos, pendingIntercept));
      }
      pendingIntercept = null;
    }
  }
  return {
    seed,
    blueContacts,
    points: [sim.score.points[0], sim.score.points[1]],
    ringDistances,
    finalJson: JSON.stringify(sim),
  };
}

describe('„gra nie gra sama” – bez dotyku drużyna gracza nie odbija piłki', () => {
  const runs = SEEDS.map(playWithoutTouch);

  it.each(runs)('seed $seed: zero kontaktów niebieskich (także biernych)', (r) => {
    expect(r.blueContacts).toBe(0);
  });

  it.each(runs)('seed $seed: rywale punktują, niebiescy nie', (r) => {
    expect(r.points[0]).toBe(0);
    expect(r.points[1]).toBeGreaterThan(0);
  });

  it('asysta biega: aktywny stoi na pierścieniu, gdy piłka przecina 1,1 m', () => {
    const all = runs.flatMap((r) => r.ringDistances).sort((a, b) => a - b);
    expect(all.length).toBeGreaterThan(20);
    const median = all[Math.floor(all.length / 2)] ?? Infinity;
    const within = all.filter((d) => d <= 0.5).length / all.length;
    console.log(
      `asysta: ${all.length} serwisów, mediana ${median.toFixed(2)} m od pierścienia, ` +
        `${(within * 100).toFixed(0)} % w promieniu 0,5 m (wysokość przyjęcia ${INTERCEPT_HEIGHT} m)`,
    );
    expect(median).toBeLessThan(0.3);
    expect(within).toBeGreaterThanOrEqual(0.8);
  });

  it('determinizm: ten sam seed daje ten sam mecz także z asystą', () => {
    expect(playWithoutTouch(3).finalJson).toBe(runs[2]?.finalJson);
  });
}, 120_000);

describe('cele asysty („jak AI partnera”)', () => {
  function rallyState(): SimState {
    const s = createSimState({ seed: 1, servingTeam: 1, humanControl: true, assist: true });
    return s;
  }

  it('serwis: serwujący stoi, reszta na pozycji bazowej', () => {
    const s = createSimState({ seed: 1, servingTeam: 0, humanControl: true, assist: true });
    expect(assistTarget(s, s.rally.server).goal).toBe('stand');
    const other = s.rally.server === 0 ? 1 : 0;
    expect(assistTarget(s, other)).toEqual({ goal: 'base', target: basePosition(0, other) });
  });

  it('piłka leci do nas → pierścień „tu stań” (landing.intercept)', () => {
    const s = rallyState();
    setRallyBall(s, { x: 0, y: 2.5, z: 5 }, { x: 0, y: 0, z: 0 }, { sideOfBall: 1 });
    launchBallTo(s, { x: 0, y: 2.5, z: 5 }, { x: -1, z: -6 }, 1.4);
    step(s, []);
    const t = assistTarget(s, s.active);
    expect(t.goal).toBe('ring');
    expect(t.target).toEqual(s.landing.intercept);
  });

  it('po własnym przyjęciu → miejsce ataku przy siatce', () => {
    const s = rallyState();
    placePlayer(s, 0, -2, -6);
    setRallyBall(
      s,
      { x: -2, y: 1.5, z: -6 },
      { x: 0, y: 6, z: 3 },
      { touches: 1, lastToucher: 0, sideOfBall: 0 },
    );
    step(s, []);
    s.active = 0;
    const t = assistTarget(s, 0);
    expect(t.goal).toBe('attack-spot');
    expect(t.target?.z).toBeCloseTo(-1.1, 5);
  });

  it('piłka leci do rywali → pozycja bazowa', () => {
    const s = rallyState();
    setRallyBall(s, { x: 0, y: 2.5, z: -3 }, { x: 0, y: 3, z: 8 }, { sideOfBall: 0 });
    step(s, []);
    expect(assistTarget(s, s.active).goal).toBe('base');
  });

  it('bez trybu asysty (F0, AI vs AI) asysta nie wysyła komend', () => {
    const s = createSimState({ seed: 1, humanControl: true, assist: false });
    expect(assistCommands(createAssist(), s)).toEqual([]);
    const ai = createSimState({ seed: 1, humanControl: false, assist: true });
    expect(ai.assist).toBe(false);
  });
});
