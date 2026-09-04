# Assety – źródła, licencje, rejestr

Zasada: **żaden plik nie trafia do repo bez wpisu w tabeli „Rejestr”** ze źródłem, licencją sprawdzoną na stronie w dniu pobrania, datą i SHA-256. Preferujemy CC0 (bez atrybucji, bez ryzyka). Assety z licencją wymagającą atrybucji – tylko po zgodzie Dawida, z wpisem w ekranie „O grze”.

## Kandydaci na postacie (sprawdzić licencję w dniu pobrania)

| Źródło | Co | Licencja (stan wiedzy, weryfikować) | Uwagi |
|---|---|---|---|
| **Quaternius** (quaternius.com) | low-poly postacie ludzkie z rigiem + „Universal Animation Library” (bieg, skok, idle i in.) | CC0 | Pierwszy wybór: spójny styl, glTF, animacje gotowe do `AnimationMixer` |
| **Kenney** (kenney.nl) | „Mini Characters”, „Animated Characters” – low-poly, glTF, animacje | CC0 | Bardziej kreskówkowe proporcje; dobre jako plan B |
| **Mixamo** (Adobe) | animacje do własnego riga | licencja Adobe – darmowa do użytku w projektach, ale NIE CC0, wymaga konta | Tylko jeśli Quaternius/Kenney nie mają potrzebnej animacji (np. atak siatkarski); wpis o licencji obowiązkowy |
| **Poly Pizza** (poly.pizza) | agregator modeli CC0/CC-BY | mieszane – filtrować po CC0 | Do rekwizytów hali (ławka, kosz na piłki), nie do postaci |

Animacje specyficzne dla siatkówki (atak z wyskoku, przyjęcie dołem, wystawa górą) prawdopodobnie nie istnieją w bibliotekach CC0. Plan: złożyć z ogólnych (skok + uderzenie ręką, kucnięcie + ręce w przód) przez blend i drobną korektę kości w kodzie (`AnimationUtils` / proceduralne dodanie rotacji ramion). Jeśli to nie wystarczy – Blender MCP na komputerze Dawida do retargetu (faza F2, decyzja wtedy).

## Piłka, hala, UI

- Piłka: własny model proceduralny (sfera + tekstura paneli z Canvas w kolorach `#F79300` / `#0A2540`). Zero pobierania.
- Hala: w całości proceduralna (patrz docs/20 §4.2). Sponsorzy: tekstury z Canvas z danych JSON.
- Czcionki: Archivo Black, Archivo, JetBrains Mono – OFL, jak na stronie. Self-hosting w `public/czcionki/`.
- Dźwięki: syntetyzowane (Web Audio) lub freesound.org z filtrem CC0 – każdy plik z wpisem.

## Narzędzia

- Kompresja glTF: `gltf-transform` (meshopt lub Draco) – dev-dependency, nie runtime.
- Podgląd modeli przed integracją: gltf.report / three.js editor – ręcznie, poza repo.

## Rejestr (uzupełnia Claude Code przy każdym pobraniu)

| Plik w repo | Źródło (URL) | Licencja | Data | SHA-256 | Użycie |
|---|---|---|---|---|---|
| – | – | – | – | – | – |
