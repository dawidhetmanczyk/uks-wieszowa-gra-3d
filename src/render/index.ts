/**
 * Publiczne API renderu (docs/22 §1). Render czyta SimState i nic w nim nie zmienia –
 * to jest gwarancja, na której stoi determinizm (docs/20 §8: „render nie wpływa na sim”).
 *
 * F0: kapsuły i prostokąty, jedno światło kierunkowe z cieniem + HemisphereLight,
 * bez postprocesu. Budżet: ≤ 60 draw calls, ≤ 120 k trójkątów (CLAUDE.md).
 */
import { Color, DirectionalLight, HemisphereLight, Scene, WebGLRenderer } from 'three';
import type { SimState, Vec2 } from '../sim/index';
import { createActors } from './actors';
import { createGameCamera } from './camera';
import { COLOR_BACKGROUND, COLOR_GROUND_LIGHT, COLOR_SKY_LIGHT } from './colors';
import { createCourt } from './court';
import { createMarkers } from './markers';

/** Stan wejścia potrzebny renderowi (celownik); dostarcza go src/input. */
export interface ViewState {
  /** Cel ataku na połowie rywali albo null = cel domyślny „między rywalami”. */
  aim: Vec2 | null;
  /** Czy zawodnik trzyma zamach – wtedy pokazujemy celownik. */
  holding: boolean;
  /** Siła 0..1 z czasu trzymania (w F0 tylko dla HUD; render jej nie rysuje). */
  power: number;
}

export interface GameRenderer {
  render(state: SimState, view: ViewState, dtSeconds: number): void;
  resize(width: number, height: number, dpr: number): void;
  /** Statystyki ostatniej klatki (renderer.info, autoReset) – czytaj po render(). */
  info(): { calls: number; triangles: number; programs: number };
  dispose(): void;
}

/** Powyżej 2× piksele kosztują, a na telefonie nikt nie widzi różnicy. */
const MAX_PIXEL_RATIO = 2;
/** Three od r155 liczy światła w jednostkach fizycznych – stąd wartości > 1. */
const SUN_INTENSITY = 2.2;
const SKY_INTENSITY = 1.2;
const SUN_POSITION = { x: 6, y: 14, z: -6 };
const SHADOW_MAP_SIZE = 1024;
/** Kamera ortogonalna cienia ma objąć boisko 9 × 18 m ze strefą serwisu. */
const SHADOW_HALF_EXTENT = 12;
const SHADOW_NEAR = 1;
const SHADOW_FAR = 40;
const SHADOW_BIAS = -0.0005;

export function createRenderer(canvas: HTMLCanvasElement): GameRenderer {
  const renderer = new WebGLRenderer({
    canvas,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.shadowMap.enabled = true;

  const scene = new Scene();
  scene.background = new Color(COLOR_BACKGROUND);

  const sun = new DirectionalLight('#FFFFFF', SUN_INTENSITY);
  sun.position.set(SUN_POSITION.x, SUN_POSITION.y, SUN_POSITION.z);
  sun.castShadow = true;
  sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  sun.shadow.bias = SHADOW_BIAS;
  const shadowCamera = sun.shadow.camera;
  shadowCamera.left = -SHADOW_HALF_EXTENT;
  shadowCamera.right = SHADOW_HALF_EXTENT;
  shadowCamera.top = SHADOW_HALF_EXTENT;
  shadowCamera.bottom = -SHADOW_HALF_EXTENT;
  shadowCamera.near = SHADOW_NEAR;
  shadowCamera.far = SHADOW_FAR;
  shadowCamera.updateProjectionMatrix();
  // Cel światła musi być w grafie sceny, żeby miał aktualną macierz świata.
  scene.add(sun, sun.target);

  scene.add(new HemisphereLight(COLOR_SKY_LIGHT, COLOR_GROUND_LIGHT, SKY_INTENSITY));

  const court = createCourt();
  const actors = createActors();
  const markers = createMarkers();
  scene.add(court.group, actors.group, markers.group);

  const gameCamera = createGameCamera();
  // Docelowy rozmiar ustawia loop przez resize(); tu tylko sensowny aspekt na start.
  const startAspect =
    canvas.clientWidth > 0 && canvas.clientHeight > 0
      ? canvas.clientWidth / canvas.clientHeight
      : 1;
  gameCamera.setAspect(startAspect);

  return {
    render(state, view, dtSeconds) {
      actors.update(state);
      markers.update(state, view);
      gameCamera.update(state, dtSeconds);
      renderer.render(scene, gameCamera.camera);
    },
    resize(width, height, dpr) {
      renderer.setPixelRatio(Math.min(dpr, MAX_PIXEL_RATIO));
      // : rozmiar kanwy w CSS ustawia arkusz (100vw/100dvh), nie inline style.
      renderer.setSize(width, height, false);
      gameCamera.setAspect(height > 0 ? width / height : 1);
    },
    info() {
      return {
        calls: renderer.info.render.calls,
        triangles: renderer.info.render.triangles,
        programs: renderer.info.programs?.length ?? 0,
      };
    },
    dispose() {
      court.dispose();
      actors.dispose();
      markers.dispose();
      sun.shadow.dispose();
      renderer.dispose();
    },
  };
}
