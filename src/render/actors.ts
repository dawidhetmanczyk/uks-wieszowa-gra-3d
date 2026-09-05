/**
 * Zawodnicy jako kapsuły, piłka jako kula, cień piłki jako płaskie koło.
 *
 * Jedna geometria kapsuły dla całej czwórki – różnią się tylko materiałem, więc
 * GPU trzyma jeden bufor. Cień piłki jest osobnym „fałszywym” cieniem, bo cień
 * z mapy cieni znika, gdy piłka leci wysoko poza frustum światła, a gracz czyta
 * z tego cienia, gdzie piłka spadnie (docs/20 §3.3 „cień piłki (zawsze)”).
 */
import {
  CapsuleGeometry,
  CircleGeometry,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  SphereGeometry,
} from 'three';
import { ALL_PLAYERS, BALL_R, PLAYER_H, PLAYER_R } from '../sim/index';
import type { PlayerId, SimState } from '../sim/index';
import { COLOR_BALL, COLOR_BALL_SHADOW, PLAYER_COLORS } from './colors';

const CAPSULE_CAP_SEGMENTS = 4;
const CAPSULE_RADIAL_SEGMENTS = 12;
const BALL_WIDTH_SEGMENTS = 16;
const BALL_HEIGHT_SEGMENTS = 12;
const BALL_SHADOW_R = 0.13;
const BALL_SHADOW_SEGMENTS = 20;
/** Nad liniami (0,002), pod pierścieniami (≥ 0,01). */
const BALL_SHADOW_Y = 0.006;
/** Cień blednie z wysokością piłki: pełny przy podłodze, najsłabszy od 4 m w górę. */
const BALL_SHADOW_OPACITY_LOW = 0.45;
const BALL_SHADOW_OPACITY_HIGH = 0.2;
const BALL_SHADOW_FADE_HEIGHT = 4;

export interface Actors {
  group: Group;
  update(state: SimState): void;
  dispose(): void;
}

export function createActors(): Actors {
  const group = new Group();

  // CapsuleGeometry(radius, wysokość części walcowej, ...) – łączna wysokość = PLAYER_H.
  const capsuleGeometry = new CapsuleGeometry(
    PLAYER_R,
    PLAYER_H - 2 * PLAYER_R,
    CAPSULE_CAP_SEGMENTS,
    CAPSULE_RADIAL_SEGMENTS,
  );
  // Krotki zamiast tablic: indeks PlayerId daje pewny element (noUncheckedIndexedAccess).
  const makeMaterial = (id: PlayerId): MeshLambertMaterial =>
    new MeshLambertMaterial({ color: PLAYER_COLORS[id] });
  const playerMaterials: readonly [
    MeshLambertMaterial,
    MeshLambertMaterial,
    MeshLambertMaterial,
    MeshLambertMaterial,
  ] = [makeMaterial(0), makeMaterial(1), makeMaterial(2), makeMaterial(3)];
  const makePlayer = (id: PlayerId): Mesh => {
    const mesh = new Mesh(capsuleGeometry, playerMaterials[id]);
    mesh.castShadow = true;
    group.add(mesh);
    return mesh;
  };
  const players: readonly [Mesh, Mesh, Mesh, Mesh] = [
    makePlayer(0),
    makePlayer(1),
    makePlayer(2),
    makePlayer(3),
  ];

  const ballGeometry = new SphereGeometry(BALL_R, BALL_WIDTH_SEGMENTS, BALL_HEIGHT_SEGMENTS);
  const ballMaterial = new MeshLambertMaterial({ color: COLOR_BALL });
  const ball = new Mesh(ballGeometry, ballMaterial);
  // Bez cienia z mapy: przy 3 m wysokości padał ~1,3 m obok płaskiego koła i obie plamy
  // konkurowały jako wskazówka „gdzie spadnie”. Jedyną wskazówką jest koło (docs/22 §7).
  ball.castShadow = false;
  group.add(ball);

  const shadowGeometry = new CircleGeometry(BALL_SHADOW_R, BALL_SHADOW_SEGMENTS).rotateX(
    -Math.PI / 2,
  );
  const shadowMaterial = new MeshBasicMaterial({
    color: COLOR_BALL_SHADOW,
    transparent: true,
    opacity: BALL_SHADOW_OPACITY_LOW,
    depthWrite: false,
  });
  const ballShadow = new Mesh(shadowGeometry, shadowMaterial);
  group.add(ballShadow);

  return {
    group,
    update(state) {
      for (const id of ALL_PLAYERS) {
        const p = state.players[id];
        const mesh = players[id];
        // pos to punkt między stopami; kapsuła ma środek w połowie wysokości.
        mesh.position.set(p.pos.x, p.pos.y + PLAYER_H / 2, p.pos.z);
        // Kąt z sim bez zmian – render niczego nie odbija (docs/22 §9 pkt 14). Dla kapsuły
        // obojętne, ale model glTF w F2 z odwróconym kątem biegałby tyłem.
        mesh.rotation.y = p.facing;
      }
      const b = state.ball.pos;
      ball.position.set(b.x, b.y, b.z);
      ballShadow.position.set(b.x, BALL_SHADOW_Y, b.z);
      const t = Math.min(Math.max(b.y / BALL_SHADOW_FADE_HEIGHT, 0), 1);
      shadowMaterial.opacity =
        BALL_SHADOW_OPACITY_LOW + (BALL_SHADOW_OPACITY_HIGH - BALL_SHADOW_OPACITY_LOW) * t;
    },
    dispose() {
      capsuleGeometry.dispose();
      for (const m of playerMaterials) m.dispose();
      ballGeometry.dispose();
      ballMaterial.dispose();
      shadowGeometry.dispose();
      shadowMaterial.dispose();
    },
  };
}
