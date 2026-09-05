import { describe, expect, it } from 'vitest';
import {
  appendTick,
  createRecording,
  createSimState,
  replay,
  step,
  TICK_HZ,
  type Command,
  type SimState,
} from '../../src/sim';
import { makeState, placePlayer, run, setRallyBall, swing } from './pomocnicze';

/**
 * Skrypt „meczu”: serwis gracza, bieganie obu zawodników drużyny 0, zamachy co jakiś czas,
 * serwisy AI (komenda z power) gdy serwują czerwoni. Ten sam skrypt dla obu przebiegów.
 */
function scriptedCommands(tick: number, state: SimState): Command[] {
  const cmds: Command[] = [];
  const rally = state.rally;
  if (rally.phase === 'serve' && state.tick - rally.phaseTick === 60) {
    // Po 0,5 s serwuje ten, kto ma serwować – człowiek celuje w róg, AI bez celu.
    if (rally.servingTeam === 0) cmds.push(swing(rally.server, { x: 2.5, z: 6 }, 0.6));
    else cmds.push(swing(rally.server, null, 0.4));
  }
  if (tick % 97 === 0) cmds.push({ type: 'move', player: 0, x: Math.sin(tick / 300), z: 0.6 });
  if (tick % 131 === 0) cmds.push({ type: 'move', player: 1, x: -0.5, z: Math.cos(tick / 200) });
  if (tick % 211 === 0) cmds.push({ type: 'move', player: 2, x: 0.3, z: -0.4 });
  if (tick % 173 === 0) cmds.push({ type: 'move', player: 3, x: -0.6, z: 0.2 });
  if (rally.phase === 'rally') {
    if (tick % 50 === 7) cmds.push(swing(0, null));
    if (tick % 50 === 30) cmds.push({ type: 'release', player: 0 });
    if (tick % 70 === 20) cmds.push(swing(1, null));
    if (tick % 70 === 45) cmds.push({ type: 'release', player: 1 });
    if (tick % 60 === 10) cmds.push(swing(2, null, 0.5));
    if (tick % 60 === 40) cmds.push(swing(3, { x: -2, z: -5 }, 0.7));
  }
  return cmds;
}

describe('determinizm', () => {
  const TICKS = 30 * TICK_HZ;

  it('dwa przebiegi z tym samym ziarnem i komendami dają identyczny stan', () => {
    const a = createSimState({ seed: 42 });
    const b = createSimState({ seed: 42 });
    let contacts = 0;
    for (let t = 0; t < TICKS; t++) {
      step(a, scriptedCommands(t, a));
      step(b, scriptedCommands(t, b));
      contacts += a.events.filter((e) => e.type === 'contact').length;
    }
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    // Skrypt ma dawać żywy mecz, nie 30 s stania – inaczej test nic nie sprawdza.
    expect(contacts).toBeGreaterThan(5);
    expect(a.score.points[0] + a.score.points[1]).toBeGreaterThan(0);
  });

  it('nagranie i replay odtwarzają identyczny stan', () => {
    const live = createSimState({ seed: 42 });
    const rec = createRecording(live);
    for (let t = 0; t < TICKS; t++) {
      const cmds = scriptedCommands(t, live);
      appendTick(rec, t, cmds);
      step(live, cmds);
    }
    expect(rec.ticks.length).toBeGreaterThan(0);
    expect(rec.ticks.length).toBeLessThan(TICKS);
    const replayed = replay(rec, TICKS);
    expect(replayed.tick).toBe(live.tick);
    expect(JSON.stringify(replayed)).toBe(JSON.stringify(live));

    // Powtórka „do połowy” też jest zgodna z bieżącym stanem w tym samym ticku.
    const half = createSimState({ seed: 42 });
    for (let t = 0; t < TICKS / 2; t++) step(half, scriptedCommands(t, half));
    expect(JSON.stringify(replay(rec, TICKS / 2))).toBe(JSON.stringify(half));
  });

  it('inne ziarno daje inny stan po kontakcie z szumem (jakość < 1)', () => {
    const targets = [11, 22].map((seed) => {
      const state = makeState(seed);
      placePlayer(state, 0, -2, -6);
      // Piłka na krawędzi zasięgu poziomego → jakość ≈ 0,5 → szum ≈ 1,1 m.
      setRallyBall(state, { x: -2 + 0.9, y: 1.2, z: -6 }, { x: 0, y: -0.5, z: 0 });
      run(state, 1, () => [swing(0, null)]);
      expect(state.lastContact).not.toBeNull();
      expect(state.lastContact!.quality).toBeLessThan(1);
      return { target: state.lastContact!.target, vel: { ...state.ball.vel } };
    });
    expect(targets[0]!.target).not.toEqual(targets[1]!.target);
    expect(targets[0]!.vel).not.toEqual(targets[1]!.vel);
  });
});
