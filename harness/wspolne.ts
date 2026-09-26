/**
 * Wspólny szkielet harnessu Playwright (docs/22 §8): argumenty CLI, serwer
 * podglądu, przeglądarka, haki deweloperskie, zapis wyników, statystyki.
 *
 * Harness celowo nie importuje nic z `src/`: tsconfig.node.json obejmuje tylko
 * `harness/` i `vite.config.ts`, a wciągnięcie `src/sim` pociągnęłoby za sobą
 * typy `vite/client` do skryptów Node. Dlatego typ haków (docs/22 §1) i PRNG
 * mulberry32 (src/sim/prng.ts) są tu skopiowane. Gdy zmienia się kontrakt,
 * trzeba zmienić oba miejsca – to świadomy koszt izolacji.
 */
import type { ChildProcess } from 'node:child_process';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Browser, BrowserContext, Page } from 'playwright';
import { chromium } from 'playwright';

// Typy kontraktu (podzbiór src/sim/types.ts czytany przez harness) ----------

/** 0 = niebiescy (gracz + partner, połowa z < 0), 1 = czerwoni. */
export type TeamId = 0 | 1;
/** 0 = gracz, 1 = partner-AI, 2 i 3 = rywale-AI. */
export type PlayerId = 0 | 1 | 2 | 3;
export type Phase = 'serve' | 'rally' | 'point' | 'set-over';
export type HitKind = 'serve' | 'receive' | 'set' | 'attack' | 'passive';

export interface Vec2 {
  x: number;
  z: number;
}

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface ContactInfo {
  tick: number;
  player: PlayerId;
  kind: HitKind;
  quality: number;
  touchNo: number;
  target: Vec2;
  power: number;
}

export interface LandingPrediction {
  valid: boolean;
  pos: Vec2;
  tick: number;
  hitsNet: boolean;
  /** Gdzie opadająca piłka przecina wysokość przyjęcia (1,1 m) – tam się dobiega. */
  intercept: Vec2;
  interceptTick: number;
}

/**
 * Podzbiór SimState, którego harness dotyka. `state()` zwraca pełny obiekt,
 * więc typ węższy jest strukturalnie zgodny; nie kopiujemy całości, żeby
 * nie dublować pól, których nikt tu nie czyta.
 */
export interface SimStateView {
  tick: number;
  seed: number;
  players: [PlayerView, PlayerView, PlayerView, PlayerView];
  ball: { pos: Vec3; held: PlayerId | -1 };
  rally: {
    phase: Phase;
    phaseTick: number;
    servingTeam: TeamId;
    server: PlayerId;
    touches: number;
    lastToucher: PlayerId | -1;
    pointWinner: TeamId | -1;
    pointReason: string | null;
  };
  score: { points: [number, number]; setWinner: TeamId | -1 };
  active: PlayerId;
  humanControl: boolean;
  /** F0b: tryb asysty (false = pełne F0 pod ?sterowanie=reczne albo AI vs AI). */
  assist: boolean;
  landing: LandingPrediction;
  lastContact: ContactInfo | null;
}

export interface PlayerView {
  id: PlayerId;
  team: TeamId;
  pos: Vec3;
  /** Tick otwarcia okna zamachu; -1 = brak – harness odczytuje z niego chwilę tapu. */
  swingStartTick: number;
  grounded: boolean;
}

/** Haki deweloperskie na `window.__sw3d` – identyczne z docs/22 §1. */
export interface DevHooks {
  version: string;
  /** Żywa referencja, tylko do odczytu. */
  state(): SimStateView;
  newSet(opts?: { seed?: number; servingTeam?: TeamId; humanControl?: boolean }): void;
  /** Czasy klatek w ms (delta rAF), bufor 16384 (FRAME_TIME_CAPACITY w src/loop/petla.ts). */
  frameTimes(): number[];
  resetFrameTimes(): void;
  renderInfo(): { calls: number; triangles: number; programs: number };
  /** Okno zasięgu względem teraz (sekundy); null = piłka nie wejdzie w zasięg. */
  reachWindow(player: PlayerId): { enterInS: number; exitInS: number } | null;
  /**
   * Opcje renderu (rozdzielczość, cienie, postprocess…) – opcjonalne, bo docs/22 §1 ich nie
   * wymaga; gdy warstwa render je wystawi, perf zapisuje je do JSON, żeby liczby fps dało się
   * porównać między uruchomieniami z różnymi ustawieniami. Przyjmujemy funkcję albo obiekt.
   */
  renderOptions?: Record<string, unknown> | (() => Record<string, unknown>);
  /** Statystyka kadru od ostatniego resetFraming() – patrz FramingStats. */
  framing(): FramingStats;
  resetFraming(): void;
  /** Stopy zawodnika w pikselach CSS okna (ostatnia klatka) albo null przed pierwszą klatką. */
  screenPos(player: PlayerId): { x: number; y: number } | null;
  /** F0b: 'assist' albo 'manual' (?sterowanie=reczne). */
  controlMode(): 'assist' | 'manual';
  /** F0b: tempo pętli (1 albo w stronę 0,6 tuż przed kontaktem aktywnego). */
  tempo(): number;
  /** F0b: czy ruchem steruje palec (asysta czeka). */
  manualSteering(): boolean;
  /** F0b: szansa na atak ze skokiem (pierścień jasnoniebieski, napis w HUD). */
  jumpChance(): boolean;
  /** F0b: liczniki samouczka; null w trybie ręcznym. */
  tutorial(): { counts: Record<'tap' | 'flick' | 'jump', number>; current: string | null } | null;
  /** F0b: czy po pierwszym dotyku poszła prośba o pełny ekran. */
  fullscreenRequested(): boolean;
  /** F0b: widoczny prostokąt okna (visualViewport) w px CSS. */
  viewport(): { width: number; height: number; top: number; left: number };
}

