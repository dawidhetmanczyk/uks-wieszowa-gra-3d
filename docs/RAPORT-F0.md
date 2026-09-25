# Raport F0 – szkielet i prototyp uczucia

Gałąź: `f0/prototyp`, scalona do `main` 2026-09-25 decyzją Dawida – przed bramą, żeby grać z produkcji Vercela (§8.1). Data: 2026-09-05, poprawki przed bramą 2026-09-25 (§8). Autor: Claude Code, brama: Dawid.

## 1. Co jest do sprawdzenia na bramie

Prototyp sterowania i kamery w 2 na 2: cztery kapsuły, piłka, siatka, boisko 9 × 18, pełne zasady (3 odbicia, podwójne odbicie, aut wg cienia, set do 7 / przewaga 2 / limit 10), AI Nowicjusz dla partnera i rywali, HUD, przycisk „Nowy set”. Wszystko jako kapsuły i prostokąty, bez modeli, hali, efektów, dźwięku, menu, poziomów, PWA (zgodnie z zakresem F0 w docs/21).

Uruchomienie na telefonie: **https://uks-wieszowa-gra-3d.vercel.app** (produkcja Vercela z `main`, §8.1) – bez sieci lokalnej i bez `pnpm dev --host`. Gra jest pozioma: w pionie pokaże się prośba o obrót z furtką „Graj mimo to”. Parametry: `?ai=1` (AI vs AI), `?serwis=1` (serwują czerwoni), `?seed=123`, `?fps=1`, `?jakosc=niska`.

Awaryjnie, w tej samej sieci Wi-Fi:

```bash
pnpm install && pnpm dev
```

Pytania z bramy (docs/21): trafiam w piłkę bez frustracji? wiem, gdzie spadnie? przełączanie zawodnika jest zrozumiałe? wystawa do partnera działa intuicyjnie?

## 2. Sterowanie w F0 (interpretacja docs/20 §3.3 – patrz §5 tego raportu)

Telefon, jeden palec:

| Gest | Co robi |
|---|---|
| przeciągnięcie (ruch > 12 px w pierwszych 120 ms) | ruch – joystick względem punktu dotknięcia; góra ekranu = w stronę siatki |
| przytrzymanie w miejscu (≥ 120 ms) | zamach – „ręce w górze”; kontakt następuje, gdy piłka doleci (do 0,8 s); im dłużej trzymasz, tym mocniej (tylko atak) |
| przesunięcie palca w trakcie trzymania | celowanie – celownik na połowie rywali |
| tapnięcie (puszczenie przed 120 ms) | szybkie uderzenie z 0,12 s łaski; bez celu przy 1. i 2. odbiciu = wystawa do partnera |
| drugi palec podczas biegu | zamach (dwa kciuki w poziomie) |

Klawiatura: WASD/strzałki ruch, spacja zamach (trzymaj = siła), strzałki przy spacji = kierunek, N = nowy set.

Sterujesz tym z pary, do którego leci piłka (pierścień pod stopami, „Sterujesz: Ty/Partner” w HUD). Pierścień bursztynowy = przewidywane lądowanie piłki.

## 3. Pomiary

### 3.1 Wydajność (harness `pnpm harness:perf`, 60 s AI vs AI, 390 × 844 @3×, CPU throttling 4×, Chromium headed bez limitu klatek)

| Miara | Wynik | Próg (CLAUDE.md) |
|---|---|---|
| Czas klatki (koszt CPU + GPU, bez vsync) | p50 1,30 ms, p95 2,40 ms, p99 3,40 ms, średnia 1,44 ms | – |
| fps p95 | 417 (1000 / p95) | ≥ 55 – PASS |
| Draw calls na klatkę | 18 | ≤ 60 – PASS |
| Trójkąty na klatkę | 2 288 | ≤ 120 000 – PASS |
| Programy shaderów | 5 | – |
| Sim | 7203 ticków w 60,2 s (oczekiwane 7218) – nadążał | – |
| Kanwa | 780 × 1688 px (dpr 3 → pixelRatio przycięty do 2), antialias, cienie | – |
| Bundle JS gzip | 146,6 kB (564 kB min) | ≤ 350 kB – PASS |
| Assety glTF | 0 B | ≤ 4 MB – PASS |

Uwaga: to pomiar na komputerze z GPU NVIDIA RTX 4060 (przez ANGLE/D3D11) z throttlingiem CPU ×4 i wyłączonym limitem klatek (delta rAF = rzeczywisty koszt klatki; pierwszy pomiar z vsync pokazywał 5,8 ms, czyli okres odświeżania monitora 175 Hz, nie koszt). Bufor 16384 klatek objął ostatnie 23,6 s pomiaru. Liczba mówi, że CPU (sim 120 Hz + predykcja toru co tick + AI) i GPU klasy desktop mają ogromny zapas – nie jest pomiarem Androida klasy średniej. Ten trzeba zrobić na telefonie: `?ai=1&fps=1` pokazuje licznik fps w HUD, a przełączniki `?jakosc=niska`, `?dpr=1`, `?aa=0`, `?cien=0` pozwalają zmierzyć, który składnik kosztuje. Headless Chromium (SwiftShader) dawał ~30 fps i nie nadaje się do budżetu.

