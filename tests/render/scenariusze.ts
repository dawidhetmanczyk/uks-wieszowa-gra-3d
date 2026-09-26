/**
 * Scenariusze meczu do pomiaru kadru (tests/render/kadr.test.ts i skrypt przeszukania
 * kamery w harness/wyniki). Każdy woła `onFrame` co 2 kroki sim – render 60 fps.
 *
 * F0b (decyzja Dawida 7): nowy scenariusz obciążeniowy „asysta + gracz przeciągany do linii”.
 * Aktywnym steruje asysta ruchu (src/ai/assist.ts) jak w grze, a symulowany człowiek:
 * - stuka, gdy piłka za ≤ 0,05 s wejdzie w zasięg aktywnego (serwis stuknięciem po 1 s),
 *   więc wymiany trwają, są wystawy, ataki i skoki przy siatce;
 * - co 7 s przeciąga aktywnego przez 1,5 s do linii bocznej albo końcowej (po kolei: lewa,
 *   prawa, tył, lewy róg, prawy róg), a po puszczeniu przez 0,5 s nic – potem wraca asysta.
 * To jest najgorszy przypadek dla kadru w pionie: zawodnik ucieka pod linię, a kamera musi
 * trzymać w kadrze i jego, i partnera.
 */
import { aiCommands, assistCommands, createAi, createAssist } from '../../src/ai/index';
import {
  createSimState,
  DT,
  reachWindow,
  sideOf,
  step,
  TICK_HZ,
  type Command,
  type PlayerId,
  type SimState,
  type TeamId,
} from '../../src/sim/index';

export const FRAME_TICKS = 2;
export const SCENARIO_TICKS = 60 * TICK_HZ;

export type FrameFn = (s: SimState) => void;
export type Scenario = (seed: number, onFrame: FrameFn) => void;

const WITHOUT: Readonly<Record<PlayerId, readonly PlayerId[]>> = {
  0: [1, 2, 3],
  1: [0, 2, 3],
  2: [0, 1, 3],
  3: [0, 1, 2],
};

/** AI vs AI, 60 s – kadr „spokojnego” meczu. */
export function runAiVsAi(seed: number, onFrame: FrameFn): void {
  const s = createSimState({ seed, humanControl: false });
  const ai = createAi(seed);
  for (let t = 0; t < SCENARIO_TICKS; t++) {
    step(s, aiCommands(ai, s, [0, 1, 2, 3]));
    if (t % FRAME_TICKS === 1) onFrame(s);
  }
}

/** F0 (2026-09-25): człowiek bez asysty zmienia kierunek co 2 s – po linie boczne i dalej. */
export function runRunaway(seed: number, onFrame: FrameFn): void {
  const s = createSimState({ seed, humanControl: true, servingTeam: 1 });
  const ai = createAi(seed);
  const dirs = [
    { x: 1, z: 0 },
    { x: -1, z: 0 },
    { x: 0.7, z: -0.7 },
    { x: -0.7, z: -0.7 },
    { x: 1, z: 0.3 },
    { x: -1, z: 0.3 },
  ];
  let lastActive: PlayerId = s.active;
  for (let t = 0; t < SCENARIO_TICKS; t++) {
    const cmds: Command[] = [];
    const d = dirs[Math.floor(t / 240) % dirs.length]!;
    if (t % 240 === 0 || s.active !== lastActive) {
      cmds.push({ type: 'move', player: s.active, x: d.x, z: d.z });
      lastActive = s.active;
    }
    if (s.rally.phase === 'serve' && s.rally.server === s.active && t % 120 === 60) {
      cmds.push({ type: 'swing', player: s.active, aim: null, power: 0.3 });
    }
    step(s, [...cmds, ...aiCommands(ai, s, WITHOUT[s.active])]);
    if (t % FRAME_TICKS === 1) onFrame(s);
  }
}

