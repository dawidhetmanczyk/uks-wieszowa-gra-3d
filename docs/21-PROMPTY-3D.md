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

## F0b – sterowanie z asystą (brama: Dawid gra na telefonie, adres produkcyjny)

Brama F0 (2026-09-25/26) nie przeszła: na iPhonie (Safari) „nie trafiam w piłkę, frustruję się; wiem, gdzie spadnie; nie wiem, jak skakać”.

```
F0b – sterowanie z asystą. Brama F0 nie przeszła. Dawid na iPhonie (Safari): „nie trafiam w piłkę, frustruję się; wiem, gdzie spadnie; nie wiem, jak skakać”. 60 fps. W poziomie Safari zabiera górę ekranu paskiem kart, w pionie wyglądało lepiej.

Decyzje Dawida z 26.09 (nie zmieniaj ich):
1. Asysta ruchu: aktywny zawodnik sam dobiega do punktu przyjęcia (landing.intercept, pierścień „tu stań”). Przeciągnięcie palcem (trzymane dłużej niż 200 ms) przejmuje ruch jak dziś; 0,5 s po puszczeniu asysta wraca.
2. Uderzenie: stuknięcie w dowolnym miejscu ekranu = odbicie w cel domyślny (1. odbicie do partnera, 2. wystawa, 3. atak między rywali). Machnięcie (ruch > 30 px i puszczenie w ciągu 200 ms) = odbicie w kierunku machnięcia. Siła ataku w F0b stała z profilu, bez „trzymaj = mocniej”.
3. Skuteczne okno czasu co najmniej 450 ms (dziś ok. 225 ms, RAPORT-F0 §8.6). Moment dalej decyduje o jakości odbicia, ale nie o tym, czy w ogóle trafisz.
4. Lekkie spowolnienie: gdy do kontaktu aktywnego zostaje ≤ 0,4 s, tempo pętli 0,6×, po kontakcie powrót. Tylko tempo pętli – krok sim i determinizm bez zmian.
5. Skok zostaje automatyczny, ale ma być widoczny: przy szansie na atak przy siatce czytelny znak (pierścień zmienia kolor + napis „stuknij – skok sam”).
6. Samouczek w trakcie gry, trzy podpowiedzi po kolei: „Biegniesz sam – stuknij, gdy piłka dolatuje”, „Machnij palcem, żeby wybrać kierunek”, „Przy siatce skok jest automatyczny”. Każda znika po 3 udanych użyciach (localStorage w try/catch).
7. Orientacja: obie, bez nakładki „Obróć telefon” i bez furtki. Pion to główny tryb na telefonie. Kamerę w pionie dobierz od nowa metodą z §8.2, pod nowy scenariusz obciążeniowy (asysta + gracz przeciągany do linii). Warunek: 100% klatek obaj w kadrze, piłka ≥ 97%. Spośród wariantów spełniających warunek wybierz ten z największym zawodnikiem (dziś 63,5 px przy 390×844). Canvas ma się mieścić między paskami Safari (visualViewport/dvh, safe-area).
8. Android: pełny ekran z pierwszego dotyku zostaje, ale bez blokady orientacji. Pierwszy gest nie może przepaść – test.
9. Dzisiejsze sterowanie zostaje pod ?sterowanie=reczne (do porównania, bez przycisku w UI).

Pomiary przed/po w docs/RAPORT-F0b.md:
- harness przyjęcia: skuteczne okno i % sukcesów (cel: okno ≥ 450 ms, ≥ 85% sukcesów dla tapów w oknie);
- „gra nie gra sama”: bez żadnego dotyku drużyna gracza nie odbija piłki (asysta tylko biega);
- kadr w pionie i w poziomie w nowym scenariuszu, rozmiar zawodnika;
- wydajność bez regresji.
Zrzuty: pion 390×844 i poziom 844×390, wymiana oraz atak z podpowiedzią skoku.

Zasady:
- Gałąź f0b/asysta od main. Po zielonej pełnej kontroli scal do main – decyzja Dawida 26.09: F0b testuje na adresie produkcyjnym.
- Zapisz to polecenie w docs/21-PROMPTY-3D.md jako F0b.
- Znak klubu: potwierdzenie czeka na Grzegorza, zostaw jak jest.
- Nie zabijaj procesów spoza ścieżki tego repozytorium.
- Jeśli deploy nie ruszy sam – powiedz mi, nie kombinuj z Vercel CLI.
- Gdziekolwiek trzeba podjąć decyzję, której nie ma w tym poleceniu — NIE ZGADUJ.
```

Odpowiedzi Dawida na luki w poleceniu (2026-09-26, zadane przed implementacją):

| Luka | Decyzja |
|---|---|
| Co robi asysta, gdy aktywny nie ma czego przyjmować | Jak AI partnera: po własnym odbiciu biegnie na miejsce ataku, gdy piłka jest u rywali – wraca na pozycję bazową |
| Asysta stawia zawodnika na torze piłki, a ciało odbija piłkę (gra grałaby sama) | Przy asyście kapsuły gracza i partnera nie odbijają piłki – piłka przez nie przelatuje |
| Serwis gracza | Stuknięcie = serwis lobem w cel domyślny, machnięcie = lob w kierunku machnięcia, bez przytrzymania |
| Stała siła ataku | 0,5 (14 m/s) |
| Zakres `?sterowanie=reczne` | Pełne F0: wejście F0, okno ~225 ms, bez spowolnienia, ciało odbija piłkę; kamera i orientacja jak w F0b |
| Kolor pierścienia przy szansie na atak ze skokiem | Jasnoniebieski #109CE4 |
| Gdzie napis „stuknij – skok sam” i podpowiedzi samouczka | Pasek komunikatów u góry (HUD) |
| Kamera pionu: kryterium „największy zawodnik” dawało płaskie boisko (zawodnik 61,3 px, nasza połowa 35 px); warianty spełniające warunek różniły się zawodnikiem o 1,6 px, a głębią prawie dwukrotnie (zadane po przeszukaniu) | Wariant C: głębia jak pod koniec F0 – kamera 4,86 m, zawodnik 59,7 px, nasza połowa 65 px |

**Brama F0b:** Dawid gra na telefonie pod adresem produkcyjnym. Te same pytania co w F0.

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