/**
 * Kadr zliczany przez render co klatkę (docs/22 §7): czy zawodnicy mieszczą się w oknie.
 * „Cały” = stopy i głowa kapsuły z promieniem po obu bokach wewnątrz okna.
 */
export interface FramingStats {
  frames: number;
  /** Klatki, w których OBAJ zawodnicy drużyny gracza (0 i 1) są w kadrze w całości. */
  team0Full: number;
  /** Klatki, w których obaj są w kadrze choć częściowo. */
  team0Partial: number;
  /** Klatki „cały w kadrze” per zawodnik 0..3. */
  playerFull: [number, number, number, number];
  /** Klatki z piłką w kadrze. */
  ballIn: number;
  /** Najmniejszy zapas (px CSS) skrajnego punktu kapsuł 0 i 1 do krawędzi okna; < 0 = wyszedł. */
  minMarginPx: number;
  /** Wysokość kapsuły gracza w px CSS – średnia z klatek (miara „jak duży jest zawodnik”). */
  meanPlayerHeightPx: number;
  width: number;
  height: number;
}

declare global {
  interface Window {
    __sw3d?: DevHooks;
  }
}

/** Rozmiar bufora czasów klatek w hakach – po jego zapełnieniu pomiar jest ucięty. */
export const FRAME_BUFFER = 16384;
export const TICK_HZ = 120;

// Argumenty CLI --------------------------------------------------------------

export interface HarnessArgs {
  /** Gdy podany, nie startujemy własnego serwera. */
  url: string | null;
  /** Domyślnie headed: headless Chromium renderuje WebGL przez SwiftShader i fps są niemiarodajne. */
  headless: boolean;
  /** Wymuś `pnpm build` nawet gdy dist/ istnieje. */
  build: boolean;
  /**
   * Zostaw limit klatek przeglądarki (vsync). Domyślnie perf, przyjęcie i zrzuty go zdejmują:
   * perf, bo delta rAF przycięta do okresu odświeżania ekranu mierzy monitor, nie koszt klatki;
   * przyjęcie i zrzuty, bo przy wygaszonym monitorze (Windows po bezczynności) Chromium z vsync
   * rysuje raz na sekundę i pomiar traci sens.
   */
  vsync: boolean;
  sekundy: number | null;
  proby: number | null;
  seed: number | null;
  /** Rozmiar okna „SZERxWYS” (np. 844x390) – nadpisuje domyślny ekran skryptu. */
  ekran: { width: number; height: number } | null;
  /** F0b: pełne sterowanie F0 (?sterowanie=reczne) zamiast asysty – pomiar „przed”. */
  reczne: boolean;
}

const FLAGS = new Set(['headless', 'build', 'vsync', 'reczne']);
const VALUES = new Set(['url', 'sekundy', 'proby', 'seed', 'ekran']);

