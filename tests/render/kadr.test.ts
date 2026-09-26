/**
 * Kadr: obaj zawodnicy drużyny gracza mają być CALI w oknie telefonu. Kamera i licznik kadru
 * to kod gry (src/render/camera.ts, src/render/framing.ts), nie kopia – Three liczy macierze
 * w Node tak samo jak w przeglądarce.
 *
 * F0b (decyzja Dawida 7): pion 390 × 844 to główny tryb; kamera pionu dobrana na nowo
 * w scenariuszu obciążeniowym „asysta + gracz przeciągany do linii” (tests/render/
 * scenariusze.ts). Warunek: 100 % klatek obaj w kadrze, piłka ≥ 97 %. Poziom 844 × 390 –
 * ten sam warunek w tym samym scenariuszu. Kontrola czułości: kamera pionu z końca F0
 * oblewa nowy scenariusz – inaczej test niczego by nie odróżniał.
 */
import { describe, expect, it } from 'vitest';
import {
  CAMERA_F0,
  CAMERA_F0_END,
  DEFAULT_CAMERA,
  createGameCamera,
  type CameraConfig,
} from '../../src/render/camera';
import { createFramingMeter, type FramingStats } from '../../src/render/framing';
import { FRAME_TICKS, runAiVsAi, runAssistDrag, runRunaway, type Scenario } from './scenariusze';

const PORTRAIT = { w: 390, h: 844 };
const LANDSCAPE = { w: 844, h: 390 };
/** Seedy scenariusza F0b w teście – podzbiór 20 seedów przeszukania (harness/wyniki). */
const F0B_SEEDS = [1, 2, 3, 4, 5];
/** Seedy, w których kamera pionu z końca F0 gubi zawodnika w scenariuszu F0b (pomiar 2026-09-26). */
const CZULOSC_SEEDS = [1, 12];

function measure(
  config: CameraConfig,
  size: { w: number; h: number },
  run: Scenario,
  seed: number,
): FramingStats {
  const cam = createGameCamera(config);
  cam.setAspect(size.w / size.h);
  const meter = createFramingMeter();
  run(seed, (s) => {
    cam.update(s, FRAME_TICKS / 120);
    meter.measure(s, cam.camera, size.w, size.h);
  });
  return meter.stats();
}

function label(seed: number, s: FramingStats): string {
  return (
    `seed ${seed}: obaj ${s.team0Full}/${s.frames}, piłka ${((s.ballIn / s.frames) * 100).toFixed(1)} %, ` +
    `zapas ${s.minMarginPx.toFixed(1)} px, zawodnik ${s.meanPlayerHeightPx.toFixed(1)} px`
  );
}

describe('kadr F0b – scenariusz „asysta + gracz przeciągany do linii”', () => {
  it.each(F0B_SEEDS)('pion 390 × 844, seed %i: obaj cali w każdej klatce, piłka ≥ 97 %', (seed) => {
    const s = measure(DEFAULT_CAMERA, PORTRAIT, runAssistDrag, seed);
    expect(s.team0Full, label(seed, s)).toBe(s.frames);
    expect(s.ballIn / s.frames, label(seed, s)).toBeGreaterThanOrEqual(0.97);
  });

  it.each(F0B_SEEDS)(
    'poziom 844 × 390, seed %i: obaj cali w każdej klatce, piłka ≥ 97 %',
    (seed) => {
      const s = measure(DEFAULT_CAMERA, LANDSCAPE, runAssistDrag, seed);
      expect(s.team0Full, label(seed, s)).toBe(s.frames);
      expect(s.ballIn / s.frames, label(seed, s)).toBeGreaterThanOrEqual(0.97);
    },
  );

  it('czułość: kamera pionu z końca F0 gubi zawodnika w tym scenariuszu', () => {
    const worst = Math.min(
      ...CZULOSC_SEEDS.map((seed) => {
        const s = measure(CAMERA_F0_END, PORTRAIT, runAssistDrag, seed);
        return s.team0Full / s.frames;
      }),
    );
    expect(worst).toBeLessThan(1);
  });
});

describe('kadr – mecz AI vs AI (60 s)', () => {
  it.each([7, 11])('seed %i: obaj cali w każdej klatce w pionie i w poziomie', (seed) => {
    for (const size of [PORTRAIT, LANDSCAPE]) {
      const s = measure(DEFAULT_CAMERA, size, runAiVsAi, seed);
      expect(s.team0Full, `${size.w}×${size.h} ${label(seed, s)}`).toBe(s.frames);
      expect(s.ballIn / s.frames).toBeGreaterThanOrEqual(0.97);
    }
  });
});

describe('kadr poziomu z F0 (2026-09-25) – regresja', () => {
  it('człowiek biega od linii do linii bez asysty: obaj cali w każdej klatce', () => {
    const s = measure(DEFAULT_CAMERA, LANDSCAPE, runRunaway, 3);
    expect(s.team0Full, label(3, s)).toBe(s.frames);
  });

  it('czułość: kamera F0 sprzed poprawek gubi partnera w tym samym scenariuszu', () => {
    const s = measure(CAMERA_F0, LANDSCAPE, runRunaway, 3);
    expect(s.team0Full / s.frames).toBeLessThan(0.9);
  });
});
