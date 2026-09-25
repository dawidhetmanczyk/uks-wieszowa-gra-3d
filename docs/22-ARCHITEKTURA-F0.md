# 22 – Architektura i kontrakt F0

Status: robocze (Claude Code, 2026-09-04). Uszczegółowienie docs/20 na potrzeby fazy F0. Wszystko oznaczone **[F0]** to założenie przyjęte, bo koncepcja milczała – lista zbiorcza w §9 i w raporcie fazy.

## 1. Moduły i ich API

Granice z CLAUDE.md. Każdy moduł ma jeden plik `index.ts` z publicznym API; reszta jest prywatna.

### src/sim (DOM-free, Three-free, deterministyczne)

Pliki kontraktu (gotowe, nie zmieniać bez powodu): `types.ts`, `constants.ts`, `prng.ts`, `vec.ts`, `ballistics.ts`, `spots.ts`, `aim.ts`.

```ts
createSimState(opts: { seed: number; servingTeam?: TeamId; humanControl?: boolean }): SimState
step(state: SimState, commands: readonly Command[]): void      // jeden tick 1/120 s
canReach(state, player: PlayerId): boolean                       // piłka teraz w zasięgu
reachWindow(state, player): { enterTick: number; exitTick: number } | null
                                  // kiedy piłka wejdzie/wyjdzie z zasięgu zawodnika stojącego w miejscu
                                  // (zasięg do REACH_TOP_JUMP), z predykcji toru; null = nie wejdzie
defaultAttackTarget(state, team: TeamId): Vec2                   // „między rywalami”, przycięty do boiska
cloneState(state): SimState                                      // głęboka kopia
createRecording(state): Recording; appendTick(rec, tick, commands): void
replay(rec: Recording, untilTick?: number): SimState             // odtworzenie od zera
// + re-eksport wszystkiego z plików kontraktu
// Command = move | swing | aim | release. Bez wariantu `new-set` [F0]: reset seta robi loop
//   przez createSimState (komenda w strumieniu psuła nagranie – Recording zaczynał się od
//   innego stanu niż jego seed).
```

Inne moduły importują sim wyłącznie z `src/sim/index` (pilnuje `pnpm check:granice` i `tests/narzedzia/granice.test.ts`); pliki wnętrzności (`types.ts`, `constants.ts`, …) są prywatne.

`step` robi w tej kolejności: czyści `events` → stosuje komendy → ruch zawodników (przyspieszenie do `move × PLAYER_MAX_SPEED`, hamowanie, skok, granice własnej połowy, rozpychanie kapsuł tej samej drużyny) → tor piłki (`stepBall`) → kolizje: siatka, podłoga, kapsuły (bierny kontakt) → rozstrzygnięcie zamachów (kontakt, pudło, auto-skok) → przejście nad siatką → punkt/zasady → zmiana fazy po pauzie → predykcja lądowania → przełączenie aktywnego → `tick++`.

### src/ai (importuje sim, nigdy odwrotnie)

```ts
interface AiProfile { name; reactionTicks; positionErrorM; maxSpeed; aggression; caution; noiseM;
                      servePower: [min, max]; attackPower: [min, max] }
const NOWICJUSZ: AiProfile
createAi(seed: number, profile?: AiProfile): AiState                // własny strumień mulberry32
aiCommands(ai: AiState, sim: SimState, controlled: readonly PlayerId[]): Command[]
                                  // wołane raz na tick; komendy tylko dla `controlled`; nie mutuje sim
```

### src/render (Three.js; czyta stan, nie zmienia)

```ts
createRenderer(canvas: HTMLCanvasElement, options?: RenderOptions): GameRenderer
interface RenderOptions { antialias?: boolean; shadows?: boolean; maxPixelRatio?: number }
                                  // przełączniki jakości do pomiaru na telefonie [F0]; domyślnie true, true, 2;
                                  // antialias to parametr konstruktora WebGLRenderer – po starcie nie do zmiany
interface ResolvedRenderOptions { antialias: boolean; shadows: boolean; maxPixelRatio: number;
                                  pixelRatio: number }   // + faktyczny renderer.getPixelRatio() po ostatnim resize
interface ViewState { aim: Vec2 | null; holding: boolean; power: number }   // z input, dla celownika
interface GameRenderer {
  render(state: SimState, view: ViewState, dtSeconds: number): void
  resize(width: number, height: number, dpr: number): void
  info(): { calls: number; triangles: number; programs: number }            // renderer.info.render
  options(): ResolvedRenderOptions                                          // czym naprawdę rysujemy (haki dev)
  framing(): FramingStats; resetFraming(): void    // kadr zliczany co klatkę po renderze (2026-09-25)
  screenPos(state, player): { x: number; y: number } | null                 // stopy zawodnika w px CSS okna
  dispose(): void
}
interface FramingStats { frames; team0Full; team0Partial; playerFull: [4]; ballIn;
                         minMarginPx; meanPlayerHeightPx; width; height }
                                  // „cały w kadrze” = stopy i czubek głowy kapsuły ± promień w oknie
createGameCamera(config?: CameraConfig): GameCamera      // src/render/camera.ts; CAMERA_F0 = stara kamera
```

### src/input (dotyk, klawiatura → komendy)

```ts
createInput(target: HTMLElement, activePlayer?: () => PlayerId): InputController
                                   // activePlayer = żywy odczyt state.active (adresat gestu w chwili zdarzenia,
                                   // nie z ostatniego poll – przełączenie zachodzi w step w tej samej klatce)
interface InputController {
  poll(state: SimState): Command[]   // raz na klatkę, przed krokami sim; komendy dla state.active
  view(): ViewState
  dispose(): void
}
```

