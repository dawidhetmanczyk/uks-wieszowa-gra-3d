/**
 * HUD prototypu F0 (docs/21 F0 pkt 6, docs/22 §1 „src/ui”): wynik, odbicia,
 * kto jest sterowany, komunikaty i przycisk „Nowy set”. Zwykły DOM.
 *
 * Drzewo DOM powstaje raz w `createHud`. `update` jest wołane co klatkę, więc
 * buduje mały model widoku i dotyka DOM tylko tam, gdzie wartość się zmieniła –
 * zapis textContent/atrybutu wymusza layout, porównanie stringów nie.
 *
 * HUD nie zna zegara ściennego: toast po punkcie trwa tyle ticków sim, co pauza
 * po punkcie, więc w powtórce (ten sam stan) wygląda identycznie.
 */
import { POINT_FREEZE_S, TICK_HZ } from '../sim/constants';
import type { PointReason, SimState, TeamId } from '../sim/types';

export interface HudHandlers {
  onNewSet(): void;
}

export interface HudOptions {
  /** Licznik klatek pod wynikiem (parametr URL ?fps=1). */
  showFps?: boolean;
}

export interface Hud {
  update(state: SimState): void;
  /** Ostatni pomiar fps z pętli; ignorowany, gdy licznik jest wyłączony. */
  setFps(fps: number): void;
  dispose(): void;
}

/** Kolory kapsuł z docs/22 §7 – wskaźnik „Sterujesz” ma ten sam kolor co postać na boisku. */
const CAPSULE_COLOR = ['#0A5AA8', '#109CE4'] as const;
const TEAM_NAME = ['NIEBIESCY', 'CZERWONI'] as const;
/** Dopełniacz do „Punkt dla …” i „Set dla …”. */
const TEAM_GENITIVE = ['niebieskich', 'czerwonych'] as const;

const REASON_TEXT: Readonly<Record<PointReason, string>> = {
  'floor-in': 'Punkt!',
  'floor-out': 'Aut!',
  'four-touches': 'Cztery odbicia',
  'double-touch': 'Podwójne odbicie',
  'under-net': 'Pod siatką',
};

/** Toast widoczny przez całą pauzę po punkcie (1,5 s), liczony w tickach sim. */
const TOAST_TICKS = Math.round(POINT_FREEZE_S * TICK_HZ);
const TOUCH_DOTS = 3;

/** Wszystko, co HUD pokazuje, w postaci porównywalnych wartości. */
interface HudView {
  points0: string;
  points1: string;
  touches: number;
  touchSide: TeamId;
  controlText: string;
  /** Pusty string = brak próbki koloru (AI vs AI). */
  controlColor: string;
  /** Pusty string = komunikat ukryty. */
  message: string;
  toastTitle: string;
  toastSub: string;
  toastWinner: TeamId | -1;
  setOver: boolean;
  finalText: string;
}

const EMPTY_VIEW: HudView = {
  points0: '',
  points1: '',
  touches: -1,
  touchSide: 0,
  controlText: '',
  controlColor: '',
  message: '',
  toastTitle: '',
  toastSub: '',
  toastWinner: -1,
  setOver: false,
  finalText: '',
};

function otherTeam(team: TeamId): TeamId {
  return team === 0 ? 1 : 0;
}

