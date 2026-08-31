/*
 * Spider, as rules alone — no DOM, no settings, no state of its own.
 *
 * The game plays through this module and so does the solver that builds the
 * winnable-game bank, which is the point: a game only reaches the bank once a
 * solution has been replayed through these exact functions and ended in a win.
 * If the rules here are wrong the bank is wrong with them, but the bank can
 * never disagree with the game.
 *
 * Cards are the ids of shuffle.ts, 0-103, because with fewer than four suits
 * the face values repeat and could not name a card.
 */

import { COLUMNS, RUN, type SuitCount, dealFromSeed, rankOf, suitOf } from "./shuffle.ts";

export const KING = 12;
export const RUNS_TO_WIN = 8;

/** A column is its cards bottom-first, plus how many at the bottom are face down. */
export interface Column {
	cards: number[];
	down: number;
}

export interface Board {
	suits: SuitCount;
	stock: number[]; // face down, the next row dealt from the end
	done: number[][]; // finished runs, king first, in the order they left the table
	tableau: Column[];
}

/** Every move is column to column: `index` cards deep into `col`, onto `dst`. */
export interface Move {
	col: number;
	index: number;
	dst: number;
}

// --- construction ---
export function emptyBoard(suits: SuitCount): Board {
	return {
		suits,
		stock: [],
		done: [],
		tableau: Array.from({ length: COLUMNS }, () => ({ cards: [], down: 0 })),
	};
}

export function cloneBoard(source: Board): Board {
	return {
		suits: source.suits,
		stock: [...source.stock],
		done: source.done.map((run) => [...run]),
		tableau: source.tableau.map((col) => ({ cards: [...col.cards], down: col.down })),
	};
}

/** Lays out a game from its shuffle seed, not its game number. */
export function dealBoard(seed: number, suits: SuitCount): Board {
	const fresh = dealFromSeed(seed);
	return {
		suits,
		stock: fresh.stock,
		done: [],
		tableau: fresh.tableau.map((cards) => ({ cards, down: cards.length - 1 })),
	};
}

// --- reading the board ---
/** Descending by one and all of one suit — the only stack that travels. */
export function isRun(board: Board, ids: number[]): boolean {
	for (let i = 1; i < ids.length; i++) {
		if (rankOf(ids[i]) !== rankOf(ids[i - 1]) - 1) return false;
		if (suitOf(ids[i], board.suits) !== suitOf(ids[i - 1], board.suits)) return false;
	}
	return true;
}

export function cardsOf(board: Board, col: number, index: number): number[] {
	const column = board.tableau[col];
	return index < column.down ? [] : column.cards.slice(index);
}

export function grabbable(board: Board, col: number, index: number): boolean {
	const cards = cardsOf(board, col, index);
	return cards.length > 0 && isRun(board, cards);
}

/** Where a card sits, if it is somewhere a move could start from. */
export function locate(board: Board, id: number): { col: number; index: number } | null {
	for (let col = 0; col < COLUMNS; col++) {
		const index = board.tableau[col].cards.indexOf(id);
		if (index >= 0) return index < board.tableau[col].down ? null : { col, index };
	}
	return null; // in the stock, or already carried off in a finished run
}

export function canMove(board: Board, move: Move): boolean {
	if (move.col === move.dst) return false;
	const cards = cardsOf(board, move.col, move.index);
	if (!cards.length || !isRun(board, cards)) return false;
	const column = board.tableau[move.dst];
	// unlike Klondike, an empty column takes anything — emptying one is the
	// strongest move in the game, not a decision to agonise over
	if (!column.cards.length) return true;
	const top = column.cards[column.cards.length - 1];
	return rankOf(cards[0]) === rankOf(top) - 1;
}

