/*
 * The card model every card game on the site shares.
 *
 * A card is a number 0-51. The low two bits are the suit and the rest is the
 * rank, which is the order a fresh deck is built in: A♣ A♦ A♥ A♠ 2♣ ...
 */

export type Card = number;

export const SUITS = ["♣", "♦", "♥", "♠"] as const;
export const RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"] as const;

const SUIT_NAMES = ["Clubs", "Diamonds", "Hearts", "Spades"];
const RANK_NAMES = [
	"Ace", "Two", "Three", "Four", "Five", "Six", "Seven",
	"Eight", "Nine", "Ten", "Jack", "Queen", "King",
];

/** 0 = ace ... 12 = king */
export function rank(card: Card): number {
	return card >> 2;
}

/** 0 = clubs, 1 = diamonds, 2 = hearts, 3 = spades */
export function suit(card: Card): number {
	return card & 3;
}

export function isRed(card: Card): boolean {
	return suit(card) === 1 || suit(card) === 2;
}

/** Spoken name, for the accessibility label on a card. */
export function cardName(card: Card): string {
	return `${RANK_NAMES[rank(card)]} of ${SUIT_NAMES[suit(card)]}`;
}

export function orderedDeck(): Card[] {
	return Array.from({ length: 52 }, (_, i) => i);
}

/*
 * A shuffle that can be replayed from its number, so a game is reproducible
 * without storing a single deal. The generator is mulberry32 — small, well
 * distributed, and above all fixed: changing it would renumber every deal on
 * the site, so it must not be "improved" later.
 */
export function shuffle<T>(items: T[], seed: number): T[] {
	let state = seed >>> 0;
	const next = () => {
		state = (state + 0x6d2b79f5) >>> 0;
		let t = state;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};

	for (let i = items.length - 1; i > 0; i--) {
		const j = Math.floor(next() * (i + 1));
		[items[i], items[j]] = [items[j], items[i]];
	}
	return items;
}

export function shuffled(seed: number): Card[] {
	return shuffle(orderedDeck(), seed);
}
