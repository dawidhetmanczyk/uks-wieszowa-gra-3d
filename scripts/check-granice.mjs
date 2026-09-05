#!/usr/bin/env node
// Skan granicy modułów (CLAUDE.md): src/sim i src/ai nie mogą importować three
// ani dotykać przeglądarki i czasu rzeczywistego. Uzupełnia tsconfig.sim.json
// (brak DOM w lib) o proste sprawdzenie tekstowe, które łapie też stringi
// w dynamicznych importach i wywołania przez globalThis.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['src/sim', 'src/ai'];

/** Wzorce zakazane w plikach sim/ai. Każdy z krótkim uzasadnieniem do raportu. */
const RULES = [
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
  { re: /\.\.\/(render|input|ui|loop)\//, why: 'sim/ai importuje warstwę przeglądarkową' },
];

// Osobno: src/sim nie może importować src/ai (zależność jest jednokierunkowa).
const SIM_ONLY_RULES = [
  { re: /\.\.\/ai\//, why: 'sim importuje ai – zależność ma iść tylko ai → sim' },
];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|mts|js|mjs)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const problems = [];
let files = 0;
for (const dir of DIRS) {
  const abs = join(ROOT, dir);
  let list;
  try {
    list = walk(abs);
  } catch {
    continue;
  }
  const rules = dir === 'src/sim' ? [...RULES, ...SIM_ONLY_RULES] : RULES;
  for (const file of list) {
    files++;
    const lines = readFileSync(file, 'utf8').split('\n');
    lines.forEach((line, i) => {
      // Komentarze mogą wspominać zakazane słowa (np. „nie używamy window”) – pomijamy je.
      if (/^\s*(\*|\/\/)/.test(line)) return;
      const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '');
      for (const rule of rules) {
        if (rule.re.test(code)) {
          problems.push(`${relative(ROOT, file)}:${i + 1}  ${rule.why}\n    ${line.trim()}`);
        }
      }
    });
  }
}

if (files === 0) {
  console.error('check:granice – nie znaleziono plików w src/sim ani src/ai.');
  process.exit(1);
}
if (problems.length > 0) {
  console.error(`check:granice – ${problems.length} naruszeń w ${files} plikach:\n`);
  for (const p of problems) console.error('  ' + p + '\n');
  process.exit(1);
}
console.log(`check:granice – OK (${files} plików w ${DIRS.join(', ')} bez three/DOM/losowości).`);
