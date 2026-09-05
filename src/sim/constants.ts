/**
 * Stałe symulacji (docs/20 §5 i §2). Jednostki: metry, sekundy, radiany.
 * Układ: x w poprzek boiska, y w górę, z w głąb; drużyna gracza ma z < 0, siatka w z = 0.
 *
 * Wszystko, co strojone, jest tutaj – nie w kodzie kroku. Wartości oznaczone
 * „F0” to założenia prototypu, które koncepcja zostawiła otwarte; są wypisane
 * w docs/22-ARCHITEKTURA-F0.md i w raporcie fazy.
 */

// Krok czasu -------------------------------------------------------------
export const TICK_HZ = 120;
export const DT = 1 / TICK_HZ;

// Boisko i siatka --------------------------------------------------------
export const COURT_HALF_W = 4.5; // 9 m szerokości
export const COURT_HALF_L = 9; // 18 m długości
export const NET_HEIGHT = 2.24; // jak dla młodzieży
export const NET_THICKNESS = 0.05;
/** Pas siatki wraz ze słupkami – piłka niżej niż NET_HEIGHT w tym pasie odbija się. F0. */
export const NET_HALF_W = COURT_HALF_W + 0.5;
/** Grubość linii do renderu (linie leżą wewnątrz boiska, jak w przepisach). */
export const LINE_WIDTH = 0.05;

// Piłka -------------------------------------------------------------------
export const BALL_R = 0.105;
/** Grawitacja 9,81 × parametr „arcade” 0,8 (docs/20 §5). */
export const ARCADE_GRAVITY_SCALE = 0.8;
export const GRAVITY = 9.81 * ARCADE_GRAVITY_SCALE;
/** Tłumienie liniowe prędkości piłki [1/s]. Całkowane dokładnie w ballistics.ts. F0. */
export const BALL_DRAG = 0.1;
/** Odbicie od podłogi po zakończonej akcji (tylko efekt wizualny). F0. */
export const BALL_FLOOR_RESTITUTION = 0.6;
export const BALL_FLOOR_FRICTION = 0.7;
/** Utrata 60 % energii na siatce → prędkość × sqrt(0,4) (docs/20 §5). */
export const BALL_NET_SPEED_FACTOR = Math.sqrt(0.4);
/** Odbicie od kapsuły bez zamachu (bierny kontakt). F0. */
export const BALL_BODY_RESTITUTION = 0.45;
/** Po własnym uderzeniu kapsuła zawodnika nie koliduje z piłką przez ten czas. F0. */
export const BODY_IMMUNITY_S = 0.3;

// Zawodnik ---------------------------------------------------------------
export const PLAYER_R = 0.3;
export const PLAYER_H = 1.8;
/** Prędkość i przyspieszenie człowieka; AI ma własne w profilu. F0. */
export const PLAYER_MAX_SPEED = 4.6;
export const PLAYER_ACCEL = 22;
/** Hamowanie, gdy brak komendy ruchu. F0. */
export const PLAYER_DECEL = 30;
/** Apogeum skoku ~0,6 m (docs/20 §5) → prędkość początkowa z v² = 2gh. */
export const JUMP_APEX = 0.6;
export const JUMP_SPEED = Math.sqrt(2 * GRAVITY * JUMP_APEX);
/** Grawitacja zawodnika – ta sama co piłki, żeby skok „zgrywał się” z torem. */
export const PLAYER_GRAVITY = GRAVITY;

// Zasięg i kontakt -------------------------------------------------------
/** Poziomy zasięg ramion od środka kapsuły. F0. */
export const REACH_H = 0.95;
/** Zasięg w pionie stojąc (y piłki) – z ziemi; w skoku dochodzi wysokość skoku. F0. */
export const REACH_TOP_STANDING = 2.35;
export const REACH_BOTTOM = 0.2;
/** Piłka wyżej niż to → automatyczny skok, jeśli zawodnik jest w zamachu i na ziemi. */
export const AUTO_JUMP_ABOVE = REACH_TOP_STANDING - 0.15;
/** Najwyższy możliwy kontakt (stojąc + skok). */
export const REACH_TOP_JUMP = REACH_TOP_STANDING + JUMP_APEX;

// Zamach (model „przytrzymaj do kontaktu”, docs/22 §3) --------------------
/** Ile najdłużej można trzymać zamach bez kontaktu – potem pudło. F0. */
export const SWING_HOLD_MAX_S = 0.8;
/** Po puszczeniu ramiona są jeszcze „w górze” przez ten czas (krótkie tapnięcie działa). F0. */
export const SWING_GRACE_S = 0.12;
/** Po pudle zawodnik nie może zamachnąć się ponownie. F0. */
export const SWING_WHIFF_COOLDOWN_S = 0.3;
/** Czas trzymania, po którym siła = 1 (bomba). Krótko = plas. */
export const POWER_FULL_HOLD_S = 0.6;
/** Minimalny czas trzymania, poniżej którego siła = 0. */
export const POWER_MIN_HOLD_S = 0.08;

