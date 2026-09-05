/**
 * Łączenie warstw (docs/22 §1 „src/loop”): input → sim (krok stały) → render + HUD.
 * Jedyny moduł, który zna wszystkie pozostałe. Sim i ai dostają tylko dane, render
 * i HUD tylko czytają stan.
 */
import {
  appendTick,
  createRecording,
  createSimState,
  step,
  type Command,
  type PlayerId,
  type SimState,
  type TeamId,
} from '../sim/index';
import { aiCommands, createAi, type AiState } from '../ai/index';
import { createRenderer, type GameRenderer } from '../render/index';
import { createInput, KEY_NEW_SET, type InputController } from '../input/index';
import { createHud, type Hud } from '../ui/index';
import {
  DEV_HOOKS_VERSION,
  installDevHooks,
  reachWindowInSeconds,
  type DevHooks,
  type NewSetOptions,
} from './haki';
import { createAccumulator, createFrameDriver, createFrameTimeBuffer, drainSteps } from './petla';

export type { DevHooks, NewSetOptions, ReachWindowSeconds, RenderInfo } from './haki';
export { parseUrlParams, daySeed, type UrlParams } from './url';

export interface GameOptions {
  canvas: HTMLCanvasElement;
  hudRoot: HTMLElement;
  seed: number;
  humanControl: boolean;
  servingTeam: TeamId;
  /** Licznik fps w HUD (?fps=1). Rozszerzenie F0 poza kontrakt, opcjonalne. */
  showFps?: boolean;
}

export interface Game {
  newSet(opts?: NewSetOptions): void;
  stop(): void;
  /** Żywy stan – ta sama referencja, którą krokuje pętla. */
  state(): SimState;
}

interface SetConfig {
  seed: number;
  servingTeam: TeamId;
  humanControl: boolean;
}

type Recording = ReturnType<typeof createRecording>;

const ALL_PLAYERS: readonly PlayerId[] = [0, 1, 2, 3];
/** „Wszyscy poza aktywnym” policzone raz – potrzebne 120 razy na sekundę. */
const WITHOUT: Readonly<Record<PlayerId, readonly PlayerId[]>> = {
  0: [1, 2, 3],
  1: [0, 2, 3],
  2: [0, 1, 3],
  3: [0, 1, 2],
};
/** Licznik fps odświeżany co pół sekundy – częściej miga, rzadziej kłamie. */
const FPS_REFRESH_MS = 500;

/** Klawisz z input może być podany jako `key` („n”) albo `code` („KeyN”) – akceptujemy oba. */
function matchesKey(e: KeyboardEvent, key: string): boolean {
  return e.code === key || e.key === key || e.key.toLowerCase() === key.toLowerCase();
}

