/**
 * Kamera za plecami drużyny gracza (docs/20 §4.1, docs/22 §7).
 *
 * Nie obraca się w trakcie wymiany – jedzie tylko w x za środkiem ciężkości
 * „aktywny + piłka”, żeby gracz nie tracił orientacji (kamera zawsze patrzy wzdłuż
 * boiska). Lerp jest niezależny od fps: ten sam ruch przy 30 i 120 klatkach.
 *
 * Wszystkie liczby są w CameraConfig: kod gry używa domyślnych, a pomiar kadru
 * (tests/render/kadr.test.ts, skrypt przeszukania) podstawia inne – dzięki temu mierzymy
 * dokładnie ten kod, który widzi gracz, a nie jego kopię.
 */
import { PerspectiveCamera } from 'three';
import type { SimState } from '../sim/index';

export interface CameraConfig {
  /** Wysokość kamery nad parkietem (m). */
  height: number;
  /** Położenie kamery w z (m); linia końcowa drużyny gracza leży w z = −9. */
  z: number;
  /** Punkt, na który patrzy kamera: (camX, lookY, lookZ). */
  lookY: number;
  lookZ: number;
  /** FOV pionowe (stopnie), gdy okno jest wyższe niż szersze (telefon w pionie po furtce). */
  fovPortrait: number;
  /** FOV pionowe (stopnie) w poziomie, gdy nie ustalono FOV poziomego. */
  fovLandscape: number;
  /**
   * FOV POZIOME (stopnie) w poziomie; null = stałe fovLandscape. Przy stałym FOV poziomym
   * szerokość widzianego boiska nie zależy od proporcji ekranu (16:9 monitor, 19,5:9
   * telefon) – liczy się pionowe z proporcji, przycięte do [fovLandscapeMin, fovLandscapeMax].
   */
  hfovLandscape: number | null;
  fovLandscapeMin: number;
  fovLandscapeMax: number;
  /** Wagi celu kamery w x: aktywny zawodnik, jego partner, piłka (suma = 1). */
  weightActive: number;
  weightPartner: number;
  weightBall: number;
}

/** Wartości F0 sprzed poprawek 2026-09-25 – do pomiaru „przed”. */
export const CAMERA_F0: Readonly<CameraConfig> = {
  height: 3.2,
  z: -15,
  lookY: 1.1,
  lookZ: 0,
  fovPortrait: 72,
  fovLandscape: 48,
  hfovLandscape: null,
  fovLandscapeMin: 48,
  fovLandscapeMax: 48,
  weightActive: 0.6,
  weightPartner: 0,
  weightBall: 0.4,
};

/**
 * Kamera pod poziom (2026-09-25), dobrana pomiarem – docs/RAPORT-F0.md §8 i przeszukanie
 * wariantów w harness/wyniki. Warunek: obaj zawodnicy drużyny gracza CALI w kadrze w 100 %
 * klatek 844 × 390 – w meczu AI vs AI i w scenariuszu, w którym człowiek biega aktywnym
 * od linii do linii (tam F0 trzymała obu tylko w 72 % klatek) – przy piłce w kadrze ≥ 97 %.
 * Z wariantów spełniających warunek wybrany ten z największym zapasem do krawędzi.
 *
 * Względem docs/20 §4.1: wysokość 3,2 m i punkt patrzenia na siatkę bez zmian; kamera
 * 11,5 m za linią zamiast ~6 m (dalej = mniejsza różnica skali bliski–daleki, rywale
 * o ~23 % więksi); cel w x uwzględnia partnera (0,35 aktywny + 0,25 partner + 0,4 piłka),
 * bo sama para „aktywny + piłka” gubiła partnera, gdy dziecko ucieka aktywnym pod linię.
 */
export const CAMERA_LANDSCAPE: Readonly<CameraConfig> = {
  height: 3.2,
  z: -20.5,
  lookY: 1.1,
  lookZ: 0,
  // Pion to tylko furtka „Graj mimo to”; 76° daje obu w kadrze z zapasem ~20 px.
  fovPortrait: 76,
  fovLandscape: 32,
  // 32° pionowo przy 844 × 390 (19,5:9) = 63,6° poziomo; na innych proporcjach szerokość
  // boiska w kadrze zostaje ta sama, a pionowe rośnie (16:9 → 38,5°, 4:3 → 49,9°).
  hfovLandscape: 63.6,
  fovLandscapeMin: 30,
  fovLandscapeMax: 60,
  weightActive: 0.35,
  weightPartner: 0.25,
  weightBall: 0.4,
};

