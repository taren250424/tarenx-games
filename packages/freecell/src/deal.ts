/*
 * Microsoft FreeCell deal numbers.
 *
 * The whole game bundle carries no puzzle data: a deal is reproduced from its
 * number by replaying the same linear congruential generator Microsoft's
 * FreeCell has used since 1994. Type in a number, get the same eight columns
 * anybody else with that number gets.
 *
 * Deals 1-32000 are the classic Windows set. Every one of them is solvable
 * except #11982, which is the only proven-impossible deal in the range.
 *
 * This is FreeCell's own dealer rather than the shared seeded shuffle, because
 * the numbering is a standard other people's FreeCells share.
 */

import { type Card, orderedDeck } from "../../shared/cards/deck.ts";

export const DEAL_MIN = 1;
export const DEAL_MAX = 32000;
export const IMPOSSIBLE_DEAL = 11982;

/** Deals one game and returns the eight tableau columns, top card last. */
export function deal(number: number): Card[][] {
	// The generator is 32-bit: the multiply stays exact in a double, and the
	// bitwise AND is what truncates it back to 32 bits.
	let seed = number;
	const next = () => {
		seed = (seed * 214013 + 2531011) & 0x7fffffff;
		return (seed >> 16) & 0x7fff;
	};

	const deck = orderedDeck();
	const columns: Card[][] = Array.from({ length: 8 }, () => []);
	let left = 52;
	for (let i = 0; i < 52; i++) {
		// Draw a random card, then plug the hole with the last one in the deck.
		const j = next() % left;
		columns[i % 8].push(deck[j]);
		deck[j] = deck[--left];
	}
	return columns;
}

export function clampDeal(value: number): number {
	if (!Number.isFinite(value)) return DEAL_MIN;
	return Math.min(DEAL_MAX, Math.max(DEAL_MIN, Math.trunc(value)));
}

/** A random deal, never the one that cannot be won. */
export function randomDeal(): number {
	let n = IMPOSSIBLE_DEAL;
	while (n === IMPOSSIBLE_DEAL) {
		n = DEAL_MIN + Math.floor(Math.random() * (DEAL_MAX - DEAL_MIN + 1));
	}
	return n;
}
