/**
 * Sterowanie WZGLĘDNE w prawdziwej przeglądarce – test regresji jak w grze 2D.
 *
 * Telefon w poziomie 844 × 390, prawdziwe dotyki przez CDP (Input.dispatchTouchEvent),
 * prawdziwa kamera i render. Dwa przypadki, każdy rozstrzyga między sterowaniem względnym
 * a bezwzględnym („biegnij do palca”):
 *  A. palec w LEWYM GÓRNYM rogu, zawodnik stoi na prawo od palca, ruch palca w PRAWO →
 *     zawodnik ma jechać w PRAWO (bezwzględne pobiegłoby w lewo, do palca);
 *  B. palec w PRAWYM DOLNYM rogu, zawodnik na lewo od palca, ruch w LEWO → w LEWO.
 * Po puszczeniu palca zawodnik ma stanąć.
 *
 * To test, nie pomiar: kod wyjścia 1, gdy któryś warunek nie zachodzi.
 *
 * Użycie: pnpm harness:sterowanie [--url <adres>] [--headless]
 */
import type { Browser, CDPSession, Page } from 'playwright';
import {
  ensureServer,
  fail,
  fmt,
  landscapeSpec,
  launchBrowser,
  modeLabel,
  openPage,
  parseArgs,
  passRotateGate,
  sleep,
  specLabel,
  waitForHooks,
  withQuery,
  writeResult,
} from './wspolne';

interface CaseSpec {
  name: string;
  seed: number;
  start: { x: number; y: number };
  /** Przesunięcie palca w px CSS (6 kroków po 1/6). */
  dx: number;
  /** +1 = zawodnik ma jechać w prawo ekranu, −1 = w lewo. */
  expect: 1 | -1;
}

const CASES: CaseSpec[] = [
  { name: 'A: lewy górny róg → w prawo', seed: 7, start: { x: 24, y: 30 }, dx: 60, expect: 1 },
  { name: 'B: prawy dolny róg → w lewo', seed: 8, start: { x: 820, y: 366 }, dx: -60, expect: -1 },
];
const STEPS = 6;
const STEP_MS = 30;
/** Zawodnik ma przejechać na ekranie co najmniej tyle px CSS w dobrą stronę. */
const MIN_SHIFT_PX = 20;

interface CaseResult {
  name: string;
  fingerStart: { x: number; y: number };
  playerBefore: { x: number; y: number };
  playerAfter: { x: number; y: number };
  playerAfterRelease: { x: number; y: number };
  shiftPx: number;
  /** Komenda move aktywnego w trakcie przeciągania (świat: prawo ekranu = −x). */
  moveDuringDrag: { x: number; z: number };
  moveAfterRelease: { x: number; z: number };
  fingerOppositeSide: boolean;
  ok: boolean;
  problems: string[];
}

async function touch(
  cdp: CDPSession,
  type: 'touchStart' | 'touchMove' | 'touchEnd',
  x: number,
  y: number,
): Promise<void> {
  await cdp.send('Input.dispatchTouchEvent', {
    type,
    touchPoints: type === 'touchEnd' ? [] : [{ x, y, id: 1 }],
  });
}