function buildView(state: SimState): HudView {
  const { rally, score } = state;
  const phase = rally.phase;

  let controlText = 'AI vs AI';
  let controlColor = '';
  if (state.humanControl) {
    // Aktywny jest zawsze z pary 0/1; kolor zgodny z kapsułą, żeby nie trzeba było czytać.
    const isPlayer = state.active === 0;
    controlText = isPlayer ? 'Sterujesz: Ty' : 'Sterujesz: Partner';
    controlColor = CAPSULE_COLOR[isPlayer ? 0 : 1];
  }

  let message = '';
  if (phase === 'serve') {
    if (state.humanControl && rally.server === state.active) {
      message = 'Przytrzymaj, żeby zaserwować';
    } else if (rally.servingTeam === 1) {
      message = 'Serwują czerwoni';
    } else {
      message = state.humanControl ? 'Serwuje partner' : 'Serwują niebiescy';
    }
  }

  let toastTitle = '';
  let toastSub = '';
  let toastWinner: TeamId | -1 = -1;
  if (
    phase === 'point' &&
    rally.pointReason !== null &&
    rally.pointWinner !== -1 &&
    state.tick - rally.phaseTick < TOAST_TICKS
  ) {
    toastTitle = REASON_TEXT[rally.pointReason];
    toastSub = `Punkt dla ${TEAM_GENITIVE[rally.pointWinner]}`;
    toastWinner = rally.pointWinner;
  }

  const setOver = phase === 'set-over';
  let finalText = '';
  if (setOver) {
    // Zwycięzca z tablicy; gdyby sim go nie wpisał, decyduje ostatni punkt albo wynik.
    let winner: TeamId;
    if (score.setWinner !== -1) winner = score.setWinner;
    else if (rally.pointWinner !== -1) winner = rally.pointWinner;
    else winner = score.points[0] >= score.points[1] ? 0 : 1;
    // Wynik zwycięzcy pierwszy – tak czyta się „Set dla … 7:5”.
    finalText = `Set dla ${TEAM_GENITIVE[winner]} ${score.points[winner]}:${score.points[otherTeam(winner)]}`;
  }

  return {
    points0: String(score.points[0]),
    points1: String(score.points[1]),
    touches: Math.max(0, Math.min(TOUCH_DOTS, rally.touches)),
    touchSide: rally.sideOfBall,
    controlText,
    controlColor,
    message,
    toastTitle,
    toastSub,
    toastWinner,
    setOver,
    finalText,
  };
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

export function createHud(root: HTMLElement, handlers: HudHandlers, options: HudOptions = {}): Hud {
  const showFps = options.showFps ?? false;

  // Pasek górny: wynik i przycisk. Wynik jako jeden blok, żeby zawijanie na wąskim ekranie
  // nie rozdzieliło nazwy drużyny od liczby.
  const top = el('div', 'hud-top');
  const score = el('div', 'hud-score');
  score.setAttribute('aria-label', 'Wynik');
  const num0 = el('span', 'hud-num', '0');
  const num1 = el('span', 'hud-num', '0');
  score.append(
    el('span', 'hud-team hud-team--blue', TEAM_NAME[0]),
    num0,
    el('span', 'hud-sep', ':'),
    num1,
    el('span', 'hud-team hud-team--red', TEAM_NAME[1]),
  );
  const btn = el('button', 'hud-btn', 'Nowy set');
  btn.type = 'button';
  top.append(score, btn);

  // Drugi wiersz: odbicia, kto sterowany, licznik fps.
  const sub = el('div', 'hud-sub');
  const touches = el('span', 'hud-touches');
  touches.setAttribute('aria-label', 'Odbicia');
  touches.dataset.side = '0';
  const dots: HTMLElement[] = [];
  for (let i = 0; i < TOUCH_DOTS; i++) {
    const dot = el('i', 'hud-dot');
    dots.push(dot);
    touches.appendChild(dot);
  }
  const control = el('span', 'hud-control');
  const swatch = el('i', 'hud-swatch');
  const controlText = el('span', 'hud-control-text', '');
  control.append(swatch, controlText);
  const fps = el('span', 'hud-fps', '');
  fps.hidden = !showFps;
  sub.append(touches, control, fps);

  // Komunikaty pod paskiem – nie na środku ekranu, tam lata piłka.
  const messages = el('div', 'hud-messages');
  const msg = el('div', 'hud-msg', '');
  msg.setAttribute('role', 'status');
  msg.hidden = true;
  const toast = el('div', 'hud-toast');
  const toastTitle = el('b', 'hud-toast-title', '');
  const toastSub = el('span', 'hud-toast-sub', '');
  toast.append(toastTitle, toastSub);
  toast.hidden = true;
  const final = el('div', 'hud-final');
  final.setAttribute('role', 'status');
  const finalTitle = el('b', 'hud-final-title', '');
  final.append(finalTitle, el('span', 'hud-final-hint', 'Naciśnij „Nowy set” albo klawisz N'));
  final.hidden = true;
  messages.append(msg, toast, final);

  root.classList.add('hud');
  root.append(top, sub, messages);

  const onClick = (e: MouseEvent): void => {
    e.preventDefault();
    // Po kliknięciu fokus zostaje na przycisku, a spacja to zamach – spacja nie ma
    // wywoływać kolejnego nowego seta.
    btn.blur();
    handlers.onNewSet();
  };
  // Dotknięcie przycisku nie jest gestem na boisku – początek gestu nie idzie dalej do input.
  // Tylko pointerdown: pointerup musi dotrzeć do window, bo input kończy nim gest zaczęty
  // na kanwie (palec puszczony nad przyciskiem nie może zostawić „wiszącego” zamachu).
  const stopPointer = (e: Event): void => e.stopPropagation();
  btn.addEventListener('click', onClick);
  btn.addEventListener('pointerdown', stopPointer);

  let prev: HudView = EMPTY_VIEW;
  let prevFps = '';

  function update(state: SimState): void {
    const v = buildView(state);

    if (v.points0 !== prev.points0) num0.textContent = v.points0;
    if (v.points1 !== prev.points1) num1.textContent = v.points1;

    if (v.touches !== prev.touches) {
      for (let i = 0; i < TOUCH_DOTS; i++) dots[i]?.classList.toggle('is-used', i < v.touches);
    }
    if (v.touchSide !== prev.touchSide) touches.dataset.side = String(v.touchSide);

    if (v.controlText !== prev.controlText) controlText.textContent = v.controlText;
    if (v.controlColor !== prev.controlColor) {
      swatch.style.background = v.controlColor;
      swatch.hidden = v.controlColor === '';
    }

    if (v.message !== prev.message) {
      msg.textContent = v.message;
      msg.hidden = v.message === '';
    }

    if (v.toastTitle !== prev.toastTitle || v.toastSub !== prev.toastSub) {
      toastTitle.textContent = v.toastTitle;
      toastSub.textContent = v.toastSub;
      toast.hidden = v.toastTitle === '';
    }
    if (v.toastWinner !== prev.toastWinner) toast.dataset.winner = String(v.toastWinner);

    if (v.finalText !== prev.finalText) finalTitle.textContent = v.finalText;
    if (v.setOver !== prev.setOver) {
      final.hidden = !v.setOver;
      root.classList.toggle('hud--set-over', v.setOver);
    }

    prev = v;
  }

  function setFps(value: number): void {
    if (!showFps) return;
    const text = `${Math.round(value)} fps`;
    if (text === prevFps) return;
    prevFps = text;
    fps.textContent = text;
  }

  function dispose(): void {
    btn.removeEventListener('click', onClick);
    btn.removeEventListener('pointerdown', stopPointer);
    root.replaceChildren();
    root.classList.remove('hud', 'hud--set-over');
    prev = EMPTY_VIEW;
    prevFps = '';
  }

  return { update, setFps, dispose };
}
