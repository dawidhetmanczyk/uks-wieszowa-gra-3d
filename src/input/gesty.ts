/**
 * Czysta logika warstwy wejścia – bez DOM, testowalna w Node (tests/input/gesty.test.ts).
 *
 * Jeden palec musi obsłużyć i ruch, i uderzenie (docs/20 §3.3), więc pierwsze
 * HOLD_MS dotknięcia są „nieznane”: ruch ponad DEADZONE_PX rozstrzyga na
 * joystick, bezruch przez HOLD_MS – na zamach, puszczenie wcześniej – na
 * tapnięcie (docs/22 §4). Progi i mapowania są tu, a nie w touch.ts/keyboard.ts,
 * żeby dotyk i klawiatura dawały sim identyczny kształt komend.
 */
import { aimFromDirection } from '../sim/aim';
import { POWER_FULL_HOLD_S, POWER_MIN_HOLD_S } from '../sim/constants';
import type { Command, PlayerId, TeamId, Vec2 } from '../sim/types';
import { clamp } from '../sim/vec';

// Progi gestów (docs/22 §4) -------------------------------------------------
/** Poniżej tego przesunięcia palec „stoi” – i dla klasyfikacji, i dla joysticka. */
export const DEADZONE_PX = 12;
/** Po tym czasie bez ruchu dotknięcie staje się zamachem. */
export const HOLD_MS = 120;
/** Przesunięcie, przy którym joystick daje pełną prędkość. */
export const SATURATION_PX = 70;
/** Tyle pikseli odpowiada jednostkowemu wektorowi kierunku celu (aimFromDirection). */
export const AIM_SCALE_PX = 60;

// Kwantyzacja – komendy idą tylko przy zmianie, więc drgania palca nie zalewają sim.
export const MOVE_QUANTUM = 0.02;
export const AIM_QUANTUM_M = 0.05;

/**
 * Znak osi x świata dla ruchu palca / klawisza „w prawo”. Układ jest prawoskrętny
 * (Three.js): kamera stoi w z = −15 i patrzy w +z, więc prawo ekranu to −x świata.
 * Ten sam znak jest w sim/aim.ts (celowanie) – ruch i cel muszą iść w tę samą stronę.
 */
export const WORLD_X_PER_SCREEN_RIGHT = -1;

/** Tryb gestu wskaźnika: nieznany (pierwsze HOLD_MS), joystick (ruch) albo zamach. */
export type GestureMode = 'unknown' | 'joystick' | 'swing';

/** Trwający zamach – do celownika i paska siły w renderze. */
export interface HoldInfo {
  aim: Vec2 | null;
  /** Czas (ms, zegar warstwy input) wysłania komendy swing. */
  sinceMs: number;
}

/**
 * Ujście komend wspólne dla touch.ts i keyboard.ts. Zegar jest wstrzykiwany,
 * bo sim nie zna czasu rzeczywistego – tylko input liczy nim siłę do podglądu.
 */
export interface InputSink {
  push(cmd: Command): void;
  /** state.active z ostatniego poll – adresat komend rozpoczynanego gestu. */
  activePlayer(): PlayerId;
  now(): number;
}

/**
 * Klasyfikacja pierwszego dotknięcia. Ruch ma pierwszeństwo przed czasem: gdy
 * oba warunki spełnią się w tym samym odczycie, przesunięcie palca jest
 * dowodem intencji, a upływ czasu tylko jego brakiem.
 */
export function classifyGesture(elapsedMs: number, dx: number, dy: number): GestureMode {
  if (Math.hypot(dx, dy) > DEADZONE_PX) return 'joystick';
  if (elapsedMs >= HOLD_MS) return 'swing';
  return 'unknown';
}

/** Zaokrąglenie do kroku; `|| 0` zamienia −0 na 0, żeby porównania i JSON były czyste. */
export function quantize(v: number, step: number): number {
  return Math.round(v / step) * step || 0;
}

function clipToUnit(x: number, z: number): Vec2 {
  const len = Math.hypot(x, z);
  if (len > 1) return { x: x / len, z: z / len };
  return { x, z };
}

/**
 * Wektor ruchu z przesunięcia palca względem punktu startu. Góra ekranu = +z
 * (w stronę siatki), bo kamera stoi za drużyną gracza.
 */
export function joystickVector(dx: number, dy: number): Vec2 {
  if (Math.hypot(dx, dy) <= DEADZONE_PX) return { x: 0, z: 0 };
  const v = clipToUnit((WORLD_X_PER_SCREEN_RIGHT * dx) / SATURATION_PX, -dy / SATURATION_PX);
  return { x: quantize(v.x, MOVE_QUANTUM), z: quantize(v.z, MOVE_QUANTUM) };
}

/**
 * Wektor ruchu z klawiszy. Klawisze na tej samej osi sumują się logicznie
 * (W i strzałka w górę = jedna jednostka), żeby dublowanie nie zmieniało kierunku.
 */
export function keyboardVector(right: boolean, left: boolean, up: boolean, down: boolean): Vec2 {
  const ax = (right ? 1 : 0) - (left ? 1 : 0);
  const az = (up ? 1 : 0) - (down ? 1 : 0);
  // `|| 0`: przy ax = 0 iloczyn z −1 daje −0, a komendy i testy porównują przez Object.is.
  return clipToUnit(WORLD_X_PER_SCREEN_RIGHT * ax || 0, az);
}

export function quantizeAim(aim: Vec2): Vec2 {
  return { x: quantize(aim.x, AIM_QUANTUM_M), z: quantize(aim.z, AIM_QUANTUM_M) };
}

/** Cel z przesunięcia palca w trakcie trzymanego zamachu (docs/22 §4 „celowanie”). */
export function aimFromOffset(dx: number, dy: number, team: TeamId): Vec2 | null {
  const aim = aimFromDirection(dx / AIM_SCALE_PX, dy / AIM_SCALE_PX, team);
  return aim ? quantizeAim(aim) : null;
}

/** Cel ze strzałek: dirX = prawo − lewo, dirY = dół − góra (konwencja DOM jak w aim.ts). */
export function aimFromArrows(
  right: boolean,
  left: boolean,
  up: boolean,
  down: boolean,
  team: TeamId,
): Vec2 | null {
  const dirX = (right ? 1 : 0) - (left ? 1 : 0);
  const dirY = (down ? 1 : 0) - (up ? 1 : 0);
  const aim = aimFromDirection(dirX, dirY, team);
  return aim ? quantizeAim(aim) : null;
}

export function sameVec2(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.z === b.z;
}

export function sameAim(a: Vec2 | null, b: Vec2 | null): boolean {
  if (a === null || b === null) return a === b;
  return sameVec2(a, b);
}

/**
 * Siła do podglądu z czasu trzymania (s) – ta sama krzywa, którą sim liczy
 * z ticków (docs/22 §3 pkt 4), żeby celownik nie kłamał.
 */
export function holdPower(heldS: number): number {
  return clamp((heldS - POWER_MIN_HOLD_S) / (POWER_FULL_HOLD_S - POWER_MIN_HOLD_S), 0, 1);
}
