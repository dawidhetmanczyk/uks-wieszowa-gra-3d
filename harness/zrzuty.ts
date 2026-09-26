/**
 * Zrzuty ekranu do raportu fazy F0b (docs/21 F0b): telefon w pionie 390 × 844 @2× (główny
 * tryb) i w poziomie 844 × 390 @2×. Gra w trybie asysty z człowiekiem – harness stuka jak
 * dziecko, gdy piłka dolatuje (asysta sama prowadzi zawodnika do pierścienia):
 *  - serwis: gracz trzyma piłkę, HUD „Stuknij, żeby zaserwować” i podpowiedź samouczka;
 *  - wymiana: serwis rywali w locie, aktywny biegnie do pierścienia „tu stań”;
 *  - atak-skok: po naszym przyjęciu partner wystawił – szansa na atak przy siatce:
 *    pierścień jasnoniebieski i napis „Stuknij – skok sam” (decyzja Dawida 5).
 *
 * Pliki lądują w docs/zrzuty/ (prefiks f0b-) i idą do repo – „czytelne” z CLAUDE.md znaczy
 * „zrzut w docelowym rozmiarze”, więc nazwa niesie rozmiar ekranu.
 *
 * Chromium bez limitu klatek (jak perf): z vsync przy wygaszonym monitorze pętla rysuje raz
 * na sekundę. `--vsync` przywraca limit.
 *
 * Użycie: pnpm harness:zrzuty [--url <adres>] [--headless] [--vsync] [--build]
 */