### src/ui (zwykły DOM)

```ts
createHud(root: HTMLElement, handlers: { onNewSet(): void }, options?: { showFps?: boolean }): Hud
interface Hud {
  update(state: SimState): void
  setFps(fps: number): void          // ostatni pomiar z pętli (średnia z 0,5 s); ignorowany bez showFps
  dispose(): void
}
createRotateGate(opts: { root: HTMLElement; onChange(blocked: boolean): void }): RotateGate
interface RotateGate { blocked(): boolean; refresh(): void; dispose(): void }
shouldBlock(coarsePointer, width, height, skipped): boolean   // czysta reguła nakładki (orientation-rule.ts)
```

Nakładka „Obróć telefon” (2026-09-25, lekcja z gry 2D): `pointer: coarse` i `innerWidth < innerHeight` → pełnoekranowa nakładka ze znakiem klubu, mecz stoi (`Game.setPaused(true)`). Furtka „Graj mimo to” zawsze – wybór w `sessionStorage` (w F0 nie ma profilu ani ustawień, w których dałoby się go cofnąć; profil w F4 jak w 2D). Pierwszy dotyk (faza przechwytywania na `document`) próbuje `requestFullscreen` + `screen.orientation.lock('landscape')` w try/catch, z pochłoniętym odrzuceniem obietnic. Kanwa nie jest obracana CSS-em.

### src/loop

```ts
startGame(opts: { canvas: HTMLCanvasElement; hudRoot: HTMLElement; seed: number;
                  humanControl: boolean; servingTeam: TeamId;
                  showFps?: boolean;                 // licznik fps w HUD (?fps=1)
                  render?: RenderOptions }): Game    // przełączniki jakości (?jakosc, ?dpr, ?aa, ?cien)
interface Game { newSet(opts?): void; stop(): void; state(): SimState;
                 setPaused(paused: boolean): void; paused(): boolean }
                                  // pauza: sim nie krokuje, komendy przepadają, render stoi; po wznowieniu
                                  // akumulator od zera (bez nadrabiania)
```

Pętla: `requestAnimationFrame` → `dt = min(now − last, 0.25 s)` → `acc += dt` → `cmds = input.poll(state)` → dopóki `acc ≥ DT`: `ai = aiCommands(ai, state, controlled)`, `step(state, [...cmds, ...ai])`, `cmds = []`, `acc −= DT`, nagranie → `render(state, input.view(), dt)` → `hud.update(state)`. Maksymalnie 30 kroków na klatkę – nadmiar czasu przepada (bez wpływu na determinizm: sim widzi tylko kolejne `step`, nie zegar). `controlled` = wszyscy poza `state.active` gdy `humanControl`, inaczej cała czwórka. Komendy człowieka z klatki bez kroku (ekran 120+ Hz) czekają na najbliższy krok. Bez interpolacji renderu w F0. Nagranie (`createRecording` / `appendTick`) żyje w pamięci pętli i nie jest nigdzie wystawione – eksport i powtórka w F1. Nowy set = nowy `createSimState` (seed + 1, chyba że podano) i nowe `createAi` z tym samym ziarnem.

Parametry URL: `?seed=123` (ziarno), `?ai=1` (AI vs AI), `?serwis=1` (serwują czerwoni), `?fps=1` (licznik fps w HUD), przełączniki jakości do pomiaru na telefonie **[F0]**: `?jakosc=niska` (zestaw: dpr 1, bez antyaliasingu, bez cieni), `?dpr=1` (maxPixelRatio, 0–4, także ułamek), `?aa=0` (antyaliasing wyłączony), `?cien=0` (mapa cieni wyłączona); pojedyncze parametry nadpisują `jakosc`, więc da się zmierzyć wpływ każdego z osobna. Parser URL zwraca tylko pola podane w adresie – wartości domyślne zna render, nie parser. Domyślnie: seed z liczby dnia, człowiek gra, serwują niebiescy, pełna jakość.

Haki deweloperskie (harness) na `window.__sw3d`:

```ts
interface DevHooks {
  version: string
  state(): SimState                                                 // żywa referencja, tylko do odczytu
  newSet(opts?: { seed?: number; servingTeam?: TeamId; humanControl?: boolean }): void
  frameTimes(): number[]        // czasy klatek w ms (rAF delta), bufor 16384; resetFrameTimes(): void
  renderInfo(): { calls: number; triangles: number; programs: number }
  renderOptions(): ResolvedRenderOptions                            // faktycznie użyte ustawienia jakości
  reachWindow(player: PlayerId): { enterInS: number; exitInS: number } | null   // względem teraz
  framing(): FramingStats; resetFraming(): void                     // pomiar kadru (harness/kadr.ts)
  screenPos(player: PlayerId): { x: number; y: number } | null      // test sterowania (harness/sterowanie.ts)
  paused(): boolean                                                 // nakładka „Obróć telefon”
}
```

## 2. Zasady gry w sim

