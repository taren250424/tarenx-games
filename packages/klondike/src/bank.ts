/*
 * The games the player can be dealt.
 *
 * A game number is an index into the bank of layouts that have been proved
 * winnable — see winnable.ts, and tools/solve.mjs for how they got there. The
 * number stored in the bank is the shuffle seed, so no deal is kept anywhere:
 * the cards are rebuilt from the seed when the game starts.
 *
 * The upshot is that every game on offer here is one that has already been
 * finished, by machine, with the moves replayed through the same rules the
 * player is bound by.
 */

import { GAMES } from "./winnable.ts";

export const GAME_MIN = 1;
export const GAME_MAX = GAMES.length;

export function clampGame(value: number): number {
	if (!Number.isFinite(value)) return GAME_MIN;
	return Math.min(GAME_MAX, Math.max(GAME_MIN, Math.trunc(value)));
}

/** The shuffle seed behind a game number. */
export function seedOf(gameNumber: number): number {
	return GAMES[clampGame(gameNumber) - 1];
}

export function randomGame(): number {
	return GAME_MIN + Math.floor(Math.random() * (GAME_MAX - GAME_MIN + 1));
}