export function isWon(board: Board): boolean {
	return board.done.length === RUNS_TO_WIN;
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

/** Carries a finished king-to-ace run off `col`, if its top thirteen make one. */
function clearRun(board: Board, col: number): boolean {
	const column = board.tableau[col];
	const start = column.cards.length - RUN;
	if (start < column.down) return false;
	const cards = column.cards.slice(start);
	if (rankOf(cards[0]) !== KING || !isRun(board, cards)) return false;
	board.done.push(cards);
	column.cards.length = start;
	return true;
}

/**
 * Applies a move that `canMove` has already allowed. Reports what followed, so
 * the game can pick a sound: a run may complete and a card may turn over.
 */
export function applyMove(board: Board, move: Move): { flipped: boolean; cleared: boolean } {
	const cards = cardsOf(board, move.col, move.index);
	board.tableau[move.col].cards.length = move.index;
	board.tableau[move.dst].cards.push(...cards);
	const cleared = clearRun(board, move.dst);
	const flipped = flipExposed(board);
	return { flipped, cleared };
}

/** Whether the next row may be dealt: cards left, and no column empty. */
export function canDealRow(board: Board): boolean {
	if (!board.stock.length) return false;
	return board.tableau.every((col) => col.cards.length > 0);
}

/** Deals one card onto every column. Returns how many runs that finished. */
export function dealRow(board: Board): number {
	let cleared = 0;
	for (let col = 0; col < COLUMNS; col++) {
		board.tableau[col].cards.push(board.stock.pop() as number);
		if (clearRun(board, col)) cleared++;
	}
	flipExposed(board);
	return cleared;
}

// --- judgement ---
/** How far down from the top of a column one unbroken run reaches. */
export function runStart(board: Board, col: number): number {
	const column = board.tableau[col];
	let start = column.cards.length - 1;
	while (
		start > column.down &&
		rankOf(column.cards[start - 1]) === rankOf(column.cards[start]) + 1 &&
		suitOf(column.cards[start - 1], board.suits) === suitOf(column.cards[start], board.suits)
	) {
		start--;
	}
	return start;
}

/** Every move on the board, ignoring the stock. */
export function legalMoves(board: Board): Move[] {
	const moves: Move[] = [];
	// empty columns are interchangeable, so one of them stands for all
	const firstEmpty = board.tableau.findIndex((column) => !column.cards.length);
	for (let col = 0; col < COLUMNS; col++) {
		const column = board.tableau[col];
		if (!column.cards.length) continue;
		for (let index = runStart(board, col); index < column.cards.length; index++) {
			const lead = rankOf(column.cards[index]);
			for (let dst = 0; dst < COLUMNS; dst++) {
				if (dst === col) continue;
				const target = board.tableau[dst].cards;
				if (!target.length) {
					// a whole column moved onto an empty column is the same position
					if (dst === firstEmpty && index > 0) moves.push({ col, index, dst });
				} else if (rankOf(target[target.length - 1]) === lead + 1) {
					moves.push({ col, index, dst });
				}
			}
		}
	}
	return moves;
}

export function hasAnyMove(board: Board): boolean {
	return canDealRow(board) || legalMoves(board).length > 0;
}

/** Where a second click sends a run: onto its own suit, any suit, then space. */
export function autoTarget(board: Board, col: number, index: number): number | null {
	const cards = cardsOf(board, col, index);
	if (!cards.length || !isRun(board, cards)) return null;
	const wanted = rankOf(cards[0]) + 1;
	const suit = suitOf(cards[0], board.suits);
	let anySuit: number | null = null;
	let empty: number | null = null;
	for (let dst = 0; dst < COLUMNS; dst++) {
		if (dst === col) continue;
		const column = board.tableau[dst];
		if (!column.cards.length) {
			empty = empty ?? dst;
			continue;
		}
		const top = column.cards[column.cards.length - 1];
		if (rankOf(top) !== wanted) continue;
		if (suitOf(top, board.suits) === suit) return dst;
		anySuit = anySuit ?? dst;
	}
	if (anySuit !== null) return anySuit;
	// moving a whole column into empty space is never progress
	return index > 0 ? empty : null;
}
