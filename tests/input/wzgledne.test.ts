/**
 * Sterowanie WZGLĘDNE – test regresji do bezwzględnego (lekcja z gry 2D).
 *
 * Palec staje w LEWYM GÓRNYM rogu ekranu 844 × 390 i jedzie w prawo. Zawodnik stoi wtedy
 * grubo na PRAWO od palca: sterowanie bezwzględne („biegnij do palca”) pobiegłoby w lewo.
 * Względne biegnie w prawo, za ruchem palca. Łańcuch jest prawdziwy od początku do końca:
 * src/input/touch.ts (zdarzenia wskaźnika) → komenda → step sim → kamera gry → piksele ekranu.
 *
 * Wersja w przeglądarce z prawdziwymi dotykami CDP: harness/sterowanie.ts.
 */
import { describe, expect, it } from 'vitest';
import type { InputSink } from '../../src/input/gesty';
import { createTouchInput, type PointerWindow } from '../../src/input/touch';
import { createGameCamera, DEFAULT_CAMERA } from '../../src/render/camera';
import { createFramingMeter } from '../../src/render/framing';
import { createSimState, step, type Command, type PlayerId } from '../../src/sim/index';

const W = 844;
const H = 390;

/** Minimalny wskaźnik: zwykły Event z polami PointerEvent, których używa touch.ts. */
function pointer(type: string, id: number, x: number, y: number): Event {
  const e = new Event(type, { cancelable: true });
  Object.defineProperties(e, {
    pointerId: { value: id },
    clientX: { value: x },
    clientY: { value: y },
    button: { value: 0 },
  });
  return e;
}

interface Rig {
  commands: Command[];
  down(x: number, y: number): void;
  move(x: number, y: number): void;
  up(x: number, y: number): void;
  /** Upływ czasu warstwy wejścia (ms) – gest rozstrzyga się po ruchu albo po 120 ms. */
  advance(ms: number): void;
}

function rig(active: PlayerId = 0): Rig {
  const target = new EventTarget() as EventTarget & {
    setPointerCapture(id: number): void;
    releasePointerCapture(id: number): void;
  };
  target.setPointerCapture = () => {};
  target.releasePointerCapture = () => {};
  const win = new EventTarget() as unknown as PointerWindow;
  let now = 1000;
  const commands: Command[] = [];
  const sink: InputSink = {
    push: (c) => commands.push(c),
    activePlayer: () => active,
    now: () => now,
  };
  const touch = createTouchInput(target as unknown as HTMLElement, sink, win);
  const winTarget = win as unknown as EventTarget;
  return {
    commands,
    down: (x, y) => void target.dispatchEvent(pointer('pointerdown', 1, x, y)),
    move: (x, y) => void winTarget.dispatchEvent(pointer('pointermove', 1, x, y)),
    up: (x, y) => void winTarget.dispatchEvent(pointer('pointerup', 1, x, y)),
    advance: (ms) => {
      now += ms;
      touch.advance(now);
    },
  };
}

/** Przeciągnięcie jak palcem: w dół, 8 kroków po 10 px co 16 ms. */
function drag(r: Rig, x0: number, y0: number, dx: number, dy: number): Command[] {
  r.down(x0, y0);
  for (let i = 1; i <= 8; i++) {
    r.advance(16);
    r.move(x0 + (dx * i) / 8, y0 + (dy * i) / 8);
  }
  return r.commands.filter((c) => c.type === 'move');
}

describe('sterowanie względne – palec gdziekolwiek, kierunek z przesunięcia', () => {
  it('ta sama komenda ruchu niezależnie od miejsca, w którym stanął palec', () => {
    const starts = [
      { x: 20, y: 20 }, // lewy górny róg
      { x: 824, y: 370 }, // prawy dolny róg
      { x: 422, y: 195 }, // środek
      { x: 10, y: 380 }, // lewy dolny
      { x: 834, y: 12 }, // prawy górny
    ];
    const last = starts.map(({ x, y }) => {
      const moves = drag(rig(), x, y, 80, 0);
      expect(moves.length, `start (${x}, ${y})`).toBeGreaterThan(0);
      return moves[moves.length - 1];
    });
    for (const m of last) expect(m).toEqual(last[0]);
    // Prawo ekranu = −x świata (docs/22 §4) – pełne wychylenie po 80 px (nasycenie 70 px).
    expect(last[0]).toMatchObject({ type: 'move', player: 0, x: -1, z: 0 });
  });

  it('palec przy lewej krawędzi i ruch w lewo poza okno dalej znaczy „w lewo”', () => {
    const moves = drag(rig(), 5, 200, -80, 0);
    expect(moves[moves.length - 1]).toMatchObject({ x: 1, z: 0 });
  });

  it('puszczenie palca zatrzymuje zawodnika', () => {
    const r = rig();
    drag(r, 20, 20, 80, 0);
    r.up(100, 20);
    const moves = r.commands.filter((c) => c.type === 'move');
    expect(moves[moves.length - 1]).toMatchObject({ x: 0, z: 0 });
  });

  it('palec w lewym górnym rogu, ruch w prawo → zawodnik biegnie w prawo NA EKRANIE', () => {
    // Rywale serwują, więc aktywny (0) nie jest zablokowany serwisem i może biec.
    const state = createSimState({ seed: 7, humanControl: true, servingTeam: 1 });
    const cam = createGameCamera(DEFAULT_CAMERA);
    cam.setAspect(W / H);
    cam.update(state, 1 / 60);
    const meter = createFramingMeter();
    const before = meter.screenPos(state, cam.camera, 0, W, H);
    const finger = { x: 24, y: 30 };
    // Sedno testu: palec leży na LEWO od zawodnika, bezwzględne sterowanie pobiegłoby w lewo.
    expect(finger.x).toBeLessThan(before.x);

    const moves = drag(rig(0), finger.x, finger.y, 80, 0);
    // 0,4 s biegu (48 ticków) bez innych komend – AI nie steruje, serwis rywali po 1 s.
    for (let t = 0; t < 48; t++) {
      step(state, t === 0 ? moves : []);
      if (t % 2 === 1) cam.update(state, 1 / 60);
    }
    const after = meter.screenPos(state, cam.camera, 0, W, H);
    expect(after.x - before.x, 'przesunięcie w px CSS na ekranie').toBeGreaterThan(20);
    expect(Math.abs(after.y - before.y)).toBeLessThan(after.x - before.x);
  });
});
