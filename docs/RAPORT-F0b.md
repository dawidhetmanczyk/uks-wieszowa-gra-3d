# Raport F0b – sterowanie z asystą

Gałąź: `f0b/asysta` od `main`, po zielonej pełnej kontroli scalona do `main` (decyzja Dawida z 2026-09-26: F0b testuje na adresie produkcyjnym). Data: 2026-09-26. Autor: Claude Code, brama: Dawid. Polecenie i odpowiedzi Dawida na luki: `docs/21-PROMPTY-3D.md`, sekcja F0b. Kontrakt modułów: `docs/22-ARCHITEKTURA-F0.md` §10.

## 1. Co jest do sprawdzenia na bramie

Adres: **https://uks-wieszowa-gra-3d.vercel.app** – telefon w pionie (główny tryb) albo w poziomie, bez nakładki. Brama F0 nie przeszła, bo na iPhonie „nie trafiam w piłkę, frustruję się; nie wiem, jak skakać”.

Jak się gra w F0b:

- zawodnik sam biegnie do bursztynowego pierścienia „tu stań”;
- **stuknij** gdziekolwiek, gdy piłka dolatuje – odbicie w cel domyślny (1. do partnera, 2. wystawa, 3. atak między rywali); serwis to też stuknięcie (lob);
- **machnij** palcem (krótko, > 30 px), żeby wybrać kierunek;
- **przeciągnij** (palec trzymany > 200 ms), żeby pobiec samemu – 0,5 s po puszczeniu asysta wraca;
- tuż przed kontaktem gra zwalnia do 0,6×; przy szansie na atak przy siatce pierścień robi się jasnoniebieski, a HUD pisze „Stuknij – skok sam”;
- samouczek w pasku u góry: trzy podpowiedzi, każda znika po 3 udanych użyciach.

Porównanie z F0: `?sterowanie=reczne` (pełne F0 – bez asysty, okno ~250 ms, bez spowolnienia, ciało odbija piłkę).

Pytania z bramy (docs/21): trafiam w piłkę bez frustracji? wiem, gdzie spadnie? przełączanie zawodnika jest zrozumiałe? wystawa do partnera działa intuicyjnie? Nowe: czy asysta nie zabiera gry? czy spowolnienie pomaga, czy przeszkadza? czy skok jest czytelny?

## 2. Decyzje Dawida i jak je wdrożyłem

| Decyzja (docs/21 F0b) | Wdrożenie | Dowód |
|---|---|---|
| 1. Asysta ruchu do punktu przyjęcia; przeciągnięcie > 200 ms przejmuje ruch, asysta wraca po 0,5 s | `src/ai/assist.ts` – komendy `move` do `landing.intercept` (pierścień), gdy nie ma czego przyjmować – jak AI partnera; `src/input/asysta.ts` + `manualSteering()` w pętli | `tests/ai/asysta.test.ts` (zawodnik na pierścieniu, cele), `tests/input/asysta-wejscie.test.ts` |
| 2. Stuknięcie = cel domyślny, machnięcie = kierunek, siła ataku stała | stuknięcie / machnięcie rozpoznawane przy puszczeniu palca; siła 0,5 (14 m/s), serwis lobem | `tests/input/asysta-wejscie.test.ts` |
| 3. Skuteczne okno ≥ 450 ms, moment decyduje o jakości | okno po stuknięciu 0,3 s dla zamachu człowieka + ciało pary nie odbija piłki, więc stuknięcie działa, dopóki piłka jest w zasięgu | §3.1 (harness przyjęcia) |
| 4. Spowolnienie 0,6× ≤ 0,4 s przed kontaktem aktywnego | `src/loop/tempo.ts` – mnoży tylko czas ścienny podawany akumulatorowi | `tests/loop/tempo.test.ts`, determinizm z asystą w `tests/ai/asysta.test.ts` |
| 5. Skok widoczny: pierścień zmienia kolor + napis | `jumpAttackChance` (sim) → pierścień #109CE4 i „Stuknij – skok sam” w pasku komunikatów | zrzuty `f0b-*-atak-skok.png` |
| 6. Samouczek: trzy podpowiedzi, każda znika po 3 udanych użyciach, localStorage w try/catch | `src/ui/tutorial.ts`, liczenie udanych gestów w pętli, linia pod komunikatem w HUD | `tests/ui/samouczek.test.ts` |
| 7. Obie orientacje bez nakładki; kamera pionu dobrana od nowa; kanwa między paskami Safari | nakładka usunięta; `CameraConfig` z osobnym pionem i poziomem; `src/ui/viewport.ts` (visualViewport → zmienne CSS) | §3.3, `tests/render/kadr.test.ts`, `tests/ui/okno.test.ts` |
| 8. Android: pełny ekran z pierwszego dotyku bez blokady orientacji; pierwszy gest nie przepada | `src/ui/fullscreen.ts` – prośba na pointerup (po geście), bez `orientation.lock` | `tests/ui/pelny-ekran.test.ts`, `pnpm harness:sterowanie` przypadek C |
| 9. Dzisiejsze sterowanie pod `?sterowanie=reczne` | tryb `manual` = pełne F0 (`touch.ts` bez zmian, `SimState.assist = false`) | `pnpm harness:przyjecie --reczne`, `harness:sterowanie` w obu trybach |

