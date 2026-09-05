/**
 * Mapowanie kierunku (z przeciągnięcia palcem albo strzałek) na cel na połowie rywali.
 * Wspólne dla dotyku i klawiatury, testowalne w Node.
 *
 * Konwencja kierunku: dirX ∈ [−1, 1] w prawo na ekranie, dirY ∈ [−1, 1] w dół na
 * ekranie (jak w DOM). Kamera stoi za drużyną gracza, więc „w górę ekranu” =
 * głębiej w boisko rywali. Dla drużyny 1 (gdyby kiedyś człowiek grał czerwonymi)
 * osie są odbite.
 */
import type { TeamId, Vec2 } from './types';
import { clampTargetToOpponentHalf, sideSign } from './spots';

/** Zakres x celu (m) i głębokości: środek w połowie boiska rywali, ± AIM_DEPTH_RANGE. */
export const AIM_X_RANGE = 3.8;
export const AIM_DEPTH_CENTER = 4.6;
export const AIM_DEPTH_RANGE = 3.4;
/** Poniżej tej długości wektor kierunku traktujemy jako „bez celu” (null). */
export const AIM_DEADZONE = 0.15;

export function aimFromDirection(dirX: number, dirY: number, team: TeamId): Vec2 | null {
  const len = Math.sqrt(dirX * dirX + dirY * dirY);
  if (len < AIM_DEADZONE) return null;
  const nx = dirX / Math.max(len, 1);
  const ny = dirY / Math.max(len, 1);
  const s = -sideSign(team); // znak połowy rywali
  const depth = -ny; // w górę ekranu = głębiej
  const target: Vec2 = {
    // Prawo ekranu = −x świata (układ prawoskrętny, kamera patrzy w +z); dla drużyny 1 odwrotnie.
    x: -s * nx * AIM_X_RANGE,
    z: s * (AIM_DEPTH_CENTER + depth * AIM_DEPTH_RANGE),
  };
  return clampTargetToOpponentHalf(target, team);
}
