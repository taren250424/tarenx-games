/*
 * The four-suit solver behind tools/solve.mjs.
 *
 * The flat beam that cracked one and two suits rates positions one primitive
 * move apart, and at four suits that fails structurally: real progress there
 * means excavations a dozen moves long whose every intermediate position looks
 * worse than its parent, so the beam culls the plan before it pays off. This
 * solver searches at two levels instead:
 *
 *  - The strategic level is a beam over milestones — a face-down card flipped,
 *    a column emptied, a row dealt, two same-suit runs joined. Positions one
 *    milestone apart are comparable, so the evaluation can actually steer.
 *  - The tactical level turns "flip the next card of column c" into a bounded
 *    best-first search of its own, allowing moves off the target column freely
 *    but other moves only when they plainly serve the dig: exposing a needed
 *    landing rank, emptying a column, or joining same-suit runs. The macro
 *    that wins games is expose-join: dig out a buried same-suit continuation
 *    and carry the run over onto it.
 *
 * On top sits a portfolio of restart attempts — two evaluation styles, then
 * jittered variants of each — because no single weighting cracks every deal.
 *
 * The budget is positions examined, not seconds, for the same reason as the
 * beam's: the bank must be a pure function of code and settings. A clock would
 * let CPU load decide which seeds get solved, and every re-run would deal
 * everyone a different bank. For the same reason every constant below is part
 * of the four-suit bank now, not a knob to turn later.
 */

import {
	applyMove,
	canDealRow,
	canMove,
	dealBoard,
	dealRow,
	isWon,
	legalMoves,
	locate,
	runStart,
} from "../src/rules.ts";
import { rankOf, suitOf } from "../src/shuffle.ts";

const SUITS = 4;
const WIDTH = 32;
const PER_PARENT = 4;
const MAX_LEVELS = 170;
const TRIES = 12;
const WORK = 6000000;
const DIG_CAP = 400;
const DIG_BUDGET = 6000;
const DIG_DEPTH = 22;
const DEAL_COMP = 5;

const BASE = { down: 6, empty: 35, runMul: 3, runPow: 1.5, seq: 0.3, brk: 1.5, brkDeep: 0.15, stock: 0.5, done: 1000 };

const VAL = Array.from({ length: 104 }, (_, id) => rankOf(id) * 4 + suitOf(id, SUITS));