Odpowiedzi Dawida na luki (zadane przed implementacją, zapisane w docs/21): asysta „jak AI partnera”, piłka mija ciało pary, serwis stuknięciem i machnięciem (lob), siła 0,5, tryb ręczny = pełne F0, kolor #109CE4, napisy w pasku u góry.

## 3. Pomiary

Wszystko na tym samym komputerze co F0 (RTX 4060, Chromium headed bez limitu klatek), 2026-09-26. „Przed” = stan z końca F0 (tryb `?sterowanie=reczne` albo pomiar z 2026-09-25), „po” = F0b.

### 3.1 Przyjęcie serwisu (`pnpm harness:przyjecie`, 390 × 844)

Definicja jak w F0 (RAPORT-F0 §3.2): rywale serwują, sukces = kontakt aktywnego (nie bierny) i piłka leci na naszą połowę. Przed: tryb ręczny (`--reczne`) – dobieg WASD, stuknięcie w ±250 ms, 50 prób. Po: asysta biegnie sama, stuknięcie w [−500, +400) ms (celowo szerzej niż okno, żeby zobaczyć jego brzegi), 150 prób. Skuteczne okno = najdłuższy ciąg sąsiednich koszy 50 ms, w których każdy ma ≥ 85 % udanych.

| | Przed (pełne F0) | Po (asysta F0b) | Cel z polecenia |
|---|---|---|---|
| Skuteczne okno | [−150, +100) ms = 250 ms | **[−300, +200) ms = 500 ms** | ≥ 450 ms |
| Udane stuknięcia w oknie | 24/25 (96 %) | **80/80 (100 %)** | ≥ 85 % |
| Wszystkie próby | 24/50 (48 %) | 93/150 (62 %) – rozrzut sięga poza okno | – |
| Średnia jakość udanych | 0,49 | 0,54 | – |
| Próby z przystankiem pętli | 0 | 0 | – |

Histogram po zmianie (prób / udanych):

| Kosz (opóźnienie stuknięcia od wejścia piłki w zasięg) | Prób | Udanych |
|---|---|---|
| < −500 ms | 1 | 0 |
| [−500, −450) ms | 6 | 0 |
| [−450, −400) ms | 8 | 0 |
| [−400, −350) ms | 10 | 1 |
| [−350, −300) ms | 6 | 1 |
| [−300, −250) ms | 5 | 5 |
| [−250, −200) ms | 8 | 8 |
| [−200, −150) ms | 11 | 11 |
| [−150, −100) ms | 8 | 8 |
| [−100, −50) ms | 6 | 6 |
| [−50, 0) ms | 9 | 9 |
| [0, 50) ms | 8 | 8 |
| [50, 100) ms | 9 | 9 |
| [100, 150) ms | 9 | 9 |
| [150, 200) ms | 7 | 7 |
| [200, 250) ms | 13 | 10 |
| [250, 300) ms | 2 | 0 |
| [300, 400) ms | 1 | 1 |

Brzegi okna: stuknięcie ponad 300 ms za wcześnie to pudło, bo okno po stuknięciu (0,3 s) wygasa przed dolotem piłki. Stuknięcie ponad ~200 ms po wejściu piłki w zasięg przychodzi, gdy piłka już go opuszcza. 23 próby z zaplanowanym stuknięciem +265…+386 ms harness liczy jako „brak zasięgu”: piłka spadła, zanim stuknięcie padło. Szacunek w Node (te same seedy, bez opóźnień przeglądarki) daje [−300, +250) ms = 550 ms, 100 % w oknie.

Moment dalej decyduje o jakości (decyzja 3) – średnia jakość udanych według momentu stuknięcia:

| Stuknięcie względem wejścia w zasięg | Jakość |
|---|---|
| −300 … −100 ms (wcześnie, kontakt na brzegu zasięgu) | 0,40–0,42 |
| −100 … 0 ms | 0,40 |
| 0 … +100 ms | 0,69 |
| +100 … +200 ms (piłka na wysokości bioder) | 0,83 |
| +200 … +300 ms (piłka nisko) | 0,45 |

### 3.2 „Gra nie gra sama”

| Pomiar | Wynik |
|---|---|
| `tests/ai/asysta.test.ts`: 5 seedów × 90 s, rywale serwują, zero dotyku | **0 kontaktów niebieskich** (także biernych), wszystkie punkty dla rywali |
| `pnpm harness:sam`: przeglądarka, 60 s, seed 7, zero dotyku | **0 kontaktów niebieskich**, 7 serwisów rywali, wynik 0:7 |
| Asysta biega: odległość aktywnego od pierścienia, gdy piłka przecina 1,1 m (35 serwisów) | mediana 0,02 m, 100 % w promieniu 0,5 m |

Sim wykonał w przeglądarce 6855 ticków zamiast 7200 – to spowolnienie 0,6× przed każdym dolotem piłki. Przed (F0) pomiar nie miał sensu: bez asysty zawodnik bez dotyku stał w miejscu.

### 3.3 Kadr w pionie i w poziomie – scenariusz „asysta + gracz przeciągany do linii”

Scenariusz (`tests/render/scenariusze.ts`): asysta prowadzi aktywnego, symulowany gracz stuka tuż przed dolotem piłki (wymiany, wystawy, ataki ze skokiem), a co 7 s przeciąga aktywnego przez 1,5 s do linii bocznej, końcowej albo w tylny róg. Licznik kadru i kamera to kod gry. 30 seedów × 60 s (20 do przeszukania, 10 kontrolnych).

| Ekran | Kamera | Obaj cali w kadrze | Seedy z ubytkiem | Piłka w kadrze | Zawodnik | Nasza połowa na ekranie | Pierścień |
|---|---|---|---|---|---|---|---|
| 390 × 844 | przed (koniec F0) | 99,99 % | 6/30 | 99,8 % | 61,5 px | 64 px | 5,0 px |
| 390 × 844 | **po (F0b)** | **100 %** | **0/30** | 99,9 % | 59,5 px | 65 px | 5,2 px |
| 844 × 390 | bez zmian | 100 % | 0/30 | 99,1 % | 77,5 px | – | – |

Mecz AI vs AI (seedy 7 i 11): pion przed 100 % / 62,2 px, po 100 % / 60,0 px; poziom 100 % / 78,4 px. W przeglądarce (`pnpm harness:kadr`, 60 s AI vs AI): pion 100 % klatek, zapas 69 px, zawodnik 60,8 px; poziom 100 %, zawodnik 79,9 px.

Jak dobrana kamera pionu. Metoda z RAPORT-F0 §8.2: losowe warianty (wysokość, odległość, punkt patrzenia, FOV, wagi celu), doskonalenie najlepszych, warunek 100 % klatek z obydwoma zawodnikami w każdym z 20 seedów i piłka ≥ 97 %, sprawdzenie na 10 innych seedach. Spełniających wariantów było wiele, z zawodnikiem 59,7–61,3 px, ale z bardzo różną głębią boiska. Miara „wysokość zawodnika w px” nagradza niską kamerę, bo z boku kapsuła wygląda na wyższą, a boisko się spłaszcza:

| Wariant | Wysokość kamery | Zawodnik | Nasza połowa | Pierścień |
|---|---|---|---|---|
| A – dosłownie „największy zawodnik” | 2,5 m | 61,3 px | 35 px | 2,8 px |
| B | 3,47 m | 60,9 px | 48 px | 3,9 px |
| **C – wybrany przez Dawida** | 4,86 m | 59,7 px | 65 px | 5,2 px |

Dawid wybrał C (2026-09-26, po obejrzeniu zrzutów trzech wariantów): głębia jak pod koniec F0 za cenę 1,6 px zawodnika. Kamera C: wysokość 4,86 m, 17,9 m za linią końcową, patrzy na (x, 0, −1,83), FOV 58,8°, cel w x 0,21 aktywny / 0,35 partner / 0,1 piłka.

### 3.4 Wydajność (`pnpm harness:perf`, 60 s AI vs AI, CPU ×4)