async function runCase(page: Page, cdp: CDPSession, c: CaseSpec): Promise<CaseResult> {
  // Rywale serwują: aktywny (0) nie jest zablokowany serwisem; AI serwuje po 1 s,
  // a cały gest trwa ~0,4 s.
  await page.evaluate(
    (s) => window.__sw3d!.newSet({ seed: s, servingTeam: 1, humanControl: true }),
    c.seed,
  );
  await sleep(150);
  const before = await page.evaluate(() => window.__sw3d!.screenPos(window.__sw3d!.state().active));
  if (!before) throw new Error('screenPos zwrócił null – brak klatki renderu');

  await touch(cdp, 'touchStart', c.start.x, c.start.y);
  await sleep(40);
  for (let i = 1; i <= STEPS; i++) {
    await touch(cdp, 'touchMove', c.start.x + (c.dx * i) / STEPS, c.start.y);
    await sleep(STEP_MS);
  }
  await sleep(150);
  const during = await page.evaluate(() => {
    const h = window.__sw3d!;
    const s = h.state();
    const p = s.players[s.active] as unknown as { move: { x: number; z: number } };
    return { pos: h.screenPos(s.active)!, move: { x: p.move.x, z: p.move.z } };
  });
  await touch(cdp, 'touchEnd', 0, 0);
  await sleep(250);
  const released = await page.evaluate(() => {
    const h = window.__sw3d!;
    const s = h.state();
    const p = s.players[s.active] as unknown as { move: { x: number; z: number } };
    return { pos: h.screenPos(s.active)!, move: { x: p.move.x, z: p.move.z } };
  });

  const shift = during.pos.x - before.x;
  const fingerOpposite = c.expect === 1 ? c.start.x < before.x : c.start.x > before.x;
  const problems: string[] = [];
  if (!fingerOpposite)
    problems.push('palec nie leży po przeciwnej stronie zawodnika – test nic nie rozstrzyga');
  if (Math.sign(shift) !== c.expect || Math.abs(shift) < MIN_SHIFT_PX) {
    problems.push(
      `zawodnik przesunął się o ${fmt(shift)} px, oczekiwane ${c.expect > 0 ? '≥ +' : '≤ −'}${MIN_SHIFT_PX}`,
    );
  }
  if (during.move.x === 0 && during.move.z === 0)
    problems.push('brak komendy ruchu w trakcie przeciągania');
  if (released.move.x !== 0 || released.move.z !== 0)
    problems.push('po puszczeniu palca ruch nie ustał');
  return {
    name: c.name,
    fingerStart: c.start,
    playerBefore: before,
    playerAfter: during.pos,
    playerAfterRelease: released.pos,
    shiftPx: shift,
    moveDuringDrag: during.move,
    moveAfterRelease: released.move,
    fingerOppositeSide: fingerOpposite,
    ok: problems.length === 0,
    problems,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const spec = landscapeSpec(2);
  const server = await ensureServer(args);
  let browser: Browser | null = null;
  const results: CaseResult[] = [];
  const run = { errors: [] as string[], version: '?' };
  try {
    browser = await launchBrowser(args.headless);
    const handle = await openPage(browser, spec);
    run.errors = handle.errors;
    const { page, context } = handle;
    const cdp = await context.newCDPSession(page);
    const url = withQuery(server.url, { seed: 7, serwis: 1 });
    console.log(`Otwieram ${url} – ${specLabel(spec)}, tryb ${modeLabel(args.headless)}`);
    await page.goto(url);
    run.version = await waitForHooks(page);
    await passRotateGate(page);
    for (const c of CASES) results.push(await runCase(page, cdp, c));
  } finally {
    await browser?.close();
    await server.stop();
  }
  const { errors, version } = run;

  const file = writeResult('sterowanie', {
    script: 'sterowanie',
    date: new Date().toISOString(),
    mode: modeLabel(args.headless),
    gameVersion: version,
    viewport: spec,
    results,
    errors,
  });
  console.log('');
  console.log('=== Harness sterowanie względne – Set Wieszowa 3D F0 ===');
  for (const r of results) {
    console.log(
      `${r.ok ? 'PASS' : 'FAIL'} ${r.name}: palec (${r.fingerStart.x}, ${r.fingerStart.y}), zawodnik ` +
        `x ${fmt(r.playerBefore.x)} → ${fmt(r.playerAfter.x)} px (${r.shiftPx >= 0 ? '+' : ''}${fmt(r.shiftPx)}), ` +
        `move (${fmt(r.moveDuringDrag.x, 2)}, ${fmt(r.moveDuringDrag.z, 2)}) → po puszczeniu (${fmt(r.moveAfterRelease.x, 2)}, ${fmt(r.moveAfterRelease.z, 2)})`,
    );
    for (const p of r.problems) console.log(`     ${p}`);
  }
  console.log(`Błędy strony: ${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
  console.log(`Zapisano: ${file}`);
  if (results.some((r) => !r.ok) || results.length !== CASES.length) process.exit(1);
}

main().catch(fail);
