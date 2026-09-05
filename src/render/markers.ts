/**
 * Pomoce dla gracza (docs/20 §3.3): pierścień lądowania, pierścień aktywnego
 * zawodnika, celownik ataku. Wszystko płaskie, tuż nad podłogą, na różnych
 * wysokościach i bez zapisu głębi – inaczej walczyłyby o głębię z podłogą i ze
 * sobą (współpłaszczyznowe przezroczyste płaszczyzny migają).
 */
import { Group, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import { defaultAttackTarget } from '../sim/index';
import type { SimState } from '../sim/index';
import { COLOR_ACTIVE, COLOR_AIM, COLOR_LANDING } from './colors';
import { buildFlatRects } from './court';
import type { ViewState } from './index';

const RING_SEGMENTS = 32;
const LANDING_Y = 0.01;
const LANDING_R = { inner: 0.28, outer: 0.36 };
const ACTIVE_Y = 0.012;
const ACTIVE_R = { inner: 0.38, outer: 0.46 };
const AIM_Y = 0.014;
const AIM_R = { inner: 0.3, outer: 0.36 };
/** Krzyż celownika wychodzi trochę poza pierścień, żeby środek dało się odczytać z 15 m. */
const AIM_CROSS_HALF_LEN = 0.5;
const AIM_CROSS_HALF_W = 0.02;
/** Lekko poniżej 1, żeby znaczniki nie wyglądały jak namalowane na podłodze. */
const MARKER_OPACITY = 0.9;

function markerMaterial(color: string): MeshBasicMaterial {
  return new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: MARKER_OPACITY,
    depthWrite: false,
  });
}

/** RingGeometry leży w XY – obracamy, żeby leżała na podłodze frontem do góry. */
function flatRing(r: { inner: number; outer: number }): RingGeometry {
  return new RingGeometry(r.inner, r.outer, RING_SEGMENTS).rotateX(-Math.PI / 2);
}

export interface Markers {
  group: Group;
  update(state: SimState, view: ViewState): void;
  dispose(): void;
}

export function createMarkers(): Markers {
  const group = new Group();

  const landingGeometry = flatRing(LANDING_R);
  const landingMaterial = markerMaterial(COLOR_LANDING);
  const landingRing = new Mesh(landingGeometry, landingMaterial);
  landingRing.visible = false;
  group.add(landingRing);

  const activeGeometry = flatRing(ACTIVE_R);
  const activeMaterial = markerMaterial(COLOR_ACTIVE);
  const activeRing = new Mesh(activeGeometry, activeMaterial);
  group.add(activeRing);

  // Celownik: pierścień + krzyż w jednej grupie, przesuwanej jako całość.
  const aimMaterial = markerMaterial(COLOR_AIM);
  const aimRingGeometry = flatRing(AIM_R);
  const aimCrossGeometry = buildFlatRects(
    [
      {
        x0: -AIM_CROSS_HALF_LEN,
        z0: -AIM_CROSS_HALF_W,
        x1: AIM_CROSS_HALF_LEN,
        z1: AIM_CROSS_HALF_W,
      },
      {
        x0: -AIM_CROSS_HALF_W,
        z0: -AIM_CROSS_HALF_LEN,
        x1: AIM_CROSS_HALF_W,
        z1: AIM_CROSS_HALF_LEN,
      },
    ],
    0,
  );
  const aim = new Group();
  aim.add(new Mesh(aimRingGeometry, aimMaterial), new Mesh(aimCrossGeometry, aimMaterial));
  aim.visible = false;
  group.add(aim);

  return {
    group,
    update(state, view) {
      const landing = state.landing;
      landingRing.visible = state.rally.phase === 'rally' && landing.valid && !landing.hitsNet;
      if (landingRing.visible) {
        landingRing.position.set(landing.pos.x, LANDING_Y, landing.pos.z);
      }

      const active = state.players[state.active];
      activeRing.position.set(active.pos.x, ACTIVE_Y, active.pos.z);

      aim.visible = view.holding;
      if (view.holding) {
        // Bez celu z wejścia pokazujemy to, gdzie sim faktycznie pośle atak.
        const target = view.aim ?? defaultAttackTarget(state, active.team);
        aim.position.set(target.x, AIM_Y, target.z);
      }
    },
    dispose() {
      landingGeometry.dispose();
      landingMaterial.dispose();
      activeGeometry.dispose();
      activeMaterial.dispose();
      aimRingGeometry.dispose();
      aimCrossGeometry.dispose();
      aimMaterial.dispose();
    },
  };
}