/** Co ile ticków zaczyna się przeciągnięcie i ile trwa; potem 0,5 s bez asysty. */
const DRAG_EVERY = 7 * TICK_HZ;
const DRAG_TICKS = Math.round(1.5 * TICK_HZ);
const RESUME_TICKS = Math.round(0.5 * TICK_HZ);
/**
 * Cele przeciągnięcia: „do linii” (polecenie F0b) – linie boczne x = ±4,5 m, linia końcowa
 * z = −9 m i oba tylne rogi. Palec prowadzi pełną prędkością i puszcza na linii.
 */
const DRAG_TARGETS = [
  { x: 4.5, z: -5 },
  { x: -4.5, z: -5 },
  { x: 0, z: -9 },
  { x: 4.5, z: -9 },
  { x: -4.5, z: -9 },
];
/** Stuknięcie, gdy piłka wejdzie w zasięg aktywnego za tyle sekundy (jak AI_SWING_LEAD_S). */
const TAP_LEAD_S = 0.05;
const SERVE_AFTER_TICKS = TICK_HZ;

/**
 * F0b: asysta + gracz przeciągany do linii (opis w nagłówku pliku). Serwuje drużyna
 * `seed % 2` – nieparzyste seedy zaczynają rywale.
 */
export function runAssistDrag(seed: number, onFrame: FrameFn): void {
  const s = createSimState({
    seed,
    humanControl: true,
    assist: true,
    servingTeam: (seed % 2) as TeamId,
  });
  const ai = createAi(seed);
  const assist = createAssist();
  /** Tick kontaktu, po którym człowiek już stuknął – jedno stuknięcie na podejście piłki. */
  let tappedAfterContact = -2;

  for (let t = 0; t < SCENARIO_TICKS; t++) {
    const human: Command[] = [];
    const active = s.active;
    const inCycle = t % DRAG_EVERY;
    const dragging = t >= DRAG_EVERY && inCycle < DRAG_TICKS;
    const resuming =
      t >= DRAG_EVERY && inCycle >= DRAG_TICKS && inCycle < DRAG_TICKS + RESUME_TICKS;

    if (dragging) {
      const target = DRAG_TARGETS[Math.floor(t / DRAG_EVERY - 1) % DRAG_TARGETS.length]!;
      const p = s.players[active].pos;
      const dx = target.x - p.x;
      const dz = target.z - p.z;
      const d = Math.hypot(dx, dz);
      const v = d < 0.2 ? { x: 0, z: 0 } : { x: dx / d, z: dz / d };
      human.push({ type: 'move', player: active, x: v.x, z: v.z });
    } else if (inCycle === DRAG_TICKS && t >= DRAG_EVERY) {
      human.push({ type: 'move', player: active, x: 0, z: 0 });
    }

    const rally = s.rally;
    const lastTick = s.lastContact?.tick ?? -1;
    if (rally.phase === 'serve' && rally.server === active && s.ball.held === active) {
      if (s.tick - rally.phaseTick === SERVE_AFTER_TICKS) {
        human.push({ type: 'swing', player: active, aim: null, power: 0 });
        human.push({ type: 'release', player: active });
      }
    } else if (
      rally.phase === 'rally' &&
      rally.lastToucher !== active &&
      tappedAfterContact !== lastTick &&
      s.landing.valid &&
      sideOf(s.landing.pos.z) === s.players[active].team
    ) {
      const w = reachWindow(s, active);
      if (w !== null && (w.enterTick - s.tick) * DT <= TAP_LEAD_S && s.tick <= w.exitTick) {
        human.push({ type: 'swing', player: active, aim: null, power: 0.5 });
        human.push({ type: 'release', player: active });
        tappedAfterContact = lastTick;
      }
    }

    const assistOn = !dragging && !resuming;
    if (!assistOn) assist.lastMove = null;
    const assistCmds = assistOn ? assistCommands(assist, s) : [];
    step(s, [...human, ...assistCmds, ...aiCommands(ai, s, WITHOUT[s.active])]);
    if (t % FRAME_TICKS === 1) onFrame(s);
  }
}
