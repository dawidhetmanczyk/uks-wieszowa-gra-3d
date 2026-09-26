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
 * Czas liczymy w tickach sim, nie zegarem ściennym: chwila tapu to `swingStartTick`
 * (tick, w którym sim otworzył okno zamachu), a wejście w zasięg to prognoza zamrożona
 * na ostatnim odczycie sprzed wejścia. Próby, w których pętla renderu przystanęła
 * (najdłuższa klatka rAF w próbie > STALL_FRAME_MS), są liczone osobno jako niewiarygodne –
 * spóźniony tap nie jest wtedy winą sterowania.
 *
 * Chromium startuje bez limitu klatek (jak perf): z vsync pętla zależy od monitora, a po
 * wygaszeniu ekranu (bezczynność) rysuje raz na sekundę. Bez limitu wejście trafia do sim
 * w najbliższym ticku (≤ 8,3 ms) – na telefonie 60 Hz dochodzi do tego ≤ 16,7 ms klatki,
 * czyli mniej niż trzecia część kosza histogramu. `--vsync` przywraca limit.
 *
 * F0b (decyzje Dawida z 2026-09-26): domyślnie tryb asysty – do punktu przyjęcia biegnie
 * asysta (bez klawiszy), a stuknięcie pada w oknie [wejście − 500 ms, wejście + 400 ms), żeby
 * zmierzyć skuteczne okno (cel: ≥ 450 ms, ≥ 85 % udanych stuknięć w oknie). Skuteczne okno =
 * najdłuższy ciąg sąsiednich koszy 50 ms, w których każdy ma ≥ 85 % udanych. `--reczne` –
 * pełne F0 (?sterowanie=reczne, dobieg WASD, okno ±250 ms) do pomiaru „przed”.
 *
 * Użycie: pnpm harness:przyjecie [--reczne] [--url <adres>] [--headless] [--vsync] [--proby N] [--seed 7] [--build]
 */
import type { Browser, Page } from 'playwright';
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
  controlQuery,
  launchBrowser,
  mean,
  mobileSpec,
  phoneSpec,
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

/** Asysta: szerszy rozrzut, więc więcej prób na kosz; tryb ręczny jak w F0. */
const DEFAULT_ATTEMPTS_ASSIST = 150;
const DEFAULT_ATTEMPTS_MANUAL = 50;
const DEFAULT_SEED = 7;
/** Seed seta = ATTEMPT_SEED_BASE + numer próby – ten sam serwis przy każdym uruchomieniu. */
const ATTEMPT_SEED_BASE = 1000;
/**
 * Miejsce tapu jako ułamek okna: środek w poziomie, w dolnej części – tam, gdzie leży kciuk,
 * z dala od HUD-u (wynik i „Nowy set” są u góry). Sterowanie jest względne, więc dla gry
 * miejsce nie ma znaczenia – liczy się tylko to, żeby nie trafić w przycisk.
 */
const TAP_FX = 0.5;
const TAP_FY = 0.72;
/** Rozrzut stuknięcia wokół wejścia w zasięg [od, do) ms – F0: ±250, F0b: szerzej, żeby objąć okno. */
const SPREAD_MANUAL = { fromMs: -250, toMs: 250 } as const;
const SPREAD_ASSIST = { fromMs: -500, toMs: 400 } as const;
/** Kosz liczy się do skutecznego okna, gdy ma co najmniej tyle udanych (cel z polecenia F0b). */
const WINDOW_MIN_RATE = 0.85;
const RESET_TIMEOUT_MS = 2000;
/** AI serwuje po 1,0 s; 5 s to już awaria. */
const SERVE_TIMEOUT_MS = 5000;
const REACH_POLL_MS = 8;
const REACH_TIMEOUT_MS = 6000;
/**
 * Najdłuższa klatka rAF w trakcie próby powyżej tego progu = pętla renderu przystanęła
 * (okno w tle, GC, obciążony CPU – pętla nadrabia do 30 kroków na klatkę). Tap i dobieg są
 * wtedy spóźnione nie z winy sterowania, więc próba jest liczona osobno. Mierzone wprost
 * z bufora `frameTimes()` zerowanego na starcie próby.
 */
