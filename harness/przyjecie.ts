/**
 * Przyjęcie serwisu dotknięciem (docs/22 §8): N prób, każda = nowy set z serwisem
 * rywali, dobieg do przewidywanego punktu przyjęcia i tap w losowym momencie okna
 * [wejście w zasięg − 0,25 s, wejście + 0,25 s].
 *
 * Okno jest symetryczne wokół chwili wejścia piłki w zasięg, bo model uderzenia to
 * „przytrzymaj do kontaktu”: wcześniejsze naciśnięcie jest poprawne (tap daje 0,12 s
 * łaski), a późniejsze kończy się biernym odbiciem od kapsuły – piłka od wejścia
 * w zasięg do ciała leci ok. 60 ms. Histogram po koszach 50 ms pokazuje, które
 * opóźnienia trafiają – to jest miara wybaczalności sterowania dla bramy F0.
 *
 * Dobieg idzie przez prawdziwą warstwę wejścia (klawisze WASD, jak gracz na
 * klawiaturze), bo serwis AI „między rywalami” ląduje ok. 1,8 m od odbierającego,
 * a zasięg stojącego to 0,95 m – bez ruchu żadne przyjęcie nie jest możliwe
 * i pomiar mówiłby o celowaniu AI, nie o oknie uderzenia. Tap idzie przez dotyk
 * (touchscreen.tap), czyli tak, jak na telefonie. „Brak zasięgu” zostaje osobnym
 * powodem porażki: dobieg nie zdążył albo okno nie pojawiło się przed lądowaniem.
 *
 * Użycie: pnpm harness:przyjecie [--url <adres>] [--headless] [--proby 50] [--seed 7] [--build]
 */
import type { Page } from 'playwright';
import type {
  HitKind,
  LandingPrediction,
  Phase,
  PlayerId,
  RngHolder,
  TeamId,
  Vec2,
} from './wspolne';
import {
  TICK_HZ,
  ensureServer,
  fail,
  fmt,
  launchBrowser,
  mean,
  mobileSpec,
  modeLabel,
  nextFloat,
  openPage,
  parseArgs,
  seedRng,
  sleep,
  specLabel,
  waitForHooks,
  withQuery,
  writeResult,
} from './wspolne';

const DEFAULT_ATTEMPTS = 50;
const DEFAULT_SEED = 7;
/** Seed seta = ATTEMPT_SEED_BASE + numer próby – ten sam serwis przy każdym uruchomieniu. */
const ATTEMPT_SEED_BASE = 1000;
/** Środek ekranu w dolnej połowie – tam, gdzie kciuk trzyma telefon w pionie. */
const TAP_X = 195;
const TAP_Y = 600;
/** Rozrzut tapu wokół wejścia w zasięg: [−TAP_SPREAD_MS, +TAP_SPREAD_MS). */
const TAP_SPREAD_MS = 250;
const RESET_TIMEOUT_MS = 2000;
/** AI serwuje po 1,0 s; 5 s to już awaria. */
const SERVE_TIMEOUT_MS = 5000;
const REACH_POLL_MS = 8;
const REACH_TIMEOUT_MS = 6000;
/**
 * Skok ticków sim między dwoma odczytami większy niż to = pętla renderu przystanęła
 * (okno w tle, obciążony CPU – pętla nadrabia do 30 kroków na klatkę). Tap i dobieg
 * są wtedy spóźnione nie z winy sterowania, więc próba jest liczona osobno.
 */
const STALL_TICKS = 12;
/** Dobieg: cel 0,15 m za punktem przyjęcia (`landing.intercept`, tor na 1,1 m), od strony własnej linii końcowej. */
const RUN_BEHIND_M = 0.15;
/** Poniżej tej odległości od celu dobiegu klawisze idą w górę (hamowanie sim dokończy). */
const RUN_STOP_M = 0.3;
/** Oś, na której różnica jest mniejsza, nie dostaje klawisza – bez drgania na skos. */
const RUN_DEADBAND_M = 0.2;
/** Po tapie kontakt następuje najpóźniej po 0,12 s (okno po puszczeniu); 0,6 s starczy, by tor się ustabilizował. */
const SETTLE_MS = 600;
const HIST_BIN_MS = 50;
const HIST_MIN_MS = -250;
const HIST_MAX_MS = 250;

