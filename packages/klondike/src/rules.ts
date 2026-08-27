/*
 * Klondike, as rules alone — no DOM, no settings, no state of its own.
 *
 * The game plays through this module and so does the solver that builds the
 * winnable-game bank, which is the point: a game only reaches the bank once a
 * solution has been replayed through these exact functions and ended in a win.
 * If the rules here are wrong the bank is wrong with them, but the bank can
 * never disagree with the game.
 */

import { type Card, isRed, rank, suit } from "../../shared/cards/deck.ts";
import { dealFromSeed } from "./shuffle.ts";

export const KING = 12;
export const COLUMNS = 7;

/** A column is its cards bottom-first, plus how many at the bottom are face down. */
export interface Column {
	cards: Card[];
	down: number;
}

export interface Board {
	stock: Card[]; // face down, drawn from the end
	waste: Card[]; // face up, last is the top
	foundations: number[]; // cards played per suit, 0-13
	tableau: Column[];
}

export type Source =
	| { type: "waste" }
	| { type: "foundation"; suit: number }
	| { type: "tableau"; col: number; index: number };

export type Target = { type: "foundation"; suit: number } | { type: "tableau"; col: number };

export interface Move {
	src: Source;
	dst: Target;
}

// --- construction ---
export function emptyBoard(): Board {
	return {
		stock: [],
		waste: [],
		foundations: [0, 0, 0, 0],
		tableau: Array.from({ length: COLUMNS }, () => ({ cards: [], down: 0 })),
	};
}

export function cloneBoard(source: Board): Board {
	return {
		stock: [...source.stock],
		waste: [...source.waste],
		foundations: [...source.foundations],
		tableau: source.tableau.map((col) => ({ cards: [...col.cards], down: col.down })),
	};
}

/** Lays out a game from its shuffle seed, not its game number. */
export function dealBoard(seed: number): Board {
	const fresh = dealFromSeed(seed);
	return {
		stock: fresh.stock,
		waste: [],
		foundations: [0, 0, 0, 0],
		tableau: fresh.tableau.map((cards) => ({ cards, down: cards.length - 1 })),
	};
}

// --- reading the board ---
export function isSequence(cards: Card[]): boolean {
	for (let i = 1; i < cards.length; i++) {
		if (rank(cards[i]) !== rank(cards[i - 1]) - 1) return false;
		if (isRed(cards[i]) === isRed(cards[i - 1])) return false;
	}
	return true;
}

export function cardsOf(board: Board, src: Source): Card[] {
	if (src.type === "waste") {
		return board.waste.length ? [board.waste[board.waste.length - 1]] : [];
	}
	if (src.type === "foundation") {
		const count = board.foundations[src.suit];
		return count ? [(count - 1) * 4 + src.suit] : [];
	}
	const col = board.tableau[src.col];
	return src.index < col.down ? [] : col.cards.slice(src.index);
}

/** Where a card sits, if it is somewhere a move could start from. */
export function locate(board: Board, card: Card): Source | null {
	if (board.waste.length && board.waste[board.waste.length - 1] === card) return { type: "waste" };
	const s = suit(card);
	if (board.foundations[s] === rank(card) + 1) return { type: "foundation", suit: s };
	for (let col = 0; col < COLUMNS; col++) {
		const index = board.tableau[col].cards.indexOf(card);
		if (index >= 0) return index < board.tableau[col].down ? null : { type: "tableau", col, index };
	}
	return null; // in the stock, buried in the waste, or under a foundation card
}

export function sameSource(a: Source, b: Source): boolean {
	if (a.type !== b.type) return false;
	if (a.type === "tableau" && b.type === "tableau") return a.col === b.col && a.index === b.index;
	if (a.type === "foundation" && b.type === "foundation") return a.suit === b.suit;
	return a.type === "waste";
}

export function grabbable(board: Board, src: Source): boolean {
	const cards = cardsOf(board, src);
	return cards.length > 0 && isSequence(cards);
}

export function canMove(board: Board, src: Source, dst: Target): boolean {
	const cards = cardsOf(board, src);
	if (!cards.length || !isSequence(cards)) return false;

	if (dst.type === "foundation") {
		if (cards.length !== 1) return false;
		if (src.type === "foundation") return false;
		return suit(cards[0]) === dst.suit && rank(cards[0]) === board.foundations[dst.suit];
	}
	if (src.type === "tableau" && src.col === dst.col) return false;
	const column = board.tableau[dst.col];
	// An empty column is not free parking in Klondike: only a king, which is
	// what makes emptying one a decision rather than a win.
	if (!column.cards.length) return rank(cards[0]) === KING;
	const top = column.cards[column.cards.length - 1];
	return rank(cards[0]) === rank(top) - 1 && isRed(cards[0]) !== isRed(top);
}

export function isWon(board: Board): boolean {
	return board.foundations.every((count) => count === 13);
}

// --- changing the board ---
/** Turns up any column left showing its back. Returns true if one turned. */
export function flipExposed(board: Board): boolean {
	let flipped = false;
	for (const col of board.tableau) {
		if (col.down > 0 && col.cards.length === col.down) {
			col.down--;
			flipped = true;
		}
	}
	return flipped;
}

