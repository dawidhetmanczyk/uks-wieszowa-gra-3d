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
 *
 * F0b: pion i poziom mają osobne ustawienia (decyzja Dawida 7 – pion to główny tryb na
 * telefonie, kamera w pionie dobrana od nowa). Wybór przy każdej zmianie proporcji okna.
 */
import { PerspectiveCamera } from 'three';
import type { SimState } from '../sim/index';

/** Ustawienie kamery dla jednej orientacji okna. */
export interface OrientationCamera {
  /** Wysokość kamery nad parkietem (m). */
  height: number;
  /** Położenie kamery w z (m); linia końcowa drużyny gracza leży w z = −9. */
  z: number;
  /** Punkt, na który patrzy kamera: (camX, lookY, lookZ). */
  lookY: number;
  lookZ: number;
  /** FOV pionowe (stopnie), gdy hfov = null. */
  fov: number;
  /**
   * FOV POZIOME (stopnie); null = stałe fov. Przy stałym FOV poziomym szerokość widzianego
   * boiska nie zależy od proporcji ekranu (16:9 monitor, 19,5:9 telefon) – pionowe liczone
   * z proporcji i przycięte do [fovMin, fovMax].
   */
  hfov: number | null;
  fovMin: number;
  fovMax: number;
  /** Wagi celu kamery w x: aktywny zawodnik, jego partner, piłka (dowolna skala – normalizowane). */
  weightActive: number;
  weightPartner: number;
  weightBall: number;
}

export interface CameraConfig {
  /** Okno wyższe niż szersze (telefon w pionie – główny tryb F0b). */
  portrait: OrientationCamera;
  /** Okno szersze niż wysokie lub kwadratowe (telefon w poziomie, monitor). */
  landscape: OrientationCamera;
}

const POSE_F0 = { height: 3.2, z: -15, lookY: 1.1, lookZ: 0 } as const;

/** Wartości F0 sprzed poprawek 2026-09-25 – do pomiaru „przed” w raporcie F0. */
export const CAMERA_F0: Readonly<CameraConfig> = {
  portrait: {
    ...POSE_F0,
    fov: 72,
    hfov: null,
    fovMin: 72,
    fovMax: 72,
    weightActive: 0.6,
    weightPartner: 0,
    weightBall: 0.4,
  },
  landscape: {
    ...POSE_F0,
    fov: 48,
    hfov: null,
    fovMin: 48,
    fovMax: 48,
    weightActive: 0.6,
    weightPartner: 0,
    weightBall: 0.4,
  },
};

/**
 * Kamera pod poziom (2026-09-25), dobrana pomiarem – docs/RAPORT-F0.md §8.2. Warunek: obaj
 * zawodnicy drużyny gracza CALI w kadrze w 100 % klatek 844 × 390 – w meczu AI vs AI
 * i w scenariuszu, w którym człowiek biega aktywnym od linii do linii – przy piłce w kadrze
 * ≥ 97 %; z wariantów spełniających warunek największy zapas do krawędzi. Względem docs/20
 * §4.1: kamera 11,5 m za linią zamiast ~6 m, cel w x z partnerem (0,35 / 0,25 / 0,4).
 */
const LANDSCAPE_2026_09_25: Readonly<OrientationCamera> = {
  height: 3.2,
  z: -20.5,
  lookY: 1.1,
  lookZ: 0,
  fov: 32,
  // 32° pionowo przy 844 × 390 (19,5:9) = 63,6° poziomo; na innych proporcjach szerokość
  // boiska w kadrze zostaje ta sama, a pionowe rośnie (16:9 → 38,5°, 4:3 → 49,9°).
  hfov: 63.6,
  fovMin: 30,
  fovMax: 60,
  weightActive: 0.35,
  weightPartner: 0.25,
  weightBall: 0.4,
};

/**
 * Stan z końca F0 (2026-09-25) – „przed” w raporcie F0b: poziom jak wyżej, pion jako furtka
 * „Graj mimo to” z tą samą pozą i FOV 76°.
 */
export const CAMERA_F0_END: Readonly<CameraConfig> = {
  portrait: { ...LANDSCAPE_2026_09_25, fov: 76, hfov: null, fovMin: 76, fovMax: 76 },
  landscape: LANDSCAPE_2026_09_25,
};