type FailReason =
  'brak serwisu' | 'brak zasięgu' | 'whiff' | 'passive' | 'inny zawodnik' | 'siatka' | 'aut';

interface Attempt {
  index: number;
  seed: number;
  success: boolean;
  reason: FailReason | null;
  /** Pętla renderu przystanęła w trakcie próby (skok > STALL_TICKS między odczytami) – wynik niewiarygodny. */
  stalled: boolean;
  /** Wylosowane d – ile ms względem wejścia w zasięg miał paść tap (ujemne = przed). */
  plannedDelayMs: number;
  /** Faktyczne opóźnienie tapu względem wejścia w zasięg, z ticków sim. */
  tapDelayMs: number | null;
  /** Opóźnienie kontaktu względem wejścia w zasięg, z ticków sim. */
  contactDelayMs: number | null;
  activeAtTap: PlayerId | null;
  reach: { enterInS: number; exitInS: number } | null;
  contact: { player: PlayerId; kind: HitKind; quality: number; touchNo: number } | null;
  landing: LandingPrediction | null;
  /** Pozycja aktywnego przy ostatnim odczycie przed tapem – razem z `landing` tłumaczy „brak zasięgu”. */
  activePos: Vec2 | null;
  /** Odległość aktywnego od przewidywanego lądowania przy ostatnim odczycie. */
  distToLandingM: number | null;
  /** Ile zmian klawiszy zrobił dobieg (0 = zawodnik już stał w zasięgu). */
  runUpKeyChanges: number;
  phaseAfter: Phase | null;
  /** Powód punktu, gdy próba skończyła się punktem (np. floor-out = serwis w aut). */
  pointReason: string | null;
}

