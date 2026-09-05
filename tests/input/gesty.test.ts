/**
 * Czysta logika wejścia (src/input/gesty.ts) i sklejanie komend (src/input/index.ts).
 * Bez DOM – Pointer Events i klawiatura są sprawdzane ręcznie / w harnessie.
 */
import { describe, expect, it } from 'vitest';
import {
  DEADZONE_PX,
  HOLD_MS,
  aimFromArrows,
  aimFromOffset,
  classifyGesture,
  holdPower,
  joystickVector,
  keyboardVector,
  quantize,
} from '../../src/input/gesty';
import { coalesceCommands } from '../../src/input/index';
import type { Command } from '../../src/sim/index';

describe('classifyGesture – joystick vs zamach vs tapnięcie', () => {
  it('przed 120 ms i bez ruchu jest nieznany', () => {
    expect(classifyGesture(0, 0, 0)).toBe('unknown');
    expect(classifyGesture(HOLD_MS - 1, 5, -5)).toBe('unknown');
    // Dokładnie 12 px to jeszcze bezruch (próg jest ostry: > 12).
    expect(classifyGesture(HOLD_MS - 1, DEADZONE_PX, 0)).toBe('unknown');
  });

  it('ruch ponad martwą strefę daje joystick niezależnie od czasu', () => {
    expect(classifyGesture(20, 13, 0)).toBe('joystick');
    expect(classifyGesture(20, 9, 9)).toBe('joystick'); // 12,7 px
    expect(classifyGesture(HOLD_MS + 10, 0, -20)).toBe('joystick');
  });

  it('120 ms bez ruchu daje zamach', () => {
    expect(classifyGesture(HOLD_MS, 0, 0)).toBe('swing');
    expect(classifyGesture(HOLD_MS + 50, 8, -8)).toBe('swing'); // 11,3 px – w strefie
  });
});

describe('joystickVector – przesunięcie palca → move', () => {
  it('w martwej strefie zwraca zero (bez −0)', () => {
    expect(joystickVector(0, 0)).toEqual({ x: 0, z: 0 });
    expect(joystickVector(-5, 5)).toEqual({ x: 0, z: 0 });
    expect(joystickVector(DEADZONE_PX, 0)).toEqual({ x: 0, z: 0 });
  });

  it('nasycenie 70 px daje pełny wektor, góra ekranu = +z', () => {
    expect(joystickVector(70, 0)).toEqual({ x: -1, z: 0 });
    expect(joystickVector(0, -70)).toEqual({ x: 0, z: 1 });
    expect(joystickVector(0, 70)).toEqual({ x: 0, z: -1 });
  });

  it('połowa nasycenia daje połowę prędkości, kwantyzacja 0,02', () => {
    const v = joystickVector(35, -35);
    expect(v.x).toBeCloseTo(-0.5, 9);
    expect(v.z).toBeCloseTo(0.5, 9);
    const q = joystickVector(23, 0); // 0,3286 → 0,32 (w prawo na ekranie = −x)
    expect(q.x).toBeCloseTo(-0.32, 9);
  });

  it('przycina długość do 1 zachowując kierunek', () => {
    const v = joystickVector(140, -140);
    expect(Math.hypot(v.x, v.z)).toBeLessThanOrEqual(1.0001);
    expect(v.x).toBeCloseTo(-0.7, 9); // 0,7071 → 0,70
    expect(v.z).toBeCloseTo(0.7, 9);
    const far = joystickVector(300, 0);
    expect(far).toEqual({ x: -1, z: 0 });
  });
});

describe('keyboardVector – klawisze → move', () => {
  it('pojedyncze osie', () => {
    expect(keyboardVector(true, false, false, false)).toEqual({ x: -1, z: 0 });
    expect(keyboardVector(false, true, false, false)).toEqual({ x: 1, z: 0 });
    expect(keyboardVector(false, false, true, false)).toEqual({ x: 0, z: 1 });
    expect(keyboardVector(false, false, false, true)).toEqual({ x: 0, z: -1 });
  });

  it('przeciwne klawisze znoszą się, skos jest znormalizowany', () => {
    expect(keyboardVector(true, true, false, false)).toEqual({ x: 0, z: 0 });
    const d = keyboardVector(true, false, true, false);
    expect(d.x).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(d.z).toBeCloseTo(Math.SQRT1_2, 9);
  });
});

