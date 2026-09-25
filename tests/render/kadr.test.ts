/**
 * Kadr (docs/RAPORT-F0.md §8): obaj zawodnicy drużyny gracza mają być CALI w oknie telefonu
 * w poziomie 844 × 390 – w każdej klatce 60 s meczu AI vs AI i w scenariuszu, w którym
 * człowiek biega aktywnym od linii do linii. Kamera i licznik kadru to kod gry
 * (src/render/camera.ts, src/render/framing.ts), nie kopia – Three liczy macierze w Node
 * tak samo jak w przeglądarce.
 *
 * Kontrola czułości: ta sama miara na kamerze F0 musi zgubić partnera w scenariuszu
 * skrajnym – inaczej test niczego by nie odróżniał.
 */
import { describe, expect, it } from 'vitest';
import { aiCommands, createAi } from '../../src/ai/index';
import {
  CAMERA_F0,
  DEFAULT_CAMERA,
  createGameCamera,
  type CameraConfig,
} from '../../src/render/camera';
import { createFramingMeter, type FramingStats } from '../../src/render/framing';
import {
  createSimState,
  step,
  type Command,
  type PlayerId,
  type SimState,
} from '../../src/sim/index';

const W = 844;
const H = 390;
const TICKS = 120 * 60;
/** Render 60 fps: klatka co dwa kroki sim. */
const TICKS_PER_FRAME = 2;

function runAiVsAi(seed: number, onFrame: (s: SimState) => void): void {
  const s = createSimState({ seed, humanControl: false });
  const ai = createAi(seed);
  for (let t = 0; t < TICKS; t++) {
    step(s, aiCommands(ai, s, [0, 1, 2, 3]));
    if (t % TICKS_PER_FRAME === 1) onFrame(s);
  }
}

/** Człowiek zmienia kierunek co 2 s: w bok, w bok, na skos do tyłu – po linie boczne i dalej. */
function runRunaway(seed: number, onFrame: (s: SimState) => void): void {
  const s = createSimState({ seed, humanControl: true, servingTeam: 1 });
  const ai = createAi(seed);
  const dirs = [
    { x: 1, z: 0 },
    { x: -1, z: 0 },
    { x: 0.7, z: -0.7 },
    { x: -0.7, z: -0.7 },
    { x: 1, z: 0.3 },
    { x: -1, z: 0.3 },
  ];
  let lastActive: PlayerId = s.active;
  for (let t = 0; t < TICKS; t++) {
    const cmds: Command[] = [];
    const d = dirs[Math.floor(t / 240) % dirs.length]!;
    if (t % 240 === 0 || s.active !== lastActive) {
      cmds.push({ type: 'move', player: s.active, x: d.x, z: d.z });
      lastActive = s.active;
    }
    if (s.rally.phase === 'serve' && s.rally.server === s.active && t % 120 === 60) {
      cmds.push({ type: 'swing', player: s.active, aim: null, power: 0.3 });
    }
    const controlled = ([0, 1, 2, 3] as PlayerId[]).filter((p) => p !== s.active);
    step(s, [...cmds, ...aiCommands(ai, s, controlled)]);
    if (t % TICKS_PER_FRAME === 1) onFrame(s);
  }
}

function measure(
  config: CameraConfig,
  run: (seed: number, onFrame: (s: SimState) => void) => void,
  seed: number,
): FramingStats {
  const cam = createGameCamera(config);
  cam.setAspect(W / H);
  const meter = createFramingMeter();
  run(seed, (s) => {
    cam.update(s, TICKS_PER_FRAME / 120);
    meter.measure(s, cam.camera, W, H);
  });
  return meter.stats();
}

describe('kadr 844 × 390 – obaj zawodnicy drużyny gracza w oknie', () => {
  it('AI vs AI, 60 s: obaj cali w każdej klatce, piłka w kadrze ≥ 97 %', () => {
    for (const seed of [7, 11]) {
      const s = measure(DEFAULT_CAMERA, runAiVsAi, seed);
      expect(s.frames).toBe(TICKS / TICKS_PER_FRAME);
      expect(s.team0Full, `seed ${seed}: obaj w kadrze`).toBe(s.frames);
      expect(s.minMarginPx, `seed ${seed}: zapas do krawędzi`).toBeGreaterThan(20);
      expect(s.ballIn / s.frames, `seed ${seed}: piłka w kadrze`).toBeGreaterThanOrEqual(0.97);
    }
  });

  it('człowiek biega od linii do linii: obaj cali w każdej klatce', () => {
    const s = measure(DEFAULT_CAMERA, runRunaway, 3);
    expect(s.team0Full).toBe(s.frames);
    expect(s.minMarginPx).toBeGreaterThan(0);
  });

  it('czułość: kamera F0 gubi partnera w tym samym scenariuszu', () => {
    const s = measure(CAMERA_F0, runRunaway, 3);
    expect(s.team0Full / s.frames).toBeLessThan(0.9);
  });

  it('zawodnik nie jest mniejszy niż w F0 (średnia wysokość na ekranie)', () => {
    const now = measure(DEFAULT_CAMERA, runAiVsAi, 7);
    const f0 = measure(CAMERA_F0, runAiVsAi, 7);
    // F0 ~79 px; nowa kamera ~79 px przy dużo większym zapasie – nie może spaść o więcej niż 5 %.
    expect(now.meanPlayerHeightPx).toBeGreaterThan(f0.meanPlayerHeightPx * 0.95);
  });
});
