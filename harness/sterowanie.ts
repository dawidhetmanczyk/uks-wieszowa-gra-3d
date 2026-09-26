/**
 * Sterowanie WZGLĘDNE w prawdziwej przeglądarce – test regresji jak w grze 2D.
 *
 * Telefon w pionie 390 × 844 (główny tryb F0b; --ekran zmienia), prawdziwe dotyki przez CDP
 * (Input.dispatchTouchEvent), prawdziwa kamera i render. Dwa przypadki, każdy rozstrzyga
 * między sterowaniem względnym a bezwzględnym („biegnij do palca”):
 *  A. palec w LEWYM GÓRNYM rogu, zawodnik stoi na prawo od palca, ruch palca w PRAWO →
 *     zawodnik ma jechać w PRAWO (bezwzględne pobiegłoby w lewo, do palca);
 *  B. palec w PRAWYM DOLNYM rogu, zawodnik na lewo od palca, ruch w LEWO → w LEWO.
 * Po puszczeniu palca zawodnik ma stanąć. Oba przypadki w trybie asysty F0b (przeciągnięcie
 * przejmuje ruch po 200 ms trzymania, więc palec najpierw stoi 250 ms) i w trybie ręcznym
 * (?sterowanie=reczne – pełne F0).
 *
 * C (F0b, decyzja Dawida 8): „pierwszy gest nie może przepaść” – na świeżej stronie serwuje
 * gracz, a PIERWSZY dotyk to stuknięcie: piłka ma zostać zaserwowana, a prośba o pełny ekran
 * ma pójść po tym geście (pointerup), nie w jego trakcie.
 *
 * To test, nie pomiar: kod wyjścia 1, gdy któryś warunek nie zachodzi.
 *
 * Użycie: pnpm harness:sterowanie [--url <adres>] [--headless] [--ekran 844x390]
 */
import type { Browser, CDPSession, Page } from 'playwright';
import {
  ensureServer,
  fail,
  fmt,
  controlQuery,
  launchBrowser,
  mobileSpec,
  modeLabel,
  openPage,
  parseArgs,
  phoneSpec,
  sleep,
  specLabel,
  waitForHooks,
  withQuery,
  writeResult,
} from './wspolne';

interface CaseSpec {
  name: string;
  seed: number;
  /** Punkt dotknięcia jako ułamek okna (0..1) – ten sam przypadek na każdym ekranie. */
  start: { fx: number; fy: number };
  /** Przesunięcie palca w px CSS (6 kroków po 1/6). */
  dx: number;
  /** +1 = zawodnik ma jechać w prawo ekranu, −1 = w lewo. */
  expect: 1 | -1;
}

const CASES: CaseSpec[] = [
  {
    name: 'A: lewy górny róg → w prawo',
    seed: 7,
    start: { fx: 0.06, fy: 0.04 },
    dx: 60,
    expect: 1,
  },
  {
    name: 'B: prawy dolny róg → w lewo',
    seed: 8,
    start: { fx: 0.94, fy: 0.96 },
    dx: -60,
    expect: -1,
  },
];
/** Tryb asysty: palec stoi tyle ms, zanim ruszy – przeciągnięcie to palec trzymany > 200 ms. */
const ASSIST_HOLD_MS = 250;
const STEPS = 6;
const STEP_MS = 30;
/** Zawodnik ma przejechać na ekranie co najmniej tyle px CSS w dobrą stronę. */
const MIN_SHIFT_PX = 20;

