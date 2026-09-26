/**
 * Publiczne API modułu ui (docs/22 §1 „src/ui”). F0b: HUD (z napisem skoku i linią
 * samouczka), samouczek, pełny ekran z pierwszego dotyku, kanwa między paskami Safari.
 * Nakładka „Obróć telefon” z F0 zniknęła – gra działa w obu orientacjach (decyzja Dawida 7).
 */
export { createHud, JUMP_HINT_TEXT } from './hud';
export type { Hud, HudHandlers, HudOptions } from './hud';
export {
  browserTutorialStorage,
  createTutorial,
  HINT_USES_TO_HIDE,
  HINTS,
  TUTORIAL_STORAGE_KEY,
} from './tutorial';
export type { Hint, HintId, Tutorial, TutorialCounts, TutorialStorage } from './tutorial';
export { createFirstTouchFullscreen } from './fullscreen';
export type { FirstTouchFullscreen, FullscreenElement, FullscreenWindow } from './fullscreen';
export { bindVisualViewport } from './viewport';
export type { ViewportBinding, ViewportWindow } from './viewport';
