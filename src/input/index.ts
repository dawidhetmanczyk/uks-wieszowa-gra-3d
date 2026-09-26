/**
 * Warstwa wejścia: dotyk/mysz (touch.ts) i klawiatura (keyboard.ts) → komendy
 * sim (docs/22 §1 i §4). Komendy zbierają się w kolejce między klatkami, a
 * `poll` oddaje je raz na klatkę, sklejone tak, żeby sim nie dostał dwóch
 * ruchów tego samego zawodnika w jednym ticku. Nic tu nie zmienia stanu sim.
 */
import type { Command, PlayerId, SimState, Vec2 } from '../sim/index';
import type { ControlMode, InputSink } from './gesty';
import { holdPower } from './gesty';
import { createAssistTouchInput } from './asysta';
import { createKeyboardInput } from './keyboard';
import { createTouchInput } from './touch';

export {
  AIM_SCALE_PX,
  ASSIST_ATTACK_POWER,
  ASSIST_SERVE_POWER,
  ASSIST_TAP_MAX_MS,
  DEADZONE_PX,
  FLICK_MIN_PX,
  HOLD_MS,
  MANUAL_RESUME_MS,
  SATURATION_PX,
} from './gesty';
export type { ControlMode } from './gesty';

/**
 * Ten sam kształt ma render (docs/22 §1) – celownik czyta `aim` i `holding`.
 * `power` to siła do podglądu – w F0 nieużywana przez render/HUD (pasek siły to F1).
 */
export interface ViewState {
  /** Ostatni cel z trwającego zamachu albo null (= cel domyślny / wystawa do partnera). */
  aim: Vec2 | null;
  /** Jakiś palec albo spacja trzyma zamach. */
  holding: boolean;
  /** Siła 0..1 z czasu trzymania – ta sama krzywa, którą sim liczy z ticków (holdPower). */
  power: number;
}

export interface InputController {
  /** Raz na klatkę, przed krokami sim. Zwraca komendy zebrane od ostatniego poll. */
  poll(state: SimState): Command[];
  view(): ViewState;
  /**
   * Tryb asysty: czy ruchem steruje teraz człowiek (przeciągnięcie palcem albo klawisze ruchu,
   * i jeszcze 0,5 s po puszczeniu). Stan z ostatniego poll. W trybie F0 zawsze true – ruch jest
   * wyłącznie ręczny.
   */
  manualSteering(): boolean;
  dispose(): void;
}

export interface InputOptions {
  /** 'assist' – F0b; 'manual' – pełne F0 (?sterowanie=reczne). Domyślnie 'manual'. */
  mode?: ControlMode;
  /** Żywy odczyt „ten zawodnik właśnie serwuje” – tryb asysty serwuje stuknięciem lobem. */
  isServing?: (player: PlayerId) => boolean;
}

/** Nowy set obsługuje loop własnym nasłuchem (porównanie z e.key). */
export const KEY_NEW_SET = 'n';

/**
 * Sklejanie komend jednej klatki: ostatnia `move` i ostatnia `aim` per zawodnik
 * wygrywają, `swing` i `release` zostają wszystkie w kolejności (tapnięcie to
 * oba w jednej klatce). Każda komenda ma adresata (`player`) – nowy set nie jest komendą sim.
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
export function createInput(
  target: HTMLElement,
  activePlayer?: () => PlayerId,
  options: InputOptions = {},
): InputController {
  const mode: ControlMode = options.mode ?? 'manual';
  const queue: Command[] = [];
  // Zapas, gdy pętla nie poda gettera: aktywny z ostatniego poll.
  let active: PlayerId = 0;
  let view: ViewState = IDLE_VIEW;
  let manual = mode === 'manual';

  const sink: InputSink = {
    push: (cmd) => {
      queue.push(cmd);
    },
    activePlayer: () => (activePlayer ? activePlayer() : active),
    // Jedyne miejsce w grze z zegarem ściennym: sim liczy siłę z ticków, input tylko ją pokazuje.
    now: () => performance.now(),
    isServing: (player) => options.isServing?.(player) ?? false,
  };

  // Tryb asysty: stuknięcie / machnięcie / przeciągnięcie (asysta.ts); F0: touch.ts bez zmian.
  const touch = mode === 'assist' ? null : createTouchInput(target, sink);
  const assistTouch = mode === 'assist' ? createAssistTouchInput(target, sink) : null;
  const keyboard = createKeyboardInput(window, sink, mode);

  function computeView(now: number): ViewState {
    // Dotyk ma pierwszeństwo – na telefonie klawiatury nie ma, na komputerze rzadko trzyma się oba.
    // W trybie asysty nie ma trzymania, więc celownik się nie pokazuje (hold zawsze null).
    const hold = touch?.hold() ?? keyboard.hold();
    if (!hold) return IDLE_VIEW;
    return { aim: hold.aim, holding: true, power: holdPower((now - hold.sinceMs) / 1000) };
  }

  return {
    poll(state) {
      active = state.active;
      const now = sink.now();
      touch?.advance(now);
      assistTouch?.advance(now);
      const out = coalesceCommands(queue);
      queue.length = 0;
      view = computeView(now);
      manual =
        mode === 'manual' ||
        (assistTouch?.manualSteering(now) ?? false) ||
        keyboard.manualSteering(now);
      return out;
    },
    view() {
      return view;
    },
    manualSteering() {
      return manual;
    },
    dispose() {
      touch?.dispose();
      assistTouch?.dispose();
      keyboard.dispose();
      queue.length = 0;
      view = IDLE_VIEW;
    },
  };
}
