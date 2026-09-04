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
```

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
createRenderer(canvas: HTMLCanvasElement): GameRenderer
interface ViewState { aim: Vec2 | null; holding: boolean; power: number }   // z input, dla celownika
interface GameRenderer {
  render(state: SimState, view: ViewState, dtSeconds: number): void
  resize(width: number, height: number, dpr: number): void
  info(): { calls: number; triangles: number; programs: number }            // renderer.info.render
  dispose(): void
}
```

### src/input (dotyk, klawiatura → komendy)

```ts
createInput(target: HTMLElement): InputController
interface InputController {
  poll(state: SimState): Command[]   // raz na klatkę, przed krokami sim; komendy dla state.active
  view(): ViewState
  dispose(): void
}
```

### src/ui (zwykły DOM)

```ts
createHud(root: HTMLElement, handlers: { onNewSet(): void }): Hud
interface Hud { update(state: SimState): void; dispose(): void }
```

### src/loop

```ts
startGame(opts: { canvas: HTMLCanvasElement; hudRoot: HTMLElement; seed: number;
                  humanControl: boolean; servingTeam: TeamId }): Game
interface Game { newSet(opts?): void; stop(): void; state(): SimState }
```

Pętla: `requestAnimationFrame` → `dt = min(now − last, 0.25 s)` → `acc += dt` → `cmds = input.poll(state)` → dopóki `acc ≥ DT`: `ai = aiCommands(ai, state, controlled)`, `step(state, [...cmds, ...ai])`, `cmds = []`, `acc −= DT`, nagranie → `render(state, input.view(), dt)` → `hud.update(state)`. `controlled` = wszyscy poza `state.active` gdy `humanControl`, inaczej cała czwórka. Bez interpolacji renderu w F0.

Parametry URL: `?seed=123` (ziarno), `?ai=1` (AI vs AI), `?serwis=1` (serwują czerwoni). Domyślnie: seed z liczby dnia, człowiek gra, serwują niebiescy.

Haki deweloperskie (harness) na `window.__sw3d`:

```ts
interface DevHooks {
  version: string
  state(): SimState                                                 // żywa referencja, tylko do odczytu
  newSet(opts?: { seed?: number; servingTeam?: TeamId; humanControl?: boolean }): void
  frameTimes(): number[]        // czasy klatek w ms (rAF delta), bufor 4096; resetFrameTimes(): void
  renderInfo(): { calls: number; triangles: number; programs: number }
  reachWindow(player: PlayerId): { enterInS: number; exitInS: number } | null   // względem teraz
}
```

## 2. Zasady gry w sim

- Boisko 9 × 18 m, siatka z = 0, 2,24 m, pas |x| ≤ 5 m. Zawodnik nie przechodzi na drugą połowę (z ograniczone do własnej połowy, margines 2 m za liniami).
- Odbicia: max 3 na stronę; czwarty kontakt = punkt dla rywali. Ten sam zawodnik dwa razy z rzędu po tej samej stronie = punkt dla rywali. Przejście nad siatką zeruje licznik.
- Bierny kontakt piłki z kapsułą (bez zamachu) liczy się jako odbicie **[F0]** – odbicie z restytucją 0,45. Po własnym uderzeniu kapsuła nie koliduje z piłką przez 0,3 s.
- Piłka na podłodze: w boisku (cień dotyka linii = w boisku, promień 0,105) → punkt dla drużyny z drugiej strony; poza boiskiem → punkt dla drużyny przeciwnej do ostatniego kontaktu.
- Siatka: przejście z = 0 poniżej 2,24 w pasie → odbicie z prędkością × √0,4; wymiana trwa. Przejście poniżej krawędzi poza pasem (za słupkami) → `under-net`, punkt dla rywali ostatniego kontaktu **[F0]**.
- Punktacja: do 7, przewaga 2, limit 10. Po punkcie pauza 1,5 s, potem serwis drużyny, która wygrała punkt; w drużynie serwują naprzemiennie **[F0]**. Set zaczyna gracz (drużyna 0, zawodnik 0), chyba że `servingTeam: 1`.
- Serwis: serwujący stoi za linią końcową (x = ±2, z = ±9,6), piłka w ręce na 2,0 m. Nie rusza się do serwisu **[F0]**. Bez paska timingu w F0 – serwis gracza ma jakość 1 (zero szumu); siła z czasu trzymania, kierunek z celu. AI serwuje po 1,0 s.

