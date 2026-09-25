/**
 * Publiczne API modułu ui (docs/22 §1 „src/ui”). W F0: HUD i nakładka „Obróć telefon” –
 * menu i ekrany przychodzą w późniejszych fazach.
 */
export { createHud } from './hud';
export type { Hud, HudHandlers, HudOptions } from './hud';
export { createRotateGate } from './orientation';
export type { RotateGate, RotateGateOptions } from './orientation';
export { shouldBlock } from './orientation-rule';