- Boisko 9 × 18 m, siatka z = 0, 2,24 m, pas |x| ≤ 5 m. Zawodnik nie przechodzi na drugą połowę (z ograniczone do własnej połowy, do siatki nie bliżej niż promień + 0,05 m). Margines poza boiskiem: 2 m za linią boczną (x, `PLAYER_OUT_X`) i 2,5 m za linią końcową (z, `PLAYER_OUT_Z`) – serwujący stoi 0,6 m za linią, potrzebuje miejsca na cofnięcie **[F0]**.
- Odbicia: max 3 na stronę; czwarty kontakt = punkt dla rywali. Ten sam zawodnik dwa razy z rzędu po tej samej stronie = punkt dla rywali. Przejście nad siatką zeruje licznik. Kontakt zza siatki (ręce nad siatką, |z| < 0,35 po stronie rywali) liczy się jako zmiana strony: licznik odbić od zera, `sideOfBall` = strona kontaktującego **[F0]**.
- Bierny kontakt piłki z kapsułą (bez zamachu) liczy się jako odbicie **[F0]** – odbicie z restytucją 0,45. Po własnym uderzeniu kapsuła nie koliduje z piłką przez 0,3 s.
- Piłka na podłodze: w boisku (cień dotyka linii = w boisku, promień 0,105) → punkt dla drużyny z drugiej strony; poza boiskiem → punkt dla drużyny przeciwnej do ostatniego kontaktu.
- Siatka: przejście z = 0 poniżej 2,24 w pasie → odbicie: **cały wektor prędkości × √0,4** (utrata 60 % energii, docs/20 §5; wcześniej tylko składowa z, a styczne × 0,8 – piłka ślizgała się po siatce za szybko) i odwrócenie składowej z; wymiana trwa. Serwujący może zagrać własny serwis odbity od siatki (licznik `touches` po serwisie = 0, więc nie ma podwójnego odbicia) – świadome **[F0]**, przepisy siatkówki mówią inaczej. Przejście poniżej krawędzi poza pasem (za słupkami) → `under-net`, punkt dla rywali ostatniego kontaktu **[F0]**.
- Punktacja: do 7, przewaga 2, limit 10. Po punkcie pauza 1,5 s, potem serwis drużyny, która wygrała punkt; w drużynie serwują naprzemiennie **[F0]**. Set zaczyna gracz (drużyna 0, zawodnik 0), chyba że `servingTeam: 1`.
- Serwis: serwujący stoi za linią końcową (x = ±2, z = ±9,6), piłka w ręce na 2,0 m. Nie rusza się do serwisu **[F0]**. Bez paska timingu w F0 – serwis gracza ma jakość 1 (zero szumu); siła z czasu trzymania, kierunek z celu. Siła < 0,5 = **lob** (łuk z apogeum 2,6 → 1,2 m nad wybiciem, jak serwis dzieci – piłka opada stromo i pierścień lądowania jest miejscem przyjęcia), siła ≥ 0,5 = płaski strzał 10,5–16 m/s; lob, który nie przeszedłby nad siatką, staje się strzałem **[F0]**. AI serwuje po 1,0 s.

## 3. Model uderzenia: „przytrzymaj do kontaktu” [F0]

Koncepcja mówi „dotknięcie – timing względem piłki” i „czas trzymania = siła”. Przyjęty model, jeden dla dotyku, klawiatury i AI:

1. `swing` = ręce w górę. Otwiera **okno kontaktu**: trwa, dopóki zawodnik trzyma (max 0,8 s) plus 0,12 s po `release` (dzięki temu krótkie tapnięcie też działa).
2. Kontakt następuje w pierwszym ticku okna, w którym piłka jest w zasięgu: poziomo ≤ 0,95 m + promień od środka kapsuły, pionowo 0,2 m ≤ y ≤ 2,35 m + wysokość skoku, po własnej stronie siatki (albo |z| < 0,35). Jeden kontakt na tick: gdy dwaj zawodnicy mają piłkę w zasięgu w tym samym ticku, kontakt zalicza się pierwszemu w kolejności rozstrzygania, drugi czeka z otwartym oknem (po kontakcie piłka leci już gdzie indziej) **[F0]**. Piłka, która kończy tick dokładnie na z = 0, dostaje stronę z kierunku lotu (znak `vel.z`) – od tego zależy, czy kontakt jest „po własnej stronie” **[F0]**.
3. **Jakość timingu** 0..1 liczona z położenia piłki w chwili kontaktu: odległość pozioma (1 przy środku, 0,4 na krawędzi zasięgu) × pasmo wysokości zależne od rodzaju (przyjęcie 0,6–1,8 m, wystawa 1,6–2,4, atak 2,0–zasięg; poza pasmem liniowo do 0,4 na granicy zasięgu). Szum celu = 2,2 m × (1 − jakość), rozkład trójkątny z PRNG sim. Zerowy szum tylko przy idealnym kontakcie – zgodnie z docs/20 §5.
4. **Siła** 0..1 = czas trzymania do kontaktu: ≤ 0,08 s → 0 (plas), ≥ 0,6 s → 1 (bomba). AI podaje siłę wprost (`power`).
5. Okno bez kontaktu → **pudło** (`whiff`), blokada zamachu 0,3 s. To jest kara za zły timing. Po własnym kontakcie obowiązuje 0,3 s immunitetu także dla zamachu (nie tylko dla kolizji z kapsułą): drugi tap zaraz po odbiciu nie robi podwójnego odbicia, tylko czeka **[F0]**.
6. **Auto-skok**: zawodnik w zamachu, na ziemi, piłka nad nim wyżej niż 2,2 m i nie wyżej niż 3,25 m → skok (apogeum 0,6 m). Kontakt następuje w skoku, gdy piłka wejdzie w zasięg. Skok wyzwolony zamachem trzyma okno otwarte do lądowania – pudło zapada dopiero po wylądowaniu bez kontaktu (inaczej okno 0,8 s kończyło się w powietrzu i zawodnik lądował z blokadą) **[F0]**.
7. Rodzaj kontaktu z numeru odbicia i celu: 1. odbicie bez celu = **przyjęcie** (łuk do miejsca rozgrywającego = x partnera przycięte do ±2,5, 2,2 m od siatki, apogeum 3,4 m); 2. bez celu = **wystawa** (łuk do miejsca ataku = x partnera przycięte do ±3,5, 1,1 m od siatki, apogeum 3,0 m); 3. odbicie zawsze **atak**; 1./2. z celem = atak („skrót”). Atak i serwis: najpłaszczy łuk do celu o prędkości ≤ lerp(9, 19, siła) (serwis 10,5–16), który przechodzi nad siatką z zapasem 0,12 m (`solveShot`). Cel ataku bez celownika = „między rywalami”.
8. Przyjęcie i wystawa zawsze do partnera, więc w F0 aktywny gracz może grać tylko: podanie do partnera (tap) albo atak (z celem lub na 3. odbiciu).