export const DEFAULT_CAMERA: Readonly<CameraConfig> = CAMERA_LANDSCAPE;

const NEAR = 0.5;
const FAR = 80;
/** docs/20: lerp 0,08 na klatkę przy 60 fps → zostaje 0,92 celu na każde 1/60 s. */
const LERP_KEEP_PER_FRAME = 0.92;
const REFERENCE_FPS = 60;
/** Dojazd przy ataku aktywnego: −4 % FOV, tam i z powrotem w 200 ms. */
const ZOOM_SCALE = 0.96;
const ZOOM_DURATION_S = 0.2;
/** Ten sam sufit co w pętli – po zwinięciu karty kamera nie skacze o kilometr. */
const MAX_DT_S = 0.25;
const DEG = Math.PI / 180;

export interface GameCamera {
  camera: PerspectiveCamera;
  setAspect(aspect: number): void;
  update(state: SimState, dtSeconds: number): void;
}

/** FOV pionowe dla danych proporcji okna (szerokość / wysokość). */
export function verticalFov(config: CameraConfig, aspect: number): number {
  if (aspect < 1) return config.fovPortrait;
  if (config.hfovLandscape === null) return config.fovLandscape;
  const v = (2 * Math.atan(Math.tan((config.hfovLandscape * DEG) / 2) / aspect)) / DEG;
  return Math.min(Math.max(v, config.fovLandscapeMin), config.fovLandscapeMax);
}

export function createGameCamera(config: CameraConfig = DEFAULT_CAMERA): GameCamera {
  const camera = new PerspectiveCamera(config.fovLandscape, 1, NEAR, FAR);
  let baseFov = config.fovLandscape;
  /** null = pierwsza klatka: kamera staje od razu na celu, bez dojazdu z zera. */
  let camX: number | null = null;
  /** Ile sekund dojazdu zostało; ≤ 0 = brak dojazdu. */
  let zoomLeft = 0;
  let seenContactTick = -1;

  function attackByActive(state: SimState): boolean {
    let hit = false;
    for (const ev of state.events) {
      if (ev.type === 'contact' && ev.kind === 'attack' && ev.player === state.active) hit = true;
    }
    // Pętla może wykonać kilka kroków sim na jedną klatkę, a `events` trzyma tylko
    // ostatni krok – nowy tick w `lastContact` łapie atak z wcześniejszego kroku.
    const last = state.lastContact;
    if (last !== null && last.tick !== seenContactTick) {
      seenContactTick = last.tick;
      if (last.kind === 'attack' && last.player === state.active) hit = true;
    }
    return hit;
  }

  return {
    camera,
    setAspect(aspect) {
      camera.aspect = aspect;
      baseFov = verticalFov(config, aspect);
      camera.fov = baseFov;
      camera.updateProjectionMatrix();
    },
    update(state, dtSeconds) {
      const dt = Math.min(Math.max(dtSeconds, 0), MAX_DT_S);
      const active = state.players[state.active];
      // Partner aktywnego = drugi z pary 0/1 (aktywny jest zawsze z drużyny gracza).
      const partner = state.players[state.active === 0 ? 1 : 0];
      // Piłka w ręce serwującego nie niesie informacji – jej waga idzie do zawodników.
      const ballWeight = state.ball.held !== -1 ? 0 : config.weightBall;
      const total = config.weightActive + config.weightPartner + ballWeight;
      const targetX =
        (config.weightActive * active.pos.x +
          config.weightPartner * partner.pos.x +
          ballWeight * state.ball.pos.x) /
        total;
      const x =
        camX === null
          ? targetX
          : camX + (targetX - camX) * (1 - Math.pow(LERP_KEEP_PER_FRAME, dt * REFERENCE_FPS));
      camX = x;

      if (attackByActive(state)) zoomLeft = ZOOM_DURATION_S;
      let scale = 1;
      if (zoomLeft > 0) {
        // Połówka sinusa: łagodny wjazd do −4 % w połowie czasu i powrót do 1.
        const progress = 1 - zoomLeft / ZOOM_DURATION_S;
        scale = 1 - (1 - ZOOM_SCALE) * Math.sin(Math.PI * progress);
        zoomLeft -= dt;
      }
      const fov = baseFov * scale;
      if (fov !== camera.fov) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
      camera.position.set(x, config.height, config.z);
      camera.lookAt(x, config.lookY, config.lookZ);
    },
  };
}
