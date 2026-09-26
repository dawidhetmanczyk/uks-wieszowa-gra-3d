/**
 * Kanwa między paskami Safari (src/ui/viewport.ts, F0b decyzja 7): rozmiar i przesunięcie
 * widocznego prostokąta (visualViewport) trafiają do zmiennych CSS, z których #game bierze
 * pozycję i rozmiar. Parametr ?sterowanie=reczne (decyzja 9) – w parserze adresu.
 */
import { describe, expect, it } from 'vitest';
import { parseUrlParams } from '../../src/loop/url';
import { bindVisualViewport, type ViewportWindow } from '../../src/ui/viewport';

function fakeWindow(
  vv: { width: number; height: number; offsetTop: number; offsetLeft: number } | null,
) {
  const win = new EventTarget() as EventTarget & {
    innerWidth: number;
    innerHeight: number;
    visualViewport: (EventTarget & typeof vv) | null;
  };
  win.innerWidth = 844;
  win.innerHeight = 390;
  win.visualViewport = vv === null ? null : Object.assign(new EventTarget(), vv);
  return win;
}

function fakeStyle() {
  const props: Record<string, string> = {};
  return { props, setProperty: (k: string, v: string) => void (props[k] = v) };
}

describe('widoczny prostokąt okna → zmienne CSS', () => {
  it('Safari w poziomie: pasek kart zabiera górę – gra zaczyna się pod nim', () => {
    const win = fakeWindow({ width: 844, height: 340, offsetTop: 50, offsetLeft: 0 });
    const style = fakeStyle();
    bindVisualViewport(win as unknown as ViewportWindow, style);
    expect(style.props).toEqual({
      '--app-w': '844px',
      '--app-h': '340px',
      '--app-top': '50px',
      '--app-left': '0px',
    });
  });

  it('pasek chowa się w trakcie gry – zmiana rozmiaru visualViewport odświeża zmienne', () => {
    const vv = { width: 390, height: 664, offsetTop: 0, offsetLeft: 0 };
    const win = fakeWindow(vv);
    const style = fakeStyle();
    const b = bindVisualViewport(win as unknown as ViewportWindow, style);
    const target = win.visualViewport!;
    Object.assign(target, { height: 764 });
    target.dispatchEvent(new Event('resize'));
    expect(style.props['--app-h']).toBe('764px');
    expect(b.size()).toEqual({ width: 390, height: 764, top: 0, left: 0 });
  });

  it('bez visualViewport – rozmiar okna', () => {
    const style = fakeStyle();
    bindVisualViewport(fakeWindow(null) as unknown as ViewportWindow, style);
    expect(style.props['--app-w']).toBe('844px');
    expect(style.props['--app-h']).toBe('390px');
  });
});

describe('?sterowanie=reczne', () => {
  const now = new Date(2026, 8, 26);
  it('domyślnie asysta F0b, ?sterowanie=reczne = pełne F0', () => {
    expect(parseUrlParams('', now).controlMode).toBe('assist');
    expect(parseUrlParams('?sterowanie=reczne', now).controlMode).toBe('manual');
    expect(parseUrlParams('?sterowanie=Reczne&seed=3', now).controlMode).toBe('manual');
    expect(parseUrlParams('?sterowanie=asysta', now).controlMode).toBe('assist');
  });
});
