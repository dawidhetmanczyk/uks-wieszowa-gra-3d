/**
 * Typy dla scripts/check-granice.mjs – tylko po to, żeby tests/narzedzia/granice.test.ts
 * przechodził `tsc` bez `allowJs`. Kształt musi zgadzać się z eksportami skryptu.
 */
export interface Rule {
  re: RegExp;
  why: string;
}

export interface Problem {
  /** Numer linii od 1. */
  line: number;
  why: string;
  /** Oryginalna linia (po trim) do raportu. */
  text: string;
}

export interface FileProblem extends Problem {
  /** Ścieżka względem korzenia repo. */
  file: string;
}

export const PURE_DIRS: readonly string[];
export const SIM_CLIENT_DIRS: readonly string[];
export const DIRS: readonly string[];
export const PURE_RULES: readonly Rule[];
export const SIM_ONLY_RULES: readonly Rule[];
export const SIM_INDEX_RULES: readonly Rule[];

export function rulesFor(dir: string): Rule[];
export function scanSource(source: string, dir: string): Problem[];
export function scanTree(root?: string): { files: number; problems: FileProblem[] };
