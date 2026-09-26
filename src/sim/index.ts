/**
 * Publiczne API symulacji (docs/22 §1 „src/sim”) + re-eksport kontraktu.
 * Inne moduły importują tylko stąd.
 */
export { createSimState, cloneState } from './state';
export type { SimOptions } from './state';
export { step } from './step';
export { canReach, jumpAttackChance, reachWindow } from './predict';
export { defaultAttackTarget } from './contact';
export { createRecording, appendTick, replay } from './recording';

export * from './types';
export * from './constants';
export * from './prng';
export * from './vec';
export * from './ballistics';
export * from './spots';
export * from './aim';
