# 20 – Set Wieszowa 3D: koncepcja

Status: zatwierdzona kierunkowo (Dawid, 2026-09-04): **prawdziwe 3D, 2 na 2, osobne repo**. Gra 2D (`uks-wieszowa-gra`) zostaje i jest rozwijana niezależnie; ta gra nie jest jej wersją, tylko drugim tytułem klubu.

## 1. Jedno zdanie

Grasz w parze z kolegą z drużyny UKS Wieszowa przeciwko dwójce rywali, w hali, z kamerą za plecami – przyjęcie, wystawa, atak, tak jak na prawdziwym treningu, ale jednym palcem.

## 2. Co przenosimy z gry 2D (sprawdzone na dzieciach)

- Set do 7, przewaga 2 przy 6:6, limit 10. Mecz = 1 set (opcjonalnie do 2 wygranych w „Turnieju”).
- 3 odbicia na stronę, ten sam zawodnik nie odbija dwa razy z rzędu (nowe – wynika z 2 na 2).
- Trzy poziomy: Nowicjusz, V-Lider, Trener Grzegorz = jeden algorytm × trzy zestawy parametrów. Trener wygrywa ~75 % (gracz 25,5 % ± 3 pp).
- Determinizm, seed, „mecz tygodnia” (ten sam mecz dla wszystkich w danym tygodniu), tablica z pseudonimem, strojenie headless z zamrożonym botem referencyjnym.
- Sponsor na siatce i na bandach, tablica wyników z nazwą turnieju.
- Kolory, czcionki, znak klubu.

## 3. Rozgrywka 2 na 2

### 3.1 Role
Na boisku po dwie osoby: **gracz** i **partner-AI** po stronie niebieskiej, dwaj **rywale-AI** po czerwonej. Sterujesz zawsze **tym z pary, do którego leci piłka** (przełączenie automatyczne w momencie, gdy przewidywany punkt lądowania jest bliżej jego pozycji – z histerezą, żeby nie migało). Aktywny zawodnik ma pierścień pod stopami i jaśniejszy numer.

### 3.2 Schemat wymiany
Przyjęcie (1. odbicie, zwykle gracz) → wystawa (2., zwykle partner, automatycznie idzie do siatki) → atak (3., gracz, jeśli zdąży – timing i kierunek) albo partner, jeśli gracz jest daleko. Gracz może skrócić: uderzyć na 1. lub 2. odbiciu (ryzyko, ale zaskoczenie). AI-partner nigdy nie kończy akcji, jeśli gracz jest w zasięgu – to gracz ma mieć atak.

### 3.3 Sterowanie (jeden palec)
| Akcja | Telefon | Klawiatura |
|---|---|---|
| Ruch po boisku (x, z) | przeciągnięcie gdziekolwiek | WASD / strzałki |
| Uderzenie | dotknięcie – timing względem piłki | spacja |
| Kierunek | kierunek przeciągnięcia trzymanego w chwili dotknięcia; celownik na połowie rywali | strzałki przy spacji |
| Siła | czas trzymania dotknięcia (krótko = plas, długo = bomba) – tylko przy ataku | czas trzymania spacji |
| Skok | automatyczny, gdy piłka jest wyżej niż zasięg z ziemi | – |
| Wystawa do partnera | dotknięcie przy 1. lub 2. odbiciu bez przeciągania = piłka idzie do partnera | spacja bez strzałek |

Pomoce: cień piłki (zawsze), pierścień lądowania (Nowicjusz: stały; V-Lider: tylko po serwisie rywala; Trener: wyłączony), celownik ataku, podświetlenie aktywnego zawodnika.

### 3.4 Serwis
Gracz serwuje dotknięciem (timing na pasku), kierunek jak przy ataku. AI serwuje z własnego strumienia losowości niezależnego od poziomu – „mecz tygodnia” obiecuje te same serwisy.

## 4. Świat

### 4.1 Kamera
Za linią końcową drużyny gracza, ~3,2 m wysokości, ~6 m za linią, patrzy w środek siatki. Śledzi w `x` środek ciężkości (gracz 0,6 + piłka 0,4) z lerp 0,08/klatkę. Przy ataku gracza „dojazd” 4 % FOV przez 200 ms. Nie obraca się w trakcie wymiany. Po punkcie: 1,5 s powtórki z kamery bocznej (odtworzenie z zapisanych wejść – deterministyczne), potem cięcie do kamery głównej.

### 4.2 Hala – „plakat w 3D”
Podłoga granatowa z białymi liniami (9 × 18 m), siatka z banerem sponsora (płaszczyzna z teksturą z Canvas), bandy za obiema końcowymi z 2–3 sponsorami, trybuny z instancjonowanych prostopadłościanów w kolorach klubu (kropki tłumu), dach z kratownicy (jedna siatka, powtórzona), dwa snopy światła (stożki z addytywnym materiałem), mgła bliska tłu. Bez tekstur fotograficznych. Bloom lekki, vignette.