### 3.2 Przyjęcie serwisu (harness `pnpm harness:przyjecie`, 50 prób)

Definicja pomiaru (docs/22 §8): rywale serwują; aktywny zawodnik dobiega klawiszami WASD do punktu przyjęcia (miejsce, gdzie opadająca piłka przecina 1,1 m); tap (dotyk) pada w losowym momencie okna [wejście piłki w zasięg − 250 ms, +250 ms]; sukces = kontakt aktywnego (nie bierny) i piłka leci do partnera na naszej połowie.

| Miara | Wynik |
|---|---|
| Sukcesy | **25 / 50 (50 %)** przy tapach rozłożonych równomiernie w ±250 ms; 0 prób odrzuconych przez przystanek pętli (najdłuższa klatka 6 ms, raz 40 ms) |
| Średnia jakość udanych kontaktów | 0,52 |
| Średnie opóźnienie kontaktu względem wejścia w zasięg | +12 ms |
| Porażki | 25: 15 „passive” (tap zaplanowany > +100 ms – piłka wcześniej trafiła w kapsułę), 10 „whiff” (tap < −150 ms – okno tapu wygasło przed dolotem) |

Histogram opóźnienia tapu względem wejścia piłki w zasięg (prób / udanych):

| Kosz | Prób | Udanych |
|---|---|---|
| [−250, −200) ms | 4 | 0 |
| [−200, −150) ms | 6 | 0 |
| [−150, −100) ms | 4 | 4 |
| [−100, −50) ms | 4 | 4 |
| [−50, 0) ms | 7 | 7 |
| [0, 50) ms | 5 | 5 |
| [50, 100) ms | 5 | 5 |
| ≥ 100 ms | 0 (tap nie zdążył – piłka wcześniej trafiła w ciało; 15 prób) | – |

Czyli: **każdy tap w oknie od −150 do +100 ms trafia (25/25), skuteczne okno tapu ma ok. 250 ms.** Wcześniejszy tap wygasa (0,12 s łaski) przed dolotem piłki, późniejszy przegrywa z biernym odbiciem od ciała. Jakość kontaktu rośnie z opóźnieniem: tapy przy −100 ms dają ~0,42 (kontakt wysoko, na krawędzi pasma przyjęcia), tapy przy +50…+75 ms ~0,8 (piłka na wysokości bioder). Pierwszy pomiar (przed naprawami harnessu) dawał 17/50 – tapy z dodatnim opóźnieniem nie padały przez błąd w planowaniu chwili tapu; ten wynik jest miarodajny.

Interpretacja: model „przytrzymaj do kontaktu” sprawia, że wcześniejsze naciśnięcie jest bezpieczne (tap daje 0,12 s łaski, przytrzymanie do 0,8 s), a naciśnięcie później niż ok. +100 ms po wejściu w zasięg kończy się biernym odbiciem od ciała – piłka od krawędzi zasięgu (0,95 m) do kapsuły (0,3 m) leci ok. 60–100 ms. Histogram po koszach 50 ms pokazuje tę granicę. Trzymanie palca (zamiast tapnięcia) rozszerza okno do 0,8 s przed wejściem – harness tego wariantu nie mierzy; to wariant, którego dzieci prawdopodobnie użyją najczęściej („trzymaj, aż piłka doleci”).

### 3.3 Testy (`pnpm test`)

129 testów w 14 plikach, wszystkie zielone (Vitest, Node, bez DOM):

| Plik | Co sprawdza |
|---|---|
| tests/sim/balistyka.test.ts | launchVelocity trafia w cel, predictLanding zgodne z torem co do ticku, solveShot nad siatką, solveArc ±2 cm |
| tests/sim/determinizm.test.ts | dwa przebiegi z tym samym seedem i komendami → identyczny JSON stanu; nagranie i replay; inny seed → inny stan |
| tests/sim/zasady.test.ts | 3 odbicia + czwarte = punkt, podwójne odbicie, aut tuż za każdą z 4 linii i w boisku tuż wewnątrz, punktacja 7/2/10, wznowienie po 1,5 s, naprzemienny serwujący |
| tests/sim/kolizje.test.ts | brak przenikania: piłka nigdy pod podłogą, nigdy w kapsule, po siatce po tej samej stronie, zawodnicy nie przechodzą siatki i nie nachodzą na siebie |
| tests/sim/aktywny.test.ts | przełączanie aktywnego: histereza (równoodległe → zero przełączeń), dokładnie jedno przy piłce bliżej partnera, ≤ 1 zmiana na 0,5 s, brak przełączeń w trakcie własnej akcji |
| tests/sim/kontakt.test.ts | okno zamachu, pudło i cooldown, tapnięcie, siła z czasu trzymania, cele przyjęcia/wystawy/ataku, auto-skok, reachWindow |
| tests/ai/determinizm.test.ts | AI vs AI 60 s, dwa przebiegi → identyczny sim i AI; komendy tylko dla sterowanych |
| tests/ai/rozgrywka.test.ts | 5 seedów: set kończy się < 6 min, ≥ 60 % punktów z podłogi, ≥ 2 kontakty na wymianę, obie drużyny punktują |
| tests/ai/partner.test.ts | „nie zabieraj gry”: partner nie zamachuje się, gdy człowiek zdąży; przejmuje, gdy człowiek jest 8 m dalej |
| tests/ai/serwis.test.ts | AI serwuje po 1,0 s, 20/20 serwisów w boisku rywali |
| tests/input/gesty.test.ts | klasyfikacja gestu, joystick, klawisze, mapowanie celu (bez DOM), próg celu ≥ 12 px |
| tests/sim/przeglad-sim.test.ts | poprawki z przeglądu: kontakt zza siatki zeruje licznik, okno zamachu do lądowania po auto-skoku, immunitet po własnym kontakcie, jeden kontakt na tick, siatka × √0,4 w każdym kierunku, wypchnięcie przy siatce, piłka na z = 0 |
| tests/ai/przeglad-ai.test.ts | reseed rng po nowym secie, obrona przed przelotem, role w czasie reakcji, release po kontakcie, \|move\| ≤ limit profilu |
| tests/narzedzia/granice.test.ts | skaner granic na próbkach linii (import `'../ai'`, `three`, `window`, wnętrzności sim) i na prawdziwym drzewie |

