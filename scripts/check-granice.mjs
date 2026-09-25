#!/usr/bin/env node
// Skan granicy modułów (CLAUDE.md):
// - src/sim i src/ai nie mogą importować three ani dotykać przeglądarki i czasu
//   rzeczywistego; src/sim nie może importować src/ai (zależność idzie tylko ai → sim);
// - src/ai, src/input, src/ui, src/render i src/loop łączą się z sim wyłącznie przez
//   src/sim/index.ts (docs/22 §1: „jeden plik index.ts z publicznym API; reszta prywatna”).
// Uzupełnia tsconfig.sim.json (brak DOM w lib) o proste sprawdzenie tekstowe, które łapie
// też stringi w dynamicznych importach i wywołania przez globalThis.
//
// Reguły i funkcja skanująca są eksportowane – tests/narzedzia/granice.test.ts podaje im
// próbki linii. Skan całego drzewa uruchamia się tylko przy wywołaniu z wiersza poleceń.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

/** Katalogi z czystą logiką: zakaz three, DOM i czasu rzeczywistego. */
export const PURE_DIRS = ['src/sim', 'src/ai'];
/** Katalogi, które z sim łączą się tylko przez src/sim/index.ts. */
export const SIM_CLIENT_DIRS = ['src/ai', 'src/input', 'src/ui', 'src/render', 'src/loop'];
/** Wszystkie skanowane katalogi (bez powtórzeń, w kolejności warstw). */
export const DIRS = [...new Set([...PURE_DIRS, ...SIM_CLIENT_DIRS])];

/**
 * Wzorce zakazane w plikach sim/ai. Każdy z krótkim uzasadnieniem do raportu.
 * Importy warstw łapane są także bez ukośnika ('../loop' = index katalogu) – regex
 * wymaga po nazwie ukośnika ALBO zamykającego cudzysłowu.
 */
export const PURE_RULES = [
  { re: /from\s+["']three(\/[^"']*)?["']/, why: 'import three w sim/ai' },
  { re: /import\s*\(\s*["']three/, why: 'dynamiczny import three w sim/ai' },
  { re: /\bwindow\b/, why: 'window w sim/ai' },
  { re: /\bdocument\b/, why: 'document w sim/ai' },
  { re: /\bnavigator\b/, why: 'navigator w sim/ai' },
  { re: /\brequestAnimationFrame\b/, why: 'requestAnimationFrame w sim/ai' },
  { re: /\bMath\.random\b/, why: 'Math.random łamie determinizm – użyj mulberry32' },
  { re: /\bDate\.now\b/, why: 'Date.now łamie determinizm' },
  { re: /\bperformance\.now\b/, why: 'performance.now łamie determinizm' },
  { re: /\bnew\s+Date\s*\(/, why: 'new Date łamie determinizm' },
  { re: /\bglobalThis\b/, why: 'globalThis omija granicę' },
  {
    re: /\.\.\/(render|input|ui|loop)(\/|["'])/,
    why: 'sim/ai importuje warstwę przeglądarkową',
  },
];

/** Osobno: src/sim nie może importować src/ai (zależność jest jednokierunkowa). */
export const SIM_ONLY_RULES = [
  { re: /\.\.\/ai(\/|["'])/, why: 'sim importuje ai – zależność ma iść tylko ai → sim' },
];

/**
 * Warstwy nad sim importują tylko '../sim' albo '../sim/index' – wnętrzności
 * ('../sim/types', '../sim/constants', …) są prywatne. Negatywne wyprzedzenie
 * przepuszcza wyłącznie index (także z rozszerzeniem .ts/.js).
 */
export const SIM_INDEX_RULES = [
  {
    re: /\.\.\/sim\/(?!index(?:\.[jt]s)?["'])[^"']*["']/,
    why: 'import wnętrzności sim z pominięciem index.ts',
  },
];

/** Zestaw reguł dla katalogu (ścieżka względem korzenia repo, np. 'src/ai'). */
export function rulesFor(dir) {
  const rules = [];
  if (PURE_DIRS.includes(dir)) rules.push(...PURE_RULES);
  if (dir === 'src/sim') rules.push(...SIM_ONLY_RULES);
  if (SIM_CLIENT_DIRS.includes(dir)) rules.push(...SIM_INDEX_RULES);
  return rules;
}

/**
 * Skanuje treść jednego pliku regułami katalogu `dir`. Zwraca listę naruszeń
 * `{ line, why, text }` (linie od 1). Komentarze są pomijane – mogą wspominać
 * zakazane słowa („nie używamy window”) – zarówno `//`, `/* … *\/` w linii, jak
 * i bloki `/* … *\/` rozciągnięte na kilka linii.
 */
export function scanSource(source, dir) {
  const rules = rulesFor(dir);
  const problems = [];
  if (rules.length === 0) return problems;
  let inBlock = false;
  source.split('\n').forEach((line, i) => {
    let code = line;
    if (inBlock) {
      const end = code.indexOf('*/');
      if (end < 0) return;
      code = code.slice(end + 2);
      inBlock = false;
    }
    // Komentarz JSDoc bez otwarcia w tej linii (` * …`) albo linia komentarza.
    if (/^\s*(\*|\/\/)/.test(code)) return;
    code = code.replace(/\/\*.*?\*\//g, '');
    const open = code.indexOf('/*');
    if (open >= 0) {
      code = code.slice(0, open);
      inBlock = true;
    }
    code = code.replace(/\/\/.*$/, '');
    for (const rule of rules) {
      if (rule.re.test(code)) problems.push({ line: i + 1, why: rule.why, text: line.trim() });
    }
  });
  return problems;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|mts|js|mjs)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

/**
 * Skan wszystkich katalogów z DIRS pod `root`. Zwraca liczbę przejrzanych plików
 * i naruszenia z ścieżką względem `root` (ukośniki jak w systemie).
 */
export function scanTree(root = ROOT) {
  const problems = [];
  let files = 0;
  for (const dir of DIRS) {
    let list;
    try {
      list = walk(join(root, dir));
    } catch {
      continue;
    }
    for (const file of list) {
      files++;
      for (const p of scanSource(readFileSync(file, 'utf8'), dir)) {
        problems.push({ file: relative(root, file), ...p });
      }
    }
  }
  return { files, problems };
}

function main() {
  const { files, problems } = scanTree();
  if (files === 0) {
    console.error(`check:granice – nie znaleziono plików w ${DIRS.join(', ')}.`);
    process.exit(1);
  }
  if (problems.length > 0) {
    console.error(`check:granice – ${problems.length} naruszeń w ${files} plikach:\n`);
    for (const p of problems) console.error(`  ${p.file}:${p.line}  ${p.why}\n    ${p.text}\n`);
    process.exit(1);
  }
  console.log(
    `check:granice – OK (${files} plików: ${PURE_DIRS.join(', ')} bez three/DOM/losowości; ` +
      `${SIM_CLIENT_DIRS.map((d) => d.slice(4)).join('/')} łączą się z sim tylko przez sim/index).`,
  );
}

/** Uruchomiono z wiersza poleceń (nie zaimportowano z testu)? Windows: wielkość liter ścieżki nieistotna. */
function isMain() {
  const entry = process.argv[1];
  if (!entry) return false;
  const a = resolve(entry);
  const b = fileURLToPath(import.meta.url);
  return process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b;
}

if (isMain()) main();
