# Set Wieszowa 3D

Siatkówka 2 na 2 w prawdziwym 3D dla klubu UKS Wieszowa („Wybieram Ruch”). Przeglądarka i telefon. Osobny tytuł od gry 2D `uks-wieszowa-gra`.

Stan: **faza F0 – prototyp sterowania i kamery** (kapsuły i prostokąty, bez grafiki), gałąź `f0/prototyp`, czeka na bramę (Dawid gra na telefonie). Fazy i bramy: `docs/21-PROMPTY-3D.md`. Koncepcja: `docs/20-KONCEPCJA-3D.md`. Kontrakt modułów i założenia F0: `docs/22-ARCHITEKTURA-F0.md`. Raport fazy: `docs/RAPORT-F0.md`.

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
| `pnpm test` | testy sim, ai, input, render (kadr), ui (nakładka) i narzędzi (skan granic) w Node (Vitest) |
| `pnpm test:watch` | testy w trybie watch |
| `pnpm typecheck` | `tsc` dla trzech konfiguracji: aplikacja, sim/ai bez DOM, node (harness) |
| `pnpm lint` | ESLint (w `src/sim` i `src/ai` zakaz `three`, `window`, `document`, `Math.random`, `Date.now`) |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm check:granice` | skan granic modułów (CLAUDE.md): `src/sim` i `src/ai` bez three/DOM/losowości, sim nie importuje ai; `ai`, `input`, `ui`, `render`, `loop` importują sim tylko z `src/sim/index` |
| `pnpm check` | wszystko powyżej po kolei (to samo uruchamia build na Vercelu) |
| `pnpm harness:perf` | 60 s AI vs AI w 390×844 z CPU 4× (za furtką „Graj mimo to”): fps p95, draw calls, trójkąty; `--ekran 844x390` = w poziomie |
| `pnpm harness:kadr` | 60 s AI vs AI w 844×390: w ilu klatkach obaj zawodnicy drużyny gracza są w oknie w całości |
| `pnpm harness:sterowanie` | test sterowania względnego prawdziwymi dotykami: palec w lewym górnym rogu, ruch w prawo → zawodnik w prawo (kod wyjścia 1 przy błędzie) |
| `pnpm harness:przyjecie` | 50 prób przyjęcia serwisu tapnięciem w oknie czasowym (844×390): odsetek udanych |
| `pnpm harness:zrzuty` | zrzuty 844×390, 390×844 (z nakładką „Obróć telefon”) i 1280×720 do `docs/zrzuty/` |

Harness przyjmuje `--headless` (domyślnie okno z GPU, bo headless Chromium renderuje WebGL programowo), `--url <adres>` (bez startu własnego serwera), `--ekran SZERxWYS`, `--sekundy N`, `--proby N`, `--seed N`, `--build`; `harness:perf`, `harness:przyjecie` i `harness:zrzuty` dodatkowo `--vsync` (domyślnie Chromium startuje w nich bez limitu klatek: perf mierzy wtedy koszt klatki, nie częstotliwość ekranu, a wszystkie trzy nie zależą od monitora – z vsync po wygaszeniu ekranu przez Windows przeglądarka rysuje raz na sekundę). Harness uruchamia własny `vite preview` na porcie **4317** (nie domyślnym 4173 – na tej maszynie pracują też repo gry 2D i strony) i odmawia startu, gdy port jest zajęty; zabija wyłącznie procesy, które sam uruchomił.

## Wdrożenie (Vercel)

Osobny projekt Vercela `uks-wieszowa-gra-3d`. `vercel.json`: build `pnpm check && pnpm build`, katalog `dist`, pliki z `/assets/*` (nazwy z haszem) z nagłówkiem `Cache-Control: public, max-age=31536000, immutable`, wszystko inne (w tym `index.html`) `no-cache`, a nieznane ścieżki dostają `index.html` (SPA fallback; zagnieżdżone `…/assets/…` wskazują na prawdziwe pliki, bo baza Vite jest względna). Podgląd gałęzi: każdy push na `f0/prototyp` daje wdrożenie podglądowe pod stałym adresem gałęzi. Kroki zakładania projektu: `docs/RAPORT-F0.md` §8.

## Parametry URL

- `?seed=123` – ziarno meczu (domyślnie z numeru dnia),
- `?ai=1` – AI vs AI (do pomiarów),
- `?serwis=1` – serwują czerwoni,
- `?fps=1` – licznik fps w HUD.

Przełączniki jakości do pomiaru fps na telefonie (domyślnie: pixel ratio do 2, antialiasing i cienie włączone):

- `?jakosc=niska` – komplet dla telefonu klasy średniej: pixel ratio 1, bez antialiasingu, bez cieni (to samo co `?dpr=1&aa=0&cien=0`),
- `?dpr=1` – górna granica pixel ratio (liczba 0–4, także ułamek, np. `1.5`),
- `?aa=0` – bez antialiasingu (MSAA),
- `?cien=0` – bez mapy cieni.

Pojedyncze parametry nadpisują `jakosc`, więc da się mierzyć wpływ każdego z osobna (np. `?jakosc=niska&cien=1`). Ustawienia, z którymi gra rysuje, zwraca w konsoli `window.__sw3d.renderOptions()`.

## Orientacja

Gra jest pozioma. Na telefonie w pionie (palec + okno wyższe niż szersze) mecz stoi, a nakładka ze znakiem klubu prosi o obrót. Furtka „Graj mimo to” jest zawsze – dla dziecka z blokadą obrotu; wybór trzyma się do końca sesji karty. Pierwszy dotyk próbuje wejść w pełny ekran i zablokować poziom (`screen.orientation.lock`, działa w Chrome na Androidzie; iOS go nie zna – wtedy zostaje prośba o obrót). Kanwa nigdy nie jest obracana CSS-em.

## Sterowanie (F0)

Telefon: sterowanie **względne** – palec postawiony gdziekolwiek ustala środek, przesunięcie od niego daje kierunek biegu (joystick od punktu dotknięcia); przytrzymanie w miejscu = zamach (ręce w górze, kontakt gdy piłka doleci; dłużej = mocniej); przesunięcie palca w trakcie trzymania = celowanie (celownik na połowie rywali); tapnięcie = szybkie uderzenie, bez celu przy 1. i 2. odbiciu = wystawa do partnera. Drugi palec podczas biegu = zamach. Bursztynowy pierścień na podłodze pokazuje, **gdzie stanąć** (miejsce przyjęcia piłki na wysokości bioder); punkt upadku piłki widać z jej cienia.

Klawiatura: WASD/strzałki ruch, spacja zamach (trzymaj = siła), strzałki przy spacji = kierunek, N = nowy set.

## Struktura

```
src/sim/     stan gry, fizyka, punktacja, wejścia jako dane – DOM-free, Three-free
src/ai/      partner i rywale – importuje sim, nigdy odwrotnie
src/render/  Three.js: kamera, kapsuły, boisko, znaczniki, pomiar kadru
src/input/   dotyk, klawiatura → komendy
src/ui/      HUD, nakładka „Obróć telefon”
src/loop/    pętla 1/120 s z akumulatorem i pauzą, haki dev (window.__sw3d)
tests/       Vitest (Node): sim, ai, input, render, ui, narzedzia (skan granic na próbkach)
harness/     skrypty Playwright
scripts/     check-granice.mjs – skan granic modułów (reguły eksportowane do testu)
docs/        koncepcja, fazy, architektura, raporty, zrzuty
```