## 4. Sterowanie (src/input) [F0 – interpretacja docs/20 §3.3]

Dotyk (Pointer Events, `touch-action: none`):

- **Palec w dół i ruch > 12 px w pierwszych 120 ms** = przeciągnięcie = ruch: wirtualny joystick względem punktu dotknięcia, nasycenie 70 px, góra ekranu = w stronę siatki (+z), prawo ekranu = **−x świata** (układ prawoskrętny Three.js, kamera patrzy w +z; ten sam znak w `aim.ts` i w klawiaturze, render nic nie odbija). Trwa do puszczenia; komenda `move` tylko przy zmianie wektora.
- **Palec w dół i bez ruchu przez 120 ms** = zamach (`swing`, cel null). Dalsze przesunięcie palca w trakcie trzymania = **celowanie** (kierunek od punktu, w którym gest stał się zamachem – nie od pierwszego dotknięcia – → `aimFromDirection`, skala 60 px; celownik na połowie rywali podąża). Przesunięcie < 12 px od tego punktu = martwa strefa „palec stoi”: cel zostaje null (wystawa do partnera), bo palec trzymany w miejscu zawsze drży o kilka px **[F0]**. Puszczenie = `release`.
- **Tapnięcie** (puszczenie przed 120 ms, bez ruchu) = `swing` + `release` w tej samej klatce → dzięki oknu 0,12 s działa jako „uderz teraz”; bez celu = wystawa do partnera przy 1./2. odbiciu.
- **Drugi palec** podczas przeciągania = zamach (żeby dało się biec i uderzać w poziomie, dwoma kciukami).
- Komendy idą do `state.active` z chwili początku gestu (przełączenie aktywnego w trakcie trzymania nie zmienia adresata).
- Sterowanie jest **względne** (lekcja z gry 2D): palec postawiony gdziekolwiek ustala środek joysticka, kierunek daje przesunięcie. Input nie zna pozycji zawodnika na ekranie – `move` to sam kierunek. Test regresji do sterowania bezwzględnego: palec w lewym górnym rogu 844 × 390 (na lewo od zawodnika), ruch w prawo → zawodnik biegnie w prawo na ekranie; w Node na prawdziwym `touch.ts` + sim + kamerze (`tests/input/wzgledne.test.ts`) i w przeglądarce prawdziwymi dotykami CDP (`harness/sterowanie.ts`, też lustrzany przypadek z prawego dolnego rogu w lewo).

Klawiatura: WASD/strzałki = ruch; strzałki dodatkowo ustawiają cel, gdy trzymane; spacja w dół = `swing` (cel ze strzałek), spacja w górę = `release`; spacja bez strzałek = cel null. N = nowy set.

## 5. Przełączanie aktywnego zawodnika [F0]

Docs/20 §3.1: „ten, do którego leci piłka, z histerezą”. Doprecyzowanie, żeby nie odbierać graczowi ataku:

- Kandydat = bliższy przewidywanego lądowania (`landing.pos`) z pary 0/1. Przełączenie tylko, gdy kandydat jest bliżej o ≥ 0,75 m i od ostatniego przełączenia minęło ≥ 0,5 s.
- Ocena tylko, gdy piłka leci na naszą stronę i **nikt z nas jej jeszcze nie dotknął** (`touches === 0` po naszej stronie) – czyli przy serwisie i ataku rywali. W trakcie naszej akcji (po 1. odbiciu) aktywny zostaje, a partner-AI wystawia sam.
- Wyjątek „ratunek”: w trakcie naszej akcji, jeśli aktywny nie zdąży (odległość / 4,6 m/s > czas do lądowania + 0,25 s), a partner zdąży – przełączamy.
- Gdy serwuje drużyna 0, aktywny = serwujący (może to być zawodnik 1).
- Zdarzenie `active-switch`; po przełączeniu `move` poprzednio aktywnego zerowane.

## 6. AI (src/ai) wg docs/20 §6, jeden profil

