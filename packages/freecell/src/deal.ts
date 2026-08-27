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
 */

export const DEAL_MIN = 1;
export const DEAL_MAX = 32000;
export const IMPOSSIBLE_DEAL = 11982;

/*
 * A card is a number 0-51. The low two bits are the suit and the rest is the
 * rank, which is the order the original deck is built in: A♣ A♦ A♥ A♠ 2♣ ...
 */
export const SUITS = ["♣", "♦", "♥", "♠"] as const;
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

/** 0 = ace ... 12 = king */
export function rank(card: number): number {
	return card >> 2;
}

/** 0 = clubs, 1 = diamonds, 2 = hearts, 3 = spades */
export function suit(card: number): number {
	return card & 3;
}

export function isRed(card: number): boolean {
	return suit(card) === 1 || suit(card) === 2;
}

export function cardName(card: number): string {
	const names = ["Clubs", "Diamonds", "Hearts", "Spades"];
	const long = ["Ace", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Jack", "Queen", "King"];
	return `${long[rank(card)]} of ${names[suit(card)]}`;
}

/** Deals one game and returns the eight tableau columns, top card last. */
export function deal(number: number): number[][] {
	// The generator is 32-bit: the multiply stays exact in a double, and the
	// bitwise AND is what truncates it back to 32 bits.
	let seed = number;
	const next = () => {
		seed = (seed * 214013 + 2531011) & 0x7fffffff;
		return (seed >> 16) & 0x7fff;
	};

	const deck = Array.from({ length: 52 }, (_, i) => i);
	const columns: number[][] = Array.from({ length: 8 }, () => []);
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