## 3. Model uderzenia: „przytrzymaj do kontaktu” [F0]

Koncepcja mówi „dotknięcie – timing względem piłki” i „czas trzymania = siła”. Przyjęty model, jeden dla dotyku, klawiatury i AI:

1. `swing` = ręce w górę. Otwiera **okno kontaktu**: trwa, dopóki zawodnik trzyma (max 0,8 s) plus 0,12 s po `release` (dzięki temu krótkie tapnięcie też działa).
2. Kontakt następuje w pierwszym ticku okna, w którym piłka jest w zasięgu: poziomo ≤ 0,95 m + promień od środka kapsuły, pionowo 0,2 m ≤ y ≤ 2,35 m + wysokość skoku, po własnej stronie siatki (albo |z| < 0,35).
3. **Jakość timingu** 0..1 liczona z położenia piłki w chwili kontaktu: odległość pozioma (1 przy środku, 0,4 na krawędzi zasięgu) × pasmo wysokości zależne od rodzaju (przyjęcie 0,6–1,8 m, wystawa 1,6–2,4, atak 2,0–zasięg; poza pasmem liniowo do 0,4 na granicy zasięgu). Szum celu = 2,2 m × (1 − jakość), rozkład trójkątny z PRNG sim. Zerowy szum tylko przy idealnym kontakcie – zgodnie z docs/20 §5.
4. **Siła** 0..1 = czas trzymania do kontaktu: ≤ 0,08 s → 0 (plas), ≥ 0,6 s → 1 (bomba). AI podaje siłę wprost (`power`).
5. Okno bez kontaktu → **pudło** (`whiff`), blokada zamachu 0,3 s. To jest kara za zły timing.
6. **Auto-skok**: zawodnik w zamachu, na ziemi, piłka nad nim wyżej niż 2,2 m i nie wyżej niż 3,25 m → skok (apogeum 0,6 m). Kontakt następuje w skoku, gdy piłka wejdzie w zasięg.
7. Rodzaj kontaktu z numeru odbicia i celu: 1. odbicie bez celu = **przyjęcie** (łuk do miejsca rozgrywającego = x partnera przycięte do ±2,5, 2,2 m od siatki, apogeum 3,4 m); 2. bez celu = **wystawa** (łuk do miejsca ataku = x partnera przycięte do ±3,5, 1,1 m od siatki, apogeum 3,0 m); 3. odbicie zawsze **atak**; 1./2. z celem = atak („skrót”). Atak i serwis: najpłaszczy łuk do celu o prędkości ≤ lerp(9, 19, siła) (serwis 10,5–16), który przechodzi nad siatką z zapasem 0,12 m (`solveShot`). Cel ataku bez celownika = „między rywalami”.
8. Przyjęcie i wystawa zawsze do partnera, więc w F0 aktywny gracz może grać tylko: podanie do partnera (tap) albo atak (z celem lub na 3. odbiciu).

## 4. Sterowanie (src/input) [F0 – interpretacja docs/20 §3.3]

Dotyk (Pointer Events, `touch-action: none`):

