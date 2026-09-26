/**
 * „Gra nie gra sama” w prawdziwej przeglądarce (F0b, docs/21): 60 s meczu w trybie asysty
 * BEZ żadnego dotyku – drużyna gracza nie może odbić piłki ani razu, także biernie. Asysta
 * tylko biega. Rywale serwują (?serwis=1), bo serwis gracza czeka na jego stuknięcie.
 *
 * Ten sam warunek w Node na 5 seedach po 90 s: tests/ai/asysta.test.ts. Tu sprawdzamy cały
 * łańcuch gry (pętla, wejście bez gestu, asysta, AI, sim) w zbudowanej grze.
 *
 * To test: kod wyjścia 1, gdy niebiescy dotkną piłki.
 *
 * Użycie: pnpm harness:sam [--sekundy 60] [--seed 7] [--url <adres>] [--headless]
 */
import type { Browser } from 'playwright';
import type { PlayerId } from './wspolne';
import {
  ensureServer,
  fail,
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

const DEFAULT_SECONDS = 60;
const DEFAULT_SEED = 7;
/** Odczyt stanu co tyle ms – kontakt zostaje w lastContact do następnego, więc nic nie ginie. */
const POLL_MS = 40;

async function main(): Promise<void> {
  const args = parseArgs();
  const seconds = args.sekundy ?? DEFAULT_SECONDS;
  const seed = args.seed ?? DEFAULT_SEED;
  const spec = phoneSpec(args, mobileSpec(2));
  const server = await ensureServer(args);
  let browser: Browser | null = null;
  const contacts: { tick: number; player: PlayerId; kind: string }[] = [];
  const run = { errors: [] as string[], version: '?', points: [0, 0], ticks: 0, mode: '?' };
  try {
    browser = await launchBrowser(args.headless, { uncappedFrameRate: !args.vsync });
    const { page, errors } = await openPage(browser, spec);
    run.errors = errors;
    const url = withQuery(server.url, { seed, serwis: 1 });
    console.log(`Otwieram ${url} – ${specLabel(spec)}, tryb ${modeLabel(args.headless)}`);
    await page.goto(url);
    run.version = await waitForHooks(page);
    run.mode = await page.evaluate(() => window.__sw3d!.controlMode());
    const tick0 = await page.evaluate(() => window.__sw3d!.state().tick);
    let lastTick = -1;
    const end = Date.now() + seconds * 1000;
    while (Date.now() < end) {
      const lc = await page.evaluate(() => {
        const c = window.__sw3d!.state().lastContact;
        return c ? { tick: c.tick, player: c.player, kind: c.kind } : null;
      });
      if (lc && lc.tick !== lastTick) {
        lastTick = lc.tick;
        contacts.push(lc);
      }
      await sleep(POLL_MS);
    }
    const endState = await page.evaluate(() => {
      const s = window.__sw3d!.state();
      return { tick: s.tick, points: s.score.points };
    });
    run.points = endState.points;
    run.ticks = endState.tick - tick0;
  } finally {
    await browser?.close();
    await server.stop();
  }
  const blue = contacts.filter((c) => c.player < 2);
  const red = contacts.filter((c) => c.player >= 2);
  const file = writeResult('sam', {
    script: 'sam',
    date: new Date().toISOString(),
    mode: modeLabel(args.headless),
    gameVersion: run.version,
    controlMode: run.mode,
    seed,
    seconds,
    simTicks: run.ticks,
    points: run.points,
    contacts,
    errors: run.errors,
  });
  console.log('');
  console.log('=== Harness „gra nie gra sama” – Set Wieszowa 3D F0b ===');
  console.log(`Sterowanie: ${run.mode}; ${seconds} s bez dotyku; ticki sim ${run.ticks}`);
  console.log(
    `Kontakty niebieskich: ${blue.length}; czerwonych: ${red.length}; wynik ${run.points[0]}:${run.points[1]}`,
  );
  for (const c of blue) console.log(`  tick ${c.tick}: zawodnik ${c.player}, ${c.kind}`);
  console.log(`Błędy strony: ${run.errors.length}`);
  console.log(`${blue.length === 0 && run.mode === 'assist' ? 'PASS' : 'FAIL'}`);
  console.log(`Zapisano: ${file}`);
  if (blue.length > 0 || run.mode !== 'assist') process.exit(1);
}

main().catch(fail);
