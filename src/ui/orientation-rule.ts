/**
 * Reguła nakładki „Obróć telefon” bez DOM – testowalna w Node (tests/ui/orientacja.test.ts).
 *
 * Nakładka zasłania grę, gdy wszystkie trzy warunki są prawdziwe:
 *  – palec, nie mysz (`pointer: coarse`): wąskie okno przeglądarki na laptopie to nie telefon,
 *  – pion (`innerWidth < innerHeight`): kwadrat i poziom grają,
 *  – gracz nie wybrał furtki „Graj mimo to”: blokada obrotu w telefonie jest włączona
 *    u wielu dzieci i bez furtki taki gracz nie zagrałby NIGDY (lekcja z gry 2D).
 */
export function shouldBlock(
  coarsePointer: boolean,
  width: number,
  height: number,
  skipped: boolean,
): boolean {
  return coarsePointer && width < height && !skipped;
}

/** Klucz sessionStorage z wyborem furtki – patrz orientation.ts, dlaczego sesja, a nie profil. */
export const SKIP_STORAGE_KEY = 'sw3d.obrot.graj-mimo-to';