- **Percepcja**: co `reactionTicks` odczyt `sim.landing` + błąd `positionErrorM × trójkątny` (stały do następnego odczytu). Piłka nie w locie → brak. Odczytywany punkt: przed 3. odbiciem własnej drużyny (atak, kontakt wysoko) – `landing.pos`; w pozostałych przypadkach – `landing.intercept`, czyli miejsce, gdzie opadająca piłka przecina 1,1 m (przy płaskim torze leży metry przed lądowaniem; stojąc na lądowaniu zawodnik dostaje piłkę przy kolanach na 40 ms) **[F0]**.
- **Rola w parze**: gdy piłka leci na naszą stronę – do piłki idzie ten z krótszym czasem dojścia (odległość / maxSpeed), histereza 0,15 s. Drugi: przed 1. odbiciem → miejsce rozgrywającego (`setterSpot`), przed 2. → miejsce ataku (`attackSpot`), przed 3. → asekuracja (pozycja bazowa). Piłka po drugiej stronie → pozycje bazowe. Po kontakcie para trzyma role do następnego odczytu percepcji (nie wraca na bazę między kontaktem a nowym odczytem – to dawało szarpnięcie w tył i spóźnienie do wystawy) **[F0]**.
- **Obrona**: po ataku rywali obrona rusza do piłki natychmiast – strażnik `reactionTicks` dotyczy tylko własnego licznika odczytu, nie czeka na „reakcję” po cudzym kontakcie (przy 30 tickach = 0,25 s opóźnienia obrona nie dobiegała do żadnego ataku) **[F0]**.
- **Partner gracza** (gdy `humanControl` i para zawiera `sim.active`): „nie zabieraj gry” – jeśli aktywny człowiek zdąży do lądowania (czas dojścia ≤ czas lotu + 0,2 s), partner nie idzie do piłki i nie zamachuje się; idzie na pozycję rozgrywającego/ataku. Wyjątek: człowiek nie zdąży.
- **Zamach**: w roli „do piłki”, gdy `reachWindow` mówi, że piłka wejdzie w zasięg w ≤ 0,1 s albo już jest → `swing` z `power` z profilu; `release` w ticku po kontakcie albo po 0,5 s trzymania. 1./2. odbicie → cel null (do partnera), chyba że partner dalej niż 6 m od miejsca ataku → kiwka (cel „między rywalami”, siła 0,1); w praktyce partner nigdy nie jest tak daleko (§9 pkt 24). 3. odbicie → cel `defaultAttackTarget` + szum `noiseM × trójkątny`. Serwis: po 1,0 s, cel „między rywalami” + szum, siła z `servePower`.
- **Ruch**: `move` = kierunek do celu × min(1, maxSpeed/4,6), z hamowaniem w promieniu 0,15 m; do piłki staje 0,3 m za punktem lądowania (atak) albo 0,15 m za punktem przyjęcia (od strony własnej linii końcowej). Wektor `move` kwantowany (krok 0,01, `AI_MOVE_QUANTUM`) i wysyłany tylko przy zmianie (zwięzłe nagrania); po kwantyzacji |move| ≤ maxSpeed/4,6 (Nowicjusz: ≤ 0,783), żeby zaokrąglenie składowych nie wypuściło AI szybciej niż profil **[F0]**. Cel ruchu nie bliżej siatki niż 0,5 m i nie dalej niż 1,5 m za liniami. Stałe algorytmu AI (histereza roli, marginesy, wyprzedzenia) leżą w `src/ai/profile.ts`, nie w `src/sim/constants.ts` – sim ich nie zna.
- **Losowość**: `createAi(seed)` seeduje własny strumień mulberry32 z `seed ^ AI_SEED_MIX` (stała mieszająca, żeby AI i sim z tego samego ziarna nie ciągnęły tych samych liczb). Po nowym secie `AiState` reseeduje rng z nowego ziarna – bez tego drugi set z tym samym seedem grał inaczej niż pierwszy **[F0]**.
- **Nowicjusz [F0]**: reactionTicks 30, positionErrorM 0,6, maxSpeed 3,6, aggression 0,5, caution 0,5, noiseM 1,0, servePower [0,2, 0,6], attackPower [0,3, 0,7].

## 7. Render (docs/20 §4.1, bez powtórek)

