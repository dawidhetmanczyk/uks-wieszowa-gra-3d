/**
 * Asysta ruchu F0b (decyzja Dawida 1 z 2026-09-26, docs/21): aktywny zawodnik sam dobiega
 * do punktu przyjęcia – `landing.intercept`, czyli pierścienia „tu stań”. Gdy nie ma czego
 * przyjmować, ustawia się „jak AI partnera” (odpowiedź Dawida z 26.09): po własnym odbiciu
 * biegnie na miejsce ataku, a gdy piłka jest u rywali – na pozycję bazową.
 *
 * Asysta TYLKO biega: nie wysyła zamachów. Uderzenie jest zawsze stuknięciem człowieka,
 * a ciało pary w trybie asysty nie odbija piłki (sim, ball.ts) – bez dotyku drużyna gracza
 * nie odbije piłki (pomiar „gra nie gra sama”, tests/ai/asysta.test.ts).
 *
 * Wynik to zwykłe komendy `move` liczone wyłącznie ze stanu sim – deterministyczne, trafiają
 * do nagrania meczu jak komendy AI. Kiedy asysta ma głos (przeciągnięcie palcem ją wyłącza
 * na czas gestu + 0,5 s), decyduje loop; ten moduł nie zna zegara ani DOM.
 */
import type { Command, PlayerId, SimState, Vec2 } from '../sim/index';
import {
  attackSpot,
  basePosition,
  MAX_TOUCHES,
  PLAYER_ACCEL,
  PLAYER_MAX_SPEED,
  sideOf,
  slotOf,
  teamOf,
} from '../sim/index';

/**
 * Cel asysty:
 * - ring: pierścień „tu stań” (punkt przyjęcia) – aktywny może dotknąć lecącej do nas piłki;
 * - attack-spot: miejsce ataku przy siatce – aktywny właśnie przyjął, partner wystawia;
 * - base: pozycja bazowa – piłka u rywali, po naszym trzecim odbiciu albo po punkcie;
 * - stand: bez ruchu – serwujący przed serwisem, koniec seta, tor kończy się na siatce.
 */
export type AssistGoal = 'ring' | 'attack-spot' | 'base' | 'stand';

export interface AssistTarget {
  goal: AssistGoal;
  /** Punkt na podłodze; null dla 'stand'. */
  target: Vec2 | null;
}

export interface AssistState {
  /** Ostatni wysłany wektor; null = trzeba wysłać od nowa (start, powrót po przeciągnięciu). */
  lastMove: Vec2 | null;
  /** Adresat ostatniej komendy – po przełączeniu aktywnego asysta wysyła wektor nowemu. */
  lastPlayer: PlayerId | -1;
}

/** W tym promieniu od celu asysta przestaje biec – jak AI (AI_ARRIVE_RADIUS_M). */
export const ASSIST_ARRIVE_RADIUS_M = 0.15;
/** Kwant wektora ruchu – komenda idzie tylko przy zmianie na tym poziomie (jak AI). */
export const ASSIST_MOVE_QUANTUM = 0.01;
const MOVE_STEPS = Math.round(1 / ASSIST_MOVE_QUANTUM);

export function createAssist(): AssistState {
  return { lastMove: null, lastPlayer: -1 };
}

/** Czysta funkcja stanu: dokąd asysta prowadzi zawodnika `id` w bieżącym ticku. */
export function assistTarget(sim: SimState, id: PlayerId): AssistTarget {
  const rally = sim.rally;
  const player = sim.players[id];
  const team = teamOf(id);
  const base = (): AssistTarget => ({ goal: 'base', target: basePosition(team, slotOf(id)) });

  switch (rally.phase) {
    case 'serve':
      // Serwujący stoi w miejscu (sim i tak go blokuje); reszta czeka na pozycji bazowej.
      return rally.server === id ? { goal: 'stand', target: null } : base();
    case 'point':
      return base();
    case 'set-over':
      return { goal: 'stand', target: null };
    case 'rally':
      break;
  }

  const landing = sim.landing;
  const predicted = landing.valid && !landing.hitsNet;
  // Piłka leci do nas: rozstrzyga przewidywane lądowanie; bez predykcji – strona piłki.
  const incoming = predicted ? sideOf(landing.pos.z) === team : rally.sideOfBall === team;
  const exhausted = rally.sideOfBall === team && rally.touches >= MAX_TOUCHES;
  if (!incoming || exhausted) return base();

  if (rally.lastToucher === id) {
    // Drugie dotknięcie z rzędu to punkt dla rywali – asysta nie biegnie do piłki, tylko
    // ustawia się jak AI: po przyjęciu na miejsce ataku, później na pozycję bazową.
    const ourTouches = rally.sideOfBall === team ? rally.touches : 0;
    if (ourTouches === 1) return { goal: 'attack-spot', target: attackSpot(team, player.pos.x) };
    return base();
  }

  if (!predicted) return { goal: 'stand', target: null };
  return { goal: 'ring', target: { x: landing.intercept.x, z: landing.intercept.z } };
}

function quantize(v: number): number {
  const q = Math.round(v * MOVE_STEPS) / MOVE_STEPS;
  return q === 0 ? 0 : q; // bez -0 w nagraniach
}

/**
 * Wektor ruchu do celu (|v| ≤ 1, skalę zna sim: × PLAYER_MAX_SPEED). Przed celem asysta
 * zwalnia tak, żeby wyhamować w nim ze stałym opóźnieniem PLAYER_ACCEL – bez tego zawodnik
 * przestrzeliwał pierścień o ~0,35 m i wracał.
 */
export function assistMove(sim: SimState, id: PlayerId): Vec2 {
  const { target } = assistTarget(sim, id);
  if (target === null) return { x: 0, z: 0 };
  const p = sim.players[id].pos;
  const dx = target.x - p.x;
  const dz = target.z - p.z;
  const d = Math.sqrt(dx * dx + dz * dz);
  if (d <= ASSIST_ARRIVE_RADIUS_M) return { x: 0, z: 0 };
  const speed = Math.min(1, Math.sqrt(2 * PLAYER_ACCEL * d) / PLAYER_MAX_SPEED);
  let x = quantize((dx / d) * speed);
  let z = quantize((dz / d) * speed);
  const l = Math.sqrt(x * x + z * z);
  if (l > 1) {
    x = Math.trunc((x / l) * MOVE_STEPS) / MOVE_STEPS || 0;
    z = Math.trunc((z / l) * MOVE_STEPS) / MOVE_STEPS || 0;
  }
  return { x, z };
}

/**
 * Komendy asysty dla aktywnego zawodnika na bieżący tick (zwykle pusta lista – komenda idzie
 * tylko przy zmianie wektora). Wołać tylko wtedy, gdy asysta ma głos; po przerwie (palec
 * sterował ręcznie) wołający zeruje `lastMove`, żeby asysta wysłała wektor od nowa.
 */
export function assistCommands(assist: AssistState, sim: SimState): Command[] {
  if (!sim.assist) return [];
  const id = sim.active;
  const v = assistMove(sim, id);
  const last = assist.lastMove;
  const sameMove = last !== null && last.x === v.x && last.z === v.z;
  // Sim zeruje move poprzedniego aktywnego przy przełączeniu – nowy aktywny dostaje wektor od razu.
  const moveMatches = sim.players[id].move.x === v.x && sim.players[id].move.z === v.z;
  if (sameMove && assist.lastPlayer === id && moveMatches) return [];
  assist.lastMove = v;
  assist.lastPlayer = id;
  return [{ type: 'move', player: id, x: v.x, z: v.z }];
}
