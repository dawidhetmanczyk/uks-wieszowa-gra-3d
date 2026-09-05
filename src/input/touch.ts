/**
 * Dotyk i mysz (Pointer Events) → komendy sim wg docs/22 §4.
 *
 * Każdy wskaźnik jest śledzony osobno po pointerId i pamięta adresata
 * (state.active z chwili dotknięcia), żeby przełączenie aktywnego w trakcie
 * gestu nie „przerzuciło” trzymanego kciuka na drugiego zawodnika. Klasyfikacja
 * i mapowania są w gesty.ts – tutaj jest wyłącznie DOM.
 */
import { teamOf } from '../sim/index';
import type { PlayerId, TeamId, Vec2 } from '../sim/index';
import type { GestureMode, HoldInfo, InputSink } from './gesty';
import { aimFromOffset, classifyGesture, joystickVector, sameAim, sameVec2 } from './gesty';

/** Dwa kciuki: bieg + uderzenie. Trzeci palec to przypadek (dłoń, krawędź) – ignorowany. */
const MAX_POINTERS = 2;
/** Dotknięcie tych elementów należy do UI (HUD), nie do gry. */
const UI_SELECTOR = 'button, a, input, select, textarea, [contenteditable]';

interface TrackedPointer {
  id: number;
  player: PlayerId;
  team: TeamId;
  /** Punkt dotknięcia (px CSS) – od niego liczy się klasyfikacja gestu i joystick. */
  startX: number;
  startY: number;
  /** Bieżące położenie palca (px CSS). */
  x: number;
  y: number;
  downAt: number;
  mode: GestureMode;
  /** Czas wysłania komendy swing – od niego liczy się siła do podglądu. */
  swingAt: number;
  /**
   * Położenie palca w chwili rozstrzygnięcia na zamach – od niego liczy się cel,
   * nie od punktu dotknięcia: dryf sprzed rozstrzygnięcia (≤ DEADZONE_PX) nie ma
   * stać się celem przy pierwszym pointermove.
   */
  swingX: number;
  swingY: number;
  lastMove: Vec2;
  lastAim: Vec2 | null;
}

export interface TouchInput {
  /** Raz na klatkę – rozstrzyga wskaźniki czekające na upływ HOLD_MS. */
  advance(now: number): void;
  /** Trwający zamach (najdłużej trzymany, gdy jest kilka) albo null. */
  hold(): HoldInfo | null;
  dispose(): void;
}

export function isUiElement(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(UI_SELECTOR) !== null;
}

