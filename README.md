# Set Wieszowa 3D

Siatkówka 2 na 2 w prawdziwym 3D dla klubu UKS Wieszowa („Wybieram Ruch”). Przeglądarka i telefon. Osobny tytuł od gry 2D `uks-wieszowa-gra`.

Stan: **faza F0 – prototyp sterowania i kamery** (kapsuły i prostokąty, bez grafiki). Fazy i bramy: `docs/21-PROMPTY-3D.md`. Koncepcja: `docs/20-KONCEPCJA-3D.md`. Kontrakt modułów i założenia F0: `docs/22-ARCHITEKTURA-F0.md`.

## Wymagania

- Node 22 (`.nvmrc`), pnpm 10 (`corepack enable` albo `npm i -g pnpm`).
- Do harnessu: Chromium Playwright – `pnpm exec playwright install chromium`.

## Komendy

| Komenda | Co robi |
|---|---|
| `pnpm install` | zależności (jedyna runtime: `three`) |
| `pnpm dev` | serwer deweloperski z `--host` (telefon w tej samej sieci: `http://<ip-komputera>:5173`) |
| `pnpm build` | build produkcyjny do `dist/` z raportem rozmiaru gzip |
| `pnpm preview` | podgląd builda na porcie 4173 |
| `pnpm test` | testy sim, ai, input i narzędzi (skan granic) w Node (Vitest) |
| `pnpm test:watch` | testy w trybie watch |
| `pnpm typecheck` | `tsc` dla trzech konfiguracji: aplikacja, sim/ai bez DOM, node (harness) |
| `pnpm lint` | ESLint (w `src/sim` i `src/ai` zakaz `three`, `window`, `document`, `Math.random`, `Date.now`) |
| `pnpm format` / `pnpm format:check` | Prettier |
| `pnpm check:granice` | skan granic modułów (CLAUDE.md): `src/sim` i `src/ai` bez three/DOM/losowości, sim nie importuje ai; `ai`, `input`, `ui`, `render`, `loop` importują sim tylko z `src/sim/index` |
| `pnpm check` | wszystko powyżej po kolei |
| `pnpm harness:perf` | 60 s AI vs AI w 390×844 z CPU 4×: fps p95, draw calls, trójkąty |
| `pnpm harness:przyjecie` | 50 prób przyjęcia serwisu tapnięciem w oknie czasowym: odsetek udanych |
| `pnpm harness:zrzuty` | zrzuty 390×844 i 1280×720 do `docs/zrzuty/` |

Harness przyjmuje `--headless` (domyślnie okno z GPU, bo headless Chromium renderuje WebGL programowo), `--url <adres>` (bez startu własnego serwera), `--sekundy N`, `--proby N`, `--seed N`, `--build`; `harness:perf` dodatkowo `--vsync` (domyślnie Chromium startuje bez limitu klatek, żeby mierzyć koszt klatki, nie częstotliwość ekranu).

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

## Sterowanie (F0)

Telefon: przeciągnięcie = ruch (joystick od punktu dotknięcia); przytrzymanie w miejscu = zamach (ręce w górze, kontakt gdy piłka doleci; dłużej = mocniej); przesunięcie palca w trakcie trzymania = celowanie (celownik na połowie rywali); tapnięcie = szybkie uderzenie, bez celu przy 1. i 2. odbiciu = wystawa do partnera. Drugi palec podczas biegu = zamach.

Klawiatura: WASD/strzałki ruch, spacja zamach (trzymaj = siła), strzałki przy spacji = kierunek, N = nowy set.

## Struktura

```
src/sim/     stan gry, fizyka, punktacja, wejścia jako dane – DOM-free, Three-free
src/ai/      partner i rywale – importuje sim, nigdy odwrotnie
src/render/  Three.js: kamera, kapsuły, boisko, znaczniki
src/input/   dotyk, klawiatura → komendy
src/ui/      HUD
src/loop/    pętla 1/120 s z akumulatorem, haki dev (window.__sw3d)
tests/       Vitest (Node): sim, ai, input, narzedzia (skan granic na próbkach)
harness/     skrypty Playwright
scripts/     check-granice.mjs – skan granic modułów (reguły eksportowane do testu)
docs/        koncepcja, fazy, architektura, raporty, zrzuty
```