Testy „bez migotania”, podwójnego odbicia i zerowania licznika przy przelocie są sprawdzone mutacjami: wyzerowanie `ACTIVE_HYSTERESIS_M`, `ACTIVE_MIN_DWELL_S` albo usunięcie zerowania licznika w `ball.ts` daje czerwone testy (przed przeglądem wszystkie trzy mutacje przechodziły).

Pozostałe kontrole: `pnpm check:granice` (36 plików: sim/ai bez three/DOM/losowości, warstwy wyżej łączą się z sim tylko przez `sim/index`), `pnpm typecheck` (trzy tsconfigi, w tym sim/ai bez lib DOM), `pnpm lint`, `pnpm format:check` – zielone.

### 3.4 AI vs AI (5 seedów, skrypt pomiarowy, po przeglądzie)

Sety kończą się w 114–201 s czasu gry (wyniki 4:7, 7:9, 4:7, 9:10, 10:8), 6,2 kontaktu na punkt, 100 % punktów z podłogi (zero błędów four-touches / double-touch / under-net, zero autów). Siła ataku działa: siła 0,25–0,5 → ~12,5 m/s, 0,5–0,75 → ~14,4 m/s, kontakt na ~2,9 m. Zaobserwowana asymetria (czerwoni wygrywali 4 z 5 setów przy identycznym profilu) została zbadana w przeglądzie na 300 setach – to efekt przyjmowania pierwszego serwisu, nie błąd (§6). Zero autów i zero błędów przy Nowicjuszu wygląda nienaturalnie – do strojenia w F1 (F1 zakłada auty AI ≤ 12 %).

## 4. Zrzuty (docs/zrzuty/)

| Plik | Scena |
|---|---|
| f0-390x844-serwis.png | gracz z piłką przed serwisem, HUD z podpowiedzią |
| f0-390x844-wymiana.png | wymiana AI vs AI po przyjęciu |
| f0-390x844-punkt.png | toast po punkcie |
| f0-1280x720-serwis.png / -wymiana.png / -punkt.png | to samo w poziomie |

## 5. Gdzie koncepcja była niedoprecyzowana i co przyjąłem

To najważniejsza część raportu (docs/21 „Zasady dla każdej fazy”). Pełna lista z liczbami: docs/22-ARCHITEKTURA-F0.md §9. Najważniejsze decyzje:

