/**
 * Hala w wersji F0: podłoga, linie, siatka, taśma górna, słupki – same prostokąty.
 *
 * Linie boiska są JEDNĄ geometrią (pięć cienkich płaszczyzn w jednym buforze), bo
 * budżet z CLAUDE.md liczy każdy draw call, a linie inaczej kosztowałyby pięć.
 * Ten sam helper składa krzyż celownika w markers.ts.
 */
import {
  BoxGeometry,
  BufferGeometry,
  CylinderGeometry,
  DoubleSide,
  Float32BufferAttribute,
  Group,
  Mesh,
  MeshBasicMaterial,
  MeshLambertMaterial,
  PlaneGeometry,
  Uint16BufferAttribute,
} from 'three';
import { COURT_HALF_L, COURT_HALF_W, LINE_WIDTH, NET_HALF_W, NET_HEIGHT } from '../sim/index';
import { COLOR_FLOOR, COLOR_LINE, COLOR_NET } from './colors';

/** Podłoga hali jest większa niż boisko, żeby kamera z −15 m nie widziała krawędzi świata. */
export const FLOOR_W = 30;
export const FLOOR_L = 40;
/** 2 mm nad podłogą wystarczą, żeby linie nie walczyły o głębię (near 0,5 m, bufor 24 bit). */
const LINE_Y = 0.002;
/** Widoczna część siatki: metr od górnej krawędzi w dół (docs/20 §4.2 nie wymaga pełnej). */
const NET_VISIBLE_H = 1.0;
const NET_OPACITY = 0.35;
const TAPE_H = 0.07;
const TAPE_D = 0.05;
const POST_R = 0.05;
const POST_H = 2.55;
const POST_SEGMENTS = 12;

/** Prostokąt leżący na podłodze: zakres x i z (min/max). */
export interface FlatRect {
  x0: number;
  z0: number;
  x1: number;
  z1: number;
}

/**
 * Składa listę płaskich prostokątów (normalna +y) w jedną geometrię indeksowaną.
 * Bez normalnych i UV – MeshBasicMaterial ich nie potrzebuje, a bufor jest mniejszy.
 */
export function buildFlatRects(rects: readonly FlatRect[], y: number): BufferGeometry {
  const positions = new Float32Array(rects.length * 4 * 3);
  const indices = new Uint16Array(rects.length * 6);
  rects.forEach((r, i) => {
    positions.set([r.x0, y, r.z0, r.x1, y, r.z0, r.x1, y, r.z1, r.x0, y, r.z1], i * 12);
    // Nawinięcie przeciwnie do wskazówek zegara patrząc z góry – front skierowany w +y.
    const v = i * 4;
    indices.set([v, v + 2, v + 1, v, v + 3, v + 2], i * 6);
  });
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(new Uint16BufferAttribute(indices, 1));
  return geometry;
}

/** Linie leżą wewnątrz boiska (jak w przepisach): zewnętrzna krawędź linii = granica boiska. */
function courtLineRects(): FlatRect[] {
  const w = COURT_HALF_W;
  const l = COURT_HALF_L;
  const t = LINE_WIDTH;
  // Linie końcowe i środkowa kończą się na wewnętrznej krawędzi linii bocznych,
  // żeby w narożnikach nie było dwóch współpłaszczyznowych trójkątów.
  const innerW = w - t;
  return [
    { x0: -w, z0: -l, x1: -w + t, z1: l }, // boczna lewa
    { x0: w - t, z0: -l, x1: w, z1: l }, // boczna prawa
    { x0: -innerW, z0: -l, x1: innerW, z1: -l + t }, // końcowa niebieskich
    { x0: -innerW, z0: l - t, x1: innerW, z1: l }, // końcowa czerwonych
    { x0: -innerW, z0: -t / 2, x1: innerW, z1: t / 2 }, // środkowa pod siatką
  ];
}

export interface Court {
  group: Group;
  dispose(): void;
}

export function createCourt(): Court {
  const group = new Group();

  const floorGeometry = new PlaneGeometry(FLOOR_W, FLOOR_L).rotateX(-Math.PI / 2);
  const floorMaterial = new MeshLambertMaterial({ color: COLOR_FLOOR });
  const floor = new Mesh(floorGeometry, floorMaterial);
  floor.receiveShadow = true;
  group.add(floor);

  const linesGeometry = buildFlatRects(courtLineRects(), LINE_Y);
  const linesMaterial = new MeshBasicMaterial({ color: COLOR_LINE });
  group.add(new Mesh(linesGeometry, linesMaterial));

  // PlaneGeometry leży w płaszczyźnie XY, czyli dokładnie w z = 0 jak siatka w sim.
  const netGeometry = new PlaneGeometry(NET_HALF_W * 2, NET_VISIBLE_H);
  const netMaterial = new MeshBasicMaterial({
    color: COLOR_NET,
    transparent: true,
    opacity: NET_OPACITY,
    side: DoubleSide,
    // Nic nie musi być testowane głębią względem siatki, a bez zapisu nie ma
    // artefaktów przy przezroczystych znacznikach za nią.
    depthWrite: false,
  });
  const net = new Mesh(netGeometry, netMaterial);
  net.position.set(0, NET_HEIGHT - NET_VISIBLE_H / 2, 0);
  group.add(net);

  // Górna krawędź taśmy = NET_HEIGHT, czyli dokładnie tam, gdzie sim odbija piłkę.
  const frameMaterial = new MeshLambertMaterial({ color: COLOR_NET });
  const tapeGeometry = new BoxGeometry(NET_HALF_W * 2, TAPE_H, TAPE_D);
  const tape = new Mesh(tapeGeometry, frameMaterial);
  tape.position.set(0, NET_HEIGHT - TAPE_H / 2, 0);
  group.add(tape);

  const postGeometry = new CylinderGeometry(POST_R, POST_R, POST_H, POST_SEGMENTS);
  for (const x of [-NET_HALF_W, NET_HALF_W]) {
    const post = new Mesh(postGeometry, frameMaterial);
    post.position.set(x, POST_H / 2, 0);
    group.add(post);
  }

  return {
    group,
    dispose() {
      floorGeometry.dispose();
      floorMaterial.dispose();
      linesGeometry.dispose();
      linesMaterial.dispose();
      netGeometry.dispose();
      netMaterial.dispose();
      tapeGeometry.dispose();
      postGeometry.dispose();
      frameMaterial.dispose();
    },
  };
}
