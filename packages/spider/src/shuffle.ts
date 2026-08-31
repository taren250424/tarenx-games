/*
 * Turning a shuffle seed into a Spider layout.
 *
 * Deliberately knows nothing about game numbers or the winnable-game bank: the
 * solver that builds that bank runs through here, so this file has to be the
 * plain, unopinionated dealer at the bottom of everything.
 *
 * Two decks make 104 cards, and with fewer suits the same values repeat, so a
 * card here is an id 0-103 rather than a face value. The ids are laid out as
 * eight runs of thirteen — id 0 is the ace of the first sequence, id 13 the ace
 * of the second — which gives every id its rank by arithmetic alone, and lets
 * one shuffled layout serve any suit count: only the faces painted on the ids
 * change, via `packOf`.
 */

import { type Card, shuffle } from "../../shared/cards/deck.ts";

export type SuitCount = 1 | 2 | 4;

export const DECK = 104;
export const COLUMNS = 10;
export const RUN = 13;

/** Which of the four suits the eight sequences cycle through per suit count. */
const SUIT_SETS: Record<SuitCount, number[]> = {
	1: [3], // all spades
	2: [3, 2], // spades and hearts
	4: [0, 1, 2, 3],
};

export function rankOf(id: number): number {
	return id % RUN;
}

/** The suit class an id belongs to — only equality between them ever matters. */
export function suitOf(id: number, suits: SuitCount): number {
	return Math.floor(id / RUN) % SUIT_SETS[suits].length;
}

/** The face value behind each id at a given suit count, for drawing the cards. */
export function packOf(suits: SuitCount): Card[] {
	const set = SUIT_SETS[suits];
	return Array.from({ length: DECK }, (_, id) => rankOf(id) * 4 + set[suitOf(id, suits)]);
}

export interface Deal {
	/** Ten columns of 5-6 ids, only the last of each dealt face up. */
	tableau: number[][];
	/** The 50 ids left over — five rows of ten, dealt from the end. */
	stock: number[];
}

export function dealFromSeed(seed: number): Deal {
	const ids = shuffle(
		Array.from({ length: DECK }, (_, i) => i),
		seed
	);
	const tableau: number[][] = [];
	let dealt = 0;
	for (let col = 0; col < COLUMNS; col++) {
		const size = col < 4 ? 6 : 5;
		tableau.push(ids.slice(dealt, dealt + size));
		dealt += size;
	}
	return { tableau, stock: ids.slice(dealt) };
}
