/**
 * Łączenie warstw (docs/22 §1 „src/loop”): input → sim (krok stały) → render + HUD.
 * Jedyny moduł, który zna wszystkie pozostałe. Sim i ai dostają tylko dane, render
 * i HUD tylko czytają stan.
 *
 * F0b (decyzje Dawida z 2026-09-26, docs/21): tryb asysty (domyślny) albo pełne F0 pod
 * ?sterowanie=reczne. W trybie asysty pętla dokłada komendy asysty ruchu dla aktywnego
 * (chyba że palec przeciąga), spowalnia tempo do 0,6× tuż przed kontaktem aktywnego
 * i liczy udane gesty do samouczka.
 */
import {
  appendTick,
  createRecording,
  createSimState,
  jumpAttackChance,
  step,
  type Command,
  type PlayerId,
  type SimState,
  type TeamId,
} from '../sim/index';
import {
  aiCommands,
  assistCommands,
  createAi,
  createAssist,
  type AiState,
  type AssistState,
} from '../ai/index';
import { createRenderer, type GameRenderer, type RenderOptions } from '../render/index';
import { createInput, KEY_NEW_SET, type ControlMode, type InputController } from '../input/index';
import {
  bindVisualViewport,
  browserTutorialStorage,
  createFirstTouchFullscreen,
  createHud,
  createTutorial,
  type HintId,
  type Hud,
  type Tutorial,
} from '../ui/index';
import {
  DEV_HOOKS_VERSION,
  installDevHooks,
  reachWindowInSeconds,
  type DevHooks,
  type NewSetOptions,
} from './haki';
import { createAccumulator, createFrameDriver, createFrameTimeBuffer, drainSteps } from './petla';
import { nextTempo, slowMoWanted } from './tempo';

export type { DevHooks, NewSetOptions, ReachWindowSeconds, RenderInfo } from './haki';
export type { FramingStats, RenderOptions, ResolvedRenderOptions } from '../render/index';
export type { ControlMode } from '../input/index';
export { parseUrlParams, daySeed, type UrlParams } from './url';
export { nextTempo, slowMoWanted, SLOWMO_LEAD_S, SLOWMO_RAMP_S, SLOWMO_TEMPO } from './tempo';

export interface GameOptions {
  canvas: HTMLCanvasElement;
  hudRoot: HTMLElement;
  seed: number;
  humanControl: boolean;
  servingTeam: TeamId;
  /** 'assist' – F0b (domyślnie); 'manual' – pełne F0 pod ?sterowanie=reczne. */
  controlMode?: ControlMode;
  /** Licznik fps w HUD (?fps=1). Rozszerzenie F0 poza kontrakt, opcjonalne. */
  showFps?: boolean;
  /**
   * Przełączniki jakości (?jakosc=niska, ?dpr=, ?aa=, ?cien=) do pomiarów fps na telefonie.
   * Brak pola = domyślne renderu. Rozszerzenie F0 poza kontrakt, opcjonalne.
   */
  render?: RenderOptions;
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
type HumanGesture = 'tap' | 'flick';

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
  const mode: ControlMode = opts.controlMode ?? 'assist';

  // Kanwa między paskami Safari: rozmiar #game z visualViewport, zanim render zmierzy okno.
  const viewport = bindVisualViewport(window, document.documentElement.style);

  const renderer: GameRenderer = createRenderer(canvas, opts.render);
  // Getter zamiast wartości: input pyta o aktywnego w chwili zdarzenia, nie w chwili poll.
  const input: InputController = createInput(canvas, () => state.active, {
    mode,
    isServing: (player) =>
      state.rally.phase === 'serve' && state.rally.server === player && state.ball.held === player,
  });
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
  // Samouczek tylko w trybie asysty – jego podpowiedzi opisują sterowanie F0b.
  const tutorial: Tutorial | null =
    mode === 'assist' ? createTutorial(browserTutorialStorage()) : null;
  // Android: pełny ekran po pierwszym dotyku, bez blokady orientacji (decyzja Dawida 8).
  const fullscreen = createFirstTouchFullscreen(
    window,
    document.documentElement,
    () => document.fullscreenElement !== null,
  );

  let config: SetConfig = {
    seed: opts.seed,
    servingTeam: opts.servingTeam,
    humanControl: opts.humanControl,
  };
  let state: SimState = createState(config);
  let ai: AiState = createAi(config.seed);
  let assist: AssistState = createAssist();
  let recording: Recording = createRecording(state);

  const acc = createAccumulator();
  const frameTimes = createFrameTimeBuffer();
  /**
   * Komendy z input czekają tu na najbliższy krok sim. Na ekranie 120+ Hz zdarzają
   * się klatki bez kroku – tapnięcie z takiej klatki nie może przepaść.
   */
  let pending: Command[] = [];
  /** Tempo pętli (1 albo w stronę 0,6 tuż przed kontaktem aktywnego) – tylko tryb asysty. */
  let tempo = 1;
  /** Gest człowieka, który otworzył bieżący zamach zawodnika – do liczenia samouczka. */
  const humanSwing: Record<PlayerId, HumanGesture | null> = { 0: null, 1: null, 2: null, 3: null };
  let fpsTimeMs = 0;
  let fpsFrames = 0;

