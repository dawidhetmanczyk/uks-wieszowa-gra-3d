/**
 * Samouczek w trakcie gry (F0b, decyzja Dawida 6 z 2026-09-26): trzy podpowiedzi po kolei,
 * każda znika po 3 udanych użyciach. Liczniki w localStorage – w try/catch, bo tryb prywatny
 * i zablokowane dane strony rzucają wyjątkiem; wtedy samouczek pamięta tylko do końca strony.
 *
 * „Udane użycie” (założenie wykonawcze, w raporcie): kontakt z piłką po geście człowieka –
 * stuknięcie (1), machnięcie (2), kontakt w skoku (3). Użycia liczą się zawsze, także zanim
 * podpowiedź dojdzie do kolejki: kto już skacze przy siatce, nie musi czytać, że skok jest sam.
 * Tekst podpowiedzi pokazuje HUD w pasku komunikatów u góry (odpowiedź Dawida z 26.09).
 *
 * Logika bez DOM – magazyn wstrzykiwany (tests/ui/samouczek.test.ts).
 */

export type HintId = 'tap' | 'flick' | 'jump';

export interface Hint {
  id: HintId;
  text: string;
}

/** Kolejność i teksty z decyzji Dawida (docs/21 F0b pkt 6) – nie zmieniać bez niego. */
export const HINTS: readonly Hint[] = [
  { id: 'tap', text: 'Biegniesz sam – stuknij, gdy piłka dolatuje' },
  { id: 'flick', text: 'Machnij palcem, żeby wybrać kierunek' },
  { id: 'jump', text: 'Przy siatce skok jest automatyczny' },
];

export const HINT_USES_TO_HIDE = 3;
export const TUTORIAL_STORAGE_KEY = 'sw3d.samouczek.v1';

export type TutorialStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type TutorialCounts = Record<HintId, number>;

export interface Tutorial {
  /** Pierwsza podpowiedź z mniej niż 3 udanymi użyciami; null = samouczek zakończony. */
  current(): Hint | null;
  /** Udane użycie gestu – licznik rośnie do HINT_USES_TO_HIDE. */
  credit(id: HintId): void;
  counts(): TutorialCounts;
}

function emptyCounts(): TutorialCounts {
  return { tap: 0, flick: 0, jump: 0 };
}

function readCounts(storage: TutorialStorage | null): TutorialCounts {
  const out = emptyCounts();
  if (storage === null) return out;
  try {
    const raw = storage.getItem(TUTORIAL_STORAGE_KEY);
    if (raw === null) return out;
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return out;
    for (const h of HINTS) {
      const v = (parsed as Record<string, unknown>)[h.id];
      if (typeof v === 'number' && Number.isFinite(v) && v >= 0) {
        out[h.id] = Math.min(HINT_USES_TO_HIDE, Math.floor(v));
      }
    }
  } catch {
    // Uszkodzony wpis albo zablokowany magazyn – zaczynamy od zera.
  }
  return out;
}

export function createTutorial(storage: TutorialStorage | null): Tutorial {
  const counts = readCounts(storage);

  function save(): void {
    if (storage === null) return;
    try {
      storage.setItem(TUTORIAL_STORAGE_KEY, JSON.stringify(counts));
    } catch {
      // Pełny albo zablokowany magazyn – liczniki zostają w pamięci do końca strony.
    }
  }

  return {
    current() {
      return HINTS.find((h) => counts[h.id] < HINT_USES_TO_HIDE) ?? null;
    },
    credit(id) {
      if (counts[id] >= HINT_USES_TO_HIDE) return;
      counts[id]++;
      save();
    },
    counts() {
      return { ...counts };
    },
  };
}

/** localStorage przeglądarki albo null, gdy dostęp rzuca (tryb prywatny, polityka strony). */
export function browserTutorialStorage(): TutorialStorage | null {
  try {
    const s = window.localStorage;
    // Sam odczyt właściwości potrafi przejść, a pierwszy zapis rzucić – sprawdzamy oba.
    const probe = '__sw3d_probe__';
    s.setItem(probe, '1');
    s.removeItem(probe);
    return s;
  } catch {
    return null;
  }
}
