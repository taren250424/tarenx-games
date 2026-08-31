/*
 * The games the player can be dealt.
 *
 * A game number is an index into the bank of layouts that have been proved
 * winnable — see winnable-*.ts, and tools/solve.mjs for how they got there. The
 * number stored in the bank is the shuffle seed, so no deal is kept anywhere:
 * the cards are rebuilt from the seed when the game starts.
 *
 * Each suit count has a bank of its own, because the same seed that is a
 * pleasant one-suit game may be a hopeless four-suit one: winnability has to be
 * proved against the suits actually in play.
 */

import type { SuitCount } from "./shuffle.ts";
import { GAMES as GAMES_1 } from "./winnable-1.ts";
import { GAMES as GAMES_2 } from "./winnable-2.ts";
import { GAMES as GAMES_4 } from "./winnable-4.ts";

const BANKS: Record<SuitCount, number[]> = { 1: GAMES_1, 2: GAMES_2, 4: GAMES_4 };

export const GAME_MIN = 1;

export function gameMax(suits: SuitCount): number {
	return BANKS[suits].length;
}

export function clampGame(suits: SuitCount, value: number): number {
	if (!Number.isFinite(value)) return GAME_MIN;
	return Math.min(gameMax(suits), Math.max(GAME_MIN, Math.trunc(value)));
}

/** The shuffle seed behind a game number. */
export function seedOf(suits: SuitCount, gameNumber: number): number {
	return BANKS[suits][clampGame(suits, gameNumber) - 1];
}

export function randomGame(suits: SuitCount): number {
	return GAME_MIN + Math.floor(Math.random() * gameMax(suits));
}