- **Palec w dół i ruch > 12 px w pierwszych 120 ms** = przeciągnięcie = ruch: wirtualny joystick względem punktu dotknięcia, nasycenie 70 px, góra ekranu = w stronę siatki. Trwa do puszczenia; komenda `move` tylko przy zmianie wektora.
- **Palec w dół i bez ruchu przez 120 ms** = zamach (`swing`, cel null). Dalsze przesunięcie palca w trakcie trzymania = **celowanie** (kierunek od punktu dotknięcia → `aimFromDirection`; celownik na połowie rywali podąża). Puszczenie = `release`.
- **Tapnięcie** (puszczenie przed 120 ms, bez ruchu) = `swing` + `release` w tej samej klatce → dzięki oknu 0,12 s działa jako „uderz teraz”; bez celu = wystawa do partnera przy 1./2. odbiciu.
- **Drugi palec** podczas przeciągania = zamach (żeby dało się biec i uderzać w poziomie, dwoma kciukami).
- Komendy idą do `state.active` z chwili początku gestu (przełączenie aktywnego w trakcie trzymania nie zmienia adresata).

Klawiatura: WASD/strzałki = ruch; strzałki dodatkowo ustawiają cel, gdy trzymane; spacja w dół = `swing` (cel ze strzałek), spacja w górę = `release`; spacja bez strzałek = cel null. N = nowy set.

## 5. Przełączanie aktywnego zawodnika [F0]

Docs/20 §3.1: „ten, do którego leci piłka, z histerezą”. Doprecyzowanie, żeby nie odbierać graczowi ataku:

- Kandydat = bliższy przewidywanego lądowania (`landing.pos`) z pary 0/1. Przełączenie tylko, gdy kandydat jest bliżej o ≥ 0,75 m i od ostatniego przełączenia minęło ≥ 0,5 s.
- Ocena tylko, gdy piłka leci na naszą stronę i **nikt z nas jej jeszcze nie dotknął** (`touches === 0` po naszej stronie) – czyli przy serwisie i ataku rywali. W trakcie naszej akcji (po 1. odbiciu) aktywny zostaje, a partner-AI wystawia sam.
- Wyjątek „ratunek”: w trakcie naszej akcji, jeśli aktywny nie zdąży (odległość / 4,6 m/s > czas do lądowania + 0,25 s), a partner zdąży – przełączamy.
- Gdy serwuje drużyna 0, aktywny = serwujący (może to być zawodnik 1).
- Zdarzenie `active-switch`; po przełączeniu `move` poprzednio aktywnego zerowane.

## 6. AI (src/ai) wg docs/20 §6, jeden profil

- **Percepcja**: co `reactionTicks` odczyt `sim.landing` + błąd `positionErrorM × trójkątny` (stały do następnego odczytu). Piłka nie w locie → brak.
- **Rola w parze**: gdy piłka leci na naszą stronę – do piłki idzie ten z krótszym czasem dojścia (odległość / maxSpeed), histereza 0,15 s. Drugi: przed 1. odbiciem → miejsce rozgrywającego (`setterSpot`), przed 2. → miejsce ataku (`attackSpot`), przed 3. → asekuracja (pozycja bazowa). Piłka po drugiej stronie → pozycje bazowe.
- **Partner gracza** (gdy `humanControl` i para zawiera `sim.active`): „nie zabieraj gry” – jeśli aktywny człowiek zdąży do lądowania (czas dojścia ≤ czas lotu + 0,2 s), partner nie idzie do piłki i nie zamachuje się; idzie na pozycję rozgrywającego/ataku. Wyjątek: człowiek nie zdąży.
- **Zamach**: w roli „do piłki”, gdy `reachWindow` mówi, że piłka wejdzie w zasięg w ≤ 0,1 s albo już jest → `swing` z `power` z profilu; `release` po kontakcie albo po 0,5 s. 1./2. odbicie → cel null (do partnera), chyba że partner dalej niż 6 m od miejsca ataku → kiwka (cel „między rywalami”, siła 0,1). 3. odbicie → cel `defaultAttackTarget` + szum `noiseM × trójkątny`. Serwis: po 1,0 s, cel „między rywalami” + szum, siła z `servePower`.
- **Ruch**: `move` = kierunek do celu × min(1, maxSpeed/4,6), z hamowaniem w promieniu 0,15 m; do piłki staje 0,3 m za punktem lądowania (od strony własnej linii końcowej).
- **Nowicjusz [F0]**: reactionTicks 30, positionErrorM 0,6, maxSpeed 3,6, aggression 0,5, caution 0,5, noiseM 1,0, servePower [0,2, 0,6], attackPower [0,3, 0,7].