export function parseArgs(argv: readonly string[] = process.argv.slice(2)): HarnessArgs {
  const args: HarnessArgs = {
    url: null,
    headless: false,
    build: false,
    vsync: false,
    sekundy: null,
    proby: null,
    seed: null,
    ekran: null,
    reczne: false,
  };
  const raw = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === undefined || !token.startsWith('--')) {
      console.warn(`Pomijam nieznany argument: ${token}`);
      continue;
    }
    const eq = token.indexOf('=');
    const name = eq >= 0 ? token.slice(2, eq) : token.slice(2);
    if (FLAGS.has(name)) {
      raw.set(name, true);
    } else if (VALUES.has(name)) {
      const next = eq >= 0 ? token.slice(eq + 1) : argv[i + 1];
      if (next === undefined || (eq < 0 && next.startsWith('--'))) {
        throw new Error(`Argument --${name} wymaga wartości`);
      }
      if (eq < 0) i++;
      raw.set(name, next);
    } else {
      console.warn(`Pomijam nieznany argument: ${token}`);
    }
  }
  const num = (name: string): number | null => {
    const v = raw.get(name);
    if (v === undefined || v === true) return null;
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`--${name} musi być liczbą, dostałem „${v}”`);
    return n;
  };
  const url = raw.get('url');
  args.url = typeof url === 'string' ? url : null;
  args.headless = raw.get('headless') === true;
  args.build = raw.get('build') === true;
  args.vsync = raw.get('vsync') === true;
  args.reczne = raw.get('reczne') === true;
  args.sekundy = num('sekundy');
  args.proby = num('proby');
  args.seed = num('seed');
  const ekran = raw.get('ekran');
  if (typeof ekran === 'string') {
    const m = /^(\d{3,4})x(\d{3,4})$/.exec(ekran.trim());
    if (!m) throw new Error(`--ekran ma postać SZERxWYS, np. 844x390; dostałem „${ekran}”`);
    args.ekran = { width: Number(m[1]), height: Number(m[2]) };
  }
  return args;
}

/** Opis trybu do raportu – w headless fps nie są miarodajne, więc zawsze to zapisujemy. */
export function modeLabel(headless: boolean): string {
  return headless ? 'headless (SwiftShader – fps niemiarodajne)' : 'headed (GPU)';
}

// Serwer podglądu -----------------------------------------------------------

/** Katalog repo – harness leży w <repo>/harness/. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Własny port harnessu, nie domyślny 4173 Vite: na tej samej maszynie równolegle
 * pracują repo gry 2D i strony, oba na Vite. Na wspólnym porcie `--strictPort`
 * odmówiłby startu, a pętla oczekiwania dostałaby odpowiedź OBCEGO serwera i harness
 * zmierzyłby cudzą grę. Dodatkowo port jest sprawdzany przed startem – patrz ensureServer.
 */
