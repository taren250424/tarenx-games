/*
 * Turning a shuffle seed into a Klondike layout.
 *
 * Deliberately knows nothing about game numbers or the winnable-game bank: the
 * solver that builds that bank runs through here, so this file has to be the
 * plain, unopinionated dealer at the bottom of everything.
 */

import { type Card, shuffled } from "../../shared/cards/deck.ts";

export interface Deal {
	/** Seven columns of 1-7 cards, only the last of each dealt face up. */
	tableau: Card[][];
	/** The 24 cards left over, drawn from the end. */
	stock: Card[];
}

export function dealFromSeed(seed: number): Deal {
	const deck = shuffled(seed);
	const tableau: Card[][] = [];
	let dealt = 0;
	for (let col = 0; col < 7; col++) {
		tableau.push(deck.slice(dealt, dealt + col + 1));
		dealt += col + 1;
	}
	return { tableau, stock: deck.slice(dealt) };
}