// Prędkości i łuki uderzeń (docs/20 §5 „prędkość zależna od typu”) ---------
export const ATTACK_SPEED_MIN = 9; // plas
export const ATTACK_SPEED_MAX = 19; // bomba
export const SERVE_SPEED_MIN = 10.5;
export const SERVE_SPEED_MAX = 16;
/** Apogeum łuku przyjęcia i wystawy ponad punktem kontaktu. F0. */
export const RECEIVE_APEX = 3.4;
export const SET_APEX = 3.0;
/** Minimalny prześwit nad siatką przy rozwiązywaniu ataku/serwisu. F0. */
export const NET_CLEARANCE = 0.12;
/** Rozrzut celu w metrach przy zerowej jakości timingu (gracz). F0. */
export const NOISE_MAX_PLAYER_M = 2.2;
/** Serwis o sile poniżej tej wartości jest lobem (łuk z apogeum), powyżej – płaskim strzałem. F0. */
export const SERVE_LOB_POWER = 0.5;
/** Apogeum lobu serwisowego nad punktem wybicia: siła 0 → MAX, siła SERVE_LOB_POWER → MIN. F0. */
export const SERVE_LOB_APEX_MAX = 2.6;
export const SERVE_LOB_APEX_MIN = 1.2;
/** Wysokość, na której tor opadającej piłki wyznacza punkt przyjęcia (środek pasma przyjęcia). F0. */
export const INTERCEPT_HEIGHT = 1.1;

// Zasady (docs/20 §2) ----------------------------------------------------
export const MAX_TOUCHES = 3;
export const SET_TARGET_POINTS = 7;
export const SET_MIN_LEAD = 2;
export const SET_CAP = 10;
/** Pauza po punkcie (bez powtórki w F0). */
export const POINT_FREEZE_S = 1.5;
/** AI serwuje po tym czasie od wejścia w fazę serwisu. F0. */
export const AI_SERVE_DELAY_S = 1.0;

// Przełączanie aktywnego zawodnika (docs/20 §3.1 „z histerezą”) ----------
/** Partner musi być bliżej o tyle metrów, żeby przejąć sterowanie. F0. */
export const ACTIVE_HYSTERESIS_M = 0.75;
/** Nie częściej niż raz na tyle sekund. F0. */
export const ACTIVE_MIN_DWELL_S = 0.5;
/** Aktywny „nie zdąży” – przełączamy mimo posiadania, gdy jego czas dojścia
 *  przekracza czas lotu o tyle sekund, a partner zdąża. F0. */
export const ACTIVE_RESCUE_MARGIN_S = 0.25;

// Pozycje (docs/22 §5) ---------------------------------------------------
/** Odległość pozycji bazowych od siatki i rozstaw w x. F0. */
export const BASE_DEPTH = 6;
export const BASE_SPREAD_X = 2.25;
/** Serwujący stoi za linią końcową. */
export const SERVE_DEPTH = COURT_HALF_L + 0.6;
export const SERVE_X = 2.0;
/** Wysokość piłki w ręce serwującego. */
export const SERVE_BALL_HEIGHT = 2.0;
/** Miejsce rozgrywającego (cel przyjęcia) i miejsce ataku (cel wystawy) – odległość od siatki. F0. */
export const SETTER_DEPTH = 2.2;
export const ATTACK_DEPTH = 1.1;
export const SETTER_MAX_X = 2.5;
export const ATTACK_MAX_X = 3.5;
/** Margines od linii dla celów AI i celownika (piłka ma lądować w boisku). */
export const TARGET_MARGIN = 0.4;

// [F0] Stałe rdzenia sim dodane przy implementacji (kontrakt ich nie wymieniał) --
/** Piłka w ręce serwującego jest wysunięta o tyle w stronę siatki. */
export const SERVE_BALL_FORWARD = 0.35;
/** Kontakt dozwolony także tuż za siatką (|z| poniżej tej wartości) – ręce nad siatką. */
export const NET_CONTACT_TOLERANCE_Z = 0.35;
/** Zawodnik nie podchodzi do siatki bliżej niż PLAYER_R + ten margines. */
export const PLAYER_NET_MARGIN = 0.05;
/** O tyle zawodnik może wyjść poza linię boczną (x) i za linię końcową (z). */
export const PLAYER_OUT_X = 2.0;
export const PLAYER_OUT_Z = 2.5;
/** Jakość timingu na krawędzi zasięgu (poziomo i pionowo); w środku = 1. */
export const QUALITY_EDGE = 0.4;
/** Pasma wysokości idealnego kontaktu wg rodzaju, względem stóp zawodnika (docs/22 §3 pkt 3). */
export const BAND_RECEIVE: readonly [number, number] = [0.6, 1.8];
export const BAND_SET: readonly [number, number] = [1.6, 2.4];
export const BAND_ATTACK: readonly [number, number] = [2.0, REACH_TOP_STANDING];
/** Auto-skok: piłka poziomo nie dalej niż REACH_H + zapas, nie wyżej niż REACH_TOP_JUMP + zapas,
 *  i nie wznosi się szybciej niż AUTO_JUMP_MAX_VY (opada albo jest przy apogeum). */
export const AUTO_JUMP_H_EXTRA = 0.4;
export const AUTO_JUMP_TOP_EXTRA = 0.3;
export const AUTO_JUMP_MAX_VY = 1.0;
/** Odbicie od siatki: tłumienie składowych stycznych (x, y). */
export const BALL_NET_TANGENT_FACTOR = 0.8;
/** Cel przyjęcia/wystawy po szumie nie bliżej siatki niż to (żeby piłka nie leciała w siatkę). */
export const OWN_TARGET_MIN_Z = 0.6;
/** Cel domyślny ataku („między rywalami”) nie bliżej siatki niż to. */
export const DEFAULT_TARGET_MIN_Z = 2.0;
/** Piłka na podłodze po punkcie zatrzymuje się poniżej tych prędkości (koniec drgań). */
export const BALL_REST_VY = 0.3;
export const BALL_REST_VXZ = 0.05;
/** Powyżej tej prędkości poziomej zawodnik obraca się w kierunku ruchu. */
export const FACING_MIN_SPEED = 0.2;
