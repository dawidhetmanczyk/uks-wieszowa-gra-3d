/**
 * Zrzuty ekranu do raportu fazy (docs/22 §8): 390 × 844 @2× i 1280 × 720 @1×,
 * trzy momenty: serwis (gracz trzyma piłkę, HUD z podpowiedzią), wymiana
 * (po pierwszym przyjęciu/wystawie AI vs AI), punkt (pauza po punkcie).
 *
 * Pliki lądują w docs/zrzuty/ i idą do repo – „czytelne” z CLAUDE.md znaczy
 * „zrzut w docelowym rozmiarze”, więc nazwa niesie rozmiar ekranu.
 *
 * Użycie: pnpm harness:zrzuty [--url <adres>] [--headless] [--build]
 */
import { join, relative } from 'node:path';
import type { Browser, Page } from 'playwright';
import type { ContextSpec, HitKind, Phase, PlayerId } from './wspolne';
import {
  DESKTOP_SPEC,
  ROOT,
  ensureServer,
  fail,
  launchBrowser,
  mobileSpec,
  modeLabel,
  openPage,
  parseArgs,
  sleep,
  specLabel,
  waitForHooks,
  withQuery,
  writeResult,
} from './wspolne';

/** Jedno ziarno dla wszystkich zrzutów: te same pozycje na obu rozmiarach ekranu. */
const SEED = 11;
/** Zrzut serwisu po chwili – kamera zdąży dojechać, HUD się narysować. */
const SERVE_SETTLE_MS = 700;
const RESET_TIMEOUT_MS = 2000;
/** Serwis AI po 1 s + lot + przyjęcie; 15 s to awaria. */
const RALLY_TIMEOUT_MS = 15_000;
/** Wymiana Nowicjusz vs Nowicjusz na seedzie 11 trwała 39 s (pomiar 2026-09-04) – stąd zapas. */
const POINT_TIMEOUT_MS = 60_000;
/**
 * Zrzut „punkt” tuż po wejściu w fazę point łapał toast HUD w trakcie 180 ms animacji
 * (krycie ~0,3). Pauza po punkcie trwa 1,5 s (POINT_FREEZE_S), więc 300 ms zapasu mieści
 * się w niej z dużym marginesem.
 */
const POINT_SETTLE_MS = 300;

type ShotName = 'serwis' | 'wymiana' | 'punkt';

interface Snapshot {
  tick: number;
  phase: Phase;
  points: [number, number];
  active: PlayerId;
  held: PlayerId | -1;
  humanControl: boolean;
  lastContact: { kind: HitKind; player: PlayerId; touchNo: number } | null;
  pointReason: string | null;
}

interface Shot {
  screen: string;
  name: ShotName;
  file: string;
  taken: boolean;
  state: Snapshot | null;
  notes: string[];
}

async function main(): Promise<void> {
  const args = parseArgs();
  const server = await ensureServer(args);
  const shots: Shot[] = [];
  const errorsByScreen: Record<string, string[]> = {};
  let version = '?';
  // Przeglądarka wewnątrz try: gdy start Chromium padnie, finally i tak ubije serwer
  // podglądu – inaczej vite preview zostawał żywy i skrypt wisiał.
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser(args.headless);
    for (const spec of [mobileSpec(2), DESKTOP_SPEC]) {
      const screen = `${spec.width}x${spec.height}`;
      const { context, page, errors } = await openPage(browser, spec);
      errorsByScreen[screen] = errors;
      try {
        version = await captureScreen(page, spec, screen, server.url, shots);
      } finally {
        await context.close();
      }
    }
  } finally {
    await browser?.close();
    await server.stop();
  }

  const result = {
    script: 'zrzuty',
    date: new Date().toISOString(),
    mode: modeLabel(args.headless),
    headless: args.headless,
    gameVersion: version,
    seed: SEED,
    shots,
    errors: errorsByScreen,
  };
  const file = writeResult('zrzuty', result);

  console.log('');
  console.log('=== Harness zrzuty – Set Wieszowa 3D F0 ===');
  console.log(`Tryb: ${result.mode}; gra ${version}; seed ${SEED}`);
  for (const s of shots) {
    const st = s.state;
    const desc = st
      ? `faza ${st.phase}, wynik ${st.points[0]}:${st.points[1]}, tick ${st.tick}` +
        (st.lastContact
          ? `, ostatni kontakt ${st.lastContact.kind} (${st.lastContact.player})`
          : '')
      : 'brak stanu';
    console.log(`${s.taken ? 'OK  ' : 'BRAK'} ${s.file} – ${desc}`);
    for (const n of s.notes) console.log(`       uwaga: ${n}`);
  }
  for (const [screen, errs] of Object.entries(errorsByScreen)) {
    console.log(`Błędy strony ${screen}: ${errs.length}`);
    for (const e of errs.slice(0, 10)) console.log(`  ${e}`);
  }
  const missing = shots.filter((s) => !s.taken).length;
  console.log(`Razem: ${shots.length - missing}/${shots.length} zrzutów`);
  console.log(`Zapisano: ${file}`);
}

