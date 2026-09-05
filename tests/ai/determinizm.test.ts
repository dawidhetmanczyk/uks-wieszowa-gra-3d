/**
 * Determinizm AI (CLAUDE.md zasada 4): ten sam seed → ten sam mecz co do bitu,
 * także po stronie stanu AI. Na tym stoją powtórki i „mecz tygodnia”.
 */
import { describe, expect, it } from 'vitest';
import { createSimState, step } from '../../src/sim';
import type { Command, PlayerId } from '../../src/sim/types';
import { aiCommands, createAi } from '../../src/ai';

const ALL: readonly PlayerId[] = [0, 1, 2, 3];
/** 60 s meczu. */
const TICKS = 7200;

function run(seed: number, ticks: number) {
  const sim = createSimState({ seed, humanControl: false });
  const ai = createAi(seed);
  const samples: number[] = [];
  const commands: Command[][] = [];
  let activeSwitches = 0;
  for (let i = 0; i < ticks; i++) {
    const cmds = aiCommands(ai, sim, ALL);
    commands.push(cmds);
    step(sim, cmds);
    for (const e of sim.events) if (e.type === 'active-switch') activeSwitches++;
    // Próbka toru piłki co 0,25 s – wystarczy, żeby odróżnić dwa różne mecze.
    if (i % 30 === 0) samples.push(sim.ball.pos.x, sim.ball.pos.z);
  }
  return { sim, ai, samples, commands, activeSwitches };
}

describe('AI – determinizm', () => {
  it('ten sam seed → identyczny stan sim i AI po 60 s AI vs AI', () => {
    const a = run(7, TICKS);
    const b = run(7, TICKS);
    expect(JSON.stringify(b.sim)).toBe(JSON.stringify(a.sim));
    expect(JSON.stringify(b.ai)).toBe(JSON.stringify(a.ai));
    expect(JSON.stringify(b.commands)).toBe(JSON.stringify(a.commands));
  }, 60_000);

  it('inny seed → inny przebieg meczu', () => {
    const a = run(7, TICKS);
    const b = run(8, TICKS);
    expect(JSON.stringify(b.samples)).not.toBe(JSON.stringify(a.samples));
    expect(JSON.stringify(b.ai.brains)).not.toBe(JSON.stringify(a.ai.brains));
  }, 60_000);

  it('aiCommands nie mutuje sim', () => {
    const sim = createSimState({ seed: 7, humanControl: false });
    const ai = createAi(7);
    for (let i = 0; i < 600; i++) {
      const before = JSON.stringify(sim);
      const cmds = aiCommands(ai, sim, ALL);
      expect(JSON.stringify(sim)).toBe(before);
      step(sim, cmds);
    }
  });

  it('komendy tylko dla controlled, w kolejności rosnącej id', () => {
    const sim = createSimState({ seed: 7, humanControl: false });
    const ai = createAi(7);
    for (let i = 0; i < 1200; i++) {
      const cmds = aiCommands(ai, sim, [3, 1]);
      let lastPlayer = -1;
      for (const c of cmds) {
        expect(c.type).not.toBe('new-set');
        if (c.type === 'new-set') continue;
        expect([1, 3]).toContain(c.player);
        expect(c.player).toBeGreaterThanOrEqual(lastPlayer);
        lastPlayer = c.player;
      }
      step(sim, cmds);
    }
  });

  it('move tylko przy zmianie wektora (kwantyzacja 0,01)', () => {
    const { commands, activeSwitches } = run(7, TICKS);
    const last = new Map<PlayerId, { x: number; z: number }>();
    let moves = 0;
    let repeated = 0;
    for (const tick of commands) {
      for (const c of tick) {
        if (c.type !== 'move') continue;
        moves++;
        const prev = last.get(c.player);
        if (prev && prev.x === c.x && prev.z === c.z) repeated++;
        expect(Math.round(c.x * 100) / 100).toBe(c.x);
        expect(Math.round(c.z * 100) / 100).toBe(c.z);
        last.set(c.player, { x: c.x, z: c.z });
      }
    }
    // Ruch musi w ogóle występować, inaczej test niczego nie sprawdza.
    expect(moves).toBeGreaterThan(0);
    // Powtórka tego samego wektora jest dopuszczalna tylko, gdy sim wyzerował move
    // przy przełączeniu aktywnego (liczy je także w AI vs AI) – AI musi go wtedy odesłać.
    expect(repeated).toBeLessThanOrEqual(activeSwitches);
  }, 60_000);
});