interface CaseResult {
  name: string;
  mode: 'assist' | 'manual';
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

async function runCase(
  page: Page,
  cdp: CDPSession,
  c: CaseSpec,
  mode: 'assist' | 'manual',
  size: { width: number; height: number },
): Promise<CaseResult> {
  const start = { x: Math.round(c.start.fx * size.width), y: Math.round(c.start.fy * size.height) };
  // Rywale serwują: aktywny (0) nie jest zablokowany serwisem; AI serwuje po 1 s,
  // a cały gest trwa ~0,4 s.
  await page.evaluate(
    (s) => window.__sw3d!.newSet({ seed: s, servingTeam: 1, humanControl: true }),
    c.seed,
  );
  await sleep(150);
  const before = await page.evaluate(() => window.__sw3d!.screenPos(window.__sw3d!.state().active));
  if (!before) throw new Error('screenPos zwrócił null – brak klatki renderu');

  await touch(cdp, 'touchStart', start.x, start.y);
  // F0 (ręczne): palec, który w 120 ms nie przejdzie 12 px, staje się zamachem – ruch rusza od
  // razu. Asysta: przeciągnięcie to palec trzymany > 200 ms – najpierw stoi, potem jedzie.
  await sleep(mode === 'assist' ? ASSIST_HOLD_MS : 5);
  // Ręczne: pierwszy ruch od razu ponad martwą strefę F0 (12 px) – zdarzenia CDP przychodzą co
  // ~60 ms, więc drobne kroki potrafiły przekroczyć 120 ms i gest stawał się zamachem.
  if (mode === 'manual') await touch(cdp, 'touchMove', start.x + Math.sign(c.dx) * 16, start.y);
  for (let i = 1; i <= STEPS; i++) {
    await touch(cdp, 'touchMove', start.x + (c.dx * i) / STEPS, start.y);
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
  const fingerOpposite = c.expect === 1 ? start.x < before.x : start.x > before.x;
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
    mode,
    fingerStart: start,
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

interface FirstTouchResult {
  name: string;
  served: boolean;
  fullscreenRequested: boolean;
  tickBefore: number;
  phaseAfter: string;
  ok: boolean;
  problems: string[];
}

/**
 * C: pierwszy dotyk na świeżej stronie (serwuje gracz) to stuknięcie – musi zaserwować,
 * a prośba o pełny ekran (Android, decyzja Dawida 8) ma pójść po geście.
 */
async function firstTouchCase(
  page: Page,
  cdp: CDPSession,
  size: { width: number; height: number },
): Promise<FirstTouchResult> {
  const before = await page.evaluate(() => {
    const h = window.__sw3d!;
    const s = h.state();
    return {
      tick: s.tick,
      phase: s.rally.phase,
      server: s.rally.server,
      active: s.active,
      requested: h.fullscreenRequested(),
    };
  });
  const x = Math.round(size.width / 2);
  const y = Math.round(size.height * 0.7);
  await touch(cdp, 'touchStart', x, y);
  await sleep(60);
  await touch(cdp, 'touchEnd', 0, 0);
  await sleep(600);
  const after = await page.evaluate(() => {
    const h = window.__sw3d!;
    const s = h.state();
    return {
      phase: s.rally.phase,
      lastContact: s.lastContact,
      requested: h.fullscreenRequested(),
    };
  });
  const problems: string[] = [];
  if (before.phase !== 'serve' || before.server !== before.active)
    problems.push('na starcie nie serwuje gracz – przypadek niczego nie sprawdza');
  if (before.requested) problems.push('prośba o pełny ekran przed pierwszym dotykiem');
  const served = after.lastContact !== null && after.lastContact.kind === 'serve';
  if (!served) problems.push('pierwsze stuknięcie nie zaserwowało – gest przepadł');
  if (!after.requested) problems.push('brak prośby o pełny ekran po pierwszym dotyku');
  return {
    name: 'C: pierwszy dotyk = stuknięcie serwuje, pełny ekran po geście',
    served,
    fullscreenRequested: after.requested,
    tickBefore: before.tick,
    phaseAfter: after.phase,
    ok: problems.length === 0,
    problems,
  };
}

async function main(): Promise<void> {
  const args = parseArgs();
  const spec = phoneSpec(args, mobileSpec(2));
  const size = { width: spec.width, height: spec.height };
  const server = await ensureServer(args);
  const results: CaseResult[] = [];
  const run = { errors: [] as string[], version: '?', first: null as FirstTouchResult | null };
  // Każda grupa przypadków we własnej przeglądarce: pierwsze stuknięcie prosi o pełny ekran
  // (decyzja Dawida 8), a Chromium z oknem zostaje w nim także dla następnych stron – dotyki
  // CDP trafiałyby wtedy obok kanwy.
  async function withBrowser(fn: (browser: Browser) => Promise<void>): Promise<void> {
    const browser = await launchBrowser(args.headless);
    try {
      await fn(browser);
    } finally {
      await browser.close();
    }
  }
  try {
    for (const mode of ['assist', 'manual'] as const) {
      await withBrowser(async (browser) => {
        const handle = await openPage(browser, spec);
        run.errors.push(...handle.errors);
        const { page, context } = handle;
        // A i B sprawdzają sterowanie, nie pełny ekran: puszczenie palca w A prosiłoby o pełny
        // ekran i przesuwało okno pod palcami B. Prawdziwy przebieg pełnego ekranu – przypadek C.
        await page.addInitScript(() => {
          Element.prototype.requestFullscreen = () => Promise.resolve();
        });
        const cdp = await context.newCDPSession(page);
        const query = { seed: 7, serwis: 1, ...controlQuery(mode === 'manual') };
        const url = withQuery(server.url, query);
        console.log(`Otwieram ${url} – ${specLabel(spec)}, tryb ${modeLabel(args.headless)}`);
        await page.goto(url);
        run.version = await waitForHooks(page);
        for (const c of CASES) results.push(await runCase(page, cdp, c, mode, size));
      });
    }
    // C: świeża strona, serwuje gracz (bez ?serwis=1), tryb asysty.
    await withBrowser(async (browser) => {
      const handle = await openPage(browser, spec);
      run.errors.push(...handle.errors);
      const cdp = await handle.context.newCDPSession(handle.page);
      const url = withQuery(server.url, { seed: 7 });
      console.log(`Otwieram ${url} – pierwszy dotyk`);
      await handle.page.goto(url);
      await waitForHooks(handle.page);
      await sleep(300);
      run.first = await firstTouchCase(handle.page, cdp, size);
    });
  } finally {
    await server.stop();
  }
  const { errors, version, first } = run;

  const file = writeResult('sterowanie', {
    script: 'sterowanie',
    date: new Date().toISOString(),
    mode: modeLabel(args.headless),
    gameVersion: version,
    viewport: spec,
    results,
    firstTouch: first,
    errors,
  });
  console.log('');
  console.log('=== Harness sterowanie względne – Set Wieszowa 3D F0b ===');
  for (const r of results) {
    console.log(
      `${r.ok ? 'PASS' : 'FAIL'} [${r.mode === 'assist' ? 'asysta' : 'ręczne'}] ${r.name}: palec (${r.fingerStart.x}, ${r.fingerStart.y}), zawodnik ` +
        `x ${fmt(r.playerBefore.x)} → ${fmt(r.playerAfter.x)} px (${r.shiftPx >= 0 ? '+' : ''}${fmt(r.shiftPx)}), ` +
        `move (${fmt(r.moveDuringDrag.x, 2)}, ${fmt(r.moveDuringDrag.z, 2)}) → po puszczeniu (${fmt(r.moveAfterRelease.x, 2)}, ${fmt(r.moveAfterRelease.z, 2)})`,
    );
    for (const p of r.problems) console.log(`     ${p}`);
  }
  if (first) {
    console.log(
      `${first.ok ? 'PASS' : 'FAIL'} ${first.name}: serwis ${first.served ? 'tak' : 'nie'}, pełny ekran ${first.fullscreenRequested ? 'poproszony' : 'brak'}, faza po ${first.phaseAfter}`,
    );
    for (const p of first.problems) console.log(`     ${p}`);
  }
  console.log(`Błędy strony: ${errors.length}`);
  for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
  console.log(`Zapisano: ${file}`);
  const expected = CASES.length * 2;
  if (results.some((r) => !r.ok) || results.length !== expected || !first?.ok) process.exit(1);
}

main().catch(fail);
