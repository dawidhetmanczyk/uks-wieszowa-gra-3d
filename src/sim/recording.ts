/**
 * Nagranie = ziarno + komendy per tick. Powtórka = ten sam `step` na tych samych danych.
 * Ticki bez wpisu to puste listy komend, więc nagranie 60 s spokojnego meczu jest małe.
 */
import { createSimState } from './state';
import { step } from './step';
import type { Command, Recording, SimState } from './types';

/** Nagranie zaczyna się od stanu początkowego setu – wołaj zaraz po createSimState. */
export function createRecording(state: SimState): Recording {
  return {
    seed: state.seed,
    servingTeam: state.rally.servingTeam,
    humanControl: state.humanControl,
    assist: state.assist,
    ticks: [],
  };
}

function cloneCommand(c: Command): Command {
  switch (c.type) {
    case 'swing':
    case 'aim':
      return { ...c, aim: c.aim ? { x: c.aim.x, z: c.aim.z } : null };
    default:
      return { ...c };
  }
}

/** Dopisuje komendy ticku; puste listy pomija. Komendy są kopiowane – wołający może je zmieniać. */
export function appendTick(rec: Recording, tick: number, commands: readonly Command[]): void {
  if (commands.length === 0) return;
  rec.ticks.push({ tick, commands: commands.map(cloneCommand) });
}

/**
 * Odtwarza stan od zera: `untilTick` kroków (stan kończy z tick === untilTick).
 * Domyślnie do ostatniego nagranego ticku włącznie.
 */
export function replay(rec: Recording, untilTick?: number): SimState {
  const state = createSimState({
    seed: rec.seed,
    servingTeam: rec.servingTeam,
    humanControl: rec.humanControl,
    assist: rec.assist,
  });
  const last = rec.ticks.length > 0 ? rec.ticks[rec.ticks.length - 1]!.tick + 1 : 0;
  const end = untilTick ?? last;
  const empty: Command[] = [];
  let idx = 0;
  for (let t = 0; t < end; t++) {
    let cmds: readonly Command[] = empty;
    const entry = rec.ticks[idx];
    if (entry && entry.tick === t) {
      cmds = entry.commands;
      idx++;
    }
    step(state, cmds);
  }
  return state;
}
