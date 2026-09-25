/**
 * vercel.json sprawdzany tym samym kodem, którym Vercel waliduje konfigurację przed buildem
 * (`@vercel/routing-utils`). Lekcja z 2026-09-25: wzorzec `source` przepisania zapisany jako
 * zwykłe wyrażenie regularne (`^/.+/assets/(.+)$`) przeszedł lokalnie wszystko, a wdrożenie
 * padło na Vercelu („invalid-route-source-pattern”) – `source` to składnia path-to-regexp 6.1.0.
 *
 * Poza samą walidacją test odtwarza kolejność Vercela: nagłówki z tras przed `filesystem`,
 * potem prawdziwe pliki, potem przepisania – pierwsze pasujące wygrywa.
 */
import { getTransformedRoutes } from '@vercel/routing-utils';
import { describe, expect, it } from 'vitest';
// Import JSON zamiast node:fs – testy przechodzą typecheck z konfiguracją aplikacji (bez typów Node).
import config from '../../vercel.json';

interface CompiledRoute {
  src?: string;
  dest?: string;
  handle?: string;
  headers?: Record<string, string>;
}

const transformed = getTransformedRoutes({ headers: config.headers, rewrites: config.rewrites });
const routes = (transformed.routes ?? []) as CompiledRoute[];

/** Pliki, które build Vite kładzie w dist/ (nazwy z haszem – przykładowe). */
const REAL_FILES = new Set([
  '/index.html',
  '/assets/index-abc123.js',
  '/assets/club-mark-xyz.webp',
]);
const IMMUTABLE = 'public, max-age=31536000, immutable';

function serve(path: string): { file: string; cacheControl: string | undefined } {
  const fsAt = routes.findIndex((r) => r.handle === 'filesystem');
  const headers: Record<string, string> = {};
  for (const r of routes.slice(0, fsAt)) {
    if (r.src && r.headers && new RegExp(r.src).test(path)) Object.assign(headers, r.headers);
  }
  const cacheControl = headers['Cache-Control'];
  if (path === '/') return { file: '/index.html', cacheControl };
  if (REAL_FILES.has(path)) return { file: path, cacheControl };
  for (const r of routes.slice(fsAt + 1)) {
    const m = r.src && r.dest ? new RegExp(r.src).exec(path) : null;
    if (m && r.dest) {
      return {
        file: r.dest.replace(/\$(\d+)/g, (_, i: string) => m[Number(i)] ?? ''),
        cacheControl,
      };
    }
  }
  return { file: '(404)', cacheControl };
}

describe('vercel.json', () => {
  it('przechodzi walidację Vercela (wzorce source w składni path-to-regexp)', () => {
    expect(transformed.error).toBeNull();
    expect(routes.some((r) => r.handle === 'filesystem')).toBe(true);
  });

  it('pliki z /assets/ (nazwy z haszem) są immutable, index.html i reszta no-cache', () => {
    expect(serve('/assets/index-abc123.js')).toEqual({
      file: '/assets/index-abc123.js',
      cacheControl: IMMUTABLE,
    });
    expect(serve('/assets/club-mark-xyz.webp').cacheControl).toBe(IMMUTABLE);
    expect(serve('/')).toEqual({ file: '/index.html', cacheControl: 'no-cache' });
    expect(serve('/index.html').cacheControl).toBe('no-cache');
  });

  it('nieznana ścieżka dostaje index.html (SPA fallback)', () => {
    expect(serve('/mecz').file).toBe('/index.html');
    expect(serve('/mecz/tygodnia').file).toBe('/index.html');
  });

  it('zagnieżdżone …/assets/… wskazują prawdziwy plik, nie index.html (baza Vite jest względna)', () => {
    expect(serve('/mecz/assets/index-abc123.js').file).toBe('/assets/index-abc123.js');
    expect(serve('/a/b/assets/club-mark-xyz.webp').file).toBe('/assets/club-mark-xyz.webp');
  });
});
