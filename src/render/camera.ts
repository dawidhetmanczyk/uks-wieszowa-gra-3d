/**
 * Kamera za plecami drużyny gracza (docs/20 §4.1, docs/22 §7).
 *
 * Nie obraca się w trakcie wymiany – jedzie tylko w x za środkiem ciężkości
 * „aktywny + piłka”, żeby gracz nie tracił orientacji (kamera zawsze patrzy wzdłuż
 * boiska). Lerp jest niezależny od fps: ten sam ruch przy 30 i 120 klatkach.
 */
import { PerspectiveCamera } from 'three';
import type { SimState } from '../sim/index';

const CAM_HEIGHT = 3.2;
/** 6 m za linią końcową drużyny 0 (z = −9). */
const CAM_Z = -15;
const LOOK_Y = 1.1;
const NEAR = 0.5;
const FAR = 80;
/** FOV pionowe: w portrecie 72°, żeby przy 390 px partner (4,5 m obok) mieścił się w kadrze; w poziomie 48°. */
const FOV_PORTRAIT = 72;
const FOV_LANDSCAPE = 48;
/** docs/20: lerp 0,08 na klatkę przy 60 fps → zostaje 0,92 celu na każde 1/60 s. */
const LERP_KEEP_PER_FRAME = 0.92;
const REFERENCE_FPS = 60;
const WEIGHT_ACTIVE = 0.6;
const WEIGHT_BALL = 0.4;
/** Dojazd przy ataku aktywnego: −4 % FOV, tam i z powrotem w 200 ms. */
const ZOOM_SCALE = 0.96;
const ZOOM_DURATION_S = 0.2;
/** Ten sam sufit co w pętli – po zwinięciu karty kamera nie skacze o kilometr. */
const MAX_DT_S = 0.25;

export interface GameCamera {
  camera: PerspectiveCamera;
  setAspect(aspect: number): void;
  update(state: SimState, dtSeconds: number): void;
}

export function createGameCamera(): GameCamera {
  const camera = new PerspectiveCamera(FOV_LANDSCAPE, 1, NEAR, FAR);
  let baseFov = FOV_LANDSCAPE;
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
      baseFov = aspect < 1 ? FOV_PORTRAIT : FOV_LANDSCAPE;
      camera.fov = baseFov;
      camera.updateProjectionMatrix();
    },
    update(state, dtSeconds) {
      const dt = Math.min(Math.max(dtSeconds, 0), MAX_DT_S);
      const active = state.players[state.active];
      // Piłka w ręce serwującego nie niesie informacji – śledzimy tylko zawodnika.
      const targetX =
        state.ball.held !== -1
          ? active.pos.x
          : WEIGHT_ACTIVE * active.pos.x + WEIGHT_BALL * state.ball.pos.x;
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
      camera.position.set(x, CAM_HEIGHT, CAM_Z);
      camera.lookAt(x, LOOK_Y, 0);
    },
  };
}
