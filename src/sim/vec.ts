/** Proste operacje na wektorach. Funkcje `*To` mutują pierwszy argument (bez alokacji w kroku). */
import type { Vec2, Vec3 } from './types';

export function v3(x = 0, y = 0, z = 0): Vec3 {
  return { x, y, z };
}

export function v2(x = 0, z = 0): Vec2 {
  return { x, z };
}

export function copy3(out: Vec3, a: Vec3): Vec3 {
  out.x = a.x;
  out.y = a.y;
  out.z = a.z;
  return out;
}

export function set3(out: Vec3, x: number, y: number, z: number): Vec3 {
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}

export function len3(a: Vec3): number {
  return Math.sqrt(a.x * a.x + a.y * a.y + a.z * a.z);
}

export function len2(a: Vec2): number {
  return Math.sqrt(a.x * a.x + a.z * a.z);
}

/** Odległość poziomą (po podłodze) między dwoma punktami 3D albo 2D. */
export function distXZ(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return Math.sqrt(dx * dx + dz * dz);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Skraca wektor 2D do długości ≤ max. Mutuje. */
export function limit2(v: Vec2, max: number): Vec2 {
  const l = len2(v);
  if (l > max && l > 0) {
    const s = max / l;
    v.x *= s;
    v.z *= s;
  }
  return v;
}

export function approxEqual(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}