async function main(): Promise<void> {
  const args = parseArgs();
  const attemptsCount = args.proby ?? DEFAULT_ATTEMPTS;
  const harnessSeed = args.seed ?? DEFAULT_SEED;
  const spec = mobileSpec(2);

  // Wszystkie opóźnienia losujemy przed startem: rozkład w oknie jest wtedy
  // niezależny od tego, ile prób padło na „brak serwisu”.
  const rng: RngHolder = { rng: seedRng(harnessSeed) };
  const delays: number[] = [];
  for (let i = 0; i < attemptsCount; i++) delays.push((nextFloat(rng) * 2 - 1) * TAP_SPREAD_MS);

  const server = await ensureServer(args);
  const browser = await launchBrowser(args.headless);
  try {
    const { page, errors } = await openPage(browser, spec);
    const url = withQuery(server.url, {});
    console.log(`Otwieram ${url} – ${specLabel(spec)}, tryb ${modeLabel(args.headless)}`);
    await page.goto(url);
    const version = await waitForHooks(page);

    const attempts: Attempt[] = [];
    let resetWarned = false;

    for (let i = 0; i < attemptsCount; i++) {
      const seed = ATTEMPT_SEED_BASE + i;
      const plannedDelayMs = delays[i] ?? 0;
      const attempt: Attempt = {
        index: i,
        seed,
        success: false,
        reason: null,
        stalled: false,
        plannedDelayMs,
        tapDelayMs: null,
        contactDelayMs: null,
        activeAtTap: null,
        reach: null,
        contact: null,
        landing: null,
        activePos: null,
        distToLandingM: null,
        runUpKeyChanges: 0,
        phaseAfter: null,
        pointReason: null,
      };
      attempts.push(attempt);

      const servingTeam: TeamId = 1;
      await page.evaluate((o) => window.__sw3d!.newSet(o), {
        seed,
        servingTeam,
        humanControl: true,
      });
      try {
        await page.waitForFunction(
          (s) => {
            const st = window.__sw3d!.state();
            return st.seed === s && st.rally.phase === 'serve';
          },
          seed,
          { timeout: RESET_TIMEOUT_MS },
        );
      } catch {
        if (!resetWarned) {
          console.warn(
            'Stan nie potwierdził nowego seta (seed/faza serve) – kontynuuję bez tej kontroli',
          );
          resetWarned = true;
        }
      }

      // Serwis rywali.
      let serveTick: number;
      try {
        await page.waitForFunction(
          () => window.__sw3d!.state().rally.phase === 'rally',
          undefined,
          {
            timeout: SERVE_TIMEOUT_MS,
          },
        );
        serveTick = await page.evaluate(() => {
          const s = window.__sw3d!.state();
          return s.lastContact && s.lastContact.kind === 'serve' ? s.lastContact.tick : s.tick;
        });
      } catch {
        attempt.reason = 'brak serwisu';
        report(attempt);
        continue;
      }

      // Dobieg do przewidywanego lądowania i plan tapu. Pętla trwa do chwili tapu:
      // dobieg zmienia okno zasięgu, więc plan jest przeliczany z każdego odczytu
      // (ostatni przed tapem wygrywa). Kończy się też, gdy ktoś inny odbije albo
      // piłka spadnie.
      const pollDeadline = Date.now() + REACH_TIMEOUT_MS;
      let enterTick: number | null = null;
      let tapAtTick: number | null = null;
      let lastActive: PlayerId | null = null;
      let readyToTap = false;
      let prevTick: number | null = null;
      const held = new Set<string>();
      while (Date.now() < pollDeadline) {
        const snap = await page.evaluate(() => {
          const h = window.__sw3d!;
          const s = h.state();
          const me = s.players[s.active];
          return {
            tick: s.tick,
            active: s.active,
            phase: s.rally.phase,
            reach: h.reachWindow(s.active),
            landing: s.landing,
            pos: { x: me.pos.x, z: me.pos.z },
            lastContact: s.lastContact,
            pointReason: s.rally.pointReason,
          };
        });
        if (prevTick !== null && snap.tick - prevTick > STALL_TICKS) attempt.stalled = true;
        prevTick = snap.tick;
        attempt.phaseAfter = snap.phase;
        attempt.pointReason = snap.pointReason;
        if (snap.phase === 'rally') {
          // Tylko w locie: po punkcie `landing` opisuje toczącą się piłkę, nie serwis.
          attempt.landing = snap.landing;
          attempt.activePos = snap.pos;
          if (snap.landing.valid) {
            attempt.distToLandingM = Math.hypot(
              snap.pos.x - snap.landing.pos.x,
              snap.pos.z - snap.landing.pos.z,
            );
          }
        }
        if (snap.lastContact && snap.lastContact.tick > serveTick) {
          // Ktoś odbił, zanim piłka weszła w zasięg aktywnego: partner-AI albo bierny kontakt.
          attempt.contact = pick(snap.lastContact);
          attempt.reason = snap.lastContact.kind === 'passive' ? 'passive' : 'inny zawodnik';
          break;
        }
        if (snap.phase !== 'rally') break;
        // Plan tapu z prognozy wejścia w zasięg. Gdy piłka JUŻ jest w zasięgu (enterInS ≤ 0),
        // reachWindow zwraca „teraz” – wtedy prognoza zostaje zamrożona na ostatnim odczycie
        // sprzed wejścia; bez tego tapAtTick uciekałby z każdym odczytem i tapy z dodatnim
        // opóźnieniem nigdy by nie padły.
        if (snap.reach && (enterTick === null || snap.reach.enterInS > 0)) {
          attempt.reach = snap.reach;
          enterTick = snap.tick + Math.round(snap.reach.enterInS * TICK_HZ);
          tapAtTick = enterTick + Math.round((plannedDelayMs / 1000) * TICK_HZ);
        }
        // Dobieg: dopóki piłka nie weszła w zasięg. Przy przełączeniu aktywnego
        // puszczamy klawisze, żeby nowa sesja ruchu trafiła do nowego zawodnika
        // (input adresuje ruch do aktywnego z chwili pierwszego klawisza).
        if (lastActive !== null && lastActive !== snap.active) {
          attempt.runUpKeyChanges += await applyKeys(page, held, new Set());
        }
        lastActive = snap.active;
        const inReach = snap.reach !== null && snap.reach.enterInS <= 0;
        const desired =
          snap.landing.valid && !inReach
            ? runUpKeys(snap.pos, snap.landing.intercept)
            : new Set<string>();
        attempt.runUpKeyChanges += await applyKeys(page, held, desired);
        if (tapAtTick !== null && snap.tick >= tapAtTick - 1) {
          readyToTap = true;
          break;
        }
        await sleep(REACH_POLL_MS);
      }
      await applyKeys(page, held, new Set());
      if (attempt.reason) {
        report(attempt);
        continue;
      }
      if (!readyToTap || enterTick === null) {
        attempt.reason = 'brak zasięgu';
        report(attempt);
        continue;
      }

      // Tap w wylosowanym momencie okna. Aktywnego czytamy tuż przed tapem, bo do
      // pierwszego odbicia sim może przełączyć sterowanie na partnera (docs/22 §5).
      const pre = await page.evaluate(() => {
        const s = window.__sw3d!.state();
        return { tick: s.tick, active: s.active };
      });
      await page.touchscreen.tap(TAP_X, TAP_Y);
      attempt.activeAtTap = pre.active;
      // Chwila tapu = tick, w którym sim otworzył okno zamachu (swingStartTick), nie tick
      // sprzed wysłania zdarzenia – między nimi jest jedna klatka. Gdy okno już się zamknęło
      // (kontakt w tym samym ticku), zostaje bieżący tick.
      const tapTick = await page.evaluate((p) => {
        const s = window.__sw3d!.state();
        const start = s.players[p].swingStartTick;
        return start >= 0 ? start : s.tick;
      }, pre.active);
      attempt.tapDelayMs = ((tapTick - enterTick) / TICK_HZ) * 1000;

      await sleep(SETTLE_MS);
      const post = await page.evaluate(() => {
        const s = window.__sw3d!.state();
        return {
          tick: s.tick,
          phase: s.rally.phase,
          lastContact: s.lastContact,
          landing: s.landing,
          pointReason: s.rally.pointReason,
        };
      });
      attempt.phaseAfter = post.phase;
      attempt.pointReason = post.pointReason;
      if (post.phase === 'rally') attempt.landing = post.landing;
      const lc = post.lastContact;
      if (!lc || lc.tick <= serveTick) {
        attempt.reason = 'whiff';
      } else {
        attempt.contact = pick(lc);
        attempt.contactDelayMs = ((lc.tick - enterTick) / TICK_HZ) * 1000;
        if (lc.kind === 'passive') attempt.reason = 'passive';
        else if (lc.player !== pre.active) attempt.reason = 'inny zawodnik';
        // Punkt w 0,6 s po naszym kontakcie = piłka od razu na podłodze (aut albo własna połowa).
        else if (post.phase !== 'rally') attempt.reason = 'aut';
        else if (post.landing.valid && post.landing.hitsNet) attempt.reason = 'siatka';
        else if (!post.landing.valid || post.landing.pos.z >= 0) attempt.reason = 'aut';
        else attempt.success = true;
      }
      report(attempt);
    }

    // Podsumowanie.
    // Statystyki tylko z prób bez przystanku pętli – reszta jest raportowana osobno.
    const stalled = attempts.filter((a) => a.stalled);
    const valid = attempts.filter((a) => !a.stalled);
    const successes = valid.filter((a) => a.success);
    const tapped = valid.filter((a) => a.tapDelayMs !== null);
    const successRate = valid.length > 0 ? successes.length / valid.length : NaN;
    const meanQuality = mean(successes.map((a) => a.contact?.quality ?? 0));
    const meanContactDelay = mean(
      successes.map((a) => a.contactDelayMs).filter((d): d is number => d !== null),
    );
    const histogram = buildHistogram(tapped);
    const reasons = new Map<FailReason, number>();
    for (const a of valid) {
      if (a.reason) reasons.set(a.reason, (reasons.get(a.reason) ?? 0) + 1);
    }

    const result = {
      script: 'przyjecie',
      date: new Date().toISOString(),
      mode: modeLabel(args.headless),
      headless: args.headless,
      url,
      gameVersion: version,
      harnessSeed,
      attemptsCount,
      tap: { x: TAP_X, y: TAP_Y, spreadMs: TAP_SPREAD_MS },
      viewport: spec,
      successCount: successes.length,
      validCount: valid.length,
      stalledCount: stalled.length,
      successRate,
      meanQuality,
      meanContactDelayMs: meanContactDelay,
      histogram,
      failures: Object.fromEntries(reasons),
      attempts,
      errors,
    };
    const file = writeResult('przyjecie', result);

    console.log('');
    console.log('=== Harness przyjęcie – Set Wieszowa 3D F0 ===');
    console.log(
      `Tryb: ${result.mode}; gra ${version}; ${attemptsCount} prób; seed harnessu ${harnessSeed}; dobieg WASD, tap (${TAP_X}, ${TAP_Y}) w oknie [wejście − ${TAP_SPREAD_MS} ms, +${TAP_SPREAD_MS} ms]`,
    );
    console.log(
      `Sukcesy: ${successes.length}/${valid.length} (${fmt(successRate * 100)} %) wiarygodnych prób; niewiarygodne (przystanek pętli renderu): ${stalled.length}; średnia jakość udanych ${fmt(meanQuality, 2)}; średnie opóźnienie kontaktu ${fmt(meanContactDelay, 0)} ms`,
    );
    console.log('Histogram opóźnienia tapu od wejścia w zasięg (prób / udanych):');
    for (const bin of histogram) {
      const bar = '█'.repeat(bin.count);
      console.log(`  ${bin.label.padEnd(14)} ${bar.padEnd(12)} ${bin.count} / ${bin.successes}`);
    }
    const failed = valid.filter((a) => !a.success);
    console.log(`Porażki: ${failed.length}`);
    for (const [reason, count] of reasons) console.log(`  ${reason}: ${count}`);
    for (const a of failed) {
      const land =
        a.landing && a.landing.valid
          ? `, lądowanie (${fmt(a.landing.pos.x)}, ${fmt(a.landing.pos.z)})`
          : '';
      const dist = a.distToLandingM === null ? '' : `, do aktywnego ${fmt(a.distToLandingM)} m`;
      const delay = a.tapDelayMs === null ? '' : `, tap +${fmt(a.tapDelayMs, 0)} ms`;
      const who = a.contact ? `, odbił ${a.contact.player} (${a.contact.kind})` : '';
      const point = a.pointReason ? `, punkt: ${a.pointReason}` : '';
      console.log(
        `  #${a.index} seed ${a.seed} – ${a.reason ?? '?'}${land}${dist}${delay}${who}${point}`,
      );
    }
    console.log(`Błędy strony: ${errors.length}`);
    for (const e of errors.slice(0, 10)) console.log(`  ${e}`);
    console.log('Próg: brak w CLAUDE.md – odsetek idzie do raportu fazy, ocenia go brama F0.');
    console.log(`Zapisano: ${file}`);
  } finally {
    await browser.close();
    await server.stop();
  }
}