- Kamera (od 2026-09-25 pod poziom, `CAMERA_LANDSCAPE` w `src/render/camera.ts`; poprzednia jako `CAMERA_F0`): `(camX, 3.2, −20.5)` (11,5 m za linią końcową drużyny 0; F0: −15, czyli 6 m), `lookAt(camX, 1.1, 0)`. `camX` → lerp 0,08/klatkę (w 60 fps; niezależne od fps: `1 − 0.92^(dt·60)`) do `0.35·x_aktywnego + 0.25·x_partnera + 0.4·x_piłki` (F0: 0,6 aktywny + 0,4 piłka); w fazie serwisu (piłka w ręce) waga piłki idzie do zawodników **[F0]**. FOV: w poziomie **stałe poziome 63,6°** (= 32° pionowo przy 844 × 390), pionowe liczone z proporcji i przycięte do 30–60° (16:9 → 38,5°, 4:3 → 49,9°); w pionie (furtka) 76° pionowo **[F0]**. Dobór pomiarem: warunek „obaj zawodnicy drużyny gracza cali w kadrze w 100 % klatek 844 × 390 w AI vs AI i w scenariuszu, w którym człowiek biega od linii do linii, piłka w kadrze ≥ 97 %”, z wariantów spełniających – największy zapas do krawędzi (raport F0 §8). Przy ataku aktywnego (event `contact` kind attack) dojazd kamery: −4 % FOV osiągane po 100 ms, cały efekt tam i z powrotem 200 ms. Kamera nie obraca się.
- Scena: podłoga granat `#0A2540` (płaszczyzna 30 × 40 m, `receiveShadow`), linie białe 5 cm (jedna geometria, `LineSegments` albo cienkie płaszczyzny) na y = 0,002, siatka jako płaszczyzna półprzezroczysta z białą taśmą górną, słupki. Kapsuły `CapsuleGeometry(0.3, 1.2, 4, 12)` – gracz `#0A5AA8`, partner `#109CE4`, rywale `#D62410` i `#B81E0C`; `rotation.y = facing` z sim (kapsuła obraca się w kierunku biegu; na razie bez znaczenia wizualnego, w F2 model musi patrzeć tam, gdzie biegnie); piłka `#F79300` (sfera r 0,105, 16 × 12). Piłka **nie rzuca cienia z mapy** (`castShadow` false) – jedyny cień piłki to płaskie ciemne koło r 0,13 na y = 0,006 (krycie 0,45 przy podłodze → 0,2 na 4 m); cień z mapy i koło dawały dwa cienie w różnych miejscach **[F0]**. Kolejność warstw na podłodze (żeby nic nie migotało): linie 0,002 < cień piłki 0,006 < pierścienie ≥ 0,01 **[F0]**. Pierścień **„tu stań”** (`RingGeometry`, bursztyn `#FBB014`, promienie 0,28–0,36, y 0,01) na `landing.intercept` – miejscu, gdzie opadająca piłka przecina 1,1 m – a nie na punkcie lądowania (decyzja Dawida 2026-09-25: dziecko biegnie do pierścienia, nie liczy toru); punkt lądowania pokazuje cień piłki, który sunie pod nią i kończy w nim. Widoczny tylko w fazie `rally` gdy `landing.valid && !hitsNet` (w fazie serwisu piłka w ręce nie ma toru, po punkcie pierścień mylił). Pierścień aktywnego (biały, promienie 0,38–0,46, y 0,012) pod stopami `state.active`. Celownik (pierścień 0,30–0,36 + krzyż, y 0,014) na `view.aim ?? defaultAttackTarget` gdy `view.holding`.
- Światło: `DirectionalLight` z cieniem (mapa 1024, kamera ortogonalna dopasowana do boiska) + `HemisphereLight`. Bez postprocesu. `setPixelRatio(min(devicePixelRatio, maxPixelRatio))`, domyślnie 2. Przełączniki `RenderOptions` (antyaliasing, cienie, maxPixelRatio) tylko do pomiaru na telefonie – docelowe ustawienia jakości to decyzja F1 po liczbach.
- Budżet: ≤ 60 draw calls (oczekiwane ~16), ≤ 120 k trójkątów.

## 8. Harness (Playwright, Chromium)

- Serwer: każdy skrypt uruchamia własny `vite preview` na porcie **4317** (nie 4173 – na tej maszynie równolegle pracują repo gry 2D i strony, oba na Vite) i odmawia startu, gdy coś już słucha na tym porcie; zabija wyłącznie drzewo procesów, które sam uruchomił. `--ekran SZERxWYS` zmienia rozmiar okna telefonu. W pionie skrypty przechodzą nakładkę „Obróć telefon” furtką „Graj mimo to” (`passRotateGate`). Perf, przyjęcie i zrzuty startują Chromium bez limitu klatek (`--vsync` przywraca limit): 2026-09-25 z vsync po wygaszeniu monitora przez Windows (15 min bezczynności) rAF spadał do 1 Hz – 39 z 50 prób przyjęcia z klatkami po 1011 ms i zrzut „punkt” bez punktu w 60 s.
- `harness/kadr.ts`: 844 × 390 @3×, `?ai=1&seed=7`, 60 s; licznik kadru z renderu (`framing()`) od resetu po rozgrzewce: klatki z obydwoma zawodnikami drużyny gracza w całości / częściowo, per zawodnik, piłka, najmniejszy zapas do krawędzi, średnia wysokość zawodnika w px.
- `harness/sterowanie.ts`: test (kod wyjścia 1 przy błędzie) sterowania względnego prawdziwymi dotykami CDP w 844 × 390 – §4.
- `harness/perf.ts`: 390 × 844 (ekran budżetu z CLAUDE.md, za furtką), `deviceScaleFactor 3`, `isMobile`, `hasTouch`; CDP `Emulation.setCPUThrottlingRate {rate: 4}`; `?ai=1&seed=7`; 60 s; odczyt `frameTimes()` → p50/p95 czasu klatki i fps p95 = 1000 / p95; `renderInfo()` po klatce. Chromium startuje bez limitu klatek (`--disable-gpu-vsync --disable-frame-rate-limit`; flaga `--vsync` przywraca limit ekranu do porównania), żeby p95 mierzył koszt klatki, a nie okres odświeżania; gdy mediana i tak równa się okresowi ekranu (mały rozrzut p99 − p50), harness ostrzega o przycięciu do częstotliwości monitora (rAF nie dał się odpiąć – wynik mówi tylko „nie poniżej częstotliwości ekranu”). Bufor `frameTimes()` ma 16384 klatek: bez limitu przy ~300 fps mieści ~55 s z 60 – harness ostrzega, ile sekund objęły statystyki (to ostatnie klatki pomiaru), i radzi skrócić `--sekundy`. Wynik JSON + tekst do `harness/wyniki/perf-<data>.json` i na stdout. Uwaga: headless Chromium używa SwiftShader – domyślnie tryb headed z GPU; flaga `--headless` do porównania; w raporcie zaznaczyć, który tryb.
- `harness/przyjecie.ts`: 844 × 390 (od 2026-09-25; wcześniej 390 × 844), tap w (50 %, 72 %) okna; 50 prób; każda: `newSet({seed: 1000+i, servingTeam: 1, humanControl: true})`, czekanie na serwis, **dobieg** aktywnego do punktu `landing.intercept − 0,15 m` (od strony własnej linii końcowej; przyjęcie na 1,1 m, nie na lądowaniu) klawiszami WASD (prawdziwa warstwa input; serwis AI „między rywalami” ląduje ~1,8 m od odbierającego, więc bez dobiegu przyjęcie jest strukturalnie niemożliwe), odczyt `reachWindow(active)` co 8 ms (dobieg zmienia okno); **prognoza wejścia zamrożona** w chwili, gdy piłka wejdzie w zasięg (`reachWindow` zwraca „teraz” i przestaje być prognozą). Tap (`touchscreen.tap`) w losowym momencie okna **[wejście − 0,25 s, wejście + 0,25 s]** (PRNG w harnessie z ziarna). Uzasadnienie: model „przytrzymaj do kontaktu” – wcześniejszy tap jest poprawny (0,12 s łaski po puszczeniu, dalej okno czeka na piłkę), późniejszy kończy się biernym kontaktem, bo piłka od wejścia w zasięg do kapsuły leci ~60 ms; histogram po koszach 50 ms pokazuje, które opóźnienia jeszcze trafiają. Chwila tapu odczytywana z `swingStartTick` w sim (tick, w którym sim otworzył okno), nie z zegara harnessu. Próby, w których pętla renderu przystanęła (najdłuższa klatka rAF w próbie > 100 ms według bufora `frameTimes()` zerowanego na starcie próby – okno w tle, GC) liczone osobno jako niewiarygodne; Chromium startuje z flagami przeciw dławieniu zasłoniętych okien (`--disable-backgrounding-occluded-windows`, `--disable-renderer-backgrounding`, `--disable-background-timer-throttling`). Sukces = `lastContact.player === active` (nie bierny) i `landing.valid` po naszej stronie (piłka leci do partnera). Raport: odsetek sukcesów z prób wiarygodnych, średnia jakość, histogram opóźnień, powody porażek.
- `harness/zrzuty.ts`: zrzuty 844 × 390, 390 × 844 i 1280 × 720 do `docs/zrzuty/` (serwis, wymiana, po punkcie); w 390 × 844 najpierw zrzut nakładki „Obróć telefon” (`f0-390x844-obrot.png`) z kontrolą, że tick sim stoi przez 1 s, potem furtka i te same trzy zrzuty. Zrzut „punkt” robiony 300 ms po zdarzeniu `point` – wtedy toast już stoi, a piłka jeszcze leży w miejscu, gdzie spadła.

