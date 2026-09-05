/**
 * Profile AI (docs/20 §6, docs/22 §6): jeden algorytm, różne parametry.
 *
 * F0 ma tylko Nowicjusza – ten sam profil gra partnerem i rywalami. V-Lider,
 * Trener Grzegorz i osobny profil „Partner” dojdą w F1 razem ze strojeniem
 * headless; wtedy Nowicjusz zostaje zamrożony jako bot referencyjny.
 */
import { JUMP_SPEED, PLAYER_GRAVITY } from '../sim/constants';
export interface AiProfile {
  name: string;
  /** Co ile ticków AI odczytuje przewidywane lądowanie – to jest czas reakcji. */
  reactionTicks: number;
  /** Błąd odczytu lądowania [m]: amplituda rozkładu trójkątnego, osobno na x i z. */
  positionErrorM: number;
  /** Prędkość biegu [m/s]; sim skaluje move × PLAYER_MAX_SPEED, więc AI podaje ułamek. */
  maxSpeed: number;
  /** Agresja i ostrożność wyboru celu – w F0 nieużywane (cel tylko „między rywalami”), zostają dla F1. */
  aggression: number;
  caution: number;
  /** Szum celu ataku i serwisu [m]: amplituda rozkładu trójkątnego na każdej osi. */
  noiseM: number;
  /** Zakres siły serwisu i ataku (0..1), losowany jednostajnie. */
  servePower: [number, number];
  attackPower: [number, number];
}

/** Wartości startowe z docs/22 §6 – do strojenia w F1, nie do ręcznego poprawiania w F0. */
export const NOWICJUSZ: AiProfile = {
  name: 'Nowicjusz',
  reactionTicks: 30,
  positionErrorM: 0.6,
  maxSpeed: 3.6,
  aggression: 0.5,
  caution: 0.5,
  noiseM: 1.0,
  servePower: [0.2, 0.6],
  attackPower: [0.3, 0.7],
};

// Stałe algorytmu wspólne dla wszystkich profili [F0] ----------------------
// Trzymane tu, a nie w src/sim/constants.ts, bo dotyczą tylko decyzji AI –
// sim ich nie zna i nie musi znać.

/** Histereza roli „do piłki”: drugi z pary przejmuje ją dopiero, gdy jest szybszy o tyle sekund. */
export const AI_ROLE_HYSTERESIS_S = 0.15;
/** „Nie zabieraj gry”: partner ustępuje, gdy człowiek zdąży do lądowania z takim zapasem. */
export const AI_YIELD_MARGIN_S = 0.2;
/** W tym promieniu od celu AI przestaje iść – hamowanie robi sim. */
export const AI_ARRIVE_RADIUS_M = 0.15;
/** Do ataku AI staje tyle metrów za punktem lądowania, od strony własnej linii końcowej. */
export const AI_STAND_BEHIND_M = 0.3;
/** Do przyjęcia/obrony AI staje tyle metrów za punktem przyjęcia (tor na 1,1 m). */
export const AI_STAND_BEHIND_INTERCEPT_M = 0.15;
/** Zamach rusza, gdy piłka wejdzie w zasięg w ciągu tego czasu. */
export const AI_SWING_LEAD_S = 0.1;
/** Puszczenie zamachu najpóźniej po tym czasie, gdy kontakt nie nastąpił. */
export const AI_RELEASE_TIMEOUT_S = 0.5;
/** Partner dalej niż tyle od miejsca ataku → zamiast wystawy kiwka na rywali. */
export const AI_DUMP_PARTNER_DIST_M = 6;
/** Siła kiwki (plas). */
export const AI_DUMP_POWER = 0.1;
/** Siła podawana przy przyjęciu i wystawie – sim liczy tam łuk stały, ale komenda ma być jednoznaczna. */
export const AI_PASS_POWER = 0.5;
/** Kwantyzacja wektora ruchu – komenda move idzie tylko przy zmianie na tym poziomie (zwięzłe nagrania). */
export const AI_MOVE_QUANTUM = 0.01;
/** Najbliżej siatki, gdzie AI stawia sobie cel – zostaje na własnej połowie. */
export const AI_MIN_NET_DIST_M = 0.5;
/** Cel może leżeć tyle metrów za liniami – dalej sim i tak nie puszcza. */
export const AI_COURT_MARGIN_M = 1.5;
/**
 * Wyprzedzenie zamachu, gdy piłka wejdzie w zasięg od góry (potrzebny auto-skok): sim
 * odbija się od ziemi dopiero w zamachu, a do apogeum leci JUMP_SPEED / PLAYER_GRAVITY s –
 * zamach otwarty później daje kontakt nisko nad ziemią i atak bez siły. Zapas 0,08 s na
 * to, że sim wyzwala skok, gdy piłka w apogeum będzie ≤ REACH_TOP_JUMP + AUTO_JUMP_TOP_EXTRA.
 */
export const AI_JUMP_LEAD_S = JUMP_SPEED / PLAYER_GRAVITY + 0.08;