/** Trzy zrzuty dla jednego rozmiaru ekranu; zwraca wersję gry. */
async function captureScreen(
  page: Page,
  spec: ContextSpec,
  screen: string,
  baseUrl: string,
  shots: Shot[],
): Promise<string> {
  const url = withQuery(baseUrl, { seed: SEED });
  console.log(`Otwieram ${url} – ${specLabel(spec)}`);
  await page.goto(url);
  const version = await waitForHooks(page);

  // 1. Serwis: człowiek gra, serwują niebiescy, nikt nie tapnął – gracz trzyma piłkę.
  await sleep(SERVE_SETTLE_MS);
  const serve = await capture(page, screen, 'serwis');
  if (serve.state && serve.state.phase !== 'serve') {
    serve.notes.push(`oczekiwana faza serve, jest ${serve.state.phase}`);
  }
  if (serve.state && serve.state.held !== serve.state.active) {
    serve.notes.push(`piłkę trzyma ${serve.state.held}, aktywny ${serve.state.active}`);
  }
  shots.push(serve);

  // 2. Wymiana: AI vs AI z tym samym ziarnem, zrzut po pierwszym przyjęciu lub wystawie.
  await page.evaluate((s) => window.__sw3d!.newSet({ seed: s, humanControl: false }), SEED);
  const rallyNotes: string[] = [];
  try {
    await page.waitForFunction(() => window.__sw3d!.state().humanControl === false, undefined, {
      timeout: RESET_TIMEOUT_MS,
    });
  } catch {
    rallyNotes.push('stan nie potwierdził humanControl=false po newSet');
  }
  try {
    await page.waitForFunction(
      () => {
        const s = window.__sw3d!.state();
        const lc = s.lastContact;
        const received = lc !== null && (lc.kind === 'receive' || lc.kind === 'set');
        return received || s.rally.phase === 'point' || s.rally.phase === 'set-over';
      },
      undefined,
      { timeout: RALLY_TIMEOUT_MS },
    );
  } catch {
    rallyNotes.push(`brak przyjęcia/wystawy w ${RALLY_TIMEOUT_MS / 1000} s`);
  }
  const rally = await capture(page, screen, 'wymiana');
  rally.notes.push(...rallyNotes);
  const lc = rally.state?.lastContact;
  if (!lc || (lc.kind !== 'receive' && lc.kind !== 'set')) {
    rally.notes.push('zrzut bez przyjęcia/wystawy – punkt zapadł wcześniej (np. serwis w aut)');
  }
  shots.push(rally);

  // 3. Punkt: pauza po punkcie – tablica wyniku z nowym rezultatem.
  const pointNotes: string[] = [];
  try {
    await page.waitForFunction(
      () => {
        const p = window.__sw3d!.state().rally.phase;
        return p === 'point' || p === 'set-over';
      },
      undefined,
      { timeout: POINT_TIMEOUT_MS },
    );
  } catch {
    pointNotes.push(`brak punktu w ${POINT_TIMEOUT_MS / 1000} s`);
  }
  // Toast po punkcie ma zdążyć się w pełni pokazać – patrz POINT_SETTLE_MS.
  await sleep(POINT_SETTLE_MS);
  const point = await capture(page, screen, 'punkt');
  point.notes.push(...pointNotes);
  if (point.state && point.state.phase !== 'point' && point.state.phase !== 'set-over') {
    point.notes.push(`oczekiwana faza point, jest ${point.state.phase}`);
  }
  shots.push(point);

  return version;
}

async function capture(page: Page, screen: string, name: ShotName): Promise<Shot> {
  const absolute = join(ROOT, 'docs', 'zrzuty', `f0-${screen}-${name}.png`);
  const shot: Shot = {
    screen,
    name,
    file: relative(ROOT, absolute).replaceAll('\\', '/'),
    taken: false,
    state: null,
    notes: [],
  };
  try {
    shot.state = await snapshot(page);
    // Playwright tworzy brakujące katalogi w ścieżce zrzutu.
    await page.screenshot({ path: absolute });
    shot.taken = true;
  } catch (err) {
    shot.notes.push(`zrzut nieudany: ${err instanceof Error ? err.message : String(err)}`);
  }
  return shot;
}

function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const s = window.__sw3d!.state();
    return {
      tick: s.tick,
      phase: s.rally.phase,
      points: s.score.points,
      active: s.active,
      held: s.ball.held,
      humanControl: s.humanControl,
      lastContact: s.lastContact
        ? { kind: s.lastContact.kind, player: s.lastContact.player, touchNo: s.lastContact.touchNo }
        : null,
      pointReason: s.rally.pointReason,
    };
  });
}

main().catch(fail);
