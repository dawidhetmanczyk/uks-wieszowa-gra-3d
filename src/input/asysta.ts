/**
 * Dotyk w trybie asysty F0b (decyzje Dawida 1 i 2 z 2026-09-26, docs/21):
 * - stuknięcie gdziekolwiek (puszczenie w ciągu 200 ms, ruch ≤ 30 px) = odbicie w cel domyślny
 *   (1. do partnera, 2. wystawa, 3. atak między rywali), w fazie serwisu – serwis lobem;
 * - machnięcie (ruch > 30 px i puszczenie w ciągu 200 ms) = odbicie w kierunku machnięcia;
 * - przeciągnięcie (palec trzymany dłużej niż 200 ms) przejmuje ruch jak w F0 – joystick
 *   względny od punktu dotknięcia; 0,5 s po puszczeniu ruch wraca do asysty (loop pyta
 *   `manualSteering`).
 * Siła ataku jest stała (0,5), bez „trzymaj = mocniej”. Zamach idzie w chwili puszczenia,
 * bo dopiero wtedy wiadomo, czy to stuknięcie, czy machnięcie (i w którą stronę).
 *
 * Klasyfikacja i mapowania są w gesty.ts – tu wyłącznie DOM. Tryb ręczny (pełne F0,
 * ?sterowanie=reczne) obsługuje touch.ts bez zmian.
 */
import { teamOf } from '../sim/index';
import type { PlayerId, TeamId, Vec2 } from '../sim/index';
import type { InputSink } from './gesty';
import {
  assistSwingPower,
  classifyAssistHeld,
  classifyAssistRelease,
  flickAim,
  joystickVector,
  MANUAL_RESUME_MS,
  sameVec2,
} from './gesty';
import { isUiElement, type PointerWindow } from './touch';

/** Dwa kciuki: jeden biegnie (przeciągnięcie), drugi stuka. Trzeci palec to przypadek. */
const MAX_POINTERS = 2;

interface AssistPointer {
  id: number;
  player: PlayerId;
  team: TeamId;
  startX: number;
  startY: number;
  x: number;
  y: number;
  downAt: number;
  /** 'pending' do rozstrzygnięcia, 'drag' – joystick, 'ignored' – drugi palec trzymany zbyt długo. */
  mode: 'pending' | 'drag' | 'ignored';
  lastMove: Vec2;
}

export interface AssistTouchInput {
  /** Raz na klatkę – palce trzymane dłużej niż 200 ms stają się przeciągnięciem. */
  advance(now: number): void;
  /** Czy ruchem steruje palec: trwa przeciągnięcie albo od jego końca nie minęło 0,5 s. */
  manualSteering(now: number): boolean;
  dispose(): void;
}

