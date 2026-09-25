/**
 * Pomiar kadru: czy OBAJ zawodnicy drużyny gracza są w oknie przez 60 s meczu AI vs AI.
 *
 * Raport F0 §7 pokazał, że w pionie partner (4,5 m obok) wypada z kadru nawet przy FOV 72°.
 * Gra idzie w poziom (nakładka „Obróć telefon”), więc domyślny ekran to telefon w poziomie
 * 844 × 390. Liczy render – ta sama kamera, którą widzi gracz – co klatkę, od resetu po
 * rozgrzewce; harness tylko czyta licznik (`__sw3d.framing()`).
 *
 * „Cały w kadrze” = stopy i czubek głowy kapsuły, z promieniem po obu bokach, w oknie.
 *
 * Użycie: pnpm harness:kadr [--ekran 844x390] [--sekundy 60] [--seed 7] [--url <adres>] [--headless]
 */
import type { Browser } from 'playwright';
import type { FramingStats } from './wspolne';
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
  phoneSpec,
  sleep,
  specLabel,
  waitForHooks,
  withQuery,
  writeResult,
} from './wspolne';

const DEFAULT_SECONDS = 60;
const DEFAULT_SEED = 7;
/** Rozgrzewka: pierwsza klatka ustawia kamerę, shadery się kompilują. */
const WARMUP_MS = 1500;

function pct(part: number, whole: number): string {
  return whole > 0 ? `${fmt((part / whole) * 100)} %` : '–';
}

async function main(): Promise<void> {
  const args = parseArgs();
  const seconds = args.sekundy ?? DEFAULT_SECONDS;
  const seed = args.seed ?? DEFAULT_SEED;
  const spec = phoneSpec(args, landscapeSpec(3));

  const server = await ensureServer(args);
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser(args.headless);
    const { page, errors } = await openPage(browser, spec);
    const url = withQuery(server.url, { ai: 1, seed });
    console.log(`Otwieram ${url} – ${specLabel(spec)}, tryb ${modeLabel(args.headless)}`);
    await page.goto(url);
    const version = await waitForHooks(page);
    const gate = await passRotateGate(page);
    if (gate) console.log('Nakładka „Obróć telefon” – przechodzę furtką „Graj mimo to”.');

    await sleep(WARMUP_MS);
    await page.evaluate(() => window.__sw3d!.resetFraming());
    const tick0 = await page.evaluate(() => window.__sw3d!.state().tick);
    console.log(`Mierzę ${seconds} s…`);
    await sleep(seconds * 1000);
    const stats: FramingStats = await page.evaluate(() => window.__sw3d!.framing());
    const tick1 = await page.evaluate(() => window.__sw3d!.state().tick);
    const camera = await page.evaluate(() => {
      const s = window.__sw3d!.state();
      return { points: s.score.points, phase: s.rally.phase };
    });

    const result = {
      script: 'kadr',
      date: new Date().toISOString(),
      mode: modeLabel(args.headless),
      gameVersion: version,
      url,
      seed,
      viewport: spec,
      passedRotateGate: gate,
      seconds,
      simTicks: tick1 - tick0,
      stats,
      team0FullPct: stats.frames > 0 ? stats.team0Full / stats.frames : null,
      endState: camera,
      errors,
    };
    const file = writeResult('kadr', result);

    console.log('');
    console.log('=== Harness kadr – Set Wieszowa 3D F0 ===');
    console.log(`Tryb: ${result.mode}; gra ${version}; seed ${seed}; ${specLabel(spec)}`);
    console.log(
      `Klatki: ${stats.frames}; ticki sim: ${result.simTicks}; okno ${stats.width}×${stats.height} px CSS`,
    );
    console.log(
      `Obaj (0 i 1) w kadrze w całości: ${stats.team0Full}/${stats.frames} (${pct(stats.team0Full, stats.frames)})`,
    );
    console.log(
      `Obaj choć częściowo: ${stats.team0Partial}/${stats.frames} (${pct(stats.team0Partial, stats.frames)})`,
    );
    console.log(
      `Cały w kadrze per zawodnik: ` +
        stats.playerFull.map((n, i) => `${i}: ${pct(n, stats.frames)}`).join(', '),
    );
    console.log(`Piłka w kadrze: ${pct(stats.ballIn, stats.frames)}`);
    console.log(`Najmniejszy zapas kapsuł 0/1 do krawędzi okna: ${fmt(stats.minMarginPx)} px`);
    console.log(
      `Średnia wysokość zawodnika drużyny gracza na ekranie: ${fmt(stats.meanPlayerHeightPx)} px`,
    );
    console.log(`Błędy strony: ${errors.length}`);
    for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
    console.log(`Zapisano: ${file}`);
  } finally {
    await browser?.close();
    await server.stop();
  }
}

main().catch(fail);
