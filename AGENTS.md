# Set Wieszowa 3D – zasady dla Codex

Gra siatkarska 2 na 2 w prawdziwym 3D dla klubu UKS Wieszowa („Wybieram Ruch”). Przeglądarka i telefon. Osobny projekt od `uks-wieszowa-gra` (widok z boku) – tamten zostaje i żyje dalej; nie kopiuj z niego kodu renderu, kopiuj tylko to, co wskazuje docs/20.

Przed pracą przeczytaj: `docs/20-KONCEPCJA-3D.md`, `docs/21-PROMPTY-3D.md`, `docs/ASSETY.md`. Aktualna faza jest w docs/21 – nie wychodź poza nią.

## Stack (decyzja, nie dyskusja)

- TypeScript, Vite, **Three.js** (jedyna zależność runtime poza `three`: brak). Żadnego React, żadnego frameworka gier, żadnej fizyki zewnętrznej (Rapier, cannon, ammo – nie).
- Fizyka własna, deterministyczna: krok stały 1/120 s z akumulatorem, PRNG mulberry32 z ziarna meczu. Ta sama filozofia co w grze 2D.
- Postacie: glTF z bibliotek CC0 wskazanych w docs/ASSETY.md, animacje miksowane `AnimationMixer`. Zero modeli o niejasnej licencji.
- Rendering: WebGL2, jeden `DirectionalLight` z cieniem + `HemisphereLight`, postprocess najwyżej bloom + vignette. Budżet klatki: 60 fps na Androidzie klasy średniej (patrz „Budżety”).

## Granice modułów (pilnowane testem)

```
src/sim/     – stan gry, fizyka, punktacja, wejścia jako dane. DOM-free, Three-free. Testowalne w Node.
src/ai/      – partner i przeciwnicy. Importuje sim, nigdy odwrotnie. DOM-free, Three-free.
src/render/  – Three.js, kamera, postacie, hala, efekty. Czyta stan sim, nie zmienia go.
src/input/   – dotyk, klawiatura, gamepad → komendy dla sim.
src/ui/      – menu, HUD, ekrany. Zwykły DOM.
src/loop/    – pętla, akumulator, łączenie warstw.
```

Skan granicy: `pnpm check:granice` – `src/sim` i `src/ai` nie mogą importować `three`, `window`, `document`. Test padnie, gdy złamiesz.

## Zasady pracy

1. **Faza po fazie z bramami** (docs/21). Po każdej fazie: raport, zrzuty, pomiary. Nie zaczynasz następnej bez decyzji Dawida.
2. **Context7 przed API.** Zanim użyjesz API Three.js/Vite, którego nie użyłeś w tym projekcie, sprawdź aktualną dokumentację przez Context7 (`resolve-library-id` → `query-docs`). Three.js zmienia API często; `THREE.Geometry`, `examples/js` i podobne są martwe.
3. **Mierz, nie oceniaj.** „Płynne” = liczba: fps p95 z 60 s; „duży” = px; „czytelne” = zrzut w docelowym rozmiarze.
4. **Determinizm to funkcja.** Ten sam seed + te same wejścia = ten sam mecz. Powtórki i „mecz tygodnia” na tym stoją. Żadnego `Math.random`, `Date.now()`, `performance.now()` w sim/ai.
5. **Zero zgadywania licencji.** Każdy asset ma wpis w docs/ASSETY.md: źródło, licencja, data pobrania, suma SHA-256. Bez wpisu – nie ładujesz.
6. **Nie usuwasz zdalnych gałęzi, jeśli proxy odmawia** – mówisz i zostawiasz.
7. Język: kod i identyfikatory po angielsku; komentarze, UI, dokumenty po polsku. Półpauza „–” (U+2013) ze spacjami, nigdy „—” (U+2014).

## Budżety (twarde)

| Miara | Próg | Jak mierzyć |
|---|---|---|
| fps p95 (390×844, CPU throttling 4×) | ≥ 55 | harness Playwright, 60 s meczu z AI vs AI |
| Draw calls na klatkę | ≤ 60 | `renderer.info.render.calls` |
| Trójkąty na klatkę | ≤ 120 000 | `renderer.info.render.triangles` |
| Bundle JS gzip (bez assetów) | ≤ 350 kB | `vite build` + raport |
| Assety glTF łącznie (Draco/meshopt) | ≤ 4 MB | rozmiar w `public/` |
| Czas do pierwszej klatki gry, 4G | ≤ 4 s | Lighthouse mobile |

## Klub i marka

Kolory: granat `#0A2540`, niebieski `#0A5AA8` / `#109CE4`, czerwony `#D62410`, bursztyn `#FBB014` (tylko na granacie), piłka `#F79300`. Czcionki: Archivo Black (nagłówki), Archivo (tekst), JetBrains Mono (liczby). Drużyna gracza – niebieska, przeciwnik – czerwony. Znak klubu ma być na koszulkach i na tablicy, nigdy zniekształcony.