export function startGame(opts: GameOptions): Game {
  const { canvas, hudRoot } = opts;
  const showFps = opts.showFps ?? false;

  const renderer: GameRenderer = createRenderer(canvas);
  // Getter zamiast wartości: input pyta o aktywnego w chwili zdarzenia, nie w chwili poll.
  const input: InputController = createInput(canvas, () => state.active);
  const hud: Hud = createHud(
    hudRoot,
    {
      onNewSet: () => {
        newSet();
        // Kliknięty przycisk zabiera fokus z kanwy – bez tego klawiatura milczy po nowym secie.
        canvas.focus({ preventScroll: true });
      },
    },
    { showFps },
  );

  let config: SetConfig = {
    seed: opts.seed,
    servingTeam: opts.servingTeam,
    humanControl: opts.humanControl,
  };
  let state: SimState = createSimState(config);
  let ai: AiState = createAi(config.seed);
  let recording: Recording = createRecording(state);

  const acc = createAccumulator();
  const frameTimes = createFrameTimeBuffer();
  /**
   * Komendy z input czekają tu na najbliższy krok sim. Na ekranie 120+ Hz zdarzają
   * się klatki bez kroku – tapnięcie z takiej klatki nie może przepaść.
   */
  let pending: Command[] = [];
  let fpsTimeMs = 0;
  let fpsFrames = 0;

  function newSet(next: NewSetOptions = {}): void {
    config = {
      seed: next.seed ?? config.seed + 1,
      servingTeam: next.servingTeam ?? config.servingTeam,
      humanControl: next.humanControl ?? config.humanControl,
    };
    state = createSimState(config);
    // AI z tego samego ziarna co sim – ma własny strumień, a nagranie = seed + komendy.
    ai = createAi(config.seed);
    recording = createRecording(state);
    acc.acc = 0;
    pending = [];
  }

  function frame(dt: number, frameMs: number | null): void {
    if (frameMs !== null) frameTimes.push(frameMs);

    // Poll zawsze – input utrzymuje stan gestu; komendy człowieka liczą się tylko, gdy gra człowiek.
    const polled = input.poll(state);
    if (state.humanControl && polled.length > 0) pending.push(...polled);

    const steps = drainSteps(acc, dt);
    for (let i = 0; i < steps; i++) {
      // Aktywny może się przełączyć w trakcie kroków, więc lista sterowanych liczona co krok.
      const controlled = state.humanControl ? WITHOUT[state.active] : ALL_PLAYERS;
      const aiCmds = aiCommands(ai, state, controlled);
      const all: Command[] = [...pending, ...aiCmds];
      pending = [];
      appendTick(recording, state.tick, all);
      step(state, all);
    }

    renderer.render(state, input.view(), dt);
    hud.update(state);

    if (showFps && frameMs !== null) {
      fpsTimeMs += frameMs;
      fpsFrames++;
      if (fpsTimeMs >= FPS_REFRESH_MS) {
        hud.setFps((fpsFrames * 1000) / fpsTimeMs);
        fpsTimeMs = 0;
        fpsFrames = 0;
      }
    }
  }

  // Rozmiar: mierzymy kontener (#gra, position: fixed; inset: 0), nie kanwę – Three przy
  // setSize wpisuje kanwie style width/height w px, więc jej clientWidth przestaje podążać
  // za oknem i ResizeObserver na kanwie nigdy nie zgłosiłby zmiany. Porównanie z poprzednimi
  // wartościami chroni przed pętlą resize → setSize → resize.
  const sizeSource: HTMLElement = canvas.parentElement ?? canvas;
  let lastW = 0;
  let lastH = 0;
  let lastDpr = 0;
  function resize(): void {
    const w = sizeSource.clientWidth;
    const h = sizeSource.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    if (w === 0 || h === 0) return;
    if (w === lastW && h === lastH && dpr === lastDpr) return;
    lastW = w;
    lastH = h;
    lastDpr = dpr;
    renderer.resize(w, h, dpr);
  }
  const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
  observer?.observe(sizeSource);
  // Zmiana zoomu przeglądarki zmienia devicePixelRatio bez zmiany rozmiaru CSS.
  window.addEventListener('resize', resize);
  resize();

  function onKeyDown(e: KeyboardEvent): void {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    if (!matchesKey(e, KEY_NEW_SET)) return;
    e.preventDefault();
    newSet();
  }
  window.addEventListener('keydown', onKeyDown);

  const hooks: DevHooks = {
    version: DEV_HOOKS_VERSION,
    state: () => state,
    newSet: (o) => newSet(o),
    frameTimes: () => frameTimes.toArray(),
    resetFrameTimes: () => frameTimes.reset(),
    renderInfo: () => renderer.info(),
    reachWindow: (player) => reachWindowInSeconds(state, player),
  };
  const uninstallHooks = installDevHooks(hooks);

  const driver = createFrameDriver(frame);
  driver.start();
  // Kanwa ma tabindex=0 w index.html – z fokusem klawiatura działa od pierwszej klatki.
  canvas.focus({ preventScroll: true });

  function stop(): void {
    driver.stop();
    observer?.disconnect();
    window.removeEventListener('resize', resize);
    window.removeEventListener('keydown', onKeyDown);
    uninstallHooks();
    hud.dispose();
    input.dispose();
    renderer.dispose();
  }

  return { newSet, stop, state: () => state };
}
