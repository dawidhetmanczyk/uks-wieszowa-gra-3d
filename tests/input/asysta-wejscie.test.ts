/**
 * Wejście w trybie asysty F0b (src/input/asysta.ts, keyboard.ts w trybie 'assist') – decyzje
 * Dawida 1 i 2 z 2026-09-26: stuknięcie = odbicie w cel domyślny (w serwisie – lob), machnięcie
 * (> 30 px, puszczenie ≤ 200 ms) = odbicie w kierunku machnięcia, przeciągnięcie (> 200 ms)
 * przejmuje ruch jak w F0, asysta wraca 0,5 s po puszczeniu. Siła ataku stała 0,5.
 *
 * Łańcuch „palec w lewym górnym rogu, ruch w prawo → zawodnik w prawo na ekranie” jak
 * w tests/input/wzgledne.test.ts, tu w trybie asysty i w pionie 390 × 844.
 */
import { describe, expect, it } from 'vitest';
import { createAssistTouchInput } from '../../src/input/asysta';
import {
  ASSIST_ATTACK_POWER,
  ASSIST_SERVE_POWER,
  ASSIST_TAP_MAX_MS,
  MANUAL_RESUME_MS,
  type InputSink,
} from '../../src/input/gesty';
import { createKeyboardInput } from '../../src/input/keyboard';
import type { PointerWindow } from '../../src/input/touch';
import { createGameCamera, DEFAULT_CAMERA } from '../../src/render/camera';
import { createFramingMeter } from '../../src/render/framing';
import { createSimState, step, type Command, type PlayerId } from '../../src/sim/index';

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
  down(x: number, y: number, id?: number): void;
  move(x: number, y: number, id?: number): void;
  up(x: number, y: number, id?: number): void;
  cancel(id?: number): void;
  advance(ms: number): void;
  manual(): boolean;
  serving: { value: boolean };
}

function rig(active: PlayerId = 0): Rig {
  const target = new EventTarget() as EventTarget & {
    setPointerCapture(id: number): void;
    releasePointerCapture(id: number): void;
  };
  target.setPointerCapture = () => {};
  target.releasePointerCapture = () => {};
  const win = new EventTarget() as unknown as PointerWindow;
  const winTarget = win as unknown as EventTarget;
  let now = 1000;
  const serving = { value: false };
  const commands: Command[] = [];
  const sink: InputSink = {
    push: (c) => commands.push(c),
    activePlayer: () => active,
    now: () => now,
    isServing: () => serving.value,
  };
  const input = createAssistTouchInput(target as unknown as HTMLElement, sink, win);
  return {
    commands,
    down: (x, y, id = 1) => void target.dispatchEvent(pointer('pointerdown', id, x, y)),
    move: (x, y, id = 1) => void winTarget.dispatchEvent(pointer('pointermove', id, x, y)),
    up: (x, y, id = 1) => void winTarget.dispatchEvent(pointer('pointerup', id, x, y)),
    cancel: (id = 1) => void winTarget.dispatchEvent(pointer('pointercancel', id, 0, 0)),
    advance: (ms) => {
      now += ms;
      input.advance(now);
    },
    manual: () => input.manualSteering(now),
    serving,
  };
}

const swings = (r: Rig): Extract<Command, { type: 'swing' }>[] =>
  r.commands.filter((c): c is Extract<Command, { type: 'swing' }> => c.type === 'swing');
const moves = (r: Rig): Extract<Command, { type: 'move' }>[] =>
  r.commands.filter((c): c is Extract<Command, { type: 'move' }> => c.type === 'move');

