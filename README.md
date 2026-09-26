# Set Wieszowa 3D

Siatkówka 2 na 2 w prawdziwym 3D dla klubu UKS Wieszowa („Wybieram Ruch”). Przeglądarka i telefon. Osobny tytuł od gry 2D `uks-wieszowa-gra`.

Stan: **faza F0b – sterowanie z asystą** (kapsuły i prostokąty, bez grafiki). Brama F0 nie przeszła (2026-09-26), F0b testuje Dawid na telefonie pod adresem produkcyjnym https://uks-wieszowa-gra-3d.vercel.app. Fazy i bramy: `docs/21-PROMPTY-3D.md`. Koncepcja: `docs/20-KONCEPCJA-3D.md`. Kontrakt modułów i założenia: `docs/22-ARCHITEKTURA-F0.md` (F0b: §10). Raporty: `docs/RAPORT-F0.md`, `docs/RAPORT-F0b.md`.

## Wymagania

- Node 22 (`.nvmrc`, `engines.node` = `22.x`), pnpm 10 (`corepack enable` albo `npm i -g pnpm`).
- Do harnessu: Chromium Playwright – `pnpm exec playwright install chromium`.

## Komendy

| Komenda | Co robi |
|---|---|
| `pnpm install` | zależności (jedyna runtime: `three`) |
| `pnpm dev` | serwer deweloperski z `--host` (telefon w tej samej sieci: `http://<ip-komputera>:5173`) |
| `pnpm build` | build produkcyjny do `dist/` z raportem rozmiaru gzip |
| `pnpm preview` | podgląd builda na porcie 4173 |
| `pnpm test` | testy sim, ai (w tym asysta i „gra nie gra sama”), input (asysta, sterowanie względne), render (kadr w scenariuszu F0b), loop (spowolnienie), ui (samouczek, pełny ekran, okno Safari) i narzędzi (skan granic, walidacja `vercel.json`) w Node (Vitest) |
| `pnpm test:watch` | testy w trybie watch |
| `pnpm typecheck` | `tsc` dla trzech konfiguracji: aplikacja, sim/ai bez DOM, node (harness) |
| `pnpm lint` | ESLint (w `src/sim` i `src/ai` zakaz `three`, `window`, `document`, `Math.random`, `Date.now`) |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm check:granice` | skan granic modułów (CLAUDE.md): `src/sim` i `src/ai` bez three/DOM/losowości, sim nie importuje ai; `ai`, `input`, `ui`, `render`, `loop` importują sim tylko z `src/sim/index` |
| `pnpm check` | wszystko powyżej po kolei (to samo uruchamia build na Vercelu) |
| `pnpm harness:perf` | 60 s AI vs AI w 390×844 z CPU 4×: fps p95, draw calls, trójkąty; `--ekran 844x390` = w poziomie |
| `pnpm harness:kadr` | 60 s AI vs AI w 390×844 (`--ekran 844x390` = poziom): w ilu klatkach obaj zawodnicy drużyny gracza są w oknie w całości; scenariusz obciążeniowy F0b liczy `tests/render/kadr.test.ts` |
| `pnpm harness:sterowanie` | test sterowania względnego prawdziwymi dotykami (asysta i tryb ręczny): palec w lewym górnym rogu, ruch w prawo → zawodnik w prawo; pierwszy dotyk na świeżej stronie serwuje, a pełny ekran idzie po nim (kod wyjścia 1 przy błędzie) |
| `pnpm harness:przyjecie` | 150 prób przyjęcia serwisu stuknięciem (390×844, asysta biega sama): skuteczne okno i odsetek udanych; `--reczne` = pełne F0 (dobieg WASD, 50 prób) |
| `pnpm harness:sam` | „gra nie gra sama”: 60 s bez dotyku w trybie asysty – drużyna gracza nie może odbić piłki (kod wyjścia 1 przy błędzie) |
| `pnpm harness:zrzuty` | zrzuty 390×844 i 844×390: serwis, wymiana, atak z podpowiedzią skoku do `docs/zrzuty/` (prefiks `f0b-`) |

Harness przyjmuje `--headless` (domyślnie okno z GPU, bo headless Chromium renderuje WebGL programowo), `--url <adres>` (bez startu własnego serwera), `--ekran SZERxWYS`, `--sekundy N`, `--proby N`, `--seed N`, `--build`, `--reczne` (tryb ręczny F0 zamiast asysty); `harness:perf`, `harness:przyjecie` i `harness:zrzuty` dodatkowo `--vsync` (domyślnie Chromium startuje w nich bez limitu klatek: perf mierzy wtedy koszt klatki, nie częstotliwość ekranu, a wszystkie trzy nie zależą od monitora – z vsync po wygaszeniu ekranu przez Windows przeglądarka rysuje raz na sekundę). Harness uruchamia własny `vite preview` na porcie **4317** (nie domyślnym 4173 – na tej maszynie pracują też repo gry 2D i strony) i odmawia startu, gdy port jest zajęty; zabija wyłącznie procesy, które sam uruchomił.

## Wdrożenie (Vercel)

Osobny projekt Vercela `uks-wieszowa-gra-3d`, produkcja = `main` (https://uks-wieszowa-gra-3d.vercel.app, bez logowania); każda inna gałąź dostaje podgląd pod adresem gałęzi, chroniony logowaniem do Vercela. `vercel.json`: build `pnpm check && pnpm build`, katalog `dist`, pliki z `/assets/*` (nazwy z haszem) z nagłówkiem `Cache-Control: public, max-age=31536000, immutable`, wszystko inne (w tym `index.html`) `no-cache`, a nieznane ścieżki dostają `index.html` (SPA fallback; zagnieżdżone `…/assets/…` wskazują na prawdziwe pliki, bo baza Vite jest względna). Pole `source` w `vercel.json` to składnia path-to-regexp 6.1.0, nie wyrażenie regularne – `tests/narzedzia/vercel.test.ts` waliduje plik kodem Vercela. Szczegóły: `docs/RAPORT-F0.md` §8.1.

## Parametry URL

- `?seed=123` – ziarno meczu (domyślnie z numeru dnia),
- `?ai=1` – AI vs AI (do pomiarów),
- `?serwis=1` – serwują czerwoni,
- `?fps=1` – licznik fps w HUD,
- `?sterowanie=reczne` – pełne sterowanie F0 do porównania (bez asysty, okno ~225 ms, bez spowolnienia, ciało odbija piłkę); bez przycisku w UI.

Przełączniki jakości do pomiaru fps na telefonie (domyślnie: pixel ratio do 2, antialiasing i cienie włączone):

- `?jakosc=niska` – komplet dla telefonu klasy średniej: pixel ratio 1, bez antialiasingu, bez cieni (to samo co `?dpr=1&aa=0&cien=0`),
- `?dpr=1` – górna granica pixel ratio (liczba 0–4, także ułamek, np. `1.5`),
- `?aa=0` – bez antialiasingu (MSAA),
- `?cien=0` – bez mapy cieni.

Pojedyncze parametry nadpisują `jakosc`, więc da się mierzyć wpływ każdego z osobna (np. `?jakosc=niska&cien=1`). Ustawienia, z którymi gra rysuje, zwraca w konsoli `window.__sw3d.renderOptions()`.

## Orientacja

Gra działa w pionie i w poziomie; pion jest głównym trybem na telefonie (F0b). Kamera ma osobne ustawienie dla każdej orientacji. Gra zajmuje dokładnie widoczną część okna (visualViewport – Safari zabiera pasek kart i adresu), HUD omija wycięcia ekranu (safe-area). Na Androidzie pierwszy dotyk prosi o pełny ekran – po zakończeniu gestu, bez blokady orientacji.

## Sterowanie (F0b – z asystą)

Telefon:

- **asysta** – aktywny zawodnik sam biegnie do bursztynowego pierścienia „tu stań” (miejsce przyjęcia piłki na wysokości bioder); gdy nie ma czego przyjmować, ustawia się jak AI partnera (po swoim odbiciu na miejsce ataku, piłka u rywali – pozycja bazowa);
- **stuknięcie** gdziekolwiek = odbicie w cel domyślny (1. do partnera, 2. wystawa, 3. atak między rywali), przy serwisie – serwis lobem; kiedy stukniesz, decyduje o jakości, a skuteczne okno ma ≥ 450 ms;
- **machnięcie** (ruch > 30 px i puszczenie w ciągu 200 ms) = odbicie w kierunku machnięcia;
- **przeciągnięcie** (palec trzymany > 200 ms) przejmuje bieg jak w F0 – joystick względny od punktu dotknięcia; 0,5 s po puszczeniu wraca asysta;
- tuż przed kontaktem (≤ 0,4 s) gra zwalnia do 0,6×; przy szansie na atak przy siatce pierścień robi się jasnoniebieski, a HUD pisze „Stuknij – skok sam” (skok jest automatyczny);
- samouczek w pasku komunikatów: trzy podpowiedzi po kolei, każda znika po 3 udanych użyciach (localStorage).

Siła ataku jest stała (14 m/s). Przy asyście ciało gracza i partnera nie odbija piłki – bez stuknięcia drużyna gracza nie odbije piłki. Punkt upadku piłki widać z jej cienia.

Klawiatura (tryb asysty): WASD/strzałki przejmują bieg (asysta wraca 0,5 s po puszczeniu), spacja = stuknięcie, spacja przy strzałkach = machnięcie w ich kierunku, N = nowy set. Tryb ręczny (`?sterowanie=reczne`) to sterowanie F0: WASD ruch, spacja zamach (trzymaj = siła).

## Struktura

```
src/sim/     stan gry, fizyka, punktacja, wejścia jako dane – DOM-free, Three-free
src/ai/      partner, rywale i asysta ruchu gracza – importuje sim, nigdy odwrotnie
src/render/  Three.js: kamera, kapsuły, boisko, znaczniki, pomiar kadru
src/input/   dotyk (asysta: asysta.ts, tryb ręczny F0: touch.ts), klawiatura → komendy
src/ui/      HUD, samouczek, pełny ekran z pierwszego dotyku, kanwa między paskami Safari
src/loop/    pętla 1/120 s z akumulatorem i spowolnieniem 0,6×, haki dev (window.__sw3d)
tests/       Vitest (Node): sim, ai, input, render, loop, ui, narzedzia (skan granic na próbkach, vercel.json)
harness/     skrypty Playwright
scripts/     check-granice.mjs – skan granic modułów (reguły eksportowane do testu)
docs/        koncepcja, fazy, architektura, raporty, zrzuty
```