  function createState(c: SetConfig): SimState {
    return createSimState({ ...c, assist: mode === 'assist' });
  }

  function newSet(next: NewSetOptions = {}): void {
    config = {
      seed: next.seed ?? config.seed + 1,
      servingTeam: next.servingTeam ?? config.servingTeam,
      humanControl: next.humanControl ?? config.humanControl,
    };
    state = createState(config);
    // AI z tego samego ziarna co sim – ma własny strumień, a nagranie = seed + komendy.
    ai = createAi(config.seed);
    assist = createAssist();
    recording = createRecording(state);
    acc.acc = 0;
    pending = [];
    tempo = 1;
    for (const id of ALL_PLAYERS) humanSwing[id] = null;
  }

  /** Zapamiętuje, jakim gestem człowiek zaczął zamach (bez celu = stuknięcie, z celem = machnięcie). */
  function noteHumanSwings(cmds: readonly Command[]): void {
    for (const c of cmds) {
      if (c.type === 'swing') humanSwing[c.player] = c.aim === null ? 'tap' : 'flick';
    }
  }

  /**
   * Udane użycie do samouczka: kontakt w wymianie po zamachu człowieka – stuknięcie albo
   * machnięcie, a w powietrzu dodatkowo skok. Serwis się nie liczy (piłka nie „dolatuje”).
   */
  function creditTutorial(s: SimState): void {
    for (const e of s.events) {
      if (e.type === 'active-switch') humanSwing[e.from] = null;
      if (e.type === 'whiff') humanSwing[e.player] = null;
      if (e.type !== 'contact') continue;
      const gesture = humanSwing[e.player];
      humanSwing[e.player] = null;
      if (tutorial === null || gesture === null) continue;
      if (e.kind === 'passive' || e.kind === 'serve') continue;
      const credits: HintId[] = [gesture];
      if (!s.players[e.player].grounded) credits.push('jump');
      for (const id of credits) tutorial.credit(id);
    }
  }

  function frame(dt: number, frameMs: number | null): void {
    if (frameMs !== null) frameTimes.push(frameMs);

    // Poll zawsze – input utrzymuje stan gestu; komendy człowieka liczą się tylko, gdy gra człowiek.
    const polled = input.poll(state);
    if (state.humanControl && polled.length > 0) {
      pending.push(...polled);
      noteHumanSwings(polled);
    }
    // Palec przeciąga (albo puścił < 0,5 s temu): ruch należy do niego. Po powrocie asysta
    // wysyła wektor od nowa – człowiek mógł zostawić zawodnika w biegu albo w miejscu.
    const assistSpeaks = state.assist && !input.manualSteering();
    if (!assistSpeaks) assist.lastMove = null;

    tempo = nextTempo(tempo, slowMoWanted(state), dt);
    const steps = drainSteps(acc, dt * tempo);
    for (let i = 0; i < steps; i++) {
      // Aktywny może się przełączyć w trakcie kroków, więc lista sterowanych liczona co krok.
      const controlled = state.humanControl ? WITHOUT[state.active] : ALL_PLAYERS;
      const assistCmds = assistSpeaks ? assistCommands(assist, state) : [];
      const aiCmds = aiCommands(ai, state, controlled);
      const all: Command[] = [...pending, ...assistCmds, ...aiCmds];
      pending = [];
      appendTick(recording, state.tick, all);
      step(state, all);
      creditTutorial(state);
    }

    renderer.render(state, input.view(), dt);
    hud.update(state, tutorial?.current()?.text ?? null);

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

  // Rozmiar: mierzymy kontener (#game), nie kanwę – Three przy setSize z updateStyle = false
  // nie dotyka stylu, ale clientWidth kanwy i tak podąża za kontenerem dopiero po layoucie.
  // Porównanie z poprzednimi wartościami chroni przed pętlą resize → setSize → resize.
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
    renderOptions: () => renderer.options(),
    framing: () => renderer.framing(),
    resetFraming: () => renderer.resetFraming(),
    screenPos: (player) => renderer.screenPos(state, player),
    controlMode: () => mode,
    tempo: () => tempo,
    manualSteering: () => state.assist && input.manualSteering(),
    jumpChance: () => state.assist && jumpAttackChance(state),
    tutorial: () =>
      tutorial === null
        ? null
        : { counts: tutorial.counts(), current: tutorial.current()?.id ?? null },
    fullscreenRequested: () => fullscreen.requested(),
    viewport: () => viewport.size(),
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
    fullscreen.dispose();
    viewport.dispose();
    hud.dispose();
    input.dispose();
    renderer.dispose();
  }

  return { newSet, stop, state: () => state };
}
