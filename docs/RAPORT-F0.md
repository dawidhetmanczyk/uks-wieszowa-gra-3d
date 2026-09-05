# Raport F0 – szkielet i prototyp uczucia

Gałąź: `f0/prototyp` (nie zmergowana). Data: 2026-09-05. Autor: Claude Code, brama: Dawid.

## 1. Co jest do sprawdzenia na bramie

Prototyp sterowania i kamery w 2 na 2: cztery kapsuły, piłka, siatka, boisko 9 × 18, pełne zasady (3 odbicia, podwójne odbicie, aut wg cienia, set do 7 / przewaga 2 / limit 10), AI Nowicjusz dla partnera i rywali, HUD, przycisk „Nowy set”. Wszystko jako kapsuły i prostokąty, bez modeli, hali, efektów, dźwięku, menu, poziomów, PWA (zgodnie z zakresem F0 w docs/21).

Uruchomienie na telefonie w tej samej sieci Wi-Fi:

```bash
pnpm install && pnpm dev
```

Vite wypisze adres `http://<ip-komputera>:5173` – otwórz go na telefonie w pionie. Parametry: `?ai=1` (AI vs AI), `?serwis=1` (serwują czerwoni), `?seed=123`, `?fps=1`.

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

### 3.1 Wydajność (harness `pnpm harness:perf`, 60 s AI vs AI, 390 × 844 @3×, CPU throttling 4×, Chromium headed)

| Miara | Wynik | Próg (CLAUDE.md) |
|---|---|---|
| fps p95 | 172,4 (czas klatki p50 5,70 ms, p95 5,80 ms, p99 5,90 ms) | ≥ 55 – PASS |
| Draw calls na klatkę | 17 | ≤ 60 – PASS |
| Trójkąty na klatkę | 2 376 | ≤ 120 000 – PASS |
| Programy shaderów | 5 | – |
| Sim | 7201 ticków w 60,1 s (oczekiwane 7210) – nadążał | – |
| Kanwa | 780 × 1688 px (dpr 3 → pixelRatio przycięty do 2) | – |
| Bundle JS gzip | 146,1 kB (562 kB min) | ≤ 350 kB – PASS |
| Assety glTF | 0 B | ≤ 4 MB – PASS |

Uwaga: to pomiar na komputerze z GPU NVIDIA RTX 4060 (przez ANGLE/D3D11) z throttlingiem CPU ×4. Mówi tylko, że CPU (sim 120 Hz + predykcja toru co tick + AI) nadąża z zapasem – nie jest pomiarem GPU Androida klasy średniej. Ten trzeba zrobić na telefonie (`?ai=1&fps=1` pokazuje licznik fps w HUD). Headless Chromium (SwiftShader) dawał ~30 fps i nie nadaje się do budżetu.

### 3.2 Przyjęcie serwisu (harness `pnpm harness:przyjecie`, 50 prób)

Definicja pomiaru (docs/22 §8): rywale serwują; aktywny zawodnik dobiega klawiszami WASD do punktu przyjęcia (miejsce, gdzie opadająca piłka przecina 1,1 m); tap (dotyk) pada w losowym momencie okna [wejście piłki w zasięg − 250 ms, +250 ms]; sukces = kontakt aktywnego (nie bierny) i piłka leci do partnera na naszej połowie.

| Miara | Wynik |
|---|---|
| Sukcesy | **17 / 50 (34 %)** przy tapach rozłożonych równomiernie w ±250 ms |
| Średnia jakość udanych kontaktów | 0,42 |
| Średnie opóźnienie kontaktu względem wejścia w zasięg | −7 ms |
| Porażki | 33, wszystkie „passive” (piłka odbiła się od kapsuły, zanim padł skuteczny zamach) |

Histogram opóźnienia tapu względem wejścia piłki w zasięg (prób / udanych):

| Kosz | Prób | Udanych |
|---|---|---|
| [−250, −200) ms | 5 | 0 |
| [−200, −150) ms | 5 | 0 |
| [−150, −100) ms | 5 | 5 |
| [−100, −50) ms | 4 | 4 |
| [−50, 0) ms | 7 | 7 |
| [0, 50) ms | 1 | 1 |
| ≥ 50 ms | 0 (tap nie zdążył – piłka wcześniej trafiła w ciało) | – |

Czyli: **każdy tap w oknie od −150 do +50 ms trafia (17/17), skuteczne okno tapu ma ok. 200 ms.** Wcześniejszy tap wygasa (0,12 s łaski) przed dolotem piłki, późniejszy przegrywa z biernym odbiciem od ciała.