1. **Model uderzenia „przytrzymaj do kontaktu”.** Koncepcja mówi „dotknięcie – timing względem piłki” i „czas trzymania = siła”, ale nie mówi, czy uderzenie pada przy dotknięciu, czy przy puszczeniu, ani jak jeden palec ma jednocześnie ciągnąć (ruch) i dotykać (uderzenie). Przyjęte: naciśnięcie = ręce w górze (okno do 0,8 s), kontakt gdy piłka wejdzie w zasięg, tap = 0,12 s łaski, siła z czasu trzymania do kontaktu, zły timing = pudło z blokadą 0,3 s albo bierne odbicie od ciała. Jakość timingu z położenia piłki w chwili kontaktu; szum celu 2,2 m × (1 − jakość).
2. **Rozróżnienie gestów po 120 ms / 12 px**: ruch palca to joystick, bezruch to zamach, puszczenie przed 120 ms to tap. Drugi palec podczas biegu = zamach. „Kierunek przeciągnięcia trzymanego w chwili dotknięcia” zinterpretowane jako przesunięcie palca w trakcie trzymania zamachu (celowanie), nie kierunek biegu.
3. **Przełączanie aktywnego tylko przed pierwszym odbiciem po naszej stronie** (serwis i atak rywali) + ratunek, gdy aktywny nie zdąży. Literalna reguła „bliżej lądowania” odbierałaby graczowi atak: po przyjęciu piłka leci do partnera-rozgrywającego i sterowanie skakałoby na niego.
4. **Oś x**: prawo ekranu = −x świata (układ prawoskrętny Three.js, kamera patrzy w +z). Mapowanie w `aim.ts` i `gesty.ts`; render nic nie odbija (odbicie zepsułoby w F3 tekst na banerach i znak na koszulkach). Gracz stoi po prawej, partner po lewej.
5. **Punkt lądowania vs punkt przyjęcia.** Przy płaskim torze piłka na wysokości bioder jest 1–3 m przed punktem lądowania; kto stanie na pierścieniu, dostaje piłkę przy kolanach na ~40 ms. Sim liczy oba punkty; AI i harness dobiegają do punktu przyjęcia. **Rozstrzygnięte 2026-09-25 (Dawid):** pierścień pokazuje miejsce, gdzie stanąć; punkt lądowania widać z cienia piłki (§8).
6. **Serwis lob/strzał z siły**: siła < 0,5 = wysoki łuk (jak serwis dzieci; piłka opada stromo, pierścień = miejsce przyjęcia), siła ≥ 0,5 = płaski strzał 10,5–16 m/s. Bez tego serwis Nowicjusza był zawsze płaski. Serwis gracza bez paska timingu (jakość 1) – pasek to F1.
7. **Auto-skok z gałęzią predykcyjną** (skok wtedy, gdy w apogeum piłka będzie w zasięgu) – literalna reguła „piłka wyżej niż zasięg → skok” dawała kontakt na 2,6 m i atak zawsze lobem, niezależnie od siły.
8. **Bierny kontakt z kapsułą liczy się jako odbicie** ze wszystkimi zasadami (podwójne odbicie!). Po własnym uderzeniu 0,3 s immunitetu.
9. **Pas siatki 10 m (słupki)**; przejście poniżej krawędzi poza pasem = błąd `under-net`.
10. **Serwujący nie rusza się przed serwisem; naprzemienny serwujący w drużynie.**
11. **Miejsca**: rozgrywający 2,2 m od siatki, atak 1,1 m, apogea łuków 3,4 / 3,0 m nad kontaktem, prędkości ataku 9–19 m/s.
12. **Kamera**: FOV 72° w portrecie (przy 62° partner 4,5 m obok wypadał z kadru na 390 px), 48° w poziomie, `lookAt` na 1,1 m.
13. **Cel „między rywalami”** = środek odcinka między rywalami, przycięty do boiska z marginesem 0,4 m i min. 2,0 m od siatki.
14. **Tłumienie liniowe 0,1 1/s z dokładnym całkowaniem** – predykcja toru bit w bit zgodna z krokiem sim.
15. **Profil Nowicjusz**: reakcja 0,25 s, błąd pozycji 0,6 m, prędkość 3,6 m/s, szum celu 1,0 m, siła serwisu 0,2–0,6, ataku 0,3–0,7 – wartości startowe do strojenia w F1.
16. **Toolchain**: TypeScript 7 (natywny `tsc`) i TypeScript 6 obok pod nazwą `typescript` dla typescript-eslint (oficjalny przepis z bloga TS 7.0) – bez tego ESLint nie startuje.

## 6. Przegląd adwersarialny

Metoda: osiem niezależnych przeglądów (determinizm i granice, fizyka i zasady, AI, sterowanie i kamera, testy, harness, budżety, UX i język), każdy czytał kod w całości, uruchamiał polecenia i pisał skrypty dowodowe (w tym mutacje stałych i 300 setów AI vs AI). Wynik: 60 unikalnych znalezisk. Faza sceptyków (dwóch na znalezisko) dwukrotnie padła na limicie sesji, więc znaleziska oceniłem sam i podzieliłem na: naprawić w kodzie, zapisać w dokumencie, odrzucić. Naprawy wykonało osiem agentów po modułach, kontrola końcowa przeszła: granice, typy, lint, format, testy, build, smoke test w Chromium.

Naprawione w kodzie (najważniejsze):

