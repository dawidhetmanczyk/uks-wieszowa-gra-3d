/**
 * Kontrakt stanu i komend symulacji (docs/22-ARCHITEKTURA-F0.md).
 *
 * Stan jest zwykłym obiektem bez metod: da się go skopiować (structuredClone),
 * porównać (JSON) i zapisać. Wejścia to dane (Command), więc nagranie meczu
 * = seed + lista komend per tick, a powtórka = ten sam `step` na tych samych danych.
 *
 * Ten plik nie zna DOM ani Three – czyta go sim, ai, render, input, ui, loop.
 */

/** 0 = niebiescy (gracz + partner, połowa z < 0), 1 = czerwoni (rywale, z > 0). */
export type TeamId = 0 | 1;

/** 0 = gracz (człowiek), 1 = partner-AI, 2 i 3 = rywale-AI. */
export type PlayerId = 0 | 1 | 2 | 3;

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

/** Punkt na podłodze (bez y). */
export interface Vec2 {
  x: number;
  z: number;
}

/**
 * Fazy wymiany:
 * - serve: serwujący trzyma piłkę (ball.held), czeka na zamach;
 * - rally: piłka w grze;
 * - point: punkt przyznany, pauza POINT_FREEZE_S, piłka jeszcze się toczy;
 * - set-over: set rozstrzygnięty, czeka na komendę new-set.
 */
export type Phase = 'serve' | 'rally' | 'point' | 'set-over';

/** Rodzaj kontaktu – decyduje o prędkości i łuku (docs/20 §5). */
export type HitKind = 'serve' | 'receive' | 'set' | 'attack' | 'passive';

export type PointReason =
  | 'floor-in' // piłka spadła w boisku po stronie przegranych
  | 'floor-out' // piłka spadła poza boiskiem – traci drużyna ostatniego kontaktu
  | 'four-touches' // czwarte odbicie po jednej stronie
  | 'double-touch' // ten sam zawodnik dwa razy z rzędu
  | 'under-net'; // piłka przeszła pod siatką lub poza pasem siatki poniżej jej górnej krawędzi

export interface PlayerState {
  id: PlayerId;
  team: TeamId;
  /** Punkt między stopami (środek podstawy kapsuły). y > 0 tylko w skoku. */
  pos: Vec3;
  vel: Vec3;
  grounded: boolean;
  /** Kierunek patrzenia (rad wokół y) – tylko dla renderu, wyliczany z ruchu. */
  facing: number;

  /** Ostatnia komenda ruchu (kierunek, |v| ≤ 1). Trwa, dopóki nie przyjdzie nowa. */
  move: Vec2;
  /** Cel na podłodze po stronie rywali albo null (= wystawa do partnera / cel domyślny). */
  aim: Vec2 | null;

  /** Tick początku zamachu; -1 = brak zamachu. */
  swingStartTick: number;
  /** Tick puszczenia; -1 = wciąż trzyma. Po puszczeniu obowiązuje jeszcze SWING_GRACE_S. */
  swingReleaseTick: number;
  /** Siła narzucona przez AI (0..1) albo null = z czasu trzymania. */
  swingPower: number | null;
  /** Do tego ticku zawodnik nie może zacząć zamachu (po pudle). */
  cooldownUntilTick: number;
  /** Tick ostatniego kontaktu z piłką; -1 = brak. Steruje immunitetem kolizji. */
  lastHitTick: number;
}

export interface BallState {
  pos: Vec3;
  vel: Vec3;
  /** Kto trzyma piłkę przed serwisem; -1 = piłka w grze / na podłodze. */
  held: PlayerId | -1;
}

export interface RallyState {
  phase: Phase;
  /** Tick wejścia w bieżącą fazę. */
  phaseTick: number;
  servingTeam: TeamId;
  server: PlayerId;
  /** Odbicia na aktualnej stronie (zeruje się przy przejściu nad siatką). */
  touches: number;
  /** Ostatni zawodnik, który dotknął piłki; -1 po serwisie/zmianie strony. */
  lastToucher: PlayerId | -1;
  /** Po której stronie jest piłka (znak z). */
  sideOfBall: TeamId;
  /** Kto wygrał ostatni punkt (faza point/set-over); -1 gdy brak. */
  pointWinner: TeamId | -1;
  pointReason: PointReason | null;
  /** Ile razy każda drużyna serwowała – do naprzemiennego wyboru serwującego. */
  servesByTeam: [number, number];
}