## 7. Render (docs/20 §4.1, bez powtórek)

- Kamera: `(camX, 3.2, −15)` (6 m za linią końcową drużyny 0), `lookAt(camX, 1.1, 0)`. `camX` → lerp 0,08/klatkę (w 60 fps; niezależne od fps: `1 − 0.92^(dt·60)`) do `0.6·x_aktywnego + 0.4·x_piłki`. FOV pionowe: portret 62°, poziom 48° **[F0]**. Przy ataku aktywnego (event `contact` kind attack) dojazd −4 % FOV w 200 ms i powrót. Kamera nie obraca się.
- Scena: podłoga granat `#0A2540` (płaszczyzna 30 × 40 m, `receiveShadow`), linie białe 5 cm (jedna geometria, `LineSegments` albo cienkie płaszczyzny), siatka jako płaszczyzna półprzezroczysta z białą taśmą górną, słupki. Kapsuły `CapsuleGeometry(0.3, 1.2, 4, 12)` – gracz `#0A5AA8`, partner `#109CE4`, rywale `#D62410` i `#B81E0C`; piłka `#F79300` (sfera r 0,105, 16 × 12). Cień piłki – płaskie ciemne koło r 0,13 na y = 0,005. Pierścień lądowania (`RingGeometry`, bursztyn `#FBB014`) gdy `landing.valid && !hitsNet`. Pierścień aktywnego (biały, r 0,45) pod stopami `state.active`. Celownik (pierścień + krzyż) na `view.aim ?? defaultAttackTarget` gdy `view.holding`.
- Światło: `DirectionalLight` z cieniem (mapa 1024, kamera ortogonalna dopasowana do boiska) + `HemisphereLight`. Bez postprocesu. `setPixelRatio(min(devicePixelRatio, 2))`.
- Budżet: ≤ 60 draw calls (oczekiwane ~16), ≤ 120 k trójkątów.

## 8. Harness (Playwright, Chromium)

- `harness/perf.ts`: 390 × 844, `deviceScaleFactor 3`, `isMobile`, `hasTouch`; CDP `Emulation.setCPUThrottlingRate {rate: 4}`; `?ai=1&seed=7`; 60 s; odczyt `frameTimes()` → p50/p95 czasu klatki i fps p95 = 1000 / p95; `renderInfo()` po klatce. Wynik JSON + tekst do `harness/wyniki/perf-<data>.json` i na stdout. Uwaga: headless Chromium używa SwiftShader – domyślnie tryb headed z GPU; flaga `--headless` do porównania; w raporcie zaznaczyć, który tryb.
- `harness/przyjecie.ts`: 50 prób; każda: `newSet({seed: 1000+i, servingTeam: 1, humanControl: true})`, czekanie na serwis, odczyt `reachWindow(active)`; tap (`touchscreen.tap`) w losowym momencie okna [wejście, wejście + 0,25 s] (PRNG w harnessie z ziarna); sukces = `lastContact.player === active` i `landing.valid` po naszej stronie (piłka leci do partnera). Raport: odsetek sukcesów, średnia jakość, histogram opóźnień.
- `harness/zrzuty.ts`: zrzuty 390 × 844 i 1280 × 720 do `docs/zrzuty/` (serwis, wymiana, po punkcie).

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
11. Kamera: FOV 62° portret / 48° poziom; `lookAt` na 1,1 m.
12. Cel „między rywalami” = środek odcinka między rywalami przycięty do boiska z marginesem 0,4 m i min. 0,8 m od siatki.
13. Profil Nowicjusz – wartości startowe do strojenia w F1.