| Moduł | Co było | Co jest |
|---|---|---|
| sim | kontakt zza siatki (blok, \|z\| < 0,35) liczony na liczniku odbić rywali → blok = „cztery odbicia” dla nas | kontakt drużyny, po której stronie piłka jeszcze nie jest, zeruje licznik i zmienia stronę |
| sim | tap na wysoką piłkę uruchamiał auto-skok (0,39 s wznoszenia), a okno tapu trwało 0,12 s → gwarantowane pudło, cooldown w powietrzu, piłka od głowy = podwójne odbicie | skok wyzwolony zamachem trzyma okno otwarte do lądowania (nowe pole `jumpSwing`) |
| sim | brak immunitetu dla zamachu tick po własnym kontakcie → podwójny tap = podwójne odbicie | 0,3 s immunitetu także dla zamachu, okno czeka |
| sim | dwóch zawodników w zasięgu w tym samym ticku = dwa kontakty, drugi kasował prędkość pierwszego | jeden kontakt na tick, drugi czeka z otwartym oknem |
| sim | siatka tłumiła tylko składową z (√0,4), x i y × 0,8 → do 57 % energii zamiast 40 % | cały wektor × √0,4 |
| sim | wypchnięcie piłki z kapsuły przy siatce mogło przenieść ją na drugą stronę bez detekcji; piłka kończąca tick dokładnie na z = 0 dostawała złą stronę | piłka zostaje po stronie sprzed wypchnięcia; strona z kierunku lotu |
| sim | komenda `new-set` w strumieniu psuła nagranie (tick do zera) | komenda usunięta z kontraktu; nowy set robi pętla |
| ai | obrona ruszała do piłki dopiero po przelocie nad siatką (strażnik liczył odbicia rywali) | strażnik tylko dla własnego licznika – chaser przed przelotem |
| ai | po każdym kontakcie para traciła role na czas reakcji i biegła do bazy | role trzymane do nowego odczytu |
| ai | `release` po kontakcie nigdy nie wychodził (martwa gałąź); kwantyzacja przekraczała maxSpeed (3,629 zamiast 3,6); reużyty `AiState` nie reseedował rng | naprawione, z testami |
| input | dryf palca ≤ 12 px sprzed rozstrzygnięcia gestu dawał cel zamachowi – tap „wystawa” stawał się atakiem | cel liczony od punktu, w którym gest stał się zamachem; próg celu ≥ 12 px |
| input | wyścig: adresat komendy z `poll` sprzed przełączenia aktywnego (klawisz tuż po serwisie szedł do zawodnika AI) | input czyta `state.active` przez getter z pętli |
| render | `rotation.y = −facing` odbijało kierunek (model glTF w F2 biegłby tyłem); piłka rzucała dwa cienie | `+facing`; cień z mapy piłki wyłączony, zostaje płaskie koło |
| render/loop | brak sposobu na zmierzenie kosztu składników na telefonie | przełączniki `?jakosc=niska`, `?dpr=1`, `?aa=0`, `?cien=0`, hak `renderOptions()` |
| ui | „CZERWONI” kontrast 3,05:1 przy 13 px; `<noscript>` czarny na granacie; pusta próbka koloru w trybie AI; polskie identyfikatory w CSS/HTML | jaśniejsza czerwień dla tekstu (5,0:1), biały komunikat, próbka ukryta, identyfikatory po angielsku |
| tests | mutacje `ACTIVE_HYSTERESIS_M = 0`, `ACTIVE_MIN_DWELL_S = 0`, usunięcie zerowania licznika przy przelocie – wszystko zielone (83/83) | test „presja na migotanie” z regulatorem pozycji, test end-to-end podwójnego odbicia, test zerowania licznika, strażnik żywego meczu w determinizmie AI; każda z mutacji teraz pada |
| harness | fps p95 5,8 ms to okres monitora 175 Hz (vsync), nie koszt klatki; prognoza wejścia w zasięg „uciekała” po wejściu piłki; zrzut „punkt” w trakcie animacji toasta; brak sprzątania serwera przy awarii Chromium | Chromium bez limitu klatek, ostrzeżenie o przycięciu do odświeżania; prognoza zamrożona; chwila tapu z ticku sim; próby z przystankiem pętli liczone osobno; `try/finally` |
| config | skan granic nie łapał `import '../ai'` bez ukośnika; nic nie pilnowało „inne moduły importują sim tylko z index” | regexy poprawione, nowa reguła, 28 testów skanera |

Zapisane w docs/22 zamiast zmieniane (kod wygrał): cień piłki na y = 0,006, promienie pierścieni 0,38–0,46 / 0,28–0,36 / 0,30–0,36, dojazd kamery −4 % po 100 ms i powrót w 200 ms, kamera w fazie serwisu śledzi tylko aktywnego, pierścień lądowania tylko w fazie rally, margines za linią końcową 2,5 m, maksymalnie 30 kroków sim na klatkę, serwujący może zagrać własny serwis odbity od siatki.

Odrzucone jako nie-błędy (z dowodem): asymetria drużyn – w 300 setach AI vs AI drużyna przyjmująca pierwszy serwis wygrywa 54 % (0 asów, atak kończy 53 % akcji), metryki per drużyna identyczne, ablacja przełączania aktywnego daje wynik bit w bit; `Math.exp/log/atan2` są deterministyczne w jednym silniku JS (między silnikami możliwa różnica ulp – dla „meczu tygodnia” w F1 porównywać wyniki, nie stany); auty AI 0 % w 962 punktach (cel przycięty do boiska − 0,4 m; F1 zakłada ≤ 12 %, zero wygląda nienaturalnie – do strojenia).

Po przeglądzie: 129 testów w 14 plikach (było 83 w 11), wszystkie zielone; skan granic obejmuje 36 plików.

## 7. Znane ograniczenia i propozycje na F0b / F1