const STALL_FRAME_MS = 100;
/** Dobieg: cel 0,15 m za punktem przyjęcia (`landing.intercept`, tor na 1,1 m), od strony własnej linii końcowej. */
const RUN_BEHIND_M = 0.15;
/** Poniżej tej odległości od celu dobiegu klawisze idą w górę (hamowanie sim dokończy). */
const RUN_STOP_M = 0.3;
/** Oś, na której różnica jest mniejsza, nie dostaje klawisza – bez drgania na skos. */
const RUN_DEADBAND_M = 0.2;
/** Po tapie kontakt następuje najpóźniej po 0,12 s (okno po puszczeniu); 0,6 s starczy, by tor się ustabilizował. */
const SETTLE_MS = 600;
const HIST_BIN_MS = 50;

/**
 * Powody porażki:
 * - 'brak serwisu' – AI nie zaserwowało w SERVE_TIMEOUT_MS;
 * - 'brak zasięgu' – dobieg nie zdążył albo okno zasięgu nie pojawiło się przed lądowaniem;
 * - 'whiff' – tap padł, zanim piłka doleciała, ale okno zamachu wygasło przed kontaktem
 *   (tap za wcześnie; piłka odbiła się biernie od ciała) albo sim nie zarejestrował
 *   żadnego kontaktu w SETTLE_MS;
 * - 'passive' – piłka odbiła się od kapsuły, zanim padł tap (tap za późno albo wcale);
 * - 'inny zawodnik' – odbił partner-AI;
 * - 'siatka' / 'aut' – nasze odbicie, ale tor w siatkę / poza własną połowę.
 */
type FailReason =
  'brak serwisu' | 'brak zasięgu' | 'whiff' | 'passive' | 'inny zawodnik' | 'siatka' | 'aut';

interface Attempt {
  index: number;
  seed: number;
  success: boolean;
  reason: FailReason | null;
  /** Pętla renderu przystanęła w trakcie próby (klatka > STALL_FRAME_MS) – wynik niewiarygodny. */
  stalled: boolean;
  /** Najdłuższa klatka rAF (ms) w trakcie próby, z bufora frameTimes zerowanego na starcie próby. */
  maxFrameMs: number | null;
  /** Wylosowane d – ile ms względem wejścia w zasięg miał paść tap (ujemne = przed). */
  plannedDelayMs: number;
  /**
   * Faktyczne opóźnienie tapu względem wejścia w zasięg, z ticków sim: chwila tapu =
   * `swingStartTick` (tick otwarcia okna zamachu), nie tick sprzed wysłania zdarzenia.
   */
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
  const manual = args.reczne;
  const spread = manual ? SPREAD_MANUAL : SPREAD_ASSIST;
  const attemptsCount = args.proby ?? (manual ? DEFAULT_ATTEMPTS_MANUAL : DEFAULT_ATTEMPTS_ASSIST);
  const harnessSeed = args.seed ?? DEFAULT_SEED;
  // Telefon w pionie – główny tryb F0b; --ekran zmienia. Sterowanie jest względne, więc
  // miejsce stuknięcia nie ma znaczenia dla gry.
  const spec = phoneSpec(args, mobileSpec(2));
  const TAP_X = Math.round(spec.width * TAP_FX);
  const TAP_Y = Math.round(spec.height * TAP_FY);

  // Wszystkie opóźnienia losujemy przed startem: rozkład w oknie jest wtedy
  // niezależny od tego, ile prób padło na „brak serwisu”.
  const rng: RngHolder = { rng: seedRng(harnessSeed) };
  const delays: number[] = [];
  for (let i = 0; i < attemptsCount; i++) {
    delays.push(spread.fromMs + nextFloat(rng) * (spread.toMs - spread.fromMs));
  }

