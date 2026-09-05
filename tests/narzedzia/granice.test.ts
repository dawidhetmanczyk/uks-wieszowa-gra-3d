/**
 * Skaner granic modułów (scripts/check-granice.mjs) na próbkach linii. Pilnuje, żeby
 * regexy łapały import katalogu bez ukośnika ('../ai' = index), import wnętrzności sim
 * z warstw wyżej, three i DOM w sim/ai – a nie łapały '../sim/index' ani komentarzy.
 * Na końcu skan prawdziwego drzewa src/: to jest „granica pilnowana testem” z CLAUDE.md.
 */
import { describe, expect, it } from 'vitest';
import { DIRS, rulesFor, scanSource, scanTree } from '../../scripts/check-granice.mjs';

const PURE = ['src/sim', 'src/ai'] as const;
const SIM_CLIENTS = ['src/ai', 'src/input', 'src/ui', 'src/render', 'src/loop'] as const;
const WHY_BROWSER_LAYER = 'sim/ai importuje warstwę przeglądarkową';
const WHY_SIM_INTERNALS = 'import wnętrzności sim z pominięciem index.ts';
const WHY_SIM_IMPORTS_AI = 'sim importuje ai – zależność ma iść tylko ai → sim';

function whys(source: string, dir: string): string[] {
  return scanSource(source, dir).map((p) => p.why);
}

describe('check:granice – sim nie importuje ai', () => {
  it('łapie import katalogu ai bez ukośnika i z ukośnikiem, w obu cudzysłowach', () => {
    expect(whys("import { createAi } from '../ai';", 'src/sim')).toEqual([WHY_SIM_IMPORTS_AI]);
    expect(whys("import { createAi } from '../ai/index';", 'src/sim')).toEqual([
      WHY_SIM_IMPORTS_AI,
    ]);
    expect(whys('import { createAi } from "../ai";', 'src/sim')).toEqual([WHY_SIM_IMPORTS_AI]);
    expect(whys("const m = await import('../ai');", 'src/sim')).toEqual([WHY_SIM_IMPORTS_AI]);
  });

  it('nie myli katalogu ai z plikiem o podobnej nazwie', () => {
    expect(whys("import { aimFromDirection } from './aim';", 'src/sim')).toEqual([]);
    expect(whys("import { x } from '../aim/types';", 'src/sim')).toEqual([]);
  });

  it('ai może importować sim (index), sim nie może importować ai', () => {
    expect(whys("import { step } from '../sim/index';", 'src/ai')).toEqual([]);
    expect(rulesFor('src/ai').map((r) => r.why)).not.toContain(WHY_SIM_IMPORTS_AI);
  });
});

describe('check:granice – sim i ai bez warstwy przeglądarkowej', () => {
  it.each(PURE)('%s: łapie import katalogu warstwy bez ukośnika', (dir) => {
    expect(whys("import { startGame } from '../loop';", dir)).toEqual([WHY_BROWSER_LAYER]);
    expect(whys("import { createInput } from '../input';", dir)).toEqual([WHY_BROWSER_LAYER]);
    expect(whys("import { createHud } from '../ui';", dir)).toEqual([WHY_BROWSER_LAYER]);
    expect(whys("import { createRenderer } from '../render';", dir)).toEqual([WHY_BROWSER_LAYER]);
  });

  it.each(PURE)('%s: łapie import pliku z warstwy', (dir) => {
    expect(whys("import { camera } from '../render/camera';", dir)).toEqual([WHY_BROWSER_LAYER]);
  });

  it.each(PURE)('%s: łapie three, window, document i źródła niedeterminizmu', (dir) => {
    expect(whys("import { Mesh } from 'three';", dir)).toEqual(['import three w sim/ai']);
    expect(whys("import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';", dir)).toEqual([
      'import three w sim/ai',
    ]);
    expect(whys('const w = window.innerWidth;', dir)).toEqual(['window w sim/ai']);
    expect(whys("document.getElementById('gra');", dir)).toEqual(['document w sim/ai']);
    expect(whys('const r = Math.random();', dir)).toEqual([
      'Math.random łamie determinizm – użyj mulberry32',
    ]);
    expect(whys('const t = Date.now();', dir)).toEqual(['Date.now łamie determinizm']);
    expect(whys('const t = performance.now();', dir)).toEqual([
      'performance.now łamie determinizm',
    ]);
  });

  it('nie łapie identyfikatorów zawierających zakazane słowo', () => {
    expect(whys('const win = reachWindow(state, player);', 'src/sim')).toEqual([]);
    expect(whys('const windowTicks = 12;', 'src/sim')).toEqual([]);
  });
});