const PREVIEW_PORT = 4317;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}/`;
const SERVER_START_TIMEOUT_MS = 30_000;
const PORT_PROBE_TIMEOUT_MS = 1500;

/** Czy coś już odpowiada pod adresem – wtedy to nie nasz serwer. */
async function somethingListens(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(PORT_PROBE_TIMEOUT_MS) });
    return true;
  } catch {
    return false;
  }
}

export interface ServerHandle {
  url: string;
  /** false = użyto --url, nic nie uruchamialiśmy. */
  started: boolean;
  stop(): Promise<void>;
}

/**
 * Gdy brak --url: buduje (jeśli trzeba) i uruchamia `vite preview` na stałym
 * porcie. Preview zamiast dev-serwera, bo mierzymy zbudowany bundle – HMR i
 * nieminifikowany kod zafałszowałyby fps.
 */
export async function ensureServer(args: HarnessArgs): Promise<ServerHandle> {
  if (args.url) {
    return { url: args.url, started: false, stop: async () => {} };
  }
  const distIndex = join(ROOT, 'dist', 'index.html');
  if (args.build || !existsSync(distIndex)) {
    console.log(args.build ? 'Buduję (--build): pnpm build' : 'Brak dist/index.html – pnpm build');
    // shell: true, bo na Windows pnpm to skrypt .cmd, nie plik wykonywalny.
    const build = spawnSync('pnpm build', { cwd: ROOT, shell: true, stdio: 'inherit' });
    if (build.status !== 0) {
      throw new Error(`pnpm build zakończył się kodem ${String(build.status)}`);
    }
  }

  if (await somethingListens(PREVIEW_URL)) {
    // Nie podpinamy się i niczego nie zabijamy: proces na tym porcie może należeć do innej
    // sesji na tej maszynie. Harness zabija wyłącznie drzewo procesów, które sam uruchomił.
    throw new Error(
      `Port ${PREVIEW_PORT} jest już zajęty przez inny serwer – nie mierzę cudzej strony. ` +
        `Zwolnij port albo podaj --url <adres naszego podglądu>.`,
    );
  }

  const child = spawn(`pnpm exec vite preview --port ${PREVIEW_PORT} --strictPort`, {
    cwd: ROOT,
    shell: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  const output: string[] = [];
  child.stdout?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  child.stderr?.on('data', (chunk: Buffer) => output.push(chunk.toString()));
  let exitCode: number | null = null;
  let exited = false;
  child.on('exit', (code) => {
    exited = true;
    exitCode = code;
  });

  // Ctrl+C w trakcie pomiaru: bez tego node kończy się, a cmd → pnpm → vite zostają
  // i trzymają port do następnego uruchomienia. Kod 130 = przerwane sygnałem.
  const onSigint = (): void => {
    killTree(child);
    process.exit(130);
  };
  process.once('SIGINT', onSigint);

  const handle: ServerHandle = {
    url: PREVIEW_URL,
    started: true,
    stop: async () => {
      process.off('SIGINT', onSigint);
      killTree(child);
    },
  };

  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited) {
      // Najczęściej: port zajęty (--strictPort) między sprawdzeniem a startem. Nie
      // podpinamy się pod obcy serwer, bo mógłby serwować co innego – lepiej odmówić.
      throw new Error(
        `vite preview zakończył się (kod ${String(exitCode)}) przed startem:\n${output.join('')}` +
          `\nJeśli port ${PREVIEW_PORT} jest zajęty, podaj --url <adres> albo zwolnij port.`,
      );
    }
    try {
      const res = await fetch(PREVIEW_URL);
      if (res.ok) {
        console.log(`Serwer podglądu gotowy: ${PREVIEW_URL}`);
        return handle;
      }
    } catch {
      // jeszcze nie słucha
    }
    await sleep(250);
  }
  process.off('SIGINT', onSigint);
  killTree(child);
  throw new Error(
    `Serwer nie odpowiedział w ${SERVER_START_TIMEOUT_MS / 1000} s:\n${output.join('')}`,
  );
}

function killTree(child: ChildProcess): void {
  if (child.pid === undefined || child.exitCode !== null) return;
  if (process.platform === 'win32') {
    // child.kill() ubija tylko cmd.exe ze `shell: true`; pnpm → node vite zostają
    // i trzymają port. taskkill /T zabija całe drzewo.
    spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' });
  } else {
    child.kill('SIGTERM');
  }
}

// Przeglądarka ---------------------------------------------------------------

export interface ContextSpec {
  width: number;
  height: number;
  deviceScaleFactor: number;
  isMobile: boolean;
  hasTouch: boolean;
}

/** Telefon w pionie, 390 × 844 – ekran budżetu z CLAUDE.md i główny tryb gry na telefonie (F0b). */
export function mobileSpec(deviceScaleFactor: number): ContextSpec {
  return { width: 390, height: 844, deviceScaleFactor, isMobile: true, hasTouch: true };
}

/** Ten sam telefon w poziomie, 844 × 390. */
export function landscapeSpec(deviceScaleFactor: number): ContextSpec {
  return { width: 844, height: 390, deviceScaleFactor, isMobile: true, hasTouch: true };
}

/** Telefon o rozmiarze z --ekran (SZERxWYS) albo domyślny skryptu. */
export function phoneSpec(
  args: HarnessArgs,
  fallback: ContextSpec,
  deviceScaleFactor = fallback.deviceScaleFactor,
): ContextSpec {
  if (!args.ekran) return fallback;
  return { ...args.ekran, deviceScaleFactor, isMobile: true, hasTouch: true };
}

/** Parametry adresu trybu sterowania: tryb ręczny (pełne F0) albo nic (asysta F0b). */
export function controlQuery(reczne: boolean): Record<string, string> {
  return reczne ? { sterowanie: 'reczne' } : {};
}

export const DESKTOP_SPEC: ContextSpec = {
  width: 1280,
  height: 720,
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
};

export interface LaunchOptions {
  /**
   * Zdejmij limit klatek: rAF przestaje czekać na odświeżenie ekranu, więc delta rAF
   * to koszt klatki, a nie okres monitora (na 175 Hz to 5,7 ms niezależnie od gry).
   * Przy okazji uniezależnia pętlę od stanu monitora: 2026-09-25 przy wygaszonym ekranie
   * Chromium z vsync dawał klatki po 1011 ms (39 z 50 prób przyjęcia do wyrzucenia).
   */
  uncappedFrameRate?: boolean;
}

export async function launchBrowser(headless: boolean, opts: LaunchOptions = {}): Promise<Browser> {
  // Bez tych flag Chromium pod Playwrightem potrafi wpaść na SwiftShader
  // nawet w trybie headed – wtedy mierzymy CPU, nie GPU.
  const args = [
    '--use-angle=default',
    '--enable-gpu',
    '--ignore-gpu-blocklist',
    // Okno harnessu zwykle leży pod innymi oknami – bez tych flag Chromium dławi rAF
    // i timery zasłoniętej karty, a sim nadrabia po 30 kroków na klatkę (pomiar timingu
    // i zrzuty tracą sens: w jednym przebiegu 32 z 50 prób miało taki przystanek).
    '--disable-backgrounding-occluded-windows',
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
  ];
  if (opts.uncappedFrameRate) args.push('--disable-gpu-vsync', '--disable-frame-rate-limit');
  return chromium.launch({ headless, args });
}

export interface PageHandle {
  context: BrowserContext;
  page: Page;
  /** console.error i nieobsłużone wyjątki strony – trafiają do raportu. */
  errors: string[];
}

export async function openPage(browser: Browser, spec: ContextSpec): Promise<PageHandle> {
  const context = await browser.newContext({
    viewport: { width: spec.width, height: spec.height },
    deviceScaleFactor: spec.deviceScaleFactor,
    isMobile: spec.isMobile,
    hasTouch: spec.hasTouch,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text()}`);
  });
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  // console.error „Failed to load resource” nie niesie adresu – odpowiedź HTTP już tak.
  page.on('response', (res) => {
    if (res.status() >= 400) errors.push(`http ${res.status()}: ${res.url()}`);
  });
  return { context, page, errors };
}