describe('cel – aimFromOffset i aimFromArrows', () => {
  it('mały dryf palca to brak celu – próg DEADZONE_PX, nie luźniejszy AIM_DEADZONE z sim', () => {
    expect(aimFromOffset(0, 0, 0)).toBeNull();
    expect(aimFromOffset(5, -5, 0)).toBeNull(); // 7,1 px
    // 11,2 px: sim (0,15 · 60 = 9 px) dałby już cel, ale klasyfikacja mówi „palec stoi”.
    expect(aimFromOffset(10, 5, 0)).toBeNull();
    // Dokładnie 12 px to jeszcze brak celu (próg ostry jak w classifyGesture), 13 px daje cel.
    expect(aimFromOffset(DEADZONE_PX, 0, 0)).toBeNull();
    expect(aimFromOffset(13, 0, 0)).not.toBeNull();
  });

  it('60 px w prawo = cel po prawej stronie ekranu (x < 0) w połowie głębokości połowy rywali', () => {
    const aim = aimFromOffset(60, 0, 0);
    expect(aim).not.toBeNull();
    expect(aim!.x).toBeCloseTo(-3.8, 9);
    expect(aim!.z).toBeCloseTo(4.6, 9);
  });

  it('w górę ekranu = głębiej, w dół = krótko; kwantyzacja 0,05 m', () => {
    const deep = aimFromOffset(0, -60, 0)!;
    expect(deep.x).toBe(0);
    expect(deep.z).toBeCloseTo(8.0, 9);
    const short = aimFromOffset(0, 60, 0)!;
    expect(short.z).toBeCloseTo(1.2, 9);
    const odd = aimFromOffset(17, -41, 0)!;
    expect(odd.x * 20).toBeCloseTo(Math.round(odd.x * 20), 9);
    expect(odd.z * 20).toBeCloseTo(Math.round(odd.z * 20), 9);
  });

  it('strzałki: brak = null, prawo/góra jak palec', () => {
    expect(aimFromArrows(false, false, false, false, 0)).toBeNull();
    const right = aimFromArrows(true, false, false, false, 0)!;
    expect(right.x).toBeCloseTo(-3.8, 9);
    expect(right.z).toBeCloseTo(4.6, 9);
    const up = aimFromArrows(false, false, true, false, 0)!;
    expect(up.x).toBe(0);
    expect(up.z).toBeCloseTo(8.0, 9);
    // Przeciwne strzałki znoszą się.
    expect(aimFromArrows(true, true, false, false, 0)).toBeNull();
  });
});

describe('holdPower – czas trzymania → siła podglądu', () => {
  it('do 0,08 s zero, od 0,6 s jeden, liniowo między', () => {
    expect(holdPower(0)).toBe(0);
    expect(holdPower(0.08)).toBe(0);
    expect(holdPower(0.34)).toBeCloseTo(0.5, 9);
    expect(holdPower(0.6)).toBe(1);
    expect(holdPower(3)).toBe(1);
  });
});

describe('quantize', () => {
  it('zaokrągla do kroku i nie zwraca −0', () => {
    expect(quantize(0.031, 0.02)).toBeCloseTo(0.04, 9);
    expect(quantize(-0.001, 0.02)).toBe(0);
    expect(Object.is(quantize(-0.001, 0.02), -0)).toBe(false);
  });
});

describe('coalesceCommands – jedna klatka', () => {
  it('ostatnia move i aim per zawodnik wygrywa, swing i release zostają w kolejności', () => {
    const cmds: Command[] = [
      { type: 'move', player: 0, x: 0.5, z: 0 },
      { type: 'swing', player: 0, aim: null },
      { type: 'aim', player: 0, aim: { x: 1, z: 4 } },
      { type: 'move', player: 1, x: 0, z: 1 },
      { type: 'aim', player: 0, aim: { x: 2, z: 5 } },
      { type: 'move', player: 0, x: 0, z: 0 },
      { type: 'release', player: 0 },
    ];
    expect(coalesceCommands(cmds)).toEqual([
      { type: 'swing', player: 0, aim: null },
      { type: 'move', player: 1, x: 0, z: 1 },
      { type: 'aim', player: 0, aim: { x: 2, z: 5 } },
      { type: 'move', player: 0, x: 0, z: 0 },
      { type: 'release', player: 0 },
    ]);
  });

  it('tapnięcie: swing + release w tej samej klatce przechodzą oba', () => {
    const cmds: Command[] = [
      { type: 'swing', player: 1, aim: null },
      { type: 'release', player: 1 },
    ];
    expect(coalesceCommands(cmds)).toEqual(cmds);
  });

  it('pusta kolejka daje pustą listę', () => {
    expect(coalesceCommands([])).toEqual([]);
  });
});
