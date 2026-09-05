/**
 * Klawiatura → komendy sim (docs/22 §4). WASD/strzałki = ruch, strzałki przy
 * trzymanej spacji = cel, spacja = zamach / puszczenie.
 *
 * Nasłuch na window, żeby gra nie wymagała fokusu na canvasie. Pola formularzy
 * i przyciski są omijane przy keydown, bo tam spacja i strzałki znaczą coś
 * innego; keyup obsługujemy zawsze, żeby klawisz nie „zawisł” po ucieczce fokusu.
 */
import { teamOf } from '../sim/spots';
import type { PlayerId, TeamId, Vec2 } from '../sim/types';
import type { HoldInfo, InputSink } from './gesty';
import { aimFromArrows, keyboardVector, sameAim, sameVec2 } from './gesty';

/** e.code zamiast e.key: niezależne od układu, Caps Locka i Shifta. */
const MOVE_CODES: ReadonlySet<string> = new Set([
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
]);
const SWING_CODE = 'Space';
const TYPING_SELECTOR = 'input, textarea, select, button, [contenteditable]';

export interface KeyboardInput {
  /** Trwający zamach ze spacji albo null. */
  hold(): HoldInfo | null;
  dispose(): void;
}

function isTyping(target: EventTarget | null): boolean {
  return target instanceof Element && target.closest(TYPING_SELECTOR) !== null;
}

export function createKeyboardInput(win: Window, sink: InputSink): KeyboardInput {
  const pressed = new Set<string>();
  /** Adresat trwającej „sesji ruchu”: od pierwszego klawisza do puszczenia ostatniego. */
  let moveTarget: PlayerId | null = null;
  let lastMove: Vec2 = { x: 0, z: 0 };
  let swingTarget: PlayerId | null = null;
  let swingAt = 0;
  let sentAim: Vec2 | null = null;

  const has = (code: string): boolean => pressed.has(code);

  function currentMove(): Vec2 {
    return keyboardVector(
      has('KeyD') || has('ArrowRight'),
      has('KeyA') || has('ArrowLeft'),
      has('KeyW') || has('ArrowUp'),
      has('KeyS') || has('ArrowDown'),
    );
  }

  function currentAim(team: TeamId): Vec2 | null {
    return aimFromArrows(
      has('ArrowRight'),
      has('ArrowLeft'),
      has('ArrowUp'),
      has('ArrowDown'),
      team,
    );
  }

  /** Po każdej zmianie klawiszy: ruch przy zmianie wektora, cel przy zmianie w trakcie zamachu. */
  function refresh(): void {
    const v = currentMove();
    if (!sameVec2(v, lastMove)) {
      // Adresat ustalany na początku sesji ruchu i trzymany do jej końca – tak samo
      // jak przy joysticku (docs/22 §4), żeby przełączenie aktywnego nie zmieniało
      // zawodnika pod palcami. Zerowy wektor kończy sesję.
      if (moveTarget === null) moveTarget = sink.activePlayer();
      sink.push({ type: 'move', player: moveTarget, x: v.x, z: v.z });
      lastMove = v;
      if (v.x === 0 && v.z === 0) moveTarget = null;
    }
    if (swingTarget !== null) {
      const aim = currentAim(teamOf(swingTarget));
      if (!sameAim(aim, sentAim)) {
        sentAim = aim;
        sink.push({ type: 'aim', player: swingTarget, aim });
      }
    }
  }

  function startSwing(): void {
    swingTarget = sink.activePlayer();
    swingAt = sink.now();
    sentAim = currentAim(teamOf(swingTarget));
    sink.push({ type: 'swing', player: swingTarget, aim: sentAim });
  }

  function release(): void {
    if (swingTarget === null) return;
    sink.push({ type: 'release', player: swingTarget });
    swingTarget = null;
    sentAim = null;
  }

  function onKeyDown(e: KeyboardEvent): void {
    // Auto-repeat nic nie zmienia; skróty z modyfikatorami (Ctrl+D itp.) należą do przeglądarki.
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.target)) return;
    if (e.code === SWING_CODE) {
      e.preventDefault();
      if (swingTarget === null) startSwing();
      return;
    }
    if (!MOVE_CODES.has(e.code)) return;
    e.preventDefault();
    if (pressed.has(e.code)) return;
    pressed.add(e.code);
    refresh();
  }

  function onKeyUp(e: KeyboardEvent): void {
    if (e.code === SWING_CODE) {
      if (swingTarget !== null) {
        e.preventDefault();
        release();
      }
      return;
    }
    if (!pressed.delete(e.code)) return;
    e.preventDefault();
    refresh();
  }

  function onBlur(): void {
    // Bez keyup po utracie fokusu zawodnik biegłby w nieskończoność, a zamach nigdy by nie puścił.
    pressed.clear();
    refresh();
    release();
  }

  win.addEventListener('keydown', onKeyDown);
  win.addEventListener('keyup', onKeyUp);
  win.addEventListener('blur', onBlur);

  return {
    hold() {
      return swingTarget !== null ? { aim: sentAim, sinceMs: swingAt } : null;
    },
    dispose() {
      win.removeEventListener('keydown', onKeyDown);
      win.removeEventListener('keyup', onKeyUp);
      win.removeEventListener('blur', onBlur);
      pressed.clear();
    },
  };
}