describe('stuknięcie i machnięcie', () => {
  it('stuknięcie (80 ms, bez ruchu) = zamach bez celu, stała siła ataku, puszczenie od razu', () => {
    const r = rig();
    r.down(200, 400);
    r.advance(80);
    r.up(202, 401);
    expect(r.commands).toEqual([
      { type: 'swing', player: 0, aim: null, power: ASSIST_ATTACK_POWER },
      { type: 'release', player: 0 },
    ]);
    expect(ASSIST_ATTACK_POWER).toBe(0.5);
  });

  it('stuknięcie w fazie serwisu = serwis lobem (siła 0)', () => {
    const r = rig();
    r.serving.value = true;
    r.down(200, 400);
    r.advance(60);
    r.up(200, 400);
    expect(swings(r)[0]?.power).toBe(ASSIST_SERVE_POWER);
    expect(ASSIST_SERVE_POWER).toBe(0);
  });

  it('ruch ≤ 30 px i puszczenie w 200 ms to nadal stuknięcie', () => {
    const r = rig();
    r.down(200, 400);
    r.advance(100);
    r.move(220, 390);
    r.up(222, 392);
    expect(swings(r)[0]?.aim).toBeNull();
  });

  it('machnięcie w górę (60 px, 150 ms) = odbicie głęboko w boisko rywali', () => {
    const r = rig();
    r.down(200, 400);
    r.advance(50);
    r.move(200, 370);
    r.advance(100);
    r.up(200, 340);
    const s = swings(r)[0];
    expect(s?.aim).not.toBeNull();
    expect(s?.aim?.z).toBeGreaterThan(6);
    expect(s?.power).toBe(ASSIST_ATTACK_POWER);
    expect(r.commands[r.commands.length - 1]).toEqual({ type: 'release', player: 0 });
  });

  it('machnięcie w prawo celuje w prawą stronę ekranu (−x świata), w lewo – w lewą', () => {
    const right = rig();
    right.down(200, 400);
    right.advance(120);
    right.up(260, 400);
    expect(swings(right)[0]?.aim?.x).toBeLessThan(-2);
    const left = rig();
    left.down(200, 400);
    left.advance(120);
    left.up(140, 400);
    expect(swings(left)[0]?.aim?.x).toBeGreaterThan(2);
  });

  it('długość machnięcia nie zmienia celu – liczy się kierunek', () => {
    const short = rig();
    short.down(200, 400);
    short.advance(100);
    short.up(240, 360);
    const long = rig();
    long.down(200, 400);
    long.advance(100);
    long.up(400, 200);
    expect(swings(short)[0]?.aim).toEqual(swings(long)[0]?.aim);
  });

  it('anulowany wskaźnik (przeglądarka przejęła gest) nie uderza', () => {
    const r = rig();
    r.down(200, 400);
    r.advance(50);
    r.cancel();
    expect(r.commands).toEqual([]);
  });
});

describe('przeciągnięcie przejmuje ruch, asysta wraca po 0,5 s', () => {
  it('palec trzymany > 200 ms staje się przeciągnięciem – bez uderzenia przy puszczeniu', () => {
    const r = rig();
    r.down(200, 400);
    r.advance(ASSIST_TAP_MAX_MS - 10);
    expect(r.manual()).toBe(false);
    r.advance(20);
    expect(r.manual()).toBe(true);
    r.up(200, 400);
    expect(swings(r)).toHaveLength(0);
  });

  it('przeciągnięcie wysyła wektor jak joystick F0, puszczenie zatrzymuje', () => {
    const r = rig();
    r.down(200, 400);
    r.advance(210);
    for (let i = 1; i <= 8; i++) {
      r.advance(16);
      r.move(200 + i * 10, 400);
    }
    const m = moves(r);
    expect(m[m.length - 1]).toMatchObject({ player: 0, x: -1, z: 0 });
    r.up(280, 400);
    expect(moves(r).at(-1)).toMatchObject({ x: 0, z: 0 });
  });

  it('ruch palca w pierwszych 200 ms nic nie wysyła – do rozstrzygnięcia rządzi asysta', () => {
    const r = rig();
    r.down(200, 400);
    r.advance(50);
    r.move(260, 400);
    r.advance(50);
    r.move(300, 400);
    expect(r.commands).toEqual([]);
    expect(r.manual()).toBe(false);
  });

  it('po puszczeniu przeciągnięcia ruch należy do palca jeszcze 0,5 s', () => {
    const r = rig();
    r.down(200, 400);
    r.advance(300);
    r.up(200, 400);
    expect(r.manual()).toBe(true);
    r.advance(MANUAL_RESUME_MS - 1);
    expect(r.manual()).toBe(true);
    r.advance(2);
    expect(r.manual()).toBe(false);
  });

  it('drugi palec stuka, gdy pierwszy biegnie', () => {
    const r = rig();
    r.down(100, 700, 1);
    r.advance(250);
    r.move(160, 700, 1);
    r.down(300, 300, 2);
    r.advance(60);
    r.up(300, 300, 2);
    expect(swings(r)).toHaveLength(1);
    expect(r.manual()).toBe(true);
  });
});