## 9. Lista założeń przyjętych w F0 (koncepcja milczała)

1. Model uderzenia „przytrzymaj do kontaktu” (§3) zamiast rozdzielnych gestów tap/hold – jeden palec, jedna zasada.
2. Rozróżnienie przeciągnięcia i zamachu po 120 ms / 12 px; drugi palec = zamach.
3. Celowanie = przesunięcie palca w trakcie trzymania zamachu (nie kierunek ruchu).
4. Przełączanie aktywnego tylko przed pierwszym odbiciem po naszej stronie + ratunek (§5).
5. Bierny kontakt z kapsułą liczy się jako odbicie.
6. Pas siatki 10 m (słupki), przejście poniżej krawędzi poza pasem = błąd.
7. Serwujący nie rusza się przed serwisem; serwis gracza bez paska timingu (jakość 1).
8. Naprzemienny serwujący w drużynie.
9. Miejsca rozgrywającego (2,2 m od siatki) i ataku (1,1 m), apogea 3,4 / 3,0 m, prędkości 9–19 m/s atak, 10,5–16 serwis.
10. Tłumienie liniowe 0,1 1/s z dokładnym całkowaniem (tor przewidywalny bit w bit).
11. Kamera: `lookAt` na 1,1 m; od 2026-09-25 ustawienia z pkt 27 (wcześniej FOV 72° portret / 48° poziom, 6 m za linią).
12. Cel „między rywalami” = środek odcinka między rywalami przycięty do boiska z marginesem 0,4 m i min. 2,0 m od siatki.
13. Profil Nowicjusz – wartości startowe do strojenia w F1.
14. Oś x: prawo ekranu = −x świata (render nie odbija sceny – odbicie zepsułoby w F3 tekst na banerach i znak na koszulkach); mapowanie w `aim.ts` i `gesty.ts`. Gracz (slot 0) stoi po prawej stronie ekranu, partner po lewej.
15. Podłoga: miejsce dotknięcia interpolowane w obrębie ticku (aut oceniany tam, gdzie piłka naprawdę dotknęła parkietu); przejście nad siatką rozstrzygane przed zamachami w tym samym ticku.
16. Auto-skok ma gałąź predykcyjną (skok wtedy, gdy w apogeum piłka będzie w zasięgu nad zawodnikiem), a AI zamachuje się z wyprzedzeniem ~0,47 s dla piłek wchodzących w zasięg od góry – bez tego atak był zawsze lobem (kontakt na 2,6 m, prędkość niezależna od siły). Po zmianie: siła 0,25–0,5 → ~12,5 m/s, 0,5–0,75 → ~14,4 m/s, kontakt ~2,9 m.
17. Bufor czasów klatek 16384 (monitor 150 Hz mieści 60 s pomiaru; bez limitu klatek przy ~300 fps tylko ~55 s – harness to wypisuje, §8).
18. Harness przyjęcia dobiega klawiaturą do punktu przyjęcia (`landing.intercept`) przed tapem (§8).
19. Predykcja ma dwa punkty: lądowanie i punkt przyjęcia na 1,1 m (`intercept`, używany przez AI i harness). Przy płaskim serwisie różnią się o 1–3 m. **Rozstrzygnięte (Dawid, 2026-09-25):** pierścień pokazuje miejsce, gdzie stanąć (`intercept`); punkt lądowania zostaje jako cień piłki (§7).
20. Serwis lob/strzał z siły (§2) – bez tego serwis Nowicjusza był zawsze płaski i okno przyjęcia przy pierścieniu trwało ~40 ms.
21. Asymetria drużyn w AI vs AI to efekt przyjmowania pierwszego serwisu, nie błąd: w 300 setach drużyna przyjmująca pierwszy serwis wygrywa 54 % setów, przy 0 asach i 53 % skuteczności ataku (przyjmujący ma pierwszy atak, serwis Nowicjusza nie punktuje sam). Profil jest identyczny dla obu drużyn.
22. `Math.exp`, `Math.log`, `Math.atan2` w sim/ai są deterministyczne w jednym silniku JS (ten sam seed + wejścia = ten sam stan bit w bit), ale między silnikami (V8 vs JavaScriptCore vs SpiderMonkey) możliwa jest różnica ostatniego ulp. Wniosek dla „meczu tygodnia” w F1: porównywać wyniki (punkty, zdarzenia), nie surowe stany; powtórka odtwarzana lokalnie jest bezpieczna.
23. Auty AI: 0 % w 962 punktach AI vs AI – cel ataku i serwisu jest przycięty do boiska z marginesem 0,4 m, a szum Nowicjusza (1,0 m) rzadko wynosi piłkę za linię. F1 zakłada ≤ 12 % autów dla Nowicjusza; zero wygląda nienaturalnie i jest do strojenia (szum albo margines), nie do naprawy w F0.
24. Zero kiwek: gałąź „partner dalej niż 6 m od miejsca ataku → kiwka” (§6) nigdy się nie uruchamia, bo partner po 1. odbiciu zawsze biegnie na miejsce ataku i jest bliżej niż 6 m. Kod zostaje (profil agresywniejszy w F1 może korzystać), F0 nie ma kiwek.
25. Skan granic obejmuje też warstwy nad sim: `src/ai`, `src/input`, `src/ui`, `src/render`, `src/loop` importują sim tylko z `src/sim/index` (reguła w `scripts/check-granice.mjs`, próbki w `tests/narzedzia/granice.test.ts`).