| Ekran | Przed (koniec F0, 2026-09-25) | Po (F0b) | Próg |
|---|---|---|---|
| 390 × 844 @3× | p95 2,90 ms (345 fps), 19 draw calls, 2 352 trójkątów | p95 2,10–2,20 ms (455–476 fps), 18 draw calls, 2 288 trójkątów | ≥ 55 fps, ≤ 60, ≤ 120 000 – PASS |
| 844 × 390 @3× | p95 4,80 ms (208 fps), 18 draw calls, 2 288 trójkątów | p95 3,70 ms (270 fps), 18 draw calls, 2 288 trójkątów | PASS |

Bez regresji. Pierwszy przebieg pionu po zmianach dał raz p95 3,6 ms z jedną długą klatką (p99 32 ms) – dwa kolejne: 2,1 i 2,2 ms, zero klatek > 33 ms, więc był to szum. Asysta, spowolnienie i predykcja zasięgu dla tempa nie widać w koszcie klatki. Bundle JS 150,4 kB gzip (było 148,5 kB; budżet 350 kB), assety glTF 0 B.

### 3.5 Testy i kontrola

`pnpm check` zielony: 212 testów w 24 plikach (było 146 w 18), skan granic 43 plików, typy, lint, format. Nowe pliki: `tests/sim/asysta-sim.test.ts` (ciało pary, okno), `tests/ai/asysta.test.ts` („gra nie gra sama”, cele asysty, determinizm), `tests/input/asysta-wejscie.test.ts` (stuknięcie, machnięcie, przeciągnięcie, sterowanie względne w pionie, klawiatura), `tests/loop/tempo.test.ts`, `tests/ui/samouczek.test.ts`, `tests/ui/pelny-ekran.test.ts`, `tests/ui/okno.test.ts`; `tests/render/kadr.test.ts` przepisany na scenariusz F0b. Usunięty `tests/ui/orientacja.test.ts` (nakładka zniknęła). Harness w przeglądarce: `harness:sterowanie` 5/5 PASS (A i B w obu trybach, C – pierwszy dotyk), `harness:sam` PASS.

## 4. Zrzuty (docs/zrzuty/, prefiks f0b-)

| Plik | Scena |
|---|---|
| f0b-390x844-serwis.png / f0b-844x390-serwis.png | gracz serwuje: „Stuknij, żeby zaserwować”, pierwsza podpowiedź samouczka |
| f0b-390x844-wymiana.png / f0b-844x390-wymiana.png | serwis rywali w locie, asysta prowadzi aktywnego na bursztynowy pierścień |
| f0b-390x844-atak-skok.png / f0b-844x390-atak-skok.png | po przyjęciu (stuknięcie harnessu) partner wystawił: pierścień jasnoniebieski, „Stuknij – skok sam” |

Zrzuty F0 (f0-*) zostają jako stan sprzed F0b.


## 5. Co przyjąłem sam (polecenie i odpowiedzi milczały)

Decyzje wykonawcze – każdą da się zmienić jedną stałą albo jedną funkcją:

