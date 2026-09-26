/**
 * Kanwa między paskami Safari (F0b, decyzja Dawida 7). Safari na iPhonie zabiera w poziomie
 * górę ekranu paskiem kart, a w pionie – dół paskiem adresu; oba paski zmieniają wysokość
 * w trakcie gry. `100vh` to wysokość bez pasków, więc część boiska i HUD-u lądowały pod nimi.
 *
 * visualViewport opisuje dokładnie widoczny prostokąt: jego rozmiar i przesunięcie trafiają do
 * zmiennych CSS (--app-w, --app-h, --app-top, --app-left), z których #game bierze pozycję
 * i rozmiar. Bez visualViewport zostaje CSS: 100dvh (dynamiczna wysokość okna) i inset 0.
 * Wycięcia ekranu (notch, pasek gestów) obsługuje HUD przez env(safe-area-inset-*).
 */

export type ViewportWindow = Pick<
  Window,
  'addEventListener' | 'removeEventListener' | 'innerWidth' | 'innerHeight'
> & { visualViewport?: VisualViewport | null };

export interface ViewportBinding {
  /** Ostatnio ustawiony rozmiar w px CSS – do testów i haków. */
  size(): { width: number; height: number; top: number; left: number };
  dispose(): void;
}

export function bindVisualViewport(
  win: ViewportWindow,
  style: Pick<CSSStyleDeclaration, 'setProperty'>,
): ViewportBinding {
  let last = { width: 0, height: 0, top: 0, left: 0 };

  function apply(): void {
    const vv = win.visualViewport ?? null;
    const next = vv
      ? {
          width: Math.round(vv.width),
          height: Math.round(vv.height),
          top: Math.round(vv.offsetTop),
          left: Math.round(vv.offsetLeft),
        }
      : { width: win.innerWidth, height: win.innerHeight, top: 0, left: 0 };
    if (next.width <= 0 || next.height <= 0) return;
    if (
      next.width === last.width &&
      next.height === last.height &&
      next.top === last.top &&
      next.left === last.left
    ) {
      return;
    }
    last = next;
    style.setProperty('--app-w', `${next.width}px`);
    style.setProperty('--app-h', `${next.height}px`);
    style.setProperty('--app-top', `${next.top}px`);
    style.setProperty('--app-left', `${next.left}px`);
  }

  const vv = win.visualViewport ?? null;
  vv?.addEventListener('resize', apply);
  vv?.addEventListener('scroll', apply);
  win.addEventListener('resize', apply);
  win.addEventListener('orientationchange', apply);
  apply();

  return {
    size: () => ({ ...last }),
    dispose() {
      vv?.removeEventListener('resize', apply);
      vv?.removeEventListener('scroll', apply);
      win.removeEventListener('resize', apply);
      win.removeEventListener('orientationchange', apply);
    },
  };
}