function mulberry32(a) {
	return () => {
		a |= 0;
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

// --- board plumbing, as in solve.mjs ---
function forkMove(board, move) {
	const src = board.tableau[move.col];
	const dst = board.tableau[move.dst];
	const tableau = [...board.tableau];
	tableau[move.col] = { cards: [...src.cards], down: src.down };
	tableau[move.dst] = { cards: [...dst.cards], down: dst.down };
	return { suits: board.suits, stock: board.stock, done: [...board.done], tableau };
}

function forkDeal(board) {
	return {
		suits: board.suits,
		stock: [...board.stock],
		done: [...board.done],
		tableau: board.tableau.map((col) => ({ cards: [...col.cards], down: col.down })),
	};
}

/** Key/score machinery bound to one attempt's weights. */
function makeCtx(w) {
	const colCache = new WeakMap();
	function colInfo(column) {
		let info = colCache.get(column);
		if (info) return info;
		const cards = column.cards;
		// an FNV-style hash stands in for the column's value string: columns are
		// interchangeable, so the board key combines these order-independently
		let hash = (0x811c9dc5 ^ column.down) >>> 0;
		let score = -column.down * w.down;
		let run = 1;
		for (let i = 0; i < cards.length; i++) {
			hash = Math.imul(hash ^ VAL[cards[i]], 0x01000193) >>> 0;
			if (i > column.down) {
				if (
					rankOf(cards[i]) === rankOf(cards[i - 1]) - 1 &&
					suitOf(cards[i], SUITS) === suitOf(cards[i - 1], SUITS)
				) {
					run++;
					continue;
				}
				score += w.runMul * (run - 1) ** w.runPow;
				run = 1;
				if (rankOf(cards[i]) === rankOf(cards[i - 1]) - 1) score += w.seq;
				// a break is priced by what it costs to dig out again: everything
				// stacked on top of it has to move first
				else score -= w.brk + w.brkDeep * (cards.length - i);
			}
		}
		score += w.runMul * (run - 1) ** w.runPow;
		info = { hash, score };
		colCache.set(column, info);
		return info;
	}
	function key(board) {
		let sum = 0;
		let xor = 0;
		for (const col of board.tableau) {
			const h = colInfo(col).hash;
			sum = (sum + h) >>> 0;
			xor = (xor ^ Math.imul(h, 0x9e3779b1)) >>> 0;
		}
		return `${board.stock.length}|${sum}|${xor}`;
	}
	function promise(board) {
		let total = board.done.length * w.done - board.stock.length * w.stock;
		let empties = 0;
		for (const col of board.tableau) {
			if (col.cards.length) total += colInfo(col).score;
			else empties++;
		}
		// the first empty column is the tool that unlocks everything; each
		// further one still helps, but not by as much again
		if (empties) total += w.empty * (1 + 0.65 * (empties - 1));
		return total;
	}
	return { key, promise, dealComp: w.dealComp ?? DEAL_COMP };
}

// --- tactical level ---
class Heap {
	constructor() {
		this.a = [];
	}
	get size() {
		return this.a.length;
	}
	push(score, item) {
		const a = this.a;
		a.push({ score, item });
		let i = a.length - 1;
		while (i > 0) {
			const p = (i - 1) >> 1;
			if (a[p].score <= a[i].score) break;
			[a[p], a[i]] = [a[i], a[p]];
			i = p;
		}
	}
	pop() {
		const a = this.a;
		const top = a[0];
		const last = a.pop();
		if (a.length) {
			a[0] = last;
			let i = 0;
			for (;;) {
				const l = 2 * i + 1;
				const r = l + 1;
				let m = i;
				if (l < a.length && a[l].score < a[m].score) m = l;
				if (r < a.length && a[r].score < a[m].score) m = r;
				if (m === i) break;
				[a[m], a[i]] = [a[i], a[m]];
				i = m;
			}
		}
		return top.item;
	}
}

function unwindDig(node) {
	const moves = [];
	for (let n = node; n.move; n = n.prev) moves.unshift(n.move);
	return moves;
}

/*
 * Digs at one column until its next face-down card flips (goal "flip"), it
 * stands empty (goal "clear"), or the card at `exposeAt` surfaces (goal
 * "expose"). Best-first on cards still covering the target, ties broken by the
 * position score, so it prefers the least destructive route.
 */
function dig(ctx, start, target, goal, budget, work, exposeAt = -1, cap = DIG_CAP) {
	const startDown = start.tableau[target].down;
	const floor = goal === "flip" ? -1 : exposeAt; // cards at or below stay put
	const covers = (board) => {
		const col = board.tableau[target];
		return col.cards.length - (goal === "flip" ? col.down : exposeAt + 1);
	};
	const seen = new Set([ctx.key(start)]);
	const heap = new Heap();
	heap.push(0, { board: start, prev: null, move: null, depth: 0 });
	let expanded = 0;
	while (heap.size) {
		if (expanded++ > cap || --budget.left < 0 || --work.left < 0) return null;
		const node = heap.pop();
		const from = node.board;
		// the landing ranks the dig still needs: one above each covering segment's lead
		const tcol = from.tableau[target];
		const needed = new Set();
		for (let i = goal === "flip" ? tcol.down : exposeAt + 1; i < tcol.cards.length; i++) {
			if (
				i === tcol.down ||
				i === exposeAt + 1 ||
				rankOf(tcol.cards[i]) !== rankOf(tcol.cards[i - 1]) - 1 ||
				suitOf(tcol.cards[i], SUITS) !== suitOf(tcol.cards[i - 1], SUITS)
			) {
				needed.add(rankOf(tcol.cards[i]) + 1);
			}
		}
		for (const move of legalMoves(from)) {
			if (move.dst === target) continue;
			if (move.col === target && move.index <= floor) continue;
			if (move.col !== target) {
				// a side move must serve the dig: free a column, expose a needed
				// landing, or tidy same-suit runs together
				const src = from.tableau[move.col];
				const dstCards = from.tableau[move.dst].cards;
				const emptiesSource = move.index === 0;
				const exposesNeeded = move.index > 0 && needed.has(rankOf(src.cards[move.index - 1]));
				const consolidates =
					dstCards.length > 0 &&
					suitOf(dstCards[dstCards.length - 1], SUITS) === suitOf(src.cards[move.index], SUITS);
				if (!emptiesSource && !exposesNeeded && !consolidates) continue;
			}
			if (node.depth >= DIG_DEPTH) continue;
			const board = forkMove(from, move);
			applyMove(board, move);
			const child = { board, prev: node, move, depth: node.depth + 1 };
			if (isWon(board)) return { board, moves: unwindDig(child), won: true };
			if (goal === "flip" ? board.tableau[target].down < startDown : covers(board) === 0) {
				return { board, moves: unwindDig(child), won: false };
			}
			const k = ctx.key(board);
			if (seen.has(k)) continue;
			seen.add(k);
			heap.push(covers(board) * 1e6 - ctx.promise(board), child);
		}
		node.board = null;
	}
	return null;
}

// --- strategic level ---
function unwindWin(node, tail) {
	const path = [];
	for (let n = node; n; n = n.prev) path.unshift(...n.steps);
	path.push(...tail);
	return path;
}

function solveAttempt(seed, ctx, work, noise) {
	const root = { board: dealBoard(seed, SUITS), prev: null, steps: [] };
	const seen = new Set([ctx.key(root.board)]);
	let frontier = [root];
	for (let level = 0; level < MAX_LEVELS && frontier.length; level++) {
		const next = [];
		const levelSeen = new Set();
		for (const node of frontier) {
			if (work.left <= 0) return null;
			const from = node.board;
			const successors = [];
			const budget = { left: DIG_BUDGET };
			for (let c = 0; c < from.tableau.length; c++) {
				if (from.tableau[c].down === 0) continue;
				const dug = dig(ctx, from, c, "flip", budget, work);
				if (!dug) continue;
				if (dug.won) return unwindWin(node, dug.moves);
				successors.push({ board: dug.board, steps: dug.moves, comp: 0 });
			}
			// a run whose same-suit continuation lies buried but face up: dig the
			// continuation out and make the join — this is how runs actually get
			// assembled once the board is dealt out
			for (let rc = 0; rc < from.tableau.length; rc++) {
				const rcol = from.tableau[rc];
				if (!rcol.cards.length) continue;
				const start = runStart(from, rc);
				const lead = rcol.cards[start];
				if (rankOf(lead) === 12) continue;
				const spots = [];
				for (let c = 0; c < from.tableau.length; c++) {
					if (c === rc) continue;
					const tcol = from.tableau[c];
					for (let p = tcol.down; p < tcol.cards.length - 1; p++) {
						const x = tcol.cards[p];
						if (rankOf(x) !== rankOf(lead) + 1 || suitOf(x, SUITS) !== suitOf(lead, SUITS)) continue;
						const cover = tcol.cards.length - (p + 1);
						if (cover <= 12) spots.push({ c, p, cover });
					}
				}
				spots.sort((a, b) => a.cover - b.cover);
				for (const { c, p } of spots) {
					const dug = dig(ctx, from, c, "expose", budget, work, p, 250);
					if (!dug) continue;
					if (dug.won) return unwindWin(node, dug.moves);
					let board = dug.board;
					let steps = dug.moves;
					const spot = locate(board, lead);
					if (spot && canMove(board, { col: spot.col, index: spot.index, dst: c })) {
						const join = { col: spot.col, index: spot.index, dst: c };
						board = forkMove(board, join);
						applyMove(board, join);
						steps = [...steps, join];
						if (isWon(board)) return unwindWin(node, steps);
					}
					successors.push({ board, steps, comp: 0 });
					break; // the shallowest join that works is milestone enough
				}
			}
			const digsFound = successors.length;
			const clearable = from.tableau
				.map((col, c) => ({ c, len: col.cards.length, down: col.down }))
				.filter((x) => x.down === 0 && x.len > 0 && x.len <= 13)
				.sort((a, b) => a.len - b.len)
				.slice(0, 2);
			for (const { c } of clearable) {
				const dug = dig(ctx, from, c, "clear", budget, work);
				if (!dug) continue;
				if (dug.won) return unwindWin(node, dug.moves);
				successors.push({ board: dug.board, steps: dug.moves, comp: 0 });
			}
			const anyEmpty = from.tableau.some((col) => !col.cards.length);
			for (const move of legalMoves(from)) {
				const src = from.tableau[move.col];
				const dstCards = from.tableau[move.dst].cards;
				if (dstCards.length) {
					// joining two same-suit runs is a milestone of its own
					if (
						move.index === runStart(from, move.col) &&
						suitOf(dstCards[dstCards.length - 1], SUITS) === suitOf(src.cards[move.index], SUITS)
					) {
						const board = forkMove(from, move);
						applyMove(board, move);
						if (isWon(board)) return unwindWin(node, [move]);
						successors.push({ board, steps: [move], comp: 0 });
					}
				} else if (from.stock.length && anyEmpty) {
					// a deal needs every column filled, so parking on an empty is
					// sometimes the only way forward
					const board = forkMove(from, move);
					applyMove(board, move);
					successors.push({ board, steps: [move], comp: -2 });
				}
			}
			// dealing buries all ten piles under unsorted cards, so it is played the
			// way a person plays it: only once no dig gets anywhere
			if (digsFound === 0 && canDealRow(from)) {
				const board = forkDeal(from);
				dealRow(board);
				if (isWon(board)) return unwindWin(node, [{ deal: true }]);
				successors.push({ board, steps: [{ deal: true }], comp: ctx.dealComp });
			}
			if (successors.length < 4) {
				// a position the macros find sterile can still have life in it —
				// let plain moves keep it breathing and the beam judge them
				const plain = [];
				for (const move of legalMoves(from)) {
					work.left--;
					const board = forkMove(from, move);
					applyMove(board, move);
					if (isWon(board)) return unwindWin(node, [move]);
					plain.push({ board, steps: [move], comp: -1, rating: ctx.promise(board) });
				}
				plain.sort((a, b) => b.rating - a.rating);
				successors.push(...plain.slice(0, 6));
			}
			for (const s of successors) {
				const k = ctx.key(s.board);
				if (seen.has(k) || levelSeen.has(k)) continue;
				levelSeen.add(k);
				next.push({
					board: s.board,
					prev: node,
					steps: s.steps,
					key: k,
					rating: ctx.promise(s.board) + s.comp + noise(),
				});
			}
			node.board = null;
		}
		next.sort((a, b) => b.rating - a.rating);
		frontier = [];
		const byParent = new Map();
		for (const child of next) {
			const used = byParent.get(child.prev) ?? 0;
			if (used >= PER_PARENT) continue;
			byParent.set(child.prev, used + 1);
			frontier.push(child);
			if (frontier.length >= WIDTH) break;
		}
		for (const n of frontier) seen.add(n.key);
	}
	return null;
}

/** A winning path for the seed — moves and `{deal: true}` steps — or null. */
export function solveFour(seed) {
	let remaining = WORK;
	// no single weighting cracks every deal, so attempts are a portfolio: two
	// plain styles first — breaks priced by depth, and not — then jittered
	// variants of each; attempts that die early hand their leftover work on
	for (let attempt = 0; attempt < TRIES && remaining > 0; attempt++) {
		const slice = Math.min(remaining, Math.ceil(WORK * (attempt < 2 ? 0.3 : 0.2)));
		const work = { left: slice };
		const rnd = mulberry32(seed * 0x9e3779b1 + attempt);
		const w = { ...BASE };
		if (attempt % 2 === 1) w.brkDeep = 0;
		if (attempt > 1) {
			for (const k of ["down", "empty", "runMul", "seq", "brk", "brkDeep"]) w[k] *= 0.7 + 0.6 * rnd();
			w.dealComp = DEAL_COMP * (0.4 + 1.6 * rnd());
		}
		const noise = attempt < 2 ? () => 0 : () => (rnd() - 0.5) * 2;
		const path = solveAttempt(seed, makeCtx(w), work, noise);
		remaining -= slice - work.left;
		if (path) return path;
	}
	return null;
}