- ~~**Portret: partner często poza kadrem.**~~ Rozwiązane 2026-09-25 (§8): gra jest pozioma, nowa kamera trzyma obu w kadrze w 100 % klatek w obu orientacjach. Opis z 2026-09-05: przy FOV 72° pole widzenia na wysokości naszych zawodników (9 m od kamery) ma ~6 m szerokości, a para stoi 4,5 m od siebie; kamera śledzi 0,6·gracz + 0,4·piłka (docs/20 §4.1), więc przy przyjęciu partner-rozgrywający jest za krawędzią (na f0-390x844-wymiana.png widać tylko jego cień). Wystawa do partnera to tap bez celu, więc gra jest możliwa, ale kciuk nie widzi, gdzie leci piłka. Opcje na F0b: FOV 80° w portrecie, kamera 2 m dalej za linią (z = −17) albo śledzenie środka pary z piłką. W poziomie (1280 × 720) cała para i większość boiska są w kadrze.
- Pomiar fps na prawdziwym Androidzie klasy średniej – nie wykonany (brak urządzenia w harnessie).
- Zawodnik AI „tańczy” pod piłką: co 0,25 s nowy odczyt z błędem ±0,6 m zmienia cel. Zgodne ze spec, ale nerwowe na ekranie – do strojenia w F1 (malejący błąd przy zbliżaniu piłki).
- AI zamachuje się na górnej granicy zasięgu, więc przyjęcia mają jakość ~0,3 i duży szum – działa (rozgrywający dobiega), ale w F1 warto opóźnić zamach do pasma wysokości.
- `state.events` trzyma zdarzenia tylko z ostatniego kroku sim, a pętla robi kilka kroków na klatkę – render zabezpieczył się przez `lastContact.tick`; w F3 (dźwięk, cząstki) pętla powinna akumulować zdarzenia z klatki.
- Wystawa z apogeum 3,0 m NAD kontaktem (2,9 m) daje piłkę na ~6 m i strome opadanie – rozważyć apogeum bezwzględne (~4,5 m).
- Celownik na dalekiej połowie w portrecie ma ~23 px – czytelny, ale mały; w F1 skalować znaczniki z odległością.
- Piłka ma dwa cienie: płaskie koło (pomoc dla gracza) i cień z mapy – jeśli myli, wyłączyć `castShadow` piłki.

## 8. Poprawki przed bramą (2026-09-25)

Brama nie odbyła się, bo test wymagał `pnpm dev --host` w sieci lokalnej. Zmiany: podgląd na Vercelu, gra w poziomie z nakładką „Obróć telefon”, kamera dobrana pod poziom, test regresji sterowania względnego, pierścień „tu stań”.

### 8.1 Wdrożenie na Vercelu

