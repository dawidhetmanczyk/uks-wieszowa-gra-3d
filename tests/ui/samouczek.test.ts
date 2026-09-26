/**
 * Samouczek F0b (src/ui/tutorial.ts, decyzja Dawida 6): trzy podpowiedzi po kolei, każda
 * znika po 3 udanych użyciach, liczniki w localStorage (w try/catch).
 */
import { describe, expect, it } from 'vitest';
import {
  createTutorial,
  HINT_USES_TO_HIDE,
  HINTS,
  TUTORIAL_STORAGE_KEY,
  type TutorialStorage,
} from '../../src/ui/tutorial';

function memoryStorage(initial: Record<string, string> = {}): TutorialStorage & {
  data: Record<string, string>;
} {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => (k in data ? data[k]! : null),
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe('samouczek', () => {
  it('teksty i kolejność z decyzji Dawida', () => {
    expect(HINTS.map((h) => h.text)).toEqual([
      'Biegniesz sam – stuknij, gdy piłka dolatuje',
      'Machnij palcem, żeby wybrać kierunek',
      'Przy siatce skok jest automatyczny',
    ]);
    expect(HINT_USES_TO_HIDE).toBe(3);
  });

  it('podpowiedź znika po 3 udanych użyciach i przychodzi następna', () => {
    const t = createTutorial(memoryStorage());
    expect(t.current()?.id).toBe('tap');
    t.credit('tap');
    t.credit('tap');
    expect(t.current()?.id).toBe('tap');
    t.credit('tap');
    expect(t.current()?.id).toBe('flick');
    for (let i = 0; i < 3; i++) t.credit('flick');
    expect(t.current()?.id).toBe('jump');
    for (let i = 0; i < 3; i++) t.credit('jump');
    expect(t.current()).toBeNull();
  });

  it('użycia liczą się zawsze – skok zaliczony wcześniej nie wraca jako podpowiedź', () => {
    const t = createTutorial(memoryStorage());
    for (let i = 0; i < 3; i++) t.credit('jump');
    for (let i = 0; i < 3; i++) t.credit('tap');
    expect(t.current()?.id).toBe('flick');
    for (let i = 0; i < 3; i++) t.credit('flick');
    expect(t.current()).toBeNull();
  });

  it('liczniki przetrwają przeładowanie (localStorage) i nie rosną ponad 3', () => {
    const storage = memoryStorage();
    const a = createTutorial(storage);
    for (let i = 0; i < 5; i++) a.credit('tap');
    expect(JSON.parse(storage.data[TUTORIAL_STORAGE_KEY] ?? '{}')).toMatchObject({ tap: 3 });
    const b = createTutorial(storage);
    expect(b.current()?.id).toBe('flick');
  });

  it('zablokowany albo uszkodzony magazyn nie psuje gry – samouczek działa w pamięci', () => {
    const throwing: TutorialStorage = {
      getItem: () => {
        throw new Error('SecurityError');
      },
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    const t = createTutorial(throwing);
    expect(t.current()?.id).toBe('tap');
    for (let i = 0; i < 3; i++) t.credit('tap');
    expect(t.current()?.id).toBe('flick');

    const broken = createTutorial(memoryStorage({ [TUTORIAL_STORAGE_KEY]: '{nie json' }));
    expect(broken.current()?.id).toBe('tap');
    const weird = createTutorial(
      memoryStorage({ [TUTORIAL_STORAGE_KEY]: '{"tap":-4,"flick":"3","jump":99}' }),
    );
    expect(weird.counts()).toEqual({ tap: 0, flick: 0, jump: 3 });
    expect(createTutorial(null).current()?.id).toBe('tap');
  });
});
