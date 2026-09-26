/**
 * Android: pełny ekran z pierwszego dotyku bez blokady orientacji (F0b, decyzja Dawida 8)
 * i „pierwszy gest nie może przepaść”. Prawdziwy moduł wejścia (src/input/asysta.ts)
 * i prawdziwy moduł pełnego ekranu (src/ui/fullscreen.ts) na jednym oknie – w kolejności,
 * w jakiej rejestruje je pętla (najpierw wejście, potem pełny ekran).
 *
 * Symulujemy najgorszy przypadek z F0: wejście w pełny ekran natychmiast anuluje wskaźnik
 * (pointercancel) i zmienia rozmiar okna. W F0 prośba szła na pointerdown, więc anulowanie
 * trafiało w trwający gest i stuknięcie ginęło – odtwarzamy to dla porównania.
 */
import { describe, expect, it } from 'vitest';
import { createAssistTouchInput } from '../../src/input/asysta';
import type { InputSink } from '../../src/input/gesty';
import type { PointerWindow } from '../../src/input/touch';
import { createFirstTouchFullscreen } from '../../src/ui/fullscreen';
import type { Command } from '../../src/sim/index';

function pointer(type: string, id: number, x: number, y: number, pointerType = 'touch'): Event {
  const e = new Event(type, { cancelable: true });
  Object.defineProperties(e, {
    pointerId: { value: id },
    clientX: { value: x },
    clientY: { value: y },
    button: { value: 0 },
    pointerType: { value: pointerType },
  });
  return e;
}

function setup() {
  const target = new EventTarget() as EventTarget & {
    setPointerCapture(id: number): void;
    releasePointerCapture(id: number): void;
  };
  target.setPointerCapture = () => {};
  target.releasePointerCapture = () => {};
  const win = new EventTarget();
  let now = 1000;
  const log: string[] = [];
  const commands: Command[] = [];
  const sink: InputSink = {
    push: (c) => {
      commands.push(c);
      log.push(c.type);
    },
    activePlayer: () => 0,
    now: () => now,
  };
  createAssistTouchInput(target as unknown as HTMLElement, sink, win as unknown as PointerWindow);
  let requests = 0;
  const element = {
    requestFullscreen: () => {
      requests++;
      log.push('fullscreen');
      // Najgorszy przypadek: przeglądarka anuluje wskaźnik 1 w chwili wejścia w pełny ekran.
      win.dispatchEvent(pointer('pointercancel', 1, 0, 0));
      return Promise.resolve();
    },
  };
  const fs = createFirstTouchFullscreen(win as unknown as Window, element);
  return {
    commands,
    log,
    fs,
    requests: () => requests,
    down: (x: number, y: number, type?: string) =>
      void target.dispatchEvent(pointer('pointerdown', 1, x, y, type)),
    up: (x: number, y: number, type?: string) =>
      void win.dispatchEvent(pointer('pointerup', 1, x, y, type)),
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('pierwszy dotyk: pełny ekran i gest, który nie przepada', () => {
  it('pierwsze stuknięcie uderza, a prośba o pełny ekran idzie po nim (pointerup)', () => {
    const r = setup();
    r.down(200, 400);
    expect(r.requests()).toBe(0);
    r.advance(80);
    r.up(200, 400);
    expect(r.commands.map((c) => c.type)).toEqual(['swing', 'release']);
    expect(r.log).toEqual(['swing', 'release', 'fullscreen']);
    expect(r.fs.requested()).toBe(true);
  });

  it('prośba idzie tylko raz i tylko z dotyku (nie z myszy)', () => {
    const r = setup();
    r.down(10, 10, 'mouse');
    r.up(10, 10, 'mouse');
    expect(r.requests()).toBe(0);
    r.down(10, 10);
    r.up(10, 10);
    r.down(10, 10);
    r.up(10, 10);
    expect(r.requests()).toBe(1);
  });

  it('porównanie z F0: prośba na pointerdown + anulowanie wskaźnika = stuknięcie przepada', () => {
    // Odtworzenie zachowania F0 na tym samym module wejścia: pełny ekran przed końcem gestu.
    const target = new EventTarget() as EventTarget & {
      setPointerCapture(id: number): void;
      releasePointerCapture(id: number): void;
    };
    target.setPointerCapture = () => {};
    target.releasePointerCapture = () => {};
    const win = new EventTarget();
    const commands: Command[] = [];
    const sink: InputSink = { push: (c) => commands.push(c), activePlayer: () => 0, now: () => 0 };
    createAssistTouchInput(target as unknown as HTMLElement, sink, win as unknown as PointerWindow);
    target.dispatchEvent(pointer('pointerdown', 1, 200, 400));
    // F0: requestFullscreen w pointerdown → przeglądarka anuluje trwający wskaźnik.
    win.dispatchEvent(pointer('pointercancel', 1, 0, 0));
    win.dispatchEvent(pointer('pointerup', 1, 200, 400));
    expect(commands).toEqual([]);
  });
});
