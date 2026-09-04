# 21 – Fazy i prompty (Set Wieszowa 3D)

Każda faza kończy się raportem i **bramą** – decyzją Dawida. Claude Code nie zaczyna kolejnej fazy sam. Gałąź per faza (`f0/…`, `f1/…`), merge do `main` dopiero po bramie.

## F0 – szkielet i prototyp uczucia (brama: Dawid gra 10 min na telefonie)

```
F0. Przeczytaj CLAUDE.md, docs/20-KONCEPCJA-3D.md, docs/ASSETY.md. Zanim użyjesz API Three.js/Vite, sprawdź je w Context7.

Cel: sprawdzić sterowanie i kamerę w 2 na 2 zanim powstanie jakakolwiek grafika. Wszystko jako kapsuły i prostokąty.

1. Scaffold: Vite + TypeScript + three (jedyna zależność runtime). Struktura katalogów z CLAUDE.md, pnpm check:granice (skan importów w src/sim i src/ai: zero three/window/document), vitest dla sim, Playwright dla harnessu, eslint, prettier. .nvmrc, README z komendami.
2. src/sim: stan 2 na 2 (4 kapsuły, piłka, siatka, boisko 9×18, 3 odbicia, zakaz dwóch odbić z rzędu tym samym zawodnikiem, punktacja set do 7 / przewaga 2 / limit 10), krok 1/120 z akumulatorem, mulberry32, uderzenie kierowane wg docs/20 §5, aut wg cienia, kolizje piłka–podłoga/siatka/kapsuła. Wejścia jako dane (komendy), żeby dało się je nagrywać.
3. src/ai: jeden algorytm wg docs/20 §6, jeden profil (Nowicjusz) dla partnera i rywali; zasada „nie zabieraj gry” dla partnera. Wybór celu: na razie tylko „między rywalami”.
4. src/render: kamera wg docs/20 §4.1 (bez powtórek), podłoga + linie, siatka jako płaszczyzna, kapsuły w kolorach drużyn (partner jaśniejszy niebieski), piłka, cień piłki (płaskie koło na podłodze), pierścień lądowania, pierścień aktywnego zawodnika, celownik. Jedno światło, bez postprocesu.
5. src/input: przeciągnięcie = ruch, dotknięcie = uderzenie z timingiem, kierunek z przeciągnięcia, czas trzymania = siła (tylko atak), dotknięcie bez przeciągania przy 1./2. odbiciu = wystawa do partnera; automatyczne przełączanie aktywnego zawodnika z histerezą. Klawiatura jak w docs/20 §3.3.
6. src/ui: tylko HUD (wynik, odbicia, kto aktywny) i przycisk „Nowy set”.
7. Testy sim: determinizm (seed → identyczny stan po 60 s AI vs AI), brak przenikania, aut na 4 liniach, 3 odbicia, zakaz podwójnego odbicia, przełączanie aktywnego bez migotania (≤ 1 zmiana na 0,5 s przy stałej pozycji piłki).
8. Harness: skrypt Playwright, który gra 60 s AI vs AI w 390×844 z CPU 4× i raportuje fps p95, draw calls, trójkąty; drugi skrypt symuluje przyjęcie serwisu dotknięciem w oknie czasowym i podaje odsetek udanych z 50 prób.

Nie rób: modeli postaci, hali, efektów, dźwięku, menu, poziomów V-Lider/Trener, PWA.

Gałąź f0/prototyp. Raport: zrzuty 390×844 i 1280×720, fps p95 / draw calls / trójkąty, odsetek udanych przyjęć z harnessu, lista miejsc, gdzie koncepcja była niedoprecyzowana i co przyjąłeś. Nie merguj.
```

**Brama F0:** Dawid gra 10 minut na telefonie. Pytania: trafiam w piłkę bez frustracji? wiem, gdzie spadnie? przełączanie zawodnika jest zrozumiałe? wystawa do partnera działa intuicyjnie? Jeśli „nie” na którekolwiek – F0b z poprawkami sterowania, nie F1.

## F1 – pełna symulacja, trzy poziomy, strojenie

```
F1. Trzy profile (Nowicjusz, V-Lider, Trener Grzegorz) dla rywali; partner gracza ma własny profil „Partner” strojony osobno (ma być pomocny, nie dominujący). Pełny wybór celu wg docs/20 §6. Serwis z niezależnego strumienia PRNG. Strojenie headless: AI vs AI 500 setów na profil, seedy 1–500, bot referencyjny = Nowicjusz z F0 zamrożony w skrypcie. Cel: gracz-bot referencyjny wygrywa z Trenerem 25,5 % ± 3 pp, z Nowicjuszem ≥ 70 %. Auty AI ≤ 12 %. Snapshot Nowicjusza z F0 bit w bit. docs/STROJENIE.md z tabelami. Nagrywanie wejść meczu do powtórek (format, test odtworzenia bit w bit).
```

**Brama F1:** tabela strojenia w widełkach, testy zielone.

## F2 – postacie

```
F2. Wybierz z docs/ASSETY.md paczkę postaci (weryfikacja licencji CC0 na stronie źródłowej w dniu pobrania – wpis z SHA-256). Załaduj glTF, przebarw materiały na kolory drużyn, koszulka z numerem i znakiem klubu z CanvasTexture. Animacje: idle, bieg (blend kierunkowy), skok, atak, przyjęcie, wystawa, radość, smutek – crossfade 120 ms, sterowane stanem sim (render nie zmienia sim). LOD: pełny model ≤ 8 m od kamery, uproszczony dalej. Cienie z jednego światła kierunkowego. Budżety z CLAUDE.md muszą się zmieścić – zmierz.
```

**Brama F2:** zrzuty 390 px i 1280 px, akceptacja wizualna Dawida; fps p95 ≥ 55.

## F3 – hala, efekty, dźwięk, powtórki

```
F3. Hala wg docs/20 §4.2 (sponsorzy jako tekstury z Canvas, dane sponsorów w jednym pliku JSON), efekty §4.4, powtórka po punkcie z kamery bocznej (odtworzenie nagranych wejść; brama: bit w bit ze stanem meczu), dźwięk syntetyzowany lub CC0 z wpisem w ASSETY.md, prefers-reduced-motion respektowany (bez drżenia, slow-mo, cząstek). Budżety zmierzone po zmianach.
```

**Brama F3:** fps p95 ≥ 55, bundle ≤ 350 kB gzip, assety ≤ 4 MB, powtórka zgodna bit w bit.

## F4 – menu, profil, mecz tygodnia, PWA, wdrożenie

```
F4. Menu (poziom, pseudonim, dźwięk, „Mecz tygodnia” z seedem z numeru tygodnia ISO), tablica lokalna, ekran końca meczu z „Pochwal się” (obraz wyniku z Canvas), PWA (manifest, ikony ze znaku klubu, offline dla gry), wdrożenie na Vercel jako osobny projekt, docelowo ukswieszowa.pl/gra3d (rewrite ze strony – po przepięciu domeny). Lighthouse mobile ≥ 90 w wydajności.
```

**Brama F4:** test z dziećmi (3 × 10 min), raport docs/TEST-DZIECI.md, decyzja o wydaniu.

## Zasady dla każdej fazy

- Raport zawsze z liczbami (fps, px, %, kB) i zrzutami w docelowych rozmiarach.
- Wszystko, co przyjąłeś sam, bo koncepcja milczała – osobna lista w raporcie. To jest najcenniejsza część raportu.
- Jeśli czegoś nie da się zrobić w budżecie – powiedz, nie tnij budżetu.