### 4.3 Postacie
Low-poly ludzie z bibliotek CC0 (docs/ASSETY.md), materiały przebarwione na kolory drużyn, numer i znak klubu jako tekstura koszulki (Canvas → `CanvasTexture`). Animacje: idle, bieg (blend z kierunkiem), skok, atak, przyjęcie, wystawa, radość, smutek. Miksowanie `AnimationMixer` z crossfade 120 ms. Cienie kontaktowe z jednego światła kierunkowego. Partner-AI ma inny odcień niebieskiego i numer, żeby nie mylić z graczem.

### 4.4 Odczucie
Smuga piłki (trail z 6 pozycji), hit-stop 60 ms przy ataku, cząstki w kolorze drużyny przy punkcie, slow-mo 0,4× na piłce meczowej przy przekraczaniu siatki, drżenie kamery 2 px przy bombie, tłum faluje przy wymianie ≥ 6 odbić. Dźwięk: odbicie, gwizdek, skrzypienie podłogi, hala – syntetyzowane lub CC0.

## 5. Fizyka (własna, deterministyczna)

Układ: `x` w poprzek, `y` w górę, `z` w głąb (gracz `z < 0`). Jednostki: metry, sekundy. Krok 1/120 s.

- Piłka: kula r = 0,105 m, grawitacja 9,81 skalowana parametrem „arcade” (start 0,8), tłumienie liniowe, Magnus **pominięty** (arcade).
- Zawodnik: kapsuła r = 0,3 m, h = 1,8 m; prędkość maks. i przyspieszenie z profilu; skok z impulsu, apogeum ~0,6 m.
- Siatka: płaszczyzna `z = 0`, wysokość 2,24 m (jak dla młodzieży), pas o grubości 0,05 m; piłka w siatkę = odbicie z utratą 60 % energii, kontynuacja wymiany, jeśli wraca na tę samą stronę i jest odbicie w zapasie.
- Kontakt zawodnik–piłka: **uderzenie kierowane** – wektor wyjściowy = normalizuj(cel − pozycja piłki) × prędkość zależna od typu (przyjęcie / wystawa / atak / plas) + szum PRNG × parametr profilu (dla gracza: szum zależny od timingu – idealny timing = zero szumu).
- Aut: rzut cienia poza prostokąt boiska po pierwszym kontakcie z podłogą. Dotknięcie linii = w boisku.

## 6. AI

Jeden algorytm dla partnera i rywali, różnią się parametrami i rolą.

- **Percepcja:** przewidywany punkt lądowania z równania toru (bez szumu) + błąd z profilu, aktualizowany co N kroków (czas reakcji).
- **Decyzja pozycji:** kto z pary idzie do piłki – ten, dla kogo czas dojścia jest krótszy, z histerezą; drugi idzie na pozycję wystawy albo asekuracji.
- **Decyzja uderzenia (rozwinięcie G9 z gry 2D):** kandydaci celów = {krótka za siatką lewa/prawa, głęboki róg lewy/prawy, między rywalami, na słabszego rywala}; ocena = odległość najbliższego rywala × agresja − ryzyko autu × ostrożność − ryzyko bloku × szacunek + szum. Wystawa zawsze do partnera, chyba że partner jest dalej niż X – wtedy kiwka.
- **Partner gracza:** ma dodatkową zasadę „nie zabieraj gry”: jeśli gracz jest w zasięgu piłki, partner ustępuje.
- Trzy profile: czas reakcji, błąd pozycji, prędkość, agresja, ostrożność, szum. Strojenie headless: AI vs AI, 500 setów na profil, bot referencyjny zamrożony po pierwszym strojeniu.

## 7. Zakres wydania 1 (MVP)

Mecz 2 na 2 vs AI na trzech poziomach, „mecz tygodnia”, tablica lokalna z pseudonimem, powtórka po punkcie, dźwięk, portret i poziomo, PWA (instalowalna). **Nie w MVP:** multiplayer, turniej wielomeczowy, edytor postaci, sklep.

## 8. Ryzyka i jak je zbijamy

| Ryzyko | Mitygacja |
|---|---|
| Sterowanie jednym palcem w 3D frustruje | Faza 0: prototyp kapsułowy, brama: Dawid 10 min, dzieci 3 × 5 min |
| Wydajność na tanich Androidach | Budżety w CLAUDE.md od dnia 1, pomiar co fazę, LOD postaci |
| Postacie CC0 wyglądają tanio | Spójna stylizacja „plakat”, przebarwienie na kolory klubu, światło; jeśli nie zadziała – sylwetki ze znaku jako billboardy (plan B) |
| AI-partner irytuje (za dobry lub za głupi) | Zasada „nie zabieraj gry”; strojenie partnera osobno od rywali; test z dziećmi |
| Determinizm pęka przez `AnimationMixer`/float | Render nie wpływa na sim; sim testowany w Node snapshotami |

## 9. Fazy i bramy – patrz docs/21-PROMPTY-3D.md
