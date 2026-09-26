/**
 * Pełny ekran z pierwszego dotyku (F0b, decyzja Dawida 8): zostaje na Androidzie, ale BEZ
 * blokady orientacji – gra działa w pionie i w poziomie. iPhone (Safari) nie ma pełnego
 * ekranu dla strony, więc wywołanie po prostu nic nie robi.
 *
 * „Pierwszy gest nie może przepaść”: w F0 prośba szła na pointerdown – wejście w pełny ekran
 * zmienia rozmiar okna w trakcie gestu, a przeglądarka potrafi wtedy anulować wskaźnik
 * (pointercancel) i stuknięcie ginęło. Teraz prośba idzie na pointerup, po obsłudze gestu:
 * input dostał już swoje zdarzenia, a zmiana rozmiaru przychodzi asynchronicznie później.
 * pointerup dotyku jest zdarzeniem dającym przeglądarce „aktywację użytkownika”, więc
 * requestFullscreen nadal jest dozwolone. Test: tests/ui/pelny-ekran.test.ts.
 */

export interface FullscreenElement {
  requestFullscreen?: () => Promise<void> | void;
}

export type FullscreenWindow = Pick<Window, 'addEventListener' | 'removeEventListener'>;

export interface FirstTouchFullscreen {
  /** Czy prośba o pełny ekran już poszła. */
  requested(): boolean;
  dispose(): void;
}

export function createFirstTouchFullscreen(
  win: FullscreenWindow,
  element: FullscreenElement,
  isFullscreen: () => boolean = () => false,
): FirstTouchFullscreen {
  let requested = false;

  const onPointerUp = (e: PointerEvent): void => {
    if (requested || e.pointerType !== 'touch') return;
    requested = true;
    win.removeEventListener('pointerup', onPointerUp);
    if (isFullscreen()) return;
    try {
      const pending = element.requestFullscreen?.call(element);
      // Odmowa (brak API, polityka przeglądarki) to normalny przypadek – nic nie wypisujemy.
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    } catch {
      // Jak wyżej: brak pełnego ekranu nie przeszkadza w grze.
    }
  };

  // Nasłuch w fazie bąbelkowania na window, rejestrowany po wejściu – gest obsłużony pierwszy.
  win.addEventListener('pointerup', onPointerUp);

  return {
    requested: () => requested,
    dispose() {
      win.removeEventListener('pointerup', onPointerUp);
    },
  };
}