Interpretacja: model „przytrzymaj do kontaktu” sprawia, że wcześniejsze naciśnięcie jest bezpieczne (tap daje 0,12 s łaski, przytrzymanie do 0,8 s), a naciśnięcie później niż ok. +50 ms po wejściu w zasięg kończy się biernym odbiciem od ciała – piłka od krawędzi zasięgu (0,95 m) do kapsuły (0,3 m) leci ok. 60 ms. Histogram po koszach 50 ms pokazuje tę granicę. Trzymanie palca (zamiast tapnięcia) rozszerza okno do 0,8 s przed wejściem – harness tego wariantu nie mierzy.

### 3.3 Testy (`pnpm test`)

83 testy w 11 plikach, wszystkie zielone (Vitest, Node, bez DOM):

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
| tests/input/gesty.test.ts | klasyfikacja gestu, joystick, klawisze, mapowanie celu (bez DOM) |

Pozostałe kontrole: `pnpm check:granice` (20 plików w sim/ai bez three/DOM/losowości), `pnpm typecheck` (trzy tsconfigi, w tym sim/ai bez lib DOM), `pnpm lint`, `pnpm format:check` – zielone.

### 3.4 AI vs AI (5 seedów, skrypt pomiarowy)

Sety kończą się w 96–216 s czasu gry, 6,1 kontaktu na punkt, 100 % punktów z podłogi (zero błędów four-touches / double-touch / under-net). Siła ataku działa: siła 0,25–0,5 → ~12,4 m/s, 0,5–0,75 → ~14,0 m/s, kontakt na ~2,9 m. Zaobserwowana asymetria: czerwoni wygrali 4 z 5 setów przy identycznym profilu – sprawdzone w przeglądzie (§6).

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
5. **Punkt lądowania vs punkt przyjęcia.** Przy płaskim torze piłka na wysokości bioder jest 1–3 m przed punktem lądowania; kto stanie na pierścieniu, dostaje piłkę przy kolanach na ~40 ms. Sim liczy oba punkty; pierścień pokazuje lądowanie (jak w koncepcji), AI i harness dobiegają do punktu przyjęcia. **Pytanie na bramę:** czy pierścień ma pokazywać, gdzie piłka spadnie, czy gdzie stanąć.
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

WYNIK_PRZEGLADU

## 7. Znane ograniczenia i propozycje na F0b / F1

- **Portret: partner często poza kadrem.** Przy FOV 72° pole widzenia na wysokości naszych zawodników (9 m od kamery) ma ~6 m szerokości, a para stoi 4,5 m od siebie; kamera śledzi 0,6·gracz + 0,4·piłka (docs/20 §4.1), więc przy przyjęciu partner-rozgrywający jest za krawędzią (na f0-390x844-wymiana.png widać tylko jego cień). Wystawa do partnera to tap bez celu, więc gra jest możliwa, ale kciuk nie widzi, gdzie leci piłka. Opcje na F0b: FOV 80° w portrecie, kamera 2 m dalej za linią (z = −17) albo śledzenie środka pary z piłką. W poziomie (1280 × 720) cała para i większość boiska są w kadrze.
- Pomiar fps na prawdziwym Androidzie klasy średniej – nie wykonany (brak urządzenia w harnessie).
- Zawodnik AI „tańczy” pod piłką: co 0,25 s nowy odczyt z błędem ±0,6 m zmienia cel. Zgodne ze spec, ale nerwowe na ekranie – do strojenia w F1 (malejący błąd przy zbliżaniu piłki).
- AI zamachuje się na górnej granicy zasięgu, więc przyjęcia mają jakość ~0,3 i duży szum – działa (rozgrywający dobiega), ale w F1 warto opóźnić zamach do pasma wysokości.
- `state.events` trzyma zdarzenia tylko z ostatniego kroku sim, a pętla robi kilka kroków na klatkę – render zabezpieczył się przez `lastContact.tick`; w F3 (dźwięk, cząstki) pętla powinna akumulować zdarzenia z klatki.
- Wystawa z apogeum 3,0 m NAD kontaktem (2,9 m) daje piłkę na ~6 m i strome opadanie – rozważyć apogeum bezwzględne (~4,5 m).
- Celownik na dalekiej połowie w portrecie ma ~23 px – czytelny, ale mały; w F1 skalować znaczniki z odległością.
- Piłka ma dwa cienie: płaskie koło (pomoc dla gracza) i cień z mapy – jeśli myli, wyłączyć `castShadow` piłki.

## 8. Jak powtórzyć pomiary

```bash
pnpm harness:perf --sekundy 60
```

```bash
pnpm harness:przyjecie --proby 50
```

```bash
pnpm harness:zrzuty
```

Wyniki JSON trafiają do `harness/wyniki/` (ignorowane przez git).
