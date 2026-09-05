/**
 * Publiczne API modułu AI (docs/22 §1 „src/ai”). Importuje sim, nigdy odwrotnie.
 */
export type { AiProfile } from './profile';
export { NOWICJUSZ } from './profile';
export type { AiRole, AiState, PlayerBrain, TeamBrain } from './brain';
export { aiCommands, createAi } from './brain';
