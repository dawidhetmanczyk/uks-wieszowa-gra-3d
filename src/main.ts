/**
 * Punkt wejścia (Vite). Znajduje kanwę i kontener z index.html, sprawdza WebGL2,
 * czyta parametry z adresu i startuje grę. Tu, i tylko tu, wolno sięgnąć po zegar
 * (ziarno dnia) – sim czasu rzeczywistego nie zna.
 */
import './style.css';
import { parseUrlParams, startGame } from './loop/index';

const NO_WEBGL2_MESSAGE =
  'Ta przeglądarka nie obsługuje WebGL2, a gra go potrzebuje. ' +
  'Spróbuj w aktualnym Chrome, Firefoxie, Edge albo Safari (15 lub nowszym).';
const START_FAILED_MESSAGE = 'Nie udało się uruchomić gry. Szczegóły są w konsoli przeglądarki.';

/**
 * Sprawdzenie na osobnej kanwie – wywołanie getContext na #scene ustaliłoby atrybuty
 * kontekstu przed rendererem, a te potem już się nie zmieniają.
 */
function supportsWebGl2(): boolean {
  try {
    const probe = document.createElement('canvas');
    const gl = probe.getContext('webgl2');
    if (gl === null) return false;
    gl.getExtension('WEBGL_lose_context')?.loseContext();
    return true;
  } catch {
    return false;
  }
}

function showError(root: HTMLElement, text: string): void {
  const box = document.createElement('div');
  box.className = 'error';
  box.setAttribute('role', 'alert');
  const title = document.createElement('h1');
  title.textContent = 'Set Wieszowa 3D';
  const body = document.createElement('p');
  body.textContent = text;
  box.append(title, body);
  root.replaceChildren(box);
}

function main(): void {
  const root = document.getElementById('game');
  if (!(root instanceof HTMLElement)) {
    throw new Error('Brak elementu #game w index.html');
  }
  const canvas = document.getElementById('scene');
  if (!(canvas instanceof HTMLCanvasElement)) {
    showError(root, 'Brak kanwy #scene w index.html.');
    return;
  }
  if (!supportsWebGl2()) {
    showError(root, NO_WEBGL2_MESSAGE);
    return;
  }

  const hudRoot = document.createElement('div');
  hudRoot.id = 'hud';
  root.appendChild(hudRoot);

  const params = parseUrlParams(window.location.search, new Date());
  try {
    startGame({ canvas, hudRoot, ...params });
  } catch (err) {
    console.error(err);
    showError(root, START_FAILED_MESSAGE);
  }
}

main();
