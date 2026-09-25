/**
 * Pętla o stałym kroku (docs/22 §1 „src/loop”). requestAnimationFrame podaje czas
 * rzeczywisty, akumulator zamienia go na całkowitą liczbę kroków DT. Sim nigdy nie
 * widzi zegara ściennego – dostaje tylko kolejne wywołania `step`, więc ta sama
 * sekwencja komend daje ten sam mecz niezależnie od fps.
 *
 * Ten plik nie zna stanu gry ani DOM poza rAF – da się go przetestować z podstawionym
 * zegarem.
 */
import { DT } from '../sim/index';

/** Dłuższa przerwa (karta w tle, debugger) nie ma dogonić symulacji jednym skokiem. */
export const MAX_FRAME_DT_S = 0.25;
/** Twardy limit kroków na klatkę: gdy krok trwa dłużej niż DT, zaległość by rosła bez końca. */
export const MAX_STEPS_PER_FRAME = 30;
/** Pojemność bufora czasów klatek dla haków (harness liczy z niego p50/p95). */
export const FRAME_TIME_CAPACITY = 16384;

export interface StepAccumulator {
  /** Niewykorzystany czas w sekundach, zawsze < DT po `drainSteps`. */
  acc: number;
}

export function createAccumulator(): StepAccumulator {
  return { acc: 0 };
}

/**
 * Dolicza czas klatki i zwraca, ile kroków DT trzeba wykonać. Nadmiar ponad
 * MAX_STEPS_PER_FRAME przepada – lepiej zgubić kawałek czasu niż wpaść w spiralę
 * śmierci, w której każda klatka ma więcej kroków niż poprzednia.
 */
export function drainSteps(a: StepAccumulator, dtSeconds: number): number {
  a.acc += Math.min(Math.max(dtSeconds, 0), MAX_FRAME_DT_S);
  let steps = Math.floor(a.acc / DT);
  if (steps > MAX_STEPS_PER_FRAME) {
    steps = MAX_STEPS_PER_FRAME;
    a.acc = a.acc % DT;
  } else {
    a.acc -= steps * DT;
  }
  return steps;
}

export interface FrameTimeBuffer {
  push(ms: number): void;
  /** Od najstarszej do najnowszej klatki. */
  toArray(): number[];
  reset(): void;
}

/** Bufor kołowy czasów klatek – stała pamięć, bez alokacji w trakcie gry. */
export function createFrameTimeBuffer(capacity = FRAME_TIME_CAPACITY): FrameTimeBuffer {
  const buf = new Float64Array(capacity);
  let head = 0;
  let count = 0;
  return {
    push(ms) {
      buf[head] = ms;
      head = (head + 1) % capacity;
      if (count < capacity) count++;
    },
    toArray() {
      const out = new Array<number>(count);
      const start = (head - count + capacity) % capacity;
      for (let i = 0; i < count; i++) out[i] = buf[(start + i) % capacity] ?? 0;
      return out;
    },
    reset() {
      head = 0;
      count = 0;
    },
  };
}

export interface FrameDriver {
  start(): void;
  stop(): void;
  running(): boolean;
}

/**
 * Sterownik klatek na requestAnimationFrame. `onFrame` dostaje czas klatki przycięty
 * do MAX_FRAME_DT_S (do akumulatora i renderu) oraz surowy czas w ms (do pomiarów);
 * dla pierwszej klatki po starcie surowy czas to null – nie ma poprzedniej.
 * Wyjątek w `onFrame` zatrzymuje pętlę i idzie dalej: jeden błąd w konsoli zamiast
 * sześćdziesięciu na sekundę.
 */
export function createFrameDriver(
  onFrame: (dtSeconds: number, frameMs: number | null) => void,
): FrameDriver {
  let handle = 0;
  let last = -1;
  let running = false;

  const tick = (now: number): void => {
    if (!running) return;
    handle = requestAnimationFrame(tick);
    const frameMs = last < 0 ? null : now - last;
    last = now;
    const dt = frameMs === null ? 0 : Math.min(frameMs / 1000, MAX_FRAME_DT_S);
    try {
      onFrame(dt, frameMs);
    } catch (err) {
      stop();
      throw err;
    }
  };

  function start(): void {
    if (running) return;
    running = true;
    last = -1;
    handle = requestAnimationFrame(tick);
  }

  function stop(): void {
    if (!running) return;
    running = false;
    cancelAnimationFrame(handle);
    last = -1;
  }

  return { start, stop, running: () => running };
}