Projekt `uks-wieszowa-gra-3d` założył Dawid 2026-09-25 (zespół dawidhetmanczyk's projects, produkcja = `main`, zmienna `ENABLE_EXPERIMENTAL_COREPACK=1` – Vercel bierze pnpm z pola `packageManager`, Node z `engines.node` = `22.x`). Decyzja Dawida z tego samego dnia: F0 scalone do `main` przed bramą, a brama to gra na telefonie pod adresem produkcyjnym **https://uks-wieszowa-gra-3d.vercel.app**. Domyślna ochrona wdrożeń Vercela (Standard Protection) nie obejmuje domeny produkcyjnej, więc telefon nie wymaga logowania; podglądy gałęzi – tak.

`vercel.json`: install `pnpm install --frozen-lockfile`, build `pnpm check && pnpm build` (na Vercel trafia tylko to, co przechodzi pełną kontrolę), katalog `dist`, `/assets/*` z `Cache-Control: public, max-age=31536000, immutable`, reszta – w tym `index.html` – `no-cache`, nieznane ścieżki → `index.html`, zagnieżdżone `…/assets/…` → prawdziwy plik (baza Vite jest względna).

Pierwszy build gałęzi `f0/prototyp` (commit f1de040) padł przed instalacją zależności: `invalid-route-source-pattern`. Wzorzec przepisania był zapisany jako wyrażenie regularne (`^/.+/assets/(.+)$`), a `source` w `vercel.json` to składnia path-to-regexp 6.1.0. Poprawka: `/:prefix+/assets/:file` → `/assets/:file`. Nowy test `tests/narzedzia/vercel.test.ts` waliduje `vercel.json` tym samym kodem, którego używa Vercel (`@vercel/routing-utils`), i sprawdza nagłówki cache, SPA fallback oraz zagnieżdżone `…/assets/…`; na starym wzorcu pada we wszystkich 4 przypadkach (sprawdzone mutacją).

WYNIK_VERCEL

### 8.2 Obaj zawodnicy drużyny gracza w kadrze – przed i po

Pomiar w przeglądarce (`pnpm harness:kadr`): 60 s AI vs AI, seed 7, licznik liczony przez render co klatkę tą samą kamerą, którą widzi gracz. „Cały w kadrze” = stopy i czubek głowy kapsuły, z promieniem po obu bokach, w oknie.

| Ekran | Kamera | Obaj cali w kadrze | Najmniejszy zapas do krawędzi | Zawodnik na ekranie | Piłka w kadrze |
|---|---|---|---|---|---|
| 844 × 390 | przed (F0) | 100 % (8794/8794 klatek) | 12,0 px | 80,0 px | 98,6 % |
| 844 × 390 | **po** | **100 % (8828/8828)** | **68,7 px** | 80,0 px | 99,0 % |
| 390 × 844 (za furtką) | przed (F0) | 29,0 % (2548/8779) | −270,7 px (partner poza oknem) | 106,1 px | 97,9 % |
| 390 × 844 (za furtką) | **po** | **100 % (8867/8867)** | 26,9 px | 63,5 px | 100 % |

W poziomie stara kamera w meczu AI vs AI już trzymała obu w kadrze, ale na styk. Scenariusz obciążeniowy (człowiek biega aktywnym od linii do linii, partner-AI gra swoje; licznik w Node na tym samym kodzie kamery) pokazał, że F0 gubi partnera w 28 % klatek – przy dziecku biegającym pod linię boczną. Kamerę dobrałem przeszukaniem ok. 5000 wariantów (FOV, odległość, wysokość, punkt patrzenia, wagi celu): warunek „obaj cali w kadrze w 100 % klatek w obu scenariuszach, piłka ≥ 97 %”, z wariantów spełniających – największy zapas do krawędzi. Wynik: FOV poziome 63,6° (32° pionowo przy 844 × 390), kamera 11,5 m za linią zamiast 6 m, wysokość 3,2 m i punkt patrzenia bez zmian, cel kamery 0,35 aktywny + 0,25 partner + 0,4 piłka. Zawodnik ma ten sam rozmiar co w F0 (80 px), rywale są o ~23 % więksi (kamera dalej = mniejsza różnica skali bliski–daleki). Wariant z większym zawodnikiem (~95 px) odpadł, bo w scenariuszu skrajnym gubił partnera w ~30 % klatek. Test regresji w Vitest (`tests/render/kadr.test.ts`) pilnuje obu scenariuszy i sprawdza, że stara kamera go oblewa.

### 8.3 Sterowanie względne – test regresji

Sterowanie było i jest względne (joystick od punktu dotknięcia, input nie zna pozycji zawodnika). Test jak w 2D, w dwóch miejscach:

| Test | Przypadek | Wynik |
|---|---|---|
| `pnpm harness:sterowanie` (Chromium, 844 × 390, dotyki CDP) | palec w lewym górnym rogu (24, 30), zawodnik na prawo od palca, ruch palca w prawo | **PASS** – zawodnik x 508,5 → 549,8 px (+41,3 px w prawo), po puszczeniu stop |
| jw. | palec w prawym dolnym rogu (820, 366), zawodnik na lewo od palca, ruch w lewo | **PASS** – x 497,4 → 467,0 px (−30,4 px), po puszczeniu stop |
| `tests/input/wzgledne.test.ts` (Node: prawdziwy `touch.ts` → sim → kamera) | ta sama komenda z 5 miejsc startu palca (4 rogi i środek); lewy górny róg + ruch w prawo = zawodnik w prawo na ekranie | PASS |

### 8.4 Pierścień

Pierścień pokazuje teraz miejsce, gdzie stanąć (`landing.intercept` – punkt, w którym opadająca piłka przecina 1,1 m), a nie punkt lądowania. Punkt lądowania pokazuje cień piłki: płaskie koło sunie pod piłką i kończy dokładnie w miejscu upadku.

### 8.5 Wydajność po zmianach (`pnpm harness:perf`, 60 s AI vs AI, CPU ×4, Chromium headed bez limitu klatek, RTX 4060)

| Ekran | Czas klatki p50 / p95 / p99 | fps p95 | Draw calls | Trójkąty | Próg |
|---|---|---|---|---|---|
| 390 × 844 @3× (ekran budżetu, za furtką) | 1,40 / 2,90 / 4,20 ms | 345 | 19 | 2 352 | PASS (≥ 55, ≤ 60, ≤ 120 000) |
| 844 × 390 @3× (tak się gra) | 1,70 / 4,80 / 6,10 ms | 208 | 18 | 2 288 | PASS |

W poziomie klatka jest droższa niż w pionie (p95 4,8 vs 2,9 ms przy tej samej liczbie pikseli kanwy 1688 × 780): w kadrze jest więcej podłogi z mapą cieni i więcej sceny. Przed zmianami (F0, pion 390 × 844): p95 2,4 ms, 18 draw calls, 2 288 trójkątów – dziś w pionie 19 draw calls – o jeden więcej, najpewniej dlatego, że dalsza kamera ma w kadrze obiekt, który wcześniej odcinał frustum culling (nie sprawdzałem, który).

Bundle JS 148,5 kB gzip (budżet 350 kB), znak klubu 7,2 kB jako osobny plik w `/assets`, assety glTF 0 B. `pnpm check` zielony: 142 testy w 17 plikach (było 129 w 14 – doszły `tests/render/kadr.test.ts`, `tests/input/wzgledne.test.ts`, `tests/ui/orientacja.test.ts`), skan granic 39 plików, typy, lint, format. Tak jak wcześniej: to zapas CPU i GPU klasy desktop, nie pomiar Androida – ten zrób na telefonie z `?ai=1&fps=1`, a w razie spadków z `?jakosc=niska`.

### 8.6 Przyjęcie serwisu po zmianach (`pnpm harness:przyjecie`, 50 prób, 844 × 390)

| Miara | F0 (2026-09-05, 390 × 844) | Po zmianach (844 × 390) |
|---|---|---|
| Sukcesy | 25 / 50 (50 %) | **24 / 50 (48 %)**, 0 prób niewiarygodnych (najdłuższa klatka 35,5 ms) |
| Tapy w oknie od −125 do +100 ms | 25 / 25 | 24 / 24 |
| Średnia jakość udanych | 0,52 | 0,50 |
| Średnie opóźnienie kontaktu | +12 ms | +9 ms |
| Porażki | 15 passive, 10 whiff | 15 passive, 11 whiff |

| Kosz | Prób | Udanych |
|---|---|---|
| [−250, −200) ms | 5 | 0 |
| [−200, −150) ms | 5 | 0 |
| [−150, −100) ms | 5 | 4 |
| [−100, −50) ms | 4 | 4 |
| [−50, 0) ms | 6 | 6 |
| [0, 50) ms | 5 | 5 |
| [50, 100) ms | 5 | 5 |
| ≥ 100 ms | 0 (piłka wcześniej trafiła w ciało) | – |

Wynik jest ten sam co w F0 w granicach rozrzutu – i powinien być: zmiany dotyczą kamery, nakładki i pierścienia, a przyjęcie zależy od sim i chwili tapu. Jedyna porażka w koszu [−150, −100) to tap 133 ms przed wejściem piłki w zasięg: łaska tapu trwa 120 ms, więc okno wygasło przed dolotem. To dokładniejsza granica niż „od −150 ms” z §3.2 – w F0 żaden wylosowany tap nie padł między −150 a −125 ms. **Skuteczne okno tapu: od ok. −125 do +100 ms, czyli ok. 225 ms.** Jakość rośnie z opóźnieniem jak wcześniej: ~0,41 przy −100 ms, ~0,77 przy +70 ms.

Uwaga o pomiarze: dwa pierwsze przebiegi po zmianach były bezużyteczne (16 i 39 prób z klatkami po 1011 ms). Przyczyna: Windows wygasza monitor po 15 minutach bezczynności, a Chromium z vsync rysuje wtedy raz na sekundę. Harness przyjęcia i zrzutów startuje teraz przeglądarkę bez limitu klatek, jak perf (`--vsync` przywraca limit). Wejście trafia wtedy do sim w najbliższym ticku (≤ 8,3 ms); na telefonie 60 Hz dochodzi do tego do 16,7 ms klatki – mniej niż trzecia część kosza.

### 8.7 Zrzuty (docs/zrzuty/)

| Plik | Scena |
|---|---|
| f0-844x390-serwis.png / -wymiana.png / -punkt.png | telefon w poziomie – tak się gra |
| f0-390x844-obrot.png | nakładka „Obróć telefon” (mecz stoi – harness sprawdza, że tick sim nie rośnie przez 1 s) |
| f0-390x844-serwis.png / -wymiana.png / -punkt.png | pion za furtką „Graj mimo to” |
| f0-1280x720-serwis.png / -wymiana.png / -punkt.png | monitor |

### 8.8 Co przyjąłem sam (pełna lista: docs/22 §9 pkt 26–30)

1. **Furtka pamiętana w sesji karty**, nie na zawsze. W 2D wybór idzie do profilu, ale w F0 nie ma profilu ani ustawień, w których dałoby się go cofnąć – jedno kliknięcie zablokowałoby test nakładki na tym telefonie. Profil przyjdzie w F4.
2. **Blokada poziomu z pierwszego dotyku**: przeglądarka pozwala na pełny ekran i `orientation.lock` tylko z gestu, a w F0 nie ma przycisku „Graj”. Na Androidzie pierwszy dotyk w grze wchodzi więc w pełny ekran. Do sprawdzenia na bramie, czy ten pierwszy gest (np. serwis) nie przepada przy zmianie rozmiaru okna. iOS nie zna `lock` – tam zostaje sama prośba o obrót.
3. **Kamera dalej niż w docs/20** (11,5 m zamiast ~6 m za linią) i cel kamery z partnerem – uzasadnienie liczbami w §8.2.
4. **Znak klubu z gry 2D**: `src/ui/club-mark.webp` z wpisem w docs/ASSETY.md (źródło, SHA-256). To znak własny klubu, nie CC0 – **potwierdź, proszę, że można go tak używać**.
5. **Harness na porcie 4317** z kontrolą zajętości – na tej maszynie równolegle działają serwery Vite gry 2D i strony; harness zabija tylko procesy, które sam uruchomił.

## 9. Jak powtórzyć pomiary

```bash
pnpm harness:kadr
```

```bash
pnpm harness:sterowanie
```

```bash
pnpm harness:perf --sekundy 60
```

```bash
pnpm harness:perf --ekran 844x390
```

```bash
pnpm harness:przyjecie --proby 50
```

```bash
pnpm harness:zrzuty
```

Wyniki JSON trafiają do `harness/wyniki/` (ignorowane przez git).
