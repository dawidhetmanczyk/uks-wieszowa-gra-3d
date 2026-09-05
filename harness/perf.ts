/**
 * Pomiar wydajności (docs/22 §8, budżety z CLAUDE.md): AI vs AI, 390 × 844 @3×,
 * CPU spowolnione 4× przez CDP, domyślnie 60 s.
 *
 * To pomiar, nie test: kod wyjścia 0 także przy FAIL – progi mówią, czy mieścimy
 * się w budżecie, a decyzję podejmuje człowiek na podstawie liczb w raporcie.
 *
 * Użycie: pnpm harness:perf [--url <adres>] [--headless] [--sekundy 60] [--seed 7] [--build]
 */
import {
  FRAME_BUFFER,
  TICK_HZ,
  ensureServer,
  fail,
  fmt,
  fmtInt,
  launchBrowser,
  mean,
  mobileSpec,
  modeLabel,
  openPage,
  parseArgs,
  passFail,
  percentile,
  sleep,
  specLabel,
  waitForHooks,
  withQuery,
  writeResult,
} from './wspolne';

// Budżety z CLAUDE.md.
const FPS_P95_MIN = 55;
const CALLS_MAX = 60;
const TRIANGLES_MAX = 120_000;

const CPU_THROTTLE_RATE = 4;
/** Rozgrzewka przed pomiarem: kompilacja shaderów i pierwsze alokacje nie są „grą”. */
const WARMUP_MS = 2000;
const DEFAULT_SECONDS = 60;
const DEFAULT_SEED = 7;
/** Klatka 60 Hz = 16,67 ms; mediana w tym oknie oznacza rAF przycięty przez ekran. */
const RAF_60HZ_MS = 1000 / 60;
const RAF_60HZ_TOLERANCE_MS = 0.6;
/** Klatka powyżej dwóch okresów 60 Hz – widoczne przycięcie. */
const LONG_FRAME_MS = 2 * RAF_60HZ_MS;