1. **Okno po stuknięciu 0,3 s** (`ASSIST_SWING_GRACE_S`) i tylko dla zamachu aktywnego człowieka w trybie asysty – AI gra bit w bit jak w F0.
2. **Zamach przy puszczeniu palca.** Dopiero wtedy wiadomo, czy to stuknięcie, czy machnięcie i w którą stronę. Stuknięcie trwa zwykle 60–120 ms – okno 550 ms to mieści.
3. **Machnięcie: liczy się tylko kierunek** – cel na elipsie z F0 (`aimFromDirection`): w górę ekranu głęboko, w bok przy linii bocznej, w dół krótko przy siatce. Machnięcie na 1. lub 2. odbiciu to atak w tym kierunku (jak cel w F0).
4. **Palec trzymany > 200 ms bez ruchu to przeciągnięcie**, nie stuknięcie: zawodnik stoi, asysta czeka, puszczenie nie uderza. Drugi palec może stukać w trakcie przeciągania; drugi trzymany > 200 ms jest ignorowany.
5. **Klawiatura w trybie asysty**: WASD/strzałki przejmują bieg jak przeciągnięcie (asysta wraca po 0,5 s), spacja = stuknięcie, spacja przy strzałkach = machnięcie.
6. **Asysta**: cel dokładnie w punkcie przyjęcia (środek pierścienia), pełna prędkość gracza 4,6 m/s, hamowanie przed celem (bez tego zawodnik przestrzeliwał pierścień o ~0,35 m), promień dojścia 0,15 m.
7. **AI partner w trybie asysty nie bierze pierwszego odbicia naszej akcji** – inaczej „gra nie gra sama” byłaby niespełnialna, gdy partner uzna, że człowiek nie zdąży. Później (wystawa, atak po naszym przyjęciu) gra jak w F0.
8. **Spowolnienie**: „kontakt aktywnego” = chwila wejścia piłki w jego zasięg (od niej stuknięcie trafia); przejście 1 ↔ 0,6 w 0,1 s czasu ściennego; po pudle powrót, gdy piłka wyjdzie z zasięgu. Tylko tryb asysty.
9. **„Przy siatce” = punkt przyjęcia ≤ 3 m od siatki** (linia ataku z przepisów) i tylko przed naszym 3. odbiciem (po wystawie partnera) – wtedy piłka opada stromo z ~5 m i sim zawsze skacze.
10. **Samouczek**: udane użycie = kontakt w wymianie po geście (stuknięcie, machnięcie; kontakt w powietrzu zalicza też skok); serwis się nie liczy; użycia liczą się zawsze, także zanim podpowiedź przyjdzie w kolejce; podpowiedź widać w fazie serwisu i wymiany, tylko w trybie asysty.
11. **Pełny ekran na pointerup, nie pointerdown**, tylko z dotyku – prośba idzie po obsłudze gestu, więc zmiana rozmiaru okna nie anuluje pierwszego stuknięcia.
12. **Kanwa**: rozmiar i przesunięcie #game z visualViewport (zmienne CSS), zapas 100dvh; HUD wewnątrz #game z marginesami safe-area.
13. **Scenariusz kadru**: symulowany gracz stuka 0,05 s przed wejściem piłki w zasięg (wymiany trwają, są wystawy i ataki ze skokiem), co 7 s przeciąga aktywnego przez 1,5 s do linii bocznej, końcowej albo w tylny róg, potem 0,5 s bez asysty; przeszukanie na 20 seedach, sprawdzenie na 10 innych.
14. **Poziom: kamera z końca F0 bez zmian** – spełnia warunek w nowym scenariuszu (§3.3).
15. **Tryb ręczny** (pełne F0): bez samouczka, bez znaku skoku i spowolnienia; kamera i obie orientacje jak w F0b.
16. **Znak klubu** po usunięciu nakładki nie jest używany w kodzie; plik i wpis w ASSETY.md zostają (potwierdzenie czeka na Grzegorza).
17. **Przedział przeszukania kamery pionu**: wysokość od 2,5 m (niżej kamera patrzyłaby przez siatkę 2,24 m; koncepcja mówi o ~3,2 m). Z kamerą 1,8 m zawodnik byłby większy o ~1 px – nie proponuję.

## 6. Znane ograniczenia i co sprawdzić na bramie

- **iPhone (Safari) nie był dostępny w pomiarach.** Paski Safari obsługuje visualViewport – test w Node sprawdza logikę, ale czy boisko i HUD mieszczą się między paskami, pokaże dopiero telefon (pion i poziom, pasek schowany i rozwinięty).
- **Android: pełny ekran po pierwszym dotyku** – w Chromium harness potwierdza, że pierwsze stuknięcie serwuje, a prośba o pełny ekran idzie po nim. Zachowanie konkretnego telefonu do sprawdzenia.
- **Okno ma ostre brzegi** (w przeglądarce 500 ms, w Node 550 ms): stuknięcie ponad 300 ms za wcześnie to pudło (okno po stuknięciu wygasa), ponad ~200 ms za późno – piłka już minęła zasięg.
- **Piłka przelatuje przez gracza i partnera** – przy kapsułach wygląda to umownie; w F2 (animacje) warto pokazać „przepuszczenie”.
- Pomiar fps nadal na komputerze (RTX 4060, CPU ×4), nie na Androidzie – licznik: `?fps=1`.

## 7. Jak powtórzyć pomiary

```bash
pnpm harness:przyjecie
```

```bash
pnpm harness:przyjecie --reczne
```

```bash
pnpm harness:sam
```

```bash
pnpm harness:sterowanie
```

```bash
pnpm harness:perf
```

```bash
pnpm harness:perf --ekran 844x390
```

```bash
pnpm harness:kadr
```

```bash
pnpm harness:zrzuty
```

Kadr w scenariuszu F0b liczy `pnpm test` (`tests/render/kadr.test.ts`); skrypty przeszukania kamery pionu leżą w `harness/wyniki/` (poza repo).