function pick(c: {
  player: PlayerId;
  kind: HitKind;
  quality: number;
  touchNo: number;
}): Attempt['contact'] {
  return { player: c.player, kind: c.kind, quality: c.quality, touchNo: c.touchNo };
}

/**
 * Klawisze dobiegu z pozycji zawodnika do celu tuż za punktem przyjęcia. Mapowanie jak
 * w src/input/gesty.ts: prawo ekranu (D) = −x świata, A = +x, W = +z (do siatki), S = −z.
 */
function runUpKeys(pos: Vec2, intercept: Vec2): Set<string> {
  const dx = intercept.x - pos.x;
  const dz = intercept.z - RUN_BEHIND_M - pos.z;
  const keys = new Set<string>();
  if (Math.hypot(dx, dz) < RUN_STOP_M) return keys;
  if (Math.abs(dx) > RUN_DEADBAND_M) keys.add(dx > 0 ? 'KeyA' : 'KeyD');
  if (Math.abs(dz) > RUN_DEADBAND_M) keys.add(dz > 0 ? 'KeyW' : 'KeyS');
  return keys;
}

/** Doprowadza zestaw wciśniętych klawiszy do `desired`; zwraca liczbę zmian. */
async function applyKeys(page: Page, held: Set<string>, desired: Set<string>): Promise<number> {
  let changes = 0;
  for (const key of [...held]) {
    if (!desired.has(key)) {
      await page.keyboard.up(key);
      held.delete(key);
      changes++;
    }
  }
  for (const key of desired) {
    if (!held.has(key)) {
      await page.keyboard.down(key);
      held.add(key);
      changes++;
    }
  }
  return changes;
}

