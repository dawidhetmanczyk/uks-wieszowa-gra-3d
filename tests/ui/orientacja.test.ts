/**
 * Reguła nakładki „Obróć telefon” (src/ui/orientation-rule.ts): palec + pion + brak furtki.
 * Sama nakładka (DOM) jest sprawdzana w przeglądarce – harness/zrzuty.ts robi jej zrzut
 * w 390 × 844 i przechodzi przez „Graj mimo to”; perf i kadr w pionie też.
 */
import { describe, expect, it } from 'vitest';
import { shouldBlock } from '../../src/ui/orientation-rule';

describe('nakładka „Obróć telefon”', () => {
  it('telefon w pionie: nakładka', () => {
    expect(shouldBlock(true, 390, 844, false)).toBe(true);
  });

  it('telefon w poziomie: gra', () => {
    expect(shouldBlock(true, 844, 390, false)).toBe(false);
  });

  it('kwadratowe okno nie jest pionem', () => {
    expect(shouldBlock(true, 600, 600, false)).toBe(false);
  });

  it('wąskie okno z myszą (laptop) nie dostaje nakładki', () => {
    expect(shouldBlock(false, 390, 844, false)).toBe(false);
  });

  it('furtka „Graj mimo to” zdejmuje nakładkę także w pionie', () => {
    expect(shouldBlock(true, 390, 844, true)).toBe(false);
  });
});
