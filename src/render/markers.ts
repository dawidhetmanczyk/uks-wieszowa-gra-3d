/**
 * Pomoce dla gracza (docs/20 §3.3): pierścień „tu stań”, pierścień aktywnego
 * zawodnika, celownik ataku. Wszystko płaskie, tuż nad podłogą, na różnych
 * wysokościach i bez zapisu głębi – inaczej walczyłyby o głębię z podłogą i ze
 * sobą (współpłaszczyznowe przezroczyste płaszczyzny migają).
 *
 * Pierścień pokazuje MIEJSCE, GDZIE STANĄĆ – punkt, w którym opadająca piłka przecina
 * 1,1 m (`landing.intercept`), nie punkt lądowania (decyzja Dawida, 2026-09-25). Dziecko
 * biegnie do pierścienia, nie liczy toru: przy płaskim torze lądowanie leży 1–3 m za
 * miejscem przyjęcia i kto stanął na nim, dostawał piłkę przy kolanach. Punkt lądowania
 * zostaje czytelny z cienia piłki (actors.ts), który sunie pod piłką i kończy w nim.
 *
 * F0b (decyzja Dawida 5): przy szansie na atak ze skokiem (jumpAttackChance) pierścień
 * zmienia kolor na jasnoniebieski – razem z napisem „Stuknij – skok sam” w HUD. Tylko
 * w trybie asysty; tryb ręczny (pełne F0) zostaje bursztynowy.
 */
import { Color, Group, Mesh, MeshBasicMaterial, RingGeometry } from 'three';
import { defaultAttackTarget, jumpAttackChance } from '../sim/index';
import type { SimState } from '../sim/index';
import { COLOR_ACTIVE, COLOR_AIM, COLOR_JUMP, COLOR_STAND } from './colors';
import { buildFlatRects } from './court';
import type { ViewState } from './index';

const RING_SEGMENTS = 32;
const STAND_Y = 0.01;
const STAND_R = { inner: 0.28, outer: 0.36 };
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

  const standGeometry = flatRing(STAND_R);
  const standMaterial = markerMaterial(COLOR_STAND);
  const standRing = new Mesh(standGeometry, standMaterial);
  standRing.visible = false;
  group.add(standRing);
  const standColor = new Color(COLOR_STAND);
  const jumpColor = new Color(COLOR_JUMP);
  let jumpShown = false;

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
      standRing.visible = state.rally.phase === 'rally' && landing.valid && !landing.hitsNet;
      if (standRing.visible) {
        // Punkt przyjęcia na 1,1 m; gdy piłka jest już niżej, sim podaje jej bieżące
        // położenie – pierścień jedzie wtedy pod piłką aż do podłogi.
        standRing.position.set(landing.intercept.x, STAND_Y, landing.intercept.z);
      }
      const jump = standRing.visible && state.assist && jumpAttackChance(state);
      if (jump !== jumpShown) {
        jumpShown = jump;
        standMaterial.color.copy(jump ? jumpColor : standColor);
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
      standGeometry.dispose();
      standMaterial.dispose();
      activeGeometry.dispose();
      activeMaterial.dispose();
      aimRingGeometry.dispose();
      aimCrossGeometry.dispose();
      aimMaterial.dispose();
    },
  };
}