Poprawki przed bramą F0 (2026-09-25):

26. Gra jest pozioma. Pion na telefonie = nakładka „Obróć telefon” (§1 src/ui) z furtką „Graj mimo to” zapamiętaną w `sessionStorage` – nie w profilu, bo w F0 nie ma miejsca, gdzie wybór dałoby się cofnąć. Warunek nakładki: `pointer: coarse` i `innerWidth < innerHeight`; kwadrat gra. Blokada poziomu (`requestFullscreen` + `orientation.lock`) z pierwszego dotyku – wejście w pełny ekran w trakcie pierwszego gestu może na Androidzie zmienić rozmiar okna w połowie gestu; do sprawdzenia na bramie.
27. Kamera pod poziom (§7): 11,5 m za linią zamiast ~6 m z docs/20 §4.1, cel w x z partnerem (0,35 / 0,25 / 0,4 zamiast 0,6 aktywny + 0,4 piłka), stałe FOV poziome 63,6°. Uzasadnienie liczbami: stara kamera w poziomie trzymała obu w kadrze w AI vs AI (100 %), ale gdy człowiek biega od linii do linii – tylko w 72 % klatek; nowa w obu scenariuszach 100 % przy tym samym rozmiarze zawodnika (80 px na 390 px wysokości) i zapasie do krawędzi 69 px zamiast 12 px. Wariant z większym zawodnikiem (~95 px, 32° i kamera 9 m za linią) odpadł, bo w scenariuszu skrajnym gubił partnera w ~30 % klatek.
28. Pierścień = miejsce, gdzie stanąć (pkt 19).
29. Harness na własnym porcie 4317 z kontrolą zajętości (§8) – na maszynie Dawida równolegle działają serwery Vite gry 2D i strony.
30. Znak klubu (`src/ui/club-mark.webp`) wzięty z gry 2D z wpisem w docs/ASSETY.md; licencja: znak własny klubu, nie CC0 – do potwierdzenia przez Dawida.
31. Wdrożenie: projekt Vercela `uks-wieszowa-gra-3d`, produkcja = `main` (decyzja Dawida 2026-09-25: F0 scalone do `main` przed bramą, brama = gra na telefonie pod adresem produkcyjnym). `source` w `vercel.json` to składnia path-to-regexp 6.1.0, nie wyrażenie regularne – pierwszy build gałęzi padł na `^/.+/assets/(.+)$`. `tests/narzedzia/vercel.test.ts` waliduje plik kodem Vercela (`@vercel/routing-utils`) i sprawdza nagłówki cache, SPA fallback oraz zagnieżdżone `…/assets/…`. Drugi i trzeci build padły w `prettier --check` na `vercel.json`: `vercel build` zmienia formatowanie pliku w katalogu buildu (w gicie plik jest czysty), więc `vercel.json` jest w `.prettierignore`, a `.vercel/` w `.gitignore` i ignorowanych ESLint.
