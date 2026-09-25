/**
 * Pomiar kadru: czy zawodnicy mieszczą się w oknie (raport F0 §7 – w pionie partner
 * wypadał z kadru). Liczony co klatkę po renderze, z tej samej kamery, którą widzi gracz.
 * Czyta tylko stan sim i kamerę – nic nie zmienia.
 *
 * Kapsuła zawodnika jest „cała w kadrze”, gdy cztery skrajne punkty – stopy i czubek
 * głowy, każdy przesunięty o promień w lewo i w prawo względem kamery – leżą w oknie.
 * „Choć częściowo” = prostokąt tych punktów na ekranie zachodzi na okno.
 *
 * Bez alokacji w klatce: wektory robocze są w module, bo `measure` idzie 60+ razy na sekundę.
 */
import { Vector3 } from 'three';
import type { PerspectiveCamera } from 'three';
import { PLAYER_H, PLAYER_R } from '../sim/index';
import type { PlayerId, SimState } from '../sim/index';

export interface FramingStats {
  frames: number;
  /** Klatki, w których obaj zawodnicy drużyny gracza (0 i 1) są w kadrze w całości. */
  team0Full: number;
  /** Klatki, w których obaj są w kadrze choć częściowo. */
  team0Partial: number;
  /** Klatki „cały w kadrze” dla zawodników 0..3. */
  playerFull: [number, number, number, number];
  /** Klatki z piłką w kadrze (środek piłki w oknie). */
  ballIn: number;
  /** Najmniejszy zapas (px CSS) skrajnego punktu kapsuł 0 i 1 do krawędzi okna; < 0 = wyszedł. */
  minMarginPx: number;
  /** Średnia wysokość kapsuł 0 i 1 na ekranie (px CSS) – miara „jak duży jest zawodnik”. */
  meanPlayerHeightPx: number;
  width: number;
  height: number;
}

/** Wynik rzutu jednej kapsuły. */
interface CapsuleView {
  full: boolean;
  partial: boolean;
  /** Najmniejszy zapas do krawędzi w px CSS (ujemny = poza oknem). */
  marginPx: number;
  heightPx: number;
}

const ALL: readonly PlayerId[] = [0, 1, 2, 3];

const right = new Vector3();
const p = new Vector3();
const capsule: CapsuleView = { full: false, partial: false, marginPx: 0, heightPx: 0 };

/**
 * Rzut kapsuły zawodnika. Kamera musi mieć aktualne macierze – `measure` woła
 * `updateMatrixWorld`, bo w testach w Node nie ma renderera, który by to zrobił.
 */
function viewCapsule(
  state: SimState,
  camera: PerspectiveCamera,
  player: PlayerId,
  width: number,
  height: number,
): CapsuleView {
  const pos = state.players[player].pos;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let behind = false;
  let footY = 0;
  let headY = 0;
  for (let k = 0; k < 4; k++) {
    const side = k % 2 === 0 ? -1 : 1;
    const y = k < 2 ? pos.y : pos.y + PLAYER_H;
    p.set(pos.x, y, pos.z)
      .addScaledVector(right, side * PLAYER_R)
      .project(camera);
    // z > 1 = za płaszczyzną dalszą albo za kamerą (odwrócenie przy w < 0).
    if (p.z > 1 || p.z < -1) behind = true;
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
    if (k === 0) footY = p.y;
    if (k === 2) headY = p.y;
  }
  const marginX = Math.min(1 - Math.abs(minX), 1 - Math.abs(maxX)) * (width / 2);
  const marginY = Math.min(1 - Math.abs(minY), 1 - Math.abs(maxY)) * (height / 2);
  capsule.marginPx = behind ? -Infinity : Math.min(marginX, marginY);
  capsule.full = !behind && minX >= -1 && maxX <= 1 && minY >= -1 && maxY <= 1;
  capsule.partial = !behind && maxX >= -1 && minX <= 1 && maxY >= -1 && minY <= 1;
  capsule.heightPx = ((headY - footY) * height) / 2;
  return capsule;
}

export interface FramingMeter {
  /** Jedna klatka: kamera po update, rozmiar okna w px CSS. */
  measure(state: SimState, camera: PerspectiveCamera, width: number, height: number): void;
  stats(): FramingStats;
  reset(): void;
  /** Stopy zawodnika w px CSS okna – do testu sterowania „w prawo na ekranie”. */
  screenPos(
    state: SimState,
    camera: PerspectiveCamera,
    player: PlayerId,
    width: number,
    height: number,
  ): { x: number; y: number };
}

export function createFramingMeter(): FramingMeter {
  let frames = 0;
  let team0Full = 0;
  let team0Partial = 0;
  const playerFull: [number, number, number, number] = [0, 0, 0, 0];
  let ballIn = 0;
  let minMarginPx = Infinity;
  let heightSum = 0;
  let lastWidth = 0;
  let lastHeight = 0;

  return {
    measure(state, camera, width, height) {
      if (width <= 0 || height <= 0) return;
      camera.updateMatrixWorld();
      right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
      lastWidth = width;
      lastHeight = height;
      frames++;
      let bothFull = true;
      let bothPartial = true;
      for (const id of ALL) {
        const v = viewCapsule(state, camera, id, width, height);
        if (v.full) playerFull[id]++;
        if (id < 2) {
          bothFull &&= v.full;
          bothPartial &&= v.partial;
          minMarginPx = Math.min(minMarginPx, v.marginPx);
          heightSum += v.heightPx / 2;
        }
      }
      if (bothFull) team0Full++;
      if (bothPartial) team0Partial++;
      const b = state.ball.pos;
      p.set(b.x, b.y, b.z).project(camera);
      if (Math.abs(p.x) <= 1 && Math.abs(p.y) <= 1 && p.z <= 1 && p.z >= -1) ballIn++;
    },
    stats() {
      return {
        frames,
        team0Full,
        team0Partial,
        playerFull: [...playerFull],
        ballIn,
        minMarginPx: frames > 0 ? minMarginPx : 0,
        meanPlayerHeightPx: frames > 0 ? heightSum / frames : 0,
        width: lastWidth,
        height: lastHeight,
      };
    },
    reset() {
      frames = 0;
      team0Full = 0;
      team0Partial = 0;
      playerFull.fill(0);
      ballIn = 0;
      minMarginPx = Infinity;
      heightSum = 0;
    },
    screenPos(state, camera, player, width, height) {
      camera.updateMatrixWorld();
      const pos = state.players[player].pos;
      p.set(pos.x, pos.y, pos.z).project(camera);
      return { x: ((p.x + 1) / 2) * width, y: ((1 - p.y) / 2) * height };
    },
  };
}
