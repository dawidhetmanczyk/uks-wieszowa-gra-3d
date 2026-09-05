/**
 * Warstwa wejścia: dotyk/mysz (touch.ts) i klawiatura (keyboard.ts) → komendy
 * sim (docs/22 §1 i §4). Komendy zbierają się w kolejce między klatkami, a
 * `poll` oddaje je raz na klatkę, sklejone tak, żeby sim nie dostał dwóch
 * ruchów tego samego zawodnika w jednym ticku. Nic tu nie zmienia stanu sim.
 */
import type { Command, PlayerId, SimState, Vec2 } from '../sim/types';
import type { InputSink } from './gesty';
import { holdPower } from './gesty';
import { createKeyboardInput } from './keyboard';
import { createTouchInput } from './touch';

export { AIM_SCALE_PX, DEADZONE_PX, HOLD_MS, SATURATION_PX } from './gesty';

/** Ten sam kształt ma render (docs/22 §1) – celownik i pasek siły. */
export interface ViewState {
  /** Ostatni cel z trwającego zamachu albo null (= cel domyślny / wystawa do partnera). */
  aim: Vec2 | null;
  /** Jakiś palec albo spacja trzyma zamach. */
  holding: boolean;
  /** Siła 0..1 z czasu trzymania – ta sama krzywa, którą sim liczy z ticków. */
  power: number;
}

export interface InputController {
  /** Raz na klatkę, przed krokami sim. Zwraca komendy zebrane od ostatniego poll. */
  poll(state: SimState): Command[];
  view(): ViewState;
  dispose(): void;
}

/** Nowy set obsługuje loop własnym nasłuchem (porównanie z e.key). */
export const KEY_NEW_SET = 'n';

/**
 * Sklejanie komend jednej klatki: ostatnia `move` i ostatnia `aim` per zawodnik
 * wygrywają, `swing` i `release` zostają wszystkie w kolejności (tapnięcie to
 * oba w jednej klatce). `new-set` nie ma adresata – przechodzi bez zmian.
 */
export function coalesceCommands(commands: readonly Command[]): Command[] {
  const lastIndex = new Map<string, number>();
  commands.forEach((c, i) => {
    if (c.type === 'move' || c.type === 'aim') lastIndex.set(`${c.type}:${c.player}`, i);
  });
  return commands.filter((c, i) => {
    if (c.type === 'move' || c.type === 'aim') return lastIndex.get(`${c.type}:${c.player}`) === i;
    return true;
  });
}

const IDLE_VIEW: ViewState = { aim: null, holding: false, power: 0 };

/**
 * `activePlayer` – żywy odczyt state.active z pętli. Bez niego adresat gestu byłby
 * aktywnym z ostatniego poll, a przełączenie aktywnego zachodzi w `step` w tej samej
 * klatce: zdarzenie DOM między krokiem a następnym poll trafiałoby do poprzedniego
 * zawodnika (już sterowanego przez AI, które go nadpisuje). Harness łapał to jako
 * „klawisz nie działa” tuż po serwisie.
 */
export function createInput(target: HTMLElement, activePlayer?: () => PlayerId): InputController {
  const queue: Command[] = [];
  // Zapas, gdy pętla nie poda gettera: aktywny z ostatniego poll.
  let active: PlayerId = 0;
  let view: ViewState = IDLE_VIEW;

  const sink: InputSink = {
    push: (cmd) => {
      queue.push(cmd);
    },
    activePlayer: () => (activePlayer ? activePlayer() : active),
    // Jedyne miejsce w grze z zegarem ściennym: sim liczy siłę z ticków, input tylko ją pokazuje.
    now: () => performance.now(),
  };

  const touch = createTouchInput(target, sink);
  const keyboard = createKeyboardInput(window, sink);

  function computeView(now: number): ViewState {
    // Dotyk ma pierwszeństwo – na telefonie klawiatury nie ma, na komputerze rzadko trzyma się oba.
    const hold = touch.hold() ?? keyboard.hold();
    if (!hold) return IDLE_VIEW;
    return { aim: hold.aim, holding: true, power: holdPower((now - hold.sinceMs) / 1000) };
  }

  return {
    poll(state) {
      active = state.active;
      const now = sink.now();
      touch.advance(now);
      const out = coalesceCommands(queue);
      queue.length = 0;
      view = computeView(now);
      return out;
    },
    view() {
      return view;
    },
    dispose() {
      touch.dispose();
      keyboard.dispose();
      queue.length = 0;
      view = IDLE_VIEW;
    },
  };
}
