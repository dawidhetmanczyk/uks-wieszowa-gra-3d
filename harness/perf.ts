/**
 * Pomiar wydajności (docs/22 §8, budżety z CLAUDE.md): AI vs AI, 390 × 844 @3×,
 * CPU spowolnione 4× przez CDP, domyślnie 60 s.
 *
 * To pomiar, nie test: kod wyjścia 0 także przy FAIL – progi mówią, czy mieścimy
 * się w budżecie, a decyzję podejmuje człowiek na podstawie liczb w raporcie.
 *
 * Domyślnie Chromium startuje bez limitu klatek (`--disable-gpu-vsync
 * --disable-frame-rate-limit`): delta rAF przycięta do odświeżania ekranu mierzy monitor
 * (na 175 Hz p95 = 5,8 ms bez względu na grę), a nas interesuje koszt klatki. `--vsync`
 * przywraca limit – wtedy p95 mówi tylko o zapasie pod częstotliwość ekranu.
 *
 * Użycie: pnpm harness:perf [--url <adres>] [--headless] [--vsync] [--sekundy 60] [--seed 7] [--build]
 */
import type { Browser } from 'playwright';
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
  phoneSpec,
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
/** Klatka 60 Hz = 16,67 ms – cel z CLAUDE.md; klatka powyżej dwóch okresów to widoczne przycięcie. */
const RAF_60HZ_MS = 1000 / 60;
const LONG_FRAME_MS = 2 * RAF_60HZ_MS;
/**
 * Typowe częstotliwości odświeżania ekranów. Gdy mediana delty rAF odpowiada 1000/f
 * z tolerancją ±3 %, a rozrzut p99 − p50 jest mniejszy niż 0,5 ms, rAF jest przycięty
 * przez ekran i liczby mówią o monitorze, nie o koszcie klatki.
 */
const REFRESH_RATES_HZ = [60, 75, 90, 120, 144, 165, 175, 240] as const;
const REFRESH_TOLERANCE = 0.03;
const CAPPED_SPREAD_MAX_MS = 0.5;

/**
 * Rozpoznaje przycięcie rAF do okresu odświeżania; zwraca częstotliwość (Hz) albo null.
 * Wąski rozrzut jest kluczowy: prawdziwy koszt klatki faluje (AI, punkt, serwis), a okres
 * monitora stoi jak w zegarku.
 */
function detectRefreshCap(p50Ms: number, p99Ms: number): number | null {
  if (!Number.isFinite(p50Ms) || !Number.isFinite(p99Ms)) return null;
  if (p99Ms - p50Ms >= CAPPED_SPREAD_MAX_MS) return null;
  for (const hz of REFRESH_RATES_HZ) {
    const period = 1000 / hz;
    if (Math.abs(p50Ms - period) <= period * REFRESH_TOLERANCE) return hz;
  }
  return null;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const seconds = args.sekundy ?? DEFAULT_SECONDS;
  const seed = args.seed ?? DEFAULT_SEED;
  // Domyślnie ekran budżetu z CLAUDE.md (390 × 844); --ekran 844x390 = telefon w poziomie.
  const spec = phoneSpec(args, mobileSpec(3));
  const uncappedFrameRate = !args.vsync;

  const server = await ensureServer(args);
  // Przeglądarka wewnątrz try: gdy start Chromium padnie, finally i tak ubije serwer
  // podglądu – inaczej vite preview zostawał żywy i skrypt wisiał.
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser(args.headless, { uncappedFrameRate });
    const { context, page, errors } = await openPage(browser, spec);
    const url = withQuery(server.url, { ai: 1, seed });
    console.log(
      `Otwieram ${url} – ${specLabel(spec)}, tryb ${modeLabel(args.headless)}, ${frameRateLabel(uncappedFrameRate)}`,
    );
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
      // Hak opcjonalny (docs/22 §1 go nie wymaga) – funkcja albo obiekt, zależnie od renderu.
      const ro = h.renderOptions;
      const renderOptions = typeof ro === 'function' ? ro() : (ro ?? null);
      return {
        frameTimes: h.frameTimes(),
        render: h.renderInfo(),
        renderOptions,
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
    const rafCappedHz = detectRefreshCap(p50, p99);

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
    if (rafCappedHz !== null) {
      warnings.push(
        `mediana ${fmt(p50, 2)} ms przy rozrzucie p99 − p50 < ${fmt(CAPPED_SPREAD_MAX_MS)} ms – delta rAF = okres odświeżania ${rafCappedHz} Hz, nie koszt klatki` +
          (uncappedFrameRate
            ? ' (mimo flag bez limitu klatek – sprawdź, czy sterownik nie wymusza vsync)'
            : '; uruchom bez --vsync, żeby zmierzyć koszt klatki'),
      );
    }
    if (bufferFull) {
      // Bufor w pętli jest pierścieniowy: zostaje ostatnie FRAME_BUFFER klatek, czyli przy
      // 300 fps bez limitu tylko ~55 s z 60. Liczby są prawdziwe, ale dotyczą końcówki pomiaru.
      const coveredS = frames.reduce((s, t) => s + t, 0) / 1000;
      warnings.push(
        `bufor frameTimes pełny (${FRAME_BUFFER}) – statystyki obejmują ostatnie ${fmt(coveredS)} s z ${fmt(wallSeconds)} s; bez limitu klatek albo ekran > 60 Hz – skróć --sekundy`,
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
      /** true = Chromium bez limitu klatek (delta rAF = koszt klatki); false = --vsync. */
      uncappedFrameRate,
      /** true = telefon w pionie, pomiar za furtką „Graj mimo to”. */
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
        /** Rozpoznana częstotliwość ekranu, gdy delta rAF to jej okres; null = brak przycięcia. */
        rafCappedHz,
      },
      render: sample.render,
      /** Z haka `renderOptions`, jeśli warstwa render go wystawia; null = brak haka. */
      renderOptions: sample.renderOptions,
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
    console.log(
      `Tryb: ${result.mode}; ${frameRateLabel(uncappedFrameRate)}; gra ${version}; seed ${seed}; CPU ×${CPU_THROTTLE_RATE}`,
    );
    if (sample.renderOptions !== null) {
      console.log(`Opcje renderu: ${JSON.stringify(sample.renderOptions)}`);
    }
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
    await browser?.close();
    await server.stop();
  }
}

/** Do nagłówka raportu – bez tej informacji p95 z dwóch uruchomień nie da się porównać. */
function frameRateLabel(uncapped: boolean): string {
  return uncapped
    ? 'bez limitu klatek (delta rAF = koszt klatki)'
    : 'z vsync (delta rAF ≥ okres odświeżania ekranu)';
}

main().catch(fail);