import { join, relative } from 'node:path';
import type { Browser, Page } from 'playwright';
import type { ContextSpec, HitKind, Phase, PlayerId } from './wspolne';
import {
  ROOT,
  ensureServer,
  fail,
  landscapeSpec,
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

/** Seedy prób: pierwszy, w którym przyjęcie i wystawa się udadzą, daje zrzut ataku. */
const SEEDS = [11, 12, 13, 14, 15, 16, 17, 18];
/** Zrzut serwisu po chwili – kamera zdąży dojechać, HUD się narysować. */
const SERVE_SETTLE_MS = 700;
const RESET_TIMEOUT_MS = 2000;
/** AI serwuje po 1 s; wymiana z przyjęciem i wystawą mieści się w kilku sekundach. */
const PHASE_TIMEOUT_MS = 8000;
const POLL_MS = 10;
/** Stuknięcie, gdy piłka za tyle sekund wejdzie w zasięg aktywnego (środek skutecznego okna). */
const TAP_LEAD_S = 0.05;
/** Zrzut wymiany, gdy piłka jest jeszcze tyle sekund od zasięgu – w locie, pierścień widać. */
const RALLY_SHOT_LEAD_S = 0.55;
/** Zrzut ataku, gdy piłka z wystawy jest tyle sekund od zasięgu – w powietrzu nad siatką. */
const ATTACK_SHOT_LEAD_S = 0.45;

type ShotName = 'serwis' | 'wymiana' | 'atak-skok';

interface Snapshot {
  tick: number;
  phase: Phase;
  points: [number, number];
  active: PlayerId;
  held: PlayerId | -1;
  assist: boolean;
  jumpChance: boolean;
  tempo: number;
  tutorial: string | null;
  lastContact: { kind: HitKind; player: PlayerId; touchNo: number } | null;
}

interface Shot {
  screen: string;
  name: ShotName;
  file: string;
  taken: boolean;
  seed: number | null;
  state: Snapshot | null;
  notes: string[];
}

async function main(): Promise<void> {
  const args = parseArgs();
  const server = await ensureServer(args);
  const shots: Shot[] = [];
  const errorsByScreen: Record<string, string[]> = {};
  let version = '?';
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser(args.headless, { uncappedFrameRate: !args.vsync });
    for (const spec of [mobileSpec(2), landscapeSpec(2)]) {
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
    shots,
    errors: errorsByScreen,
  };
  const file = writeResult('zrzuty', result);

  console.log('');
  console.log('=== Harness zrzuty – Set Wieszowa 3D F0b ===');
  console.log(`Tryb: ${result.mode}; gra ${version}`);
  for (const s of shots) {
    const st = s.state;
    const desc = st
      ? `seed ${s.seed}, faza ${st.phase}, wynik ${st.points[0]}:${st.points[1]}, tick ${st.tick}, ` +
        `tempo ${st.tempo.toFixed(2)}, szansa skoku ${st.jumpChance ? 'tak' : 'nie'}` +
        (st.lastContact
          ? `, ostatni kontakt ${st.lastContact.kind} (${st.lastContact.player})`
          : '') +
        (st.tutorial ? `, samouczek: ${st.tutorial}` : '')
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

/** Czeka, aż funkcja stanu zwróci true (odpytywanie co POLL_MS); false po czasie. */
async function waitFor(page: Page, fn: string, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await page.evaluate(fn);
    if (ok) return true;
    await sleep(POLL_MS);
  }
  return false;
}

/** Wyrażenie: piłka leci do aktywnego i wejdzie w jego zasięg za ≤ `lead` s. */
function approaching(lead: number): string {
  return `(() => {
    const h = window.__sw3d;
    const s = h.state();
    if (s.rally.phase !== 'rally' || s.rally.lastToucher === s.active) return false;
    if (!s.landing.valid || s.landing.pos.z >= 0) return false;
    const w = h.reachWindow(s.active);
    return w !== null && w.enterInS <= ${lead} && w.exitInS > 0;
  })()`;
}

async function tap(page: Page, spec: ContextSpec): Promise<void> {
  await page.touchscreen.tap(Math.round(spec.width / 2), Math.round(spec.height * 0.72));
}

/** Zrzuty dla jednego rozmiaru ekranu; zwraca wersję gry. */
async function captureScreen(
  page: Page,
  spec: ContextSpec,
  screen: string,
  baseUrl: string,
  shots: Shot[],
): Promise<string> {
  const first = SEEDS[0] ?? 11;
  const url = withQuery(baseUrl, { seed: first });
  console.log(`Otwieram ${url} – ${specLabel(spec)}`);
  await page.goto(url);
  const version = await waitForHooks(page);

  // 1. Serwis: człowiek serwuje, nikt nie stuknął – gracz trzyma piłkę, HUD i samouczek.
  await sleep(SERVE_SETTLE_MS);
  const serve = await capture(page, screen, 'serwis', first);
  if (serve.state && serve.state.phase !== 'serve') {
    serve.notes.push(`oczekiwana faza serve, jest ${serve.state.phase}`);
  }
  shots.push(serve);

  // 2–3. Serwują rywale; harness stuka przy przyjęciu. Seed po seedzie, aż wyjdzie atak.
  let rallyShot: Shot | null = null;
  let attackShot: Shot | null = null;
  const tried: string[] = [];
  for (const seed of SEEDS) {
    await page.evaluate(
      (s) => window.__sw3d!.newSet({ seed: s, servingTeam: 1, humanControl: true }),
      seed,
    );
    await waitFor(
      page,
      `window.__sw3d.state().seed === ${seed} && window.__sw3d.state().rally.phase === 'serve'`,
      RESET_TIMEOUT_MS,
    );
    if (!(await waitFor(page, approaching(RALLY_SHOT_LEAD_S), PHASE_TIMEOUT_MS))) {
      tried.push(`seed ${seed}: serwis nie doleciał do aktywnego`);
      continue;
    }
    if (rallyShot === null) rallyShot = await capture(page, screen, 'wymiana', seed);
    if (!(await waitFor(page, approaching(TAP_LEAD_S), PHASE_TIMEOUT_MS))) {
      tried.push(`seed ${seed}: piłka nie weszła w zasięg`);
      continue;
    }
    await tap(page, spec);
    // Partner wystawia; czekamy na szansę ataku i piłkę w powietrzu nad siatką.
    const chance = await waitFor(
      page,
      `(() => { const h = window.__sw3d; if (!h.jumpChance()) return false;
        const w = h.reachWindow(h.state().active); return w !== null && w.enterInS <= ${ATTACK_SHOT_LEAD_S}; })()`,
      PHASE_TIMEOUT_MS,
    );
    if (!chance) {
      tried.push(`seed ${seed}: brak szansy na atak (przyjęcie/wystawa nie wyszły)`);
      continue;
    }
    attackShot = await capture(page, screen, 'atak-skok', seed);
    break;
  }
  if (rallyShot === null) {
    rallyShot = emptyShot(screen, 'wymiana');
    rallyShot.notes.push(...tried);
  }
  shots.push(rallyShot);
  if (attackShot === null) {
    attackShot = emptyShot(screen, 'atak-skok');
    attackShot.notes.push(...tried);
  } else {
    if (tried.length > 0) attackShot.notes.push(...tried);
    if (attackShot.state && !attackShot.state.jumpChance) {
      attackShot.notes.push('w chwili zrzutu szansa skoku już zgasła');
    }
  }
  shots.push(attackShot);
  return version;
}

function shotPath(screen: string, name: ShotName): string {
  return join(ROOT, 'docs', 'zrzuty', `f0b-${screen}-${name}.png`);
}

function emptyShot(screen: string, name: ShotName): Shot {
  return {
    screen,
    name,
    file: relative(ROOT, shotPath(screen, name)).replaceAll('\\', '/'),
    taken: false,
    seed: null,
    state: null,
    notes: [],
  };
}

async function capture(page: Page, screen: string, name: ShotName, seed: number): Promise<Shot> {
  const shot = emptyShot(screen, name);
  shot.seed = seed;
  try {
    shot.state = await snapshot(page);
    // Playwright tworzy brakujące katalogi w ścieżce zrzutu.
    await page.screenshot({ path: shotPath(screen, name) });
    shot.taken = true;
  } catch (err) {
    shot.notes.push(`zrzut nieudany: ${err instanceof Error ? err.message : String(err)}`);
  }
  return shot;
}

function snapshot(page: Page): Promise<Snapshot> {
  return page.evaluate(() => {
    const h = window.__sw3d!;
    const s = h.state();
    return {
      tick: s.tick,
      phase: s.rally.phase,
      points: s.score.points,
      active: s.active,
      held: s.ball.held,
      assist: s.assist,
      jumpChance: h.jumpChance(),
      tempo: h.tempo(),
      tutorial: h.tutorial()?.current ?? null,
      lastContact: s.lastContact
        ? { kind: s.lastContact.kind, player: s.lastContact.player, touchNo: s.lastContact.touchNo }
        : null,
    };
  });
}

main().catch(fail);