/** Applies a move that `canMove` has already allowed. Returns true if a card turned. */
export function applyMove(board: Board, src: Source, dst: Target): boolean {
	const cards = cardsOf(board, src);
	if (src.type === "waste") board.waste.pop();
	else if (src.type === "foundation") board.foundations[src.suit]--;
	else board.tableau[src.col].cards.length = src.index;

	if (dst.type === "foundation") board.foundations[dst.suit]++;
	else board.tableau[dst.col].cards.push(...cards);

	return flipExposed(board);
}

/**
 * Turns the next cards from the stock, or turns the waste back over when the
 * stock has run out. False when there is nothing left to turn either way.
 */
export function drawStock(board: Board, drawCount: number): boolean {
	if (board.stock.length) {
		const n = Math.min(drawCount, board.stock.length);
		for (let i = 0; i < n; i++) board.waste.push(board.stock.pop() as Card);
		return true;
	}
	if (!board.waste.length) return false;
	// turning the waste back over: what was on top ends up at the bottom
	board.stock = board.waste.slice().reverse();
	board.waste = [];
	return true;
}

// --- judgement ---
/**
 * The safe-autoplay rule: a card only goes up on its own once no lower card of
 * the opposite colour could still need it as a landing place.
 */
export function safeToAutoPlay(board: Board, card: Card): boolean {
	const r = rank(card);
	if (r <= 1) return true;
	const opposite = isRed(card) ? [0, 3] : [1, 2];
	return opposite.every((s) => board.foundations[s] >= r);
}

/** The tops of the piles a single card can be taken from. */
export function playableSources(board: Board): Source[] {
	const sources: Source[] = [];
	if (board.waste.length) sources.push({ type: "waste" });
	for (let col = 0; col < COLUMNS; col++) {
		const column = board.tableau[col];
		if (column.cards.length > column.down) {
			sources.push({ type: "tableau", col, index: column.cards.length - 1 });
		}
	}
	return sources;
}

/** Sends up every card that cannot be needed below. Returns how many went. */
export function autoPlaySafe(board: Board): number {
	let sent = 0;
	for (let pass = true; pass; ) {
		pass = false;
		for (const src of playableSources(board)) {
			const card = cardsOf(board, src)[0];
			if (card === undefined || !safeToAutoPlay(board, card)) continue;
			const dst: Target = { type: "foundation", suit: suit(card) };
			if (!canMove(board, src, dst)) continue;
			applyMove(board, src, dst);
			sent++;
			pass = true;
			break;
		}
	}
	return sent;
}

/** Where a second click sends a stack: foundation, then a column. */
export function autoTarget(board: Board, src: Source): Target | null {
	const cards = cardsOf(board, src);
	if (!cards.length) return null;

	if (cards.length === 1 && src.type !== "foundation") {
		const foundation: Target = { type: "foundation", suit: suit(cards[0]) };
		if (canMove(board, src, foundation)) return foundation;
	}
	for (let col = 0; col < COLUMNS; col++) {
		if (board.tableau[col].cards.length && canMove(board, src, { type: "tableau", col })) {
			return { type: "tableau", col };
		}
	}
	// Moving a king from one empty column to another is never progress.
	const wouldEmptySource = src.type === "tableau" && src.index === 0;
	if (!wouldEmptySource) {
		for (let col = 0; col < COLUMNS; col++) {
			if (!board.tableau[col].cards.length && canMove(board, src, { type: "tableau", col })) {
				return { type: "tableau", col };
			}
		}
	}
	return null;
}

/** Every move on the board, ignoring the stock. */
export function legalMoves(board: Board): Move[] {
	const moves: Move[] = [];
	const sources: Source[] = [];
	if (board.waste.length) sources.push({ type: "waste" });
	for (let s = 0; s < 4; s++) if (board.foundations[s]) sources.push({ type: "foundation", suit: s });
	for (let col = 0; col < COLUMNS; col++) {
		const column = board.tableau[col];
		for (let index = column.down; index < column.cards.length; index++) {
			sources.push({ type: "tableau", col, index });
		}
	}
	for (const src of sources) {
		const cards = cardsOf(board, src);
		if (!cards.length) continue;
		if (cards.length === 1) {
			const dst: Target = { type: "foundation", suit: suit(cards[0]) };
			if (canMove(board, src, dst)) moves.push({ src, dst });
		}
		for (let col = 0; col < COLUMNS; col++) {
			const dst: Target = { type: "tableau", col };
			if (canMove(board, src, dst)) moves.push({ src, dst });
		}
	}
	return moves;
}

export function hasAnyMove(board: Board): boolean {
	// While there is anything left to turn over, there is always something to do
	if (board.stock.length || board.waste.length) return true;
	return legalMoves(board).length > 0;
}

/*
 * With nothing left to turn over and every card face up, each column is a run
 * that descends from wherever it was last turned — so the lowest card in play
 * is always on top of something and the rest of the game is bookkeeping.
 */
export function canSweep(board: Board): boolean {
	if (isWon(board)) return false;
	if (board.stock.length || board.waste.length) return false;
	return board.tableau.every((col) => col.down === 0);
}
