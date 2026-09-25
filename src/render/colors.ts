/**
 * Kolory klubu (CLAUDE.md „Klub i marka”) w jednym miejscu, żeby render nie miał
 * rozsianych heksów. Tło jest ciemniejsze od podłogi – granatowa podłoga ma się
 * czytać jako podłoga, a nie zlewać z horyzontem. Drużyna 0 (gracz + partner) jest
 * niebieska, drużyna 1 (rywale) czerwona; partner ma jaśniejszy odcień, żeby nie
 * mylić go z graczem (docs/20 §4.3).
 */
import type { PlayerId } from '../sim/index';

export const COLOR_BACKGROUND = '#061A2E';
export const COLOR_FLOOR = '#0A2540';
export const COLOR_LINE = '#FFFFFF';
export const COLOR_NET = '#FFFFFF';
export const COLOR_BALL = '#F79300';
export const COLOR_BALL_SHADOW = '#000000';
/** Bursztyn wolno używać tylko na granacie – pierścień „tu stań” leży na podłodze, więc pasuje. */
export const COLOR_STAND = '#FBB014';
export const COLOR_ACTIVE = '#FFFFFF';
export const COLOR_AIM = '#109CE4';
export const COLOR_SKY_LIGHT = '#DFF1FF';
export const COLOR_GROUND_LIGHT = '#0A2540';

/** Gracz, partner, dwaj rywale – indeks = PlayerId. */
export const PLAYER_COLORS: Readonly<Record<PlayerId, string>> = {
  0: '#0A5AA8',
  1: '#109CE4',
  2: '#D62410',
  3: '#B81E0C',
};