export interface ScoreState {
  points: [number, number];
  setWinner: TeamId | -1;
}

/** Ostatni kontakt zawodnika z piłką – do HUD, testów i harnessu. */
export interface ContactInfo {
  tick: number;
  player: PlayerId;
  kind: HitKind;
  /** 0..1; 1 = idealny timing (zero szumu). Bierny kontakt ma 0. */
  quality: number;
  /** Numer odbicia po tej stronie (1..3). */
  touchNo: number;
  /** Cel po szumie (dokąd piłka ma polecieć). */
  target: Vec2;
  power: number;
}

/**
 * Przewidywane lądowanie piłki z równania toru (bez szumu, bez zawodników).
 * `hitsNet` = tor kończy się na siatce; wtedy pos to punkt przy siatce.
 */
export interface LandingPrediction {
  valid: boolean;
  pos: Vec2;
  /** Tick sim, w którym piłka dotknie podłogi (lub siatki). */
  tick: number;
  hitsNet: boolean;
}

export type SimEvent =
  | { type: 'contact'; player: PlayerId; kind: HitKind; quality: number; touchNo: number }
  | { type: 'whiff'; player: PlayerId }
  | { type: 'net' }
  | { type: 'floor'; pos: Vec2; inCourt: boolean }
  | { type: 'point'; winner: TeamId; reason: PointReason }
  | { type: 'serve-ready'; server: PlayerId }
  | { type: 'set-over'; winner: TeamId }
  | { type: 'active-switch'; from: PlayerId; to: PlayerId };

export interface SimState {
  tick: number;
  seed: number;
  /** Stan mulberry32 – jedyne źródło losowości sim. */
  rng: number;
  players: [PlayerState, PlayerState, PlayerState, PlayerState];
  ball: BallState;
  rally: RallyState;
  score: ScoreState;
  /** Zawodnik drużyny 0 sterowany przez człowieka (0 lub 1). */
  active: PlayerId;
  activeSinceTick: number;
  /** Czy człowiek gra (false = AI vs AI, np. harness). Sim nie generuje komend – to informacja dla loop/ai. */
  humanControl: boolean;
  /** Odświeżane w każdym kroku dla piłki w locie. */
  landing: LandingPrediction;
  lastContact: ContactInfo | null;
  /** Zdarzenia z ostatniego wykonanego kroku (czyszczone na początku kroku). */
  events: SimEvent[];
}

/**
 * Komendy = wejścia jako dane. Każdy tick dostaje listę komend (może być pusta).
 * - move: ustawia kierunek ruchu zawodnika; trwa do następnej komendy move.
 * - swing: początek zamachu (przytrzymanie). aim = cel albo null. power nadpisuje siłę (AI).
 *   W fazie serve przez serwującego: z power → serwis natychmiast; bez → serwis przy release.
 * - aim: zmiana celu w trakcie trzymania.
 * - release: puszczenie – kończy trzymanie (siła = czas trzymania, jeśli nie nadpisana).
 * - new-set: nowy set z podanym ziarnem; opcjonalnie kto serwuje i czy człowiek gra.
 */
export type Command =
  | { type: 'move'; player: PlayerId; x: number; z: number }
  | { type: 'swing'; player: PlayerId; aim: Vec2 | null; power?: number }
  | { type: 'aim'; player: PlayerId; aim: Vec2 | null }
  | { type: 'release'; player: PlayerId }
  | { type: 'new-set'; seed: number; servingTeam?: TeamId; humanControl?: boolean };

/** Jedna klatka nagrania: komendy podane do `step` w danym ticku. */
export interface RecordedTick {
  tick: number;
  commands: Command[];
}

export interface Recording {
  seed: number;
  servingTeam: TeamId;
  humanControl: boolean;
  ticks: RecordedTick[];
}