  const server = await ensureServer(args);
  // Przeglądarka wewnątrz try: gdy start Chromium padnie, finally i tak ubije serwer
  // podglądu – inaczej vite preview zostawał żywy i skrypt wisiał.
  let browser: Browser | null = null;
  try {
    browser = await launchBrowser(args.headless, { uncappedFrameRate: !args.vsync });
    const { page, errors } = await openPage(browser, spec);
    const url = withQuery(server.url, controlQuery(manual));
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
        maxFrameMs: null,
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
      await page.evaluate(() => window.__sw3d!.resetFrameTimes());
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
        await finish(page, attempt);
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
        // Tryb asysty: biegnie asysta, klawisze zostają puszczone. F0: dobieg WASD.
        const desired =
          manual && snap.landing.valid && !inReach
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
        await finish(page, attempt);
        continue;
      }
      if (!readyToTap || enterTick === null) {
        attempt.reason = 'brak zasięgu';
        await finish(page, attempt);
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
        if (lc.kind === 'passive') {
          // Bierne odbicie po tapie: gdy kontakt był PO otwarciu okna zamachu, okno wygasło
          // przed dolotem (tap za wcześnie) – to pudło, 'whiff'. Gdy kontakt był PRZED nim,
          // piłka odbiła się od ciała, zanim tap dotarł do sim – jak brak tapu, 'passive'.
          attempt.reason = lc.tick >= tapTick ? 'whiff' : 'passive';
        } else if (lc.player !== pre.active) attempt.reason = 'inny zawodnik';
        // Punkt w 0,6 s po naszym kontakcie = piłka od razu na podłodze (aut albo własna połowa).
        else if (post.phase !== 'rally') attempt.reason = 'aut';
        else if (post.landing.valid && post.landing.hitsNet) attempt.reason = 'siatka';
        else if (!post.landing.valid || post.landing.pos.z >= 0) attempt.reason = 'aut';
        else attempt.success = true;
      }
      await finish(page, attempt);
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
    const histogram = buildHistogram(tapped, spread);
    const effective = effectiveWindow(histogram);
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
      controlMode: manual ? 'manual' : 'assist',
      tap: { x: TAP_X, y: TAP_Y, spread },
      viewport: spec,
      successCount: successes.length,
      validCount: valid.length,
      stalledCount: stalled.length,
      successRate,
      meanQuality,
      meanContactDelayMs: meanContactDelay,
      histogram,
      effectiveWindow: effective,
      failures: Object.fromEntries(reasons),
      attempts,
      errors,
    };
    const file = writeResult('przyjecie', result);

    console.log('');
    console.log('=== Harness przyjęcie – Set Wieszowa 3D F0b ===');
    const control = manual ? 'ręczne (pełne F0, dobieg WASD)' : 'asysta F0b (dobieg sam)';
    console.log(
      `Tryb: ${result.mode}; sterowanie ${control}; gra ${version}; ${attemptsCount} prób; seed harnessu ${harnessSeed}; stuknięcie (${TAP_X}, ${TAP_Y}) w oknie [wejście ${spread.fromMs} ms, wejście +${spread.toMs} ms)`,
    );
    console.log(
      `Sukcesy: ${successes.length}/${valid.length} (${fmt(successRate * 100)} %) wiarygodnych prób; niewiarygodne (przystanek pętli renderu): ${stalled.length}; średnia jakość udanych ${fmt(meanQuality, 2)}; średnie opóźnienie kontaktu ${fmt(meanContactDelay, 0)} ms`,
    );
    console.log('Histogram opóźnienia tapu od wejścia w zasięg (prób / udanych):');
    for (const bin of histogram) {
      const bar = '█'.repeat(bin.count);
      console.log(`  ${bin.label.padEnd(14)} ${bar.padEnd(12)} ${bin.count} / ${bin.successes}`);
    }
    console.log(
      effective
        ? `Skuteczne okno (kosze ≥ ${WINDOW_MIN_RATE * 100} % udanych): [${effective.fromMs}, ${effective.toMs}) ms = ${effective.widthMs} ms; w oknie ${effective.successes}/${effective.attempts} (${fmt(effective.rate * 100)} %)`
        : 'Skuteczne okno: brak kosza z ≥ 85 % udanych',
    );
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
    console.log(
      'Cel F0b (docs/21): okno ≥ 450 ms i ≥ 85 % udanych w oknie. Brak progu w CLAUDE.md – ocenia brama.',
    );
    console.log(`Zapisano: ${file}`);
  } finally {
    await browser?.close();
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

/** Zamyka próbę: odczyt najdłuższej klatki z bufora (przystanek pętli) i wpis w konsoli. */
async function finish(page: Page, attempt: Attempt): Promise<void> {
  const frames = await page.evaluate(() => window.__sw3d!.frameTimes());
  attempt.maxFrameMs = frames.length > 0 ? Math.max(...frames) : null;
  attempt.stalled = attempt.maxFrameMs !== null && attempt.maxFrameMs > STALL_FRAME_MS;
  report(attempt);
}

function report(a: Attempt): void {
  const status = a.stalled ? 'STOP' : a.success ? 'OK  ' : 'FAIL';
  const delay = a.tapDelayMs === null ? '' : ` tap +${fmt(a.tapDelayMs, 0)} ms`;
  const q = a.success && a.contact ? ` jakość ${fmt(a.contact.quality, 2)}` : '';
  const reason = a.reason ? ` ${a.reason}` : '';
  const keys = ` klawisze ${a.runUpKeyChanges}`;
  const frame = a.maxFrameMs === null ? '' : ` klatka max ${fmt(a.maxFrameMs, 0)} ms`;
  const reach = a.reach
    ? ` okno +${fmt(a.reach.enterInS * 1000, 0)}..${fmt(a.reach.exitInS * 1000, 0)} ms`
    : ' okno brak';
  console.log(
    `[${String(a.index + 1).padStart(2)}] ${status}${delay}${q}${reason}${keys}${reach}${frame}`,
  );
}

interface HistogramBin {
  label: string;
  fromMs: number | null;
  toMs: number | null;
  count: number;
  successes: number;
}

/** Kosze co 50 ms w zakresie rozrzutu plus dwa brzegowe poza nim. */
function buildHistogram(
  tapped: readonly Attempt[],
  spread: { fromMs: number; toMs: number },
): HistogramBin[] {
  const HIST_MIN_MS = spread.fromMs;
  const HIST_MAX_MS = spread.toMs;
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

interface EffectiveWindow {
  fromMs: number;
  toMs: number;
  widthMs: number;
  attempts: number;
  successes: number;
  rate: number;
}

/**
 * Skuteczne okno: najdłuższy ciąg sąsiednich koszy 50 ms (bez brzegowych), w którym każdy kosz
 * ma próby i ≥ WINDOW_MIN_RATE udanych. Pusty kosz przerywa ciąg – o nim nic nie wiemy.
 */
function effectiveWindow(bins: readonly HistogramBin[]): EffectiveWindow | null {
  let best: EffectiveWindow | null = null;
  let run: HistogramBin[] = [];
  const close = (): void => {
    if (run.length === 0) return;
    const first = run[0]!;
    const last = run[run.length - 1]!;
    const attempts = run.reduce((n, b) => n + b.count, 0);
    const successes = run.reduce((n, b) => n + b.successes, 0);
    const w: EffectiveWindow = {
      fromMs: first.fromMs ?? 0,
      toMs: last.toMs ?? 0,
      widthMs: (last.toMs ?? 0) - (first.fromMs ?? 0),
      attempts,
      successes,
      rate: attempts > 0 ? successes / attempts : 0,
    };
    if (best === null || w.widthMs > best.widthMs) best = w;
    run = [];
  };
  for (const b of bins) {
    const inner = b.fromMs !== null && b.toMs !== null;
    if (inner && b.count > 0 && b.successes / b.count >= WINDOW_MIN_RATE) run.push(b);
    else close();
  }
  close();
  return best;
}

main().catch(fail);
