/**
 * Nakładka „Obróć telefon” – lekcja z gry 2D, przeniesiona 1:1 co do zasad.
 *
 * Gra 3D jest pozioma: w pionie na telefonie partner (4,5 m obok) wypadał z kadru nawet
 * przy FOV 72° (raport F0 §7 – 29 % klatek z obydwoma w kadrze). Pion nie jest trybem gry,
 * tylko ekranem z prośbą o obrót. Mecz stoi, dopóki nakładka jest widoczna.
 *
 * TRZY rzeczy, których ta nakładka NIE robi, każda z powodem:
 *  – nie obraca kanwy przekształceniem CSS: obrócona kanwa ma pomylone współrzędne dotyku,
 *    a sterowanie liczy przesunięcie palca w pikselach okna,
 *  – nie pokazuje się bez palca (`pointer: coarse`): zwężone okno na laptopie gra dalej,
 *  – nie zamyka drogi: furtka „Graj mimo to” jest zawsze. Wybór trzyma sessionStorage –
 *    w F0 nie ma jeszcze profilu ani ustawień, w których dałoby się go cofnąć, więc wybór na
 *    zawsze zablokowałby test nakładki na tym telefonie. Profil przyjdzie w F4, jak w 2D.
 *
 * `screen.orientation.lock('landscape')` działa tylko w pełnym ekranie (Chrome na Androidzie)
 * i nie istnieje w Safari na iOS – wołamy je z pierwszego dotyku (bez gestu przeglądarka
 * odmawia), wszystko w try/catch i z pochłoniętym odrzuceniem obietnicy.
 */
import clubMarkUrl from './club-mark.webp';
import { SKIP_STORAGE_KEY, shouldBlock } from './orientation-rule';

export interface RotateGateOptions {
  /** Kontener nakładki – <main>, żeby czytnik ekranu znalazł ją w punktach orientacyjnych. */
  root: HTMLElement;
  /** Wołane przy każdej zmianie widoczności nakładki (true = gra ma stać). */
  onChange(blocked: boolean): void;
}

export interface RotateGate {
  blocked(): boolean;
  /** Ponowne sprawdzenie orientacji (np. po zmianie rozmiaru z zewnątrz). */
  refresh(): void;
  dispose(): void;
}

const ROTATE_ICON = `<svg viewBox="0 0 64 64" aria-hidden="true" focusable="false">
  <rect class="rotate-gate__frame" x="20" y="6" width="24" height="42" rx="4" />
  <path class="rotate-gate__arrow" d="M12 52a24 24 0 0 0 40 0" />
  <path class="rotate-gate__arrowhead" d="M8 44l4 9 9-4z" />
</svg>`;

/** Twarda spacja po jednoliterowym spójniku – „W” nie zostaje sama na końcu linii. */
const NBSP = ' ';

function isCoarsePointer(): boolean {
  try {
    return window.matchMedia('(pointer: coarse)').matches;
  } catch {
    // Brak matchMedia: zakładamy mysz – fałszywa nakładka na komputerze jest gorsza niż jej brak.
    return false;
  }
}

function readSkipped(): boolean {
  try {
    return window.sessionStorage.getItem(SKIP_STORAGE_KEY) === '1';
  } catch {
    // Tryb prywatny / zablokowane dane strony: pamiętamy tylko w tej karcie (zmienna niżej).
    return false;
  }
}

function writeSkipped(): void {
  try {
    window.sessionStorage.setItem(SKIP_STORAGE_KEY, '1');
  } catch {
    // Jak wyżej – wybór i tak trzyma zmienna `skipped` do końca życia strony.
  }
}

/** Pełny ekran + blokada poziomu. Obie obietnice odmawiają normalnie – nic nie wypisujemy. */
function tryLockLandscape(): void {
  const lock = (): void => {
    try {
      const orientation = screen.orientation as ScreenOrientation & {
        lock?: (o: string) => Promise<void>;
      };
      const pending = orientation?.lock?.call(orientation, 'landscape');
      if (pending && typeof pending.catch === 'function') pending.catch(() => {});
    } catch {
      // Brak API (iOS) albo odmowa systemu – nakładka i tak poprosi o obrót ręczny.
    }
  };
  try {
    const el = document.documentElement;
    const pending = el.requestFullscreen?.call(el);
    if (pending && typeof pending.then === 'function') pending.then(lock, lock);
    else lock();
  } catch {
    lock();
  }
}

export function createRotateGate(opts: RotateGateOptions): RotateGate {
  const coarse = isCoarsePointer();
  let skipped = readSkipped();
  let blocked = false;

  const overlay = document.createElement('div');
  overlay.className = 'rotate-gate';
  overlay.hidden = true;
  // „Gra czeka” to komunikat na żywo, nie strona – dialog modalny z tytułem.
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'rotate-gate-title');

  const card = document.createElement('div');
  card.className = 'rotate-gate__card';

  const mark = document.createElement('img');
  mark.className = 'rotate-gate__mark';
  // Pusty alt: tuż pod znakiem stoi tytuł, czytnik ekranu nie ma czego powtarzać.
  mark.alt = '';
  mark.width = 80;
  mark.height = 80;
  mark.decoding = 'async';
  mark.src = clubMarkUrl;

  const icon = document.createElement('div');
  icon.className = 'rotate-gate__icon';
  icon.innerHTML = ROTATE_ICON;

  const title = document.createElement('h2');
  title.className = 'rotate-gate__title';
  title.id = 'rotate-gate-title';
  title.textContent = 'Obróć telefon';

  const text = document.createElement('p');
  text.className = 'rotate-gate__text';
  // Jedno krótkie zdanie – w 390 px mieści się w jednej linii, bez sieroty na końcu.
  text.textContent = `W${NBSP}poziomie widać ciebie i${NBSP}partnera.`;

  const skip = document.createElement('button');
  skip.type = 'button';
  skip.className = 'rotate-gate__skip';
  skip.textContent = 'Graj mimo to';

  card.append(mark, icon, title, text, skip);
  overlay.appendChild(card);
  opts.root.appendChild(overlay);

  function refresh(): void {
    const next = shouldBlock(coarse, window.innerWidth, window.innerHeight, skipped);
    if (next === blocked) return;
    blocked = next;
    overlay.hidden = !next;
    if (next) skip.focus({ preventScroll: true });
    opts.onChange(next);
  }

  const onSkip = (): void => {
    skipped = true;
    writeSkipped();
    refresh();
  };

  // Pierwszy dotyk gdziekolwiek to gest, z którego wolno poprosić o pełny ekran i poziom.
  // Faza przechwytywania: działa także wtedy, gdy dotyk trafi w kanwę albo w nakładkę.
  let lockTried = false;
  const onFirstPointer = (): void => {
    if (lockTried || !coarse) return;
    lockTried = true;
    tryLockLandscape();
  };

  const portrait = (() => {
    try {
      return window.matchMedia('(orientation: portrait)');
    } catch {
      return null;
    }
  })();

  skip.addEventListener('click', onSkip);
  window.addEventListener('resize', refresh);
  window.addEventListener('orientationchange', refresh);
  portrait?.addEventListener('change', refresh);
  document.addEventListener('pointerdown', onFirstPointer, { capture: true });
  refresh();

  return {
    blocked: () => blocked,
    refresh,
    dispose() {
      skip.removeEventListener('click', onSkip);
      window.removeEventListener('resize', refresh);
      window.removeEventListener('orientationchange', refresh);
      portrait?.removeEventListener('change', refresh);
      document.removeEventListener('pointerdown', onFirstPointer, { capture: true });
      overlay.remove();
    },
  };
}