export function createTouchInput(target: HTMLElement, sink: InputSink): TouchInput {
  const pointers = new Map<number, TrackedPointer>();

  function startSwing(p: TrackedPointer, now: number): void {
    p.mode = 'swing';
    p.swingAt = now;
    p.swingX = p.x;
    p.swingY = p.y;
    p.lastAim = null;
    sink.push({ type: 'swing', player: p.player, aim: null });
  }

  function emitMove(p: TrackedPointer, v: Vec2, force = false): void {
    if (!force && sameVec2(v, p.lastMove)) return;
    p.lastMove = v;
    sink.push({ type: 'move', player: p.player, x: v.x, z: v.z });
  }

  function emitAim(p: TrackedPointer, aim: Vec2 | null): void {
    if (sameAim(aim, p.lastAim)) return;
    p.lastAim = aim;
    sink.push({ type: 'aim', player: p.player, aim });
  }

  /** Rozstrzyga tryb nieznanego wskaźnika i przekłada bieżące położenie palca na komendę. */
  function update(p: TrackedPointer, now: number): void {
    const dx = p.x - p.startX;
    const dy = p.y - p.startY;
    if (p.mode === 'unknown') {
      const mode = classifyGesture(now - p.downAt, dx, dy);
      if (mode === 'unknown') return;
      if (mode === 'swing') {
        // Zamach zaczyna się bez celu (docs/22 §4). Dryf kciuka sprzed rozstrzygnięcia
        // nie ma stać się celem: startSwing zapamiętuje bieżące położenie palca i od
        // niego liczy się cel, a aimFromOffset odsiewa przesunięcia ≤ DEADZONE_PX –
        // celowanie rusza dopiero od wyraźnego ruchu po rozstrzygnięciu.
        startSwing(p, now);
        return;
      }
      p.mode = 'joystick';
    }
    if (p.mode === 'joystick') emitMove(p, joystickVector(dx, dy));
    else emitAim(p, aimFromOffset(p.x - p.swingX, p.y - p.swingY, p.team));
  }

  function finish(p: TrackedPointer, now: number, cancelled: boolean): void {
    pointers.delete(p.id);
    try {
      target.releasePointerCapture(p.id);
    } catch {
      // Wskaźnik już zwolniony przez przeglądarkę – nic do zrobienia.
    }
    // Ostatnie położenie palca jeszcze się liczy (np. tapnięcie tuż po 120 ms
    // klasyfikuje się tu jako zamach), ale przy anulowaniu nie ufamy pozycji.
    if (!cancelled) update(p, now);
    switch (p.mode) {
      case 'joystick':
        // Zawsze, nawet gdy ostatni wektor był zerowy – to jedna komenda na gest.
        emitMove(p, { x: 0, z: 0 }, true);
        return;
      case 'swing':
        sink.push({ type: 'release', player: p.player });
        return;
      case 'unknown':
        // Anulowanie (przeglądarka przejęła gest) nie jest tapnięciem.
        if (cancelled) return;
        // Tapnięcie: swing + release w tej samej klatce – okno SWING_GRACE_S robi resztę.
        startSwing(p, now);
        sink.push({ type: 'release', player: p.player });
        return;
    }
  }

  function onPointerDown(e: PointerEvent): void {
    // Tylko główny przycisk / palec; prawy przycisk i tak kończy się na contextmenu.
    if (e.button !== 0) return;
    if (isUiElement(e.target)) return;
    if (pointers.has(e.pointerId) || pointers.size >= MAX_POINTERS) return;

    const now = sink.now();
    const player = sink.activePlayer();
    const p: TrackedPointer = {
      id: e.pointerId,
      player,
      team: teamOf(player),
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      downAt: now,
      mode: 'unknown',
      swingAt: now,
      swingX: e.clientX,
      swingY: e.clientY,
      lastMove: { x: 0, z: 0 },
      lastAim: null,
    };

    const other = pointers.values().next().value;
    if (other) {
      if (other.mode === 'swing') {
        // Zamach już trwa – drugi kciuk może tylko biec; dwa zamachy naraz nie mają sensu.
        p.mode = 'joystick';
      } else {
        // Dwa kciuki = bieg + uderzenie (docs/22 §4): pierwszy zostaje joystickiem
        // (nawet jeśli jeszcze się nie rozstrzygnął), drugi od razu zamachuje się.
        other.mode = 'joystick';
        startSwing(p, now);
      }
    }

    pointers.set(p.id, p);
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
    update(p, sink.now());
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
    // Scroll, zoom i menu kontekstowe (długie przytrzymanie) psują gest; przyciski HUD zostają.
    if (!isUiElement(e.target)) e.preventDefault();
  }

  // pointerdown tylko na celu (HUD obok canvasu nie zaczyna gestu); ruch i puszczenie
  // na window – działa też wtedy, gdy setPointerCapture zawiedzie.
  const nonPassive: AddEventListenerOptions = { passive: false };
  target.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  window.addEventListener('pointercancel', onPointerCancel);
  target.addEventListener('touchstart', blockBrowserGesture, nonPassive);
  target.addEventListener('touchmove', blockBrowserGesture, nonPassive);
  target.addEventListener('contextmenu', blockBrowserGesture);

  return {
    advance(now) {
      for (const p of pointers.values()) {
        if (p.mode === 'unknown') update(p, now);
      }
    },
    hold() {
      let best: TrackedPointer | null = null;
      for (const p of pointers.values()) {
        if (p.mode === 'swing' && (best === null || p.swingAt < best.swingAt)) best = p;
      }
      return best ? { aim: best.lastAim, sinceMs: best.swingAt } : null;
    },
    dispose() {
      target.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerup', onPointerUp);
      window.removeEventListener('pointercancel', onPointerCancel);
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
