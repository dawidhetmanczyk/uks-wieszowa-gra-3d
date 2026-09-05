/**
 * Jeden tick symulacji w kolejności z docs/22 §1:
 * czyszczenie zdarzeń → komendy → ruch zawodników → tor piłki i kolizje (siatka,
 * podłoga, kapsuły; przejście nad siatką) → zamachy (kontakt, pudło, auto-skok)
 * → zmiana fazy po pauzie → predykcja lądowania → przełączenie aktywnego → tick++.
 */
import { updateActive } from './active';
import { stepBallAndCollide } from './ball';
import { beginSwing, releaseSwing, resolveSwings, setAim } from './contact';
import { stepPlayers } from './players';
import { updateLanding } from './predict';
import { updatePhase } from './rules';
import type { Command, SimState } from './types';

function applyCommand(state: SimState, cmd: Command): void {
  switch (cmd.type) {
    case 'move': {
      const p = state.players[cmd.player];
      // Przycinanie do koła jednostkowego – klawiatura po przekątnej nie ma być szybsza.
      const l = Math.sqrt(cmd.x * cmd.x + cmd.z * cmd.z);
      const k = l > 1 ? 1 / l : 1;
      p.move.x = cmd.x * k;
      p.move.z = cmd.z * k;
      break;
    }
    case 'swing':
      beginSwing(state, state.players[cmd.player], cmd.aim, cmd.power);
      break;
    case 'aim':
      setAim(state.players[cmd.player], cmd.aim);
      break;
    case 'release':
      releaseSwing(state, state.players[cmd.player]);
      break;
  }
}

export function step(state: SimState, commands: readonly Command[]): void {
  state.events.length = 0;
  for (const cmd of commands) applyCommand(state, cmd);
  stepPlayers(state);
  stepBallAndCollide(state);
  resolveSwings(state);
  updatePhase(state);
  updateLanding(state);
  updateActive(state);
  state.tick++;
}