async function main(): Promise<void> {
  const args = parseArgs();
  const seconds = args.sekundy ?? DEFAULT_SECONDS;
  const seed = args.seed ?? DEFAULT_SEED;
  const spec = mobileSpec(3);

  const server = await ensureServer(args);
  const browser = await launchBrowser(args.headless);
  try {
    const { context, page, errors } = await openPage(browser, spec);
    const url = withQuery(server.url, { ai: 1, seed });
    console.log(`Otwieram ${url} – ${specLabel(spec)}, tryb ${modeLabel(args.headless)}`);
    await page.goto(url);
    const version = await waitForHooks(page);

    // Throttling dopiero po załadowaniu: czas ładowania mierzy Lighthouse, tu
    // interesuje nas klatka w trakcie gry na wolnym telefonie.
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: CPU_THROTTLE_RATE });
    await sleep(WARMUP_MS);

    const tickStart = await page.evaluate(() => {
      const h = window.__sw3d!;
      h.resetFrameTimes();
      return h.state().tick;
    });
    const wallStart = Date.now();
    console.log(`Mierzę ${seconds} s…`);
    await sleep(seconds * 1000);

    const sample = await page.evaluate(() => {
      const h = window.__sw3d!;
      const s = h.state();
      const canvas = document.querySelector('canvas');
      return {
        frameTimes: h.frameTimes(),
        render: h.renderInfo(),
        tick: s.tick,
        points: s.score.points,
        phase: s.rally.phase,
        canvas: { width: canvas?.width ?? 0, height: canvas?.height ?? 0 },
        css: { width: window.innerWidth, height: window.innerHeight },
        dpr: window.devicePixelRatio,
      };
    });
    const wallSeconds = (Date.now() - wallStart) / 1000;

    const frames = [...sample.frameTimes].sort((a, b) => a - b);
    const p50 = percentile(frames, 50);
    const p95 = percentile(frames, 95);
    const p99 = percentile(frames, 99);
    const avg = mean(frames);
    const fpsP95 = 1000 / p95;
    const fpsMean = 1000 / avg;
    const longFrames = frames.filter((t) => t > LONG_FRAME_MS).length;
    const bufferFull = frames.length >= FRAME_BUFFER;
    const rafCapped = Math.abs(p50 - RAF_60HZ_MS) < RAF_60HZ_TOLERANCE_MS;

    const ticks = sample.tick - tickStart;
    const ticksExpected = Math.round(wallSeconds * TICK_HZ);
    // Sim nadąża, gdy wykonał ~wszystkie ticki czasu ściennego; pętla clampuje dt do 0,25 s,
    // więc brak ticków = klatki dłuższe niż 250 ms.
    const simKeptUp = ticks >= ticksExpected * 0.95;

    const thresholds = {
      fpsP95: { threshold: FPS_P95_MIN, value: fpsP95, pass: fpsP95 >= FPS_P95_MIN },
      drawCalls: {
        threshold: CALLS_MAX,
        value: sample.render.calls,
        pass: sample.render.calls <= CALLS_MAX,
      },
      triangles: {
        threshold: TRIANGLES_MAX,
        value: sample.render.triangles,
        pass: sample.render.triangles <= TRIANGLES_MAX,
      },
    };
    const warnings: string[] = [];
    if (rafCapped) {
      warnings.push(
        'mediana ≈ 16,7 ms – rAF przycięty do 60 Hz; p95 mówi o zapasie pod 60 fps, nie o maksymalnym fps',
      );
    }
    if (bufferFull) {
      // Bufor w pętli jest pierścieniowy: zostaje ostatnie FRAME_BUFFER klatek, czyli na ekranie
      // 144 Hz tylko ~28 s z 60. Liczby są prawdziwe, ale dotyczą końcówki pomiaru.
      const coveredS = frames.reduce((s, t) => s + t, 0) / 1000;
      warnings.push(
        `bufor frameTimes pełny (${FRAME_BUFFER}) – statystyki obejmują ostatnie ${fmt(coveredS)} s z ${fmt(wallSeconds)} s; ekran > 60 Hz albo skróć --sekundy`,
      );
    }
    if (!simKeptUp) {
      warnings.push(
        `sim wykonał ${ticks} ticków z ${ticksExpected} oczekiwanych – klatki dłuższe niż 250 ms`,
      );
    }
    if (frames.length === 0) warnings.push('frameTimes() puste – pętla nie raportuje klatek');

    const result = {
      script: 'perf',
      date: new Date().toISOString(),
      mode: modeLabel(args.headless),
      headless: args.headless,
      url,
      gameVersion: version,
      seed,
      seconds,
      wallSeconds,
      viewport: spec,
      cpuThrottleRate: CPU_THROTTLE_RATE,
      canvas: {
        ...sample.canvas,
        cssWidth: sample.css.width,
        cssHeight: sample.css.height,
        dpr: sample.dpr,
      },
      frames: {
        count: frames.length,
        p50Ms: p50,
        p95Ms: p95,
        p99Ms: p99,
        meanMs: avg,
        fpsP95,
        fpsMean,
        longFrames,
        bufferFull,
        rafCapped60Hz: rafCapped,
      },
      render: sample.render,
      sim: {
        tickStart,
        tickEnd: sample.tick,
        ticks,
        ticksExpected,
        keptUp: simKeptUp,
        points: sample.points,
        phase: sample.phase,
      },
      thresholds,
      allPass: Object.values(thresholds).every((t) => t.pass),
      warnings,
      errors,
    };
    const file = writeResult('perf', result);

    console.log('');
    console.log('=== Harness perf – Set Wieszowa 3D F0 ===');
    console.log(`Tryb: ${result.mode}; gra ${version}; seed ${seed}; CPU ×${CPU_THROTTLE_RATE}`);
    console.log(
      `Ekran: ${specLabel(spec)} – okno CSS ${sample.css.width}×${sample.css.height}, kanwa ${sample.canvas.width}×${sample.canvas.height} px, dpr ${fmt(sample.dpr, 2)}`,
    );
    console.log(
      `Pomiar: ${fmt(wallSeconds)} s, ${frames.length} klatek, ${longFrames} klatek > ${fmt(LONG_FRAME_MS)} ms`,
    );
    console.log(
      `Czas klatki: p50 ${fmt(p50, 2)} ms, p95 ${fmt(p95, 2)} ms, p99 ${fmt(p99, 2)} ms, średnia ${fmt(avg, 2)} ms`,
    );
    console.log(`fps: p95 ${fmt(fpsP95)}, średnie ${fmt(fpsMean)}`);
    console.log(
      `Render: ${sample.render.calls} draw calls, ${fmtInt(sample.render.triangles)} trójkątów, ${sample.render.programs} programów`,
    );
    console.log(
      `Sim: ${ticks} ticków w ${fmt(wallSeconds)} s (oczekiwane ${ticksExpected}) – ${simKeptUp ? 'nadążał' : 'NIE nadążał'}; wynik ${sample.points[0]}:${sample.points[1]}, faza ${sample.phase}`,
    );
    for (const w of warnings) console.log(`Ostrzeżenie: ${w}`);
    console.log(`Błędy strony: ${errors.length}`);
    for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
    console.log('Progi (CLAUDE.md):');
    console.log(
      `  fps p95 ≥ ${FPS_P95_MIN}        → ${passFail(thresholds.fpsP95.pass)} (${fmt(fpsP95)})`,
    );
    console.log(
      `  draw calls ≤ ${CALLS_MAX}      → ${passFail(thresholds.drawCalls.pass)} (${sample.render.calls})`,
    );
    console.log(
      `  trójkąty ≤ ${fmtInt(TRIANGLES_MAX)} → ${passFail(thresholds.triangles.pass)} (${fmtInt(sample.render.triangles)})`,
    );
    console.log(`Razem: ${passFail(result.allPass)}`);
    console.log(`Zapisano: ${file}`);
  } finally {
    await browser.close();
    await server.stop();
  }
}

main().catch(fail);