function report(a: Attempt): void {
  const status = a.stalled ? 'STOP' : a.success ? 'OK  ' : 'FAIL';
  const delay = a.tapDelayMs === null ? '' : ` tap +${fmt(a.tapDelayMs, 0)} ms`;
  const q = a.success && a.contact ? ` jakość ${fmt(a.contact.quality, 2)}` : '';
  const reason = a.reason ? ` ${a.reason}` : '';
  const keys = ` klawisze ${a.runUpKeyChanges}`;
  const reach = a.reach
    ? ` okno +${fmt(a.reach.enterInS * 1000, 0)}..${fmt(a.reach.exitInS * 1000, 0)} ms`
    : ' okno brak';
  console.log(`[${String(a.index + 1).padStart(2)}] ${status}${delay}${q}${reason}${keys}${reach}`);
}

interface HistogramBin {
  label: string;
  fromMs: number | null;
  toMs: number | null;
  count: number;
  successes: number;
}

/** Kosze co 50 ms od −250 do +250 ms plus dwa brzegowe poza oknem. */
function buildHistogram(tapped: readonly Attempt[]): HistogramBin[] {
  const bins: HistogramBin[] = [
    { label: `< ${HIST_MIN_MS} ms`, fromMs: null, toMs: HIST_MIN_MS, count: 0, successes: 0 },
  ];
  for (let from = HIST_MIN_MS; from < HIST_MAX_MS; from += HIST_BIN_MS) {
    bins.push({
      label: `[${from}, ${from + HIST_BIN_MS}) ms`,
      fromMs: from,
      toMs: from + HIST_BIN_MS,
      count: 0,
      successes: 0,
    });
  }
  bins.push({
    label: `≥ ${HIST_MAX_MS} ms`,
    fromMs: HIST_MAX_MS,
    toMs: null,
    count: 0,
    successes: 0,
  });
  for (const a of tapped) {
    const d = a.tapDelayMs ?? 0;
    let idx: number;
    if (d < HIST_MIN_MS) idx = 0;
    else if (d >= HIST_MAX_MS) idx = bins.length - 1;
    else idx = 1 + Math.floor((d - HIST_MIN_MS) / HIST_BIN_MS);
    const bin = bins[idx];
    if (!bin) continue;
    bin.count++;
    if (a.success) bin.successes++;
  }
  return bins;
}

main().catch(fail);