describe('check:granice – warstwy nad sim tylko przez sim/index', () => {
  it.each(SIM_CLIENTS)('%s: łapie import wnętrzności sim', (dir) => {
    expect(whys("import type { Command } from '../sim/types';", dir)).toEqual([WHY_SIM_INTERNALS]);
    expect(whys("import { DT } from '../sim/constants';", dir)).toEqual([WHY_SIM_INTERNALS]);
    expect(whys('import { clamp } from "../sim/vec";', dir)).toEqual([WHY_SIM_INTERNALS]);
    expect(whys("import { x } from '../sim/indexing';", dir)).toEqual([WHY_SIM_INTERNALS]);
  });

  it.each(SIM_CLIENTS)('%s: przepuszcza index (bez i z rozszerzeniem) i sam katalog', (dir) => {
    expect(whys("import { DT } from '../sim/index';", dir)).toEqual([]);
    expect(whys("import { DT } from '../sim/index.ts';", dir)).toEqual([]);
    expect(whys("import { DT } from '../sim';", dir)).toEqual([]);
    expect(
      whys("import { appendTick, type Command, type PlayerId } from '../sim/index';", dir),
    ).toEqual([]);
  });

  it('sim może importować własne pliki względnie', () => {
    expect(whys("import { GRAVITY } from './constants';", 'src/sim')).toEqual([]);
    expect(rulesFor('src/sim').map((r) => r.why)).not.toContain(WHY_SIM_INTERNALS);
  });

  it('render, input, ui i loop mogą używać three i DOM', () => {
    for (const dir of ['src/render', 'src/input', 'src/ui', 'src/loop']) {
      expect(whys("import { Mesh } from 'three';", dir)).toEqual([]);
      expect(whys('window.addEventListener("resize", onResize);', dir)).toEqual([]);
      expect(whys('const now = performance.now();', dir)).toEqual([]);
    }
  });
});

describe('check:granice – komentarze i numeracja', () => {
  it('nie łapie komentarzy liniowych, JSDoc, inline ani bloków wieloliniowych', () => {
    const source = [
      "// import '../ai' – tak nie wolno",
      '/**',
      ' * Sim nie zna window ani document; from "three" też nie.',
      ' */',
      'const a = 1; // Math.random() tu nie ma',
      '/* window */ const b = 2;',
      '/*',
      "  import { Mesh } from 'three';",
      '  Date.now();',
      '*/',
      "import type { Command } from '../sim/index';",
      'const c = 3;',
    ].join('\n');
    expect(scanSource(source, 'src/ai')).toEqual([]);
  });

  it('kod za zamknięciem bloku komentarza jest skanowany', () => {
    const source = ['/* komentarz', "koniec */ import { Mesh } from 'three';"].join('\n');
    expect(scanSource(source, 'src/sim')).toEqual([
      { line: 2, why: 'import three w sim/ai', text: "koniec */ import { Mesh } from 'three';" },
    ]);
  });

  it('numeruje linie od 1 i zwraca oryginalną linię po trim', () => {
    const source = ['const a = 1;', '', "  import { Mesh } from 'three';  "].join('\n');
    expect(scanSource(source, 'src/sim')).toEqual([
      { line: 3, why: 'import three w sim/ai', text: "import { Mesh } from 'three';" },
    ]);
  });

  it('zgłasza każde naruszenie w linii osobno', () => {
    expect(whys("import { x } from '../loop'; window.alert(1);", 'src/ai')).toEqual([
      'window w sim/ai',
      WHY_BROWSER_LAYER,
    ]);
  });
});

describe('check:granice – prawdziwe drzewo src/', () => {
  it('skanuje wszystkie katalogi z DIRS', () => {
    expect(DIRS).toEqual(['src/sim', 'src/ai', 'src/input', 'src/ui', 'src/render', 'src/loop']);
    expect(scanTree().files).toBeGreaterThan(0);
  });

  it('nie ma naruszeń granic w repozytorium', () => {
    const { problems } = scanTree();
    const report = problems.map((p) => `${p.file}:${p.line}  ${p.why}\n    ${p.text}`).join('\n');
    expect(report).toBe('');
  });
});
