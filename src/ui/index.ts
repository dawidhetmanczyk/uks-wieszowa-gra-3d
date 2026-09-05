/**
 * Publiczne API modułu ui (docs/22 §1 „src/ui”). W F0 to tylko HUD – menu i ekrany
 * przychodzą w późniejszych fazach.
 */
export { createHud } from './hud';
export type { Hud, HudHandlers, HudOptions } from './hud';
