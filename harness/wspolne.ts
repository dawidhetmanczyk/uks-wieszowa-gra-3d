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
  landing: LandingPrediction;
  lastContact: ContactInfo | null;
}

export interface PlayerView {
  id: PlayerId;
  team: TeamId;
  pos: Vec3;
  /** Tick otwarcia okna zamachu; -1 = brak – harness odczytuje z niego chwilę tapu. */
  swingStartTick: number;
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
  sekundy: number | null;
  proby: number | null;
  seed: number | null;
}

const FLAGS = new Set(['headless', 'build']);
const VALUES = new Set(['url', 'sekundy', 'proby', 'seed']);

export function parseArgs(argv: readonly string[] = process.argv.slice(2)): HarnessArgs {
  const args: HarnessArgs = {
    url: null,
    headless: false,
    build: false,
    sekundy: null,
    proby: null,
    seed: null,
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
  args.sekundy = num('sekundy');
  args.proby = num('proby');
  args.seed = num('seed');
  return args;
}

/** Opis trybu do raportu – w headless fps nie są miarodajne, więc zawsze to zapisujemy. */
export function modeLabel(headless: boolean): string {
  return headless ? 'headless (SwiftShader – fps niemiarodajne)' : 'headed (GPU)';
}

// Serwer podglądu -----------------------------------------------------------

/** Katalog repo – harness leży w <repo>/harness/. */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PREVIEW_PORT = 4173;
const PREVIEW_URL = `http://localhost:${PREVIEW_PORT}/`;
const SERVER_START_TIMEOUT_MS = 30_000;

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

  const handle: ServerHandle = {
    url: PREVIEW_URL,
    started: true,
    stop: async () => {
      killTree(child);
    },
  };

  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (exited) {
      // Najczęściej: port 4173 zajęty (--strictPort). Nie podpinamy się pod obcy
      // serwer, bo mógłby serwować stary build – lepiej wyraźnie odmówić.
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

export function mobileSpec(deviceScaleFactor: number): ContextSpec {
  return { width: 390, height: 844, deviceScaleFactor, isMobile: true, hasTouch: true };
}

export const DESKTOP_SPEC: ContextSpec = {
  width: 1280,
  height: 720,
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
};

export async function launchBrowser(headless: boolean): Promise<Browser> {
  return chromium.launch({
    headless,
    // Bez tych flag Chromium pod Playwrightem potrafi wpaść na SwiftShader
    // nawet w trybie headed – wtedy mierzymy CPU, nie GPU.
    args: ['--use-angle=default', '--enable-gpu', '--ignore-gpu-blocklist'],
  });
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