/** Poziom w F0b bez zmian względem końca F0 (pomiar w nowym scenariuszu: docs/RAPORT-F0b.md). */
export const CAMERA_LANDSCAPE: Readonly<OrientationCamera> = LANDSCAPE_2026_09_25;

/**
 * Pion F0b (decyzja Dawida 7, wybór wariantu – Dawid, 2026-09-26) – dobrany od nowa metodą
 * z RAPORT-F0 §8.2, docs/RAPORT-F0b.md §3.3. Scenariusz obciążeniowy „asysta + gracz
 * przeciągany do linii” (tests/render/scenariusze.ts), 20 seedów × 60 s, 390 × 844, warunek:
 * obaj zawodnicy drużyny gracza CALI w kadrze w 100 % klatek każdego seeda, piłka ≥ 97 %.
 *
 * Przeszukanie znalazło wiele spełniających wariantów z zawodnikiem 59,7–61,3 px, ale bardzo
 * różną głębią boiska: najniższa kamera (2,5 m, 61,3 px) spłaszczała naszą połowę do 35 px
 * i pierścień „tu stań” do 2,8 px. Dawid wybrał wariant z głębią jak pod koniec F0 (nasza
 * połowa 65 px, pierścień 5,2 px) za cenę 1,6 px zawodnika: 59,7 px (koniec F0: 61,8 px, ale
 * gubił zawodnika w 6 z 30 seedów). Sprawdzone na 10 innych seedach i w AI vs AI.
 *
 * Kamera wyżej (4,86 m) i dalej (17,9 m za linią), patrzy nisko, przed siatkę (0; −1,83), więc
 * widzi boisko bardziej z góry; cel w x ważony na partnera (0,21 / 0,35 / 0,1, po normalizacji
 * 0,32 / 0,53 / 0,15), bo w pionie najwęższy jest kadr w poprzek, a partnera trzeba utrzymać,
 * gdy palec ciągnie gracza pod linię.
 */
export const CAMERA_PORTRAIT: Readonly<OrientationCamera> = {
  height: 4.86,
  z: -26.88,
  lookY: 0,
  lookZ: -1.83,
  fov: 58.8,
  hfov: null,
  fovMin: 58.8,
  fovMax: 58.8,
  weightActive: 0.21,
  weightPartner: 0.35,
  weightBall: 0.1,
};

export const CAMERA_F0B: Readonly<CameraConfig> = {
  portrait: CAMERA_PORTRAIT,
  landscape: CAMERA_LANDSCAPE,
};

export const DEFAULT_CAMERA: Readonly<CameraConfig> = CAMERA_F0B;

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

/** Ustawienie dla danych proporcji okna (szerokość / wysokość). */
export function cameraFor(config: CameraConfig, aspect: number): OrientationCamera {
  return aspect < 1 ? config.portrait : config.landscape;
}

/** FOV pionowe ustawienia dla danych proporcji okna (szerokość / wysokość). */
export function verticalFov(cam: OrientationCamera, aspect: number): number {
  if (cam.hfov === null) return cam.fov;
  const v = (2 * Math.atan(Math.tan((cam.hfov * DEG) / 2) / aspect)) / DEG;
  return Math.min(Math.max(v, cam.fovMin), cam.fovMax);
}

export function createGameCamera(config: CameraConfig = DEFAULT_CAMERA): GameCamera {
  let cam: OrientationCamera = config.landscape;
  const camera = new PerspectiveCamera(cam.fov, 1, NEAR, FAR);
  let baseFov = cam.fov;
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
      cam = cameraFor(config, aspect);
      baseFov = verticalFov(cam, aspect);
      camera.fov = baseFov;
      camera.updateProjectionMatrix();
    },
    update(state, dtSeconds) {
      const dt = Math.min(Math.max(dtSeconds, 0), MAX_DT_S);
      const active = state.players[state.active];
      // Partner aktywnego = drugi z pary 0/1 (aktywny jest zawsze z drużyny gracza).
      const partner = state.players[state.active === 0 ? 1 : 0];
      // Piłka w ręce serwującego nie niesie informacji – jej waga idzie do zawodników.
      const ballWeight = state.ball.held !== -1 ? 0 : cam.weightBall;
      const total = cam.weightActive + cam.weightPartner + ballWeight;
      const targetX =
        (cam.weightActive * active.pos.x +
          cam.weightPartner * partner.pos.x +
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
      camera.position.set(x, cam.height, cam.z);
      camera.lookAt(x, cam.lookY, cam.lookZ);
    },
  };
}