describe('sterowanie względne w trybie asysty (pion 390 × 844)', () => {
  it('ta sama komenda ruchu z pięciu miejsc startu palca', () => {
    const starts = [
      { x: 20, y: 20 },
      { x: 370, y: 824 },
      { x: 195, y: 422 },
      { x: 10, y: 830 },
      { x: 380, y: 12 },
    ];
    const last = starts.map(({ x, y }) => {
      const r = rig();
      r.down(x, y);
      r.advance(210);
      for (let i = 1; i <= 8; i++) {
        r.advance(16);
        r.move(x + i * 10, y);
      }
      return moves(r).at(-1);
    });
    for (const m of last) expect(m).toEqual(last[0]);
    expect(last[0]).toMatchObject({ type: 'move', player: 0, x: -1, z: 0 });
  });

  it('palec w lewym górnym rogu, ruch w prawo → zawodnik biegnie w prawo NA EKRANIE', () => {
    const W = 390;
    const H = 844;
    const state = createSimState({ seed: 7, humanControl: true, servingTeam: 1, assist: true });
    const cam = createGameCamera(DEFAULT_CAMERA);
    cam.setAspect(W / H);
    cam.update(state, 1 / 60);
    const meter = createFramingMeter();
    const before = meter.screenPos(state, cam.camera, 0, W, H);
    const finger = { x: 24, y: 30 };
    expect(finger.x).toBeLessThan(before.x);

    const r = rig(0);
    r.down(finger.x, finger.y);
    r.advance(210);
    for (let i = 1; i <= 8; i++) {
      r.advance(16);
      r.move(finger.x + i * 10, finger.y);
    }
    const m = moves(r);
    for (let t = 0; t < 48; t++) {
      step(state, t === 0 ? m : []);
      if (t % 2 === 1) cam.update(state, 1 / 60);
    }
    const after = meter.screenPos(state, cam.camera, 0, W, H);
    expect(after.x - before.x, 'przesunięcie w px CSS').toBeGreaterThan(10);
  });
});

describe('klawiatura w trybie asysty', () => {
  function key(type: string, code: string): Event {
    const e = new Event(type, { cancelable: true });
    Object.defineProperties(e, {
      code: { value: code },
      key: { value: code },
      repeat: { value: false },
      ctrlKey: { value: false },
      metaKey: { value: false },
      altKey: { value: false },
    });
    return e;
  }

  function kbRig() {
    const win = new EventTarget();
    let now = 5000;
    const commands: Command[] = [];
    const sink: InputSink = {
      push: (c) => commands.push(c),
      activePlayer: () => 0,
      now: () => now,
      isServing: () => false,
    };
    const kb = createKeyboardInput(win as unknown as Window, sink, 'assist');
    return {
      commands,
      press: (code: string) => void win.dispatchEvent(key('keydown', code)),
      lift: (code: string) => void win.dispatchEvent(key('keyup', code)),
      advance: (ms: number) => {
        now += ms;
      },
      manual: () => kb.manualSteering(now),
      hold: () => kb.hold(),
    };
  }

  it('spacja = stuknięcie (zamach + puszczenie od razu, siła stała), bez trzymania', () => {
    const k = kbRig();
    k.press('Space');
    expect(k.commands).toEqual([
      { type: 'swing', player: 0, aim: null, power: ASSIST_ATTACK_POWER },
      { type: 'release', player: 0 },
    ]);
    expect(k.hold()).toBeNull();
    k.lift('Space');
    expect(k.commands).toHaveLength(2);
  });

  it('spacja przy strzałce = machnięcie w jej kierunku', () => {
    const k = kbRig();
    k.press('ArrowUp');
    k.press('Space');
    const s = k.commands.find((c) => c.type === 'swing');
    expect(s && s.type === 'swing' ? s.aim?.z : 0).toBeGreaterThan(6);
  });

  it('klawisze ruchu przejmują bieg, asysta wraca 0,5 s po puszczeniu', () => {
    const k = kbRig();
    expect(k.manual()).toBe(false);
    k.press('KeyD');
    expect(k.manual()).toBe(true);
    k.lift('KeyD');
    k.advance(MANUAL_RESUME_MS - 1);
    expect(k.manual()).toBe(true);
    k.advance(2);
    expect(k.manual()).toBe(false);
  });
});