export function createAssistTouchInput(
  target: HTMLElement,
  sink: InputSink,
  win: PointerWindow = window,
): AssistTouchInput {
  const pointers = new Map<number, AssistPointer>();
  /** Do tej chwili (zegar sink) ruch należy jeszcze do palca, choć przeciągnięcie się skończyło. */
  let manualUntil = -Infinity;

  function dragging(): boolean {
    for (const p of pointers.values()) if (p.mode === 'drag') return true;
    return false;
  }

  function emitMove(p: AssistPointer, v: Vec2, force = false): void {
    if (!force && sameVec2(v, p.lastMove)) return;
    p.lastMove = v;
    sink.push({ type: 'move', player: p.player, x: v.x, z: v.z });
  }

  /** Palec trzymany ponad 200 ms: przeciągnięcie – chyba że inny palec już biegnie. */
  function promote(p: AssistPointer, now: number): void {
    if (p.mode !== 'pending' || classifyAssistHeld(now - p.downAt) !== 'drag') return;
    if (dragging()) {
      p.mode = 'ignored';
      return;
    }
    p.mode = 'drag';
    emitMove(p, joystickVector(p.x - p.startX, p.y - p.startY), true);
  }

  function hit(p: AssistPointer, aim: Vec2 | null): void {
    const serving = sink.isServing?.(p.player) ?? false;
    sink.push({ type: 'swing', player: p.player, aim, power: assistSwingPower(serving) });
    sink.push({ type: 'release', player: p.player });
  }

  function finish(p: AssistPointer, now: number, cancelled: boolean): void {
    pointers.delete(p.id);
    try {
      target.releasePointerCapture(p.id);
    } catch {
      // Wskaźnik już zwolniony przez przeglądarkę – nic do zrobienia.
    }
    if (p.mode === 'drag') {
      emitMove(p, { x: 0, z: 0 }, true);
      manualUntil = now + MANUAL_RESUME_MS;
      return;
    }
    // Anulowanie (przeglądarka przejęła gest) nie jest ani stuknięciem, ani machnięciem.
    if (p.mode === 'ignored' || cancelled) return;
    const dx = p.x - p.startX;
    const dy = p.y - p.startY;
    const gesture = classifyAssistRelease(now - p.downAt, dx, dy);
    if (gesture === 'tap') hit(p, null);
    else if (gesture === 'flick') hit(p, flickAim(dx, dy, p.team));
    // 'drag': palec przekroczył 200 ms między klatkami, a advance nie zdążył go awansować –
    // bez ruchu nic nie wysyłamy; ruch i tak przejmuje asysta.
  }

  function onPointerDown(e: PointerEvent): void {
    if (e.button !== 0) return;
    if (isUiElement(e.target)) return;
    if (pointers.has(e.pointerId) || pointers.size >= MAX_POINTERS) return;
    const now = sink.now();
    const player = sink.activePlayer();
    pointers.set(e.pointerId, {
      id: e.pointerId,
      player,
      team: teamOf(player),
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      downAt: now,
      mode: 'pending',
      lastMove: { x: 0, z: 0 },
    });
    try {
      target.setPointerCapture(e.pointerId);
    } catch {
      // Wskaźnik mógł już zniknąć – ruch i puszczenie i tak łapiemy na window.
    }
  }

  function onPointerMove(e: PointerEvent): void {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    const now = sink.now();
    promote(p, now);
    if (p.mode === 'drag') emitMove(p, joystickVector(p.x - p.startX, p.y - p.startY));
  }

  function onPointerUp(e: PointerEvent): void {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX;
    p.y = e.clientY;
    finish(p, sink.now(), false);
  }

  function onPointerCancel(e: PointerEvent): void {
    const p = pointers.get(e.pointerId);
    if (p) finish(p, sink.now(), true);
  }

  function blockBrowserGesture(e: Event): void {
    if (!isUiElement(e.target)) e.preventDefault();
  }

  const nonPassive: AddEventListenerOptions = { passive: false };
  target.addEventListener('pointerdown', onPointerDown);
  win.addEventListener('pointermove', onPointerMove);
  win.addEventListener('pointerup', onPointerUp);
  win.addEventListener('pointercancel', onPointerCancel);
  target.addEventListener('touchstart', blockBrowserGesture, nonPassive);
  target.addEventListener('touchmove', blockBrowserGesture, nonPassive);
  target.addEventListener('contextmenu', blockBrowserGesture);

  return {
    advance(now) {
      for (const p of pointers.values()) promote(p, now);
    },
    manualSteering(now) {
      return dragging() || now < manualUntil;
    },
    dispose() {
      target.removeEventListener('pointerdown', onPointerDown);
      win.removeEventListener('pointermove', onPointerMove);
      win.removeEventListener('pointerup', onPointerUp);
      win.removeEventListener('pointercancel', onPointerCancel);
      target.removeEventListener('touchstart', blockBrowserGesture);
      target.removeEventListener('touchmove', blockBrowserGesture);
      target.removeEventListener('contextmenu', blockBrowserGesture);
      for (const p of pointers.values()) {
        try {
          target.releasePointerCapture(p.id);
        } catch {
          // Jak wyżej – wskaźnik mógł już nie istnieć.
        }
      }
      pointers.clear();
    },
  };
}