const HOOKS_TIMEOUT_MS = 20_000;

/** Czeka na `window.__sw3d` i zwraca wersję gry. */
export async function waitForHooks(page: Page): Promise<string> {
  await page.waitForFunction(() => window.__sw3d !== undefined, undefined, {
    timeout: HOOKS_TIMEOUT_MS,
  });
  return page.evaluate(() => window.__sw3d!.version);
}

export function withQuery(base: string, params: Record<string, string | number>): string {
  const u = new URL(base);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, String(v));
  return u.toString();
}

export function specLabel(spec: ContextSpec): string {
  return `${spec.width}×${spec.height} @${spec.deviceScaleFactor}×${spec.isMobile ? ' mobile' : ''}`;
}

// Wyniki ----------------------------------------------------------------------

export function resultsDir(): string {
  const dir = join(ROOT, 'harness', 'wyniki');
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** Znacznik czasu do nazwy pliku (czas lokalny, bez dwukropków – Windows). */
export function stamp(d: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}-${p(d.getMinutes())}-${p(d.getSeconds())}`
  );
}

export function writeResult(prefix: string, data: unknown): string {
  const file = join(resultsDir(), `${prefix}-${stamp()}.json`);
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
  return file;
}

// Statystyki i format ----------------------------------------------------------

/** Percentyl metodą najbliższej rangi na posortowanej rosnąco tablicy. */
export function percentile(sortedAsc: readonly number[], p: number): number {
  const n = sortedAsc.length;
  if (n === 0) return NaN;
  const rank = Math.min(n - 1, Math.max(0, Math.ceil((p / 100) * n) - 1));
  return sortedAsc[rank] ?? NaN;
}

export function mean(xs: readonly number[]): number {
  if (xs.length === 0) return NaN;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

/** Liczba w polskim zapisie (przecinek dziesiętny). */
export function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return 'brak';
  return n.toFixed(digits).replace('.', ',');
}

/** Liczba całkowita z odstępami tysięcy (12 345). */
export function fmtInt(n: number): string {
  if (!Number.isFinite(n)) return 'brak';
  return Math.round(n)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function passFail(ok: boolean): 'PASS' | 'FAIL' {
  return ok ? 'PASS' : 'FAIL';
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Wypisuje błąd i ustawia kod wyjścia 1 – tylko dla awarii infrastruktury, nie dla FAIL progów. */
export function fail(err: unknown): void {
  console.error('Harness przerwany:', err instanceof Error ? err.message : String(err));
  process.exitCode = 1;
}

// PRNG mulberry32 (kopia src/sim/prng.ts) -----------------------------------

export interface RngHolder {
  rng: number;
}

const UINT32 = 4294967296;

export function seedRng(seed: number): number {
  let s = (seed | 0) >>> 0;
  s = (s ^ 0x9e3779b9) >>> 0;
  s = Math.imul(s ^ (s >>> 16), 0x85ebca6b) >>> 0;
  s = Math.imul(s ^ (s >>> 13), 0xc2b2ae35) >>> 0;
  return (s ^ (s >>> 16)) >>> 0;
}

export function nextUint32(holder: RngHolder): number {
  holder.rng = (holder.rng + 0x6d2b79f5) >>> 0;
  let t = holder.rng;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return (t ^ (t >>> 14)) >>> 0;
}

export function nextFloat(holder: RngHolder): number {
  return nextUint32(holder) / UINT32;
}
