/*
 * Builds the bank of Klondike games that are known to be winnable.
 *
 *   node tools/solve.mjs [--scan N] [--nodes N] [--out path]
 *
 * For each seed it searches for a way to win with every card visible, then —
 * and this is the part that matters — replays the solution it found through
 * src/rules.ts, the same module the game itself plays through, and only counts
 * the seed if that replay ends with all four foundations full.
 *
 * So the bank cannot lie. A bug in the search can only cost us games we would
 * otherwise have shipped; it cannot put an unwinnable game in front of anybody.
 * Seeds the search gives up on are simply left out.
 *
 * Everything is judged at draw three. A draw-three solution replays exactly in
 * draw one — three single draws land the same cards on the waste in the same
 * order — so a game in the bank is winnable in both modes.
 *
 * The output is a bitmap over the scanned seeds, one bit each, base64 encoded.
 * No deal is ever stored: the cards still come from the seed at run time.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	applyMove,
	canMove,
	cardsOf,
	cloneBoard,
	dealBoard,
	drawStock,
	isWon,
	COLUMNS,
	legalMoves,
	playableSources,
	safeToAutoPlay,
} from "../src/rules.ts";
import { rank, suit } from "../../shared/cards/deck.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
const DRAW = 3;
const DEPTH_CAP = 400;

// --- options ---
const args = process.argv.slice(2);
const option = (name, fallback) => {
	const i = args.indexOf(`--${name}`);
	return i >= 0 && args[i + 1] !== undefined ? Number(args[i + 1]) : fallback;
};
/*
 * Scan state lives beside the tool and is committed with it. It is not a cache
 * that can be thrown away for free: it is the record of which seeds have been
 * settled, and without it extending the bank means scanning them all again.
 */
const SCANS = join(HERE, "scan");
const value = (name) => {
	const i = args.indexOf(`--${name}`);
	if (i < 0) return undefined;
	const next = args[i + 1];
	return next === undefined || next.startsWith("--") ? null : next;
};
const partial = value("partial");
const mergeArg = value("merge");
const SCAN = option("scan", 20000);
const TO = option("to", SCAN);
/*
 * Shards interleave rather than take blocks. A block-per-shard split leaves the
 * scanned seeds full of holes while it runs, and filling a hole later would
 * insert games in the middle of the bank and renumber everything after them.
 * Striding keeps coverage a solid prefix at every checkpoint, so a scan can be
 * stopped, banked, and extended later without moving anybody's game numbers.
 */
const STRIDE = option("stride", 1);
const OFFSET = option("offset", 0);
const PARTIAL = partial === undefined ? null : (partial ?? join(SCANS, `shard-${STRIDE}-${OFFSET}.json`));
const MERGE =
	mergeArg === undefined
		? null
		: (mergeArg ??
			readdirSync(SCANS)
				.filter((name) => name.startsWith("shard-"))
				.map((name) => join(SCANS, name))
				.join(","));
const CHECK_DRAWS = args.includes("--check-draws");
const NODE_CAP = option("nodes", 60000);
/*
 * Most games fall to a narrow beam in a fraction of a second. Rather than pay
 * a wide one for all of them, try narrow first and only widen for the games
 * that resist — the budget then lands where it is actually needed.
 */
const WIDTHS = [40, 150, 400];
const outIndex = args.indexOf("--out");
/*
 * The shipped bank is only ever written by --merge, or by --out said out loud.
 * A bare scan used to overwrite it, which turns a quick check of one seed into
 * a one-game bank without a word of warning.
 */
const OUT = outIndex >= 0 ? args[outIndex + 1] : null;
const BANK = join(HERE, "..", "src", "winnable.ts");

// --- search ---

/*
 * Columns are interchangeable, so sorting them collapses whole families of
 * positions onto one key. The stock and waste have to stay in order: where the
 * pile splits is part of the position in draw three.
 */
function key(board) {
	const cols = board.tableau
		.map((col) => `${col.down}:${col.cards.join(",")}`)
		.sort()
		.join("/");
	return `${board.stock.join(",")}|${board.waste.join(",")}|${board.foundations.join(",")}|${cols}`;
}

/**
 * How much an option is worth looking at first. Turning a card over is the
 * whole game; emptying a column and playing off the waste come next, and every
 * turn of the stock it takes to get there costs a little.
 */
function score(board, option) {
	const { src, dst } = option.move;
	let value = -option.draws;
	if (dst.type === "foundation") value += 20;
	if (src.type === "tableau") {
		const column = board.tableau[src.col];
		// this move strips the column back to a face-down card, which will turn
		if (src.index === column.down && column.down > 0) value += 60;
		// or empties it outright
		else if (src.index === 0) value += 25;
	}
	if (src.type === "waste") value += 12;
	return value;
}

/*
 * Everything worth doing from a position, as (draws, move) pairs.
 *
 * The stock is the reason a naive search drowns: turning it one triple at a
 * time makes a chain of nodes that each re-examine the whole tableau. But
 * drawing changes nothing except which card sits on the waste, so instead we
 * run the pile round once here and collect, for every card the waste can be
 * made to show, the moves that card could make. A draw on its own is never
 * worth doing — if no waste card and no tableau card can move, the game is
 * dead however long you keep turning.
 */
function options(board) {
	const out = [];
	for (const move of legalMoves(board)) {
		if (move.src.type === "waste") continue;
		// shifting a king between empty columns is not progress
		if (
			move.dst.type === "tableau" &&
			!board.tableau[move.dst.col].cards.length &&
			move.src.type === "tableau" &&
			move.src.index === 0
		) {
			continue;
		}
		out.push({ draws: 0, move });
	}

	const probe = cloneBoard(board);
	const cards = probe.stock.length + probe.waste.length;
	const offered = new Set();
	for (let draws = 0; draws <= cards; draws++) {
		if (probe.waste.length) {
			const card = probe.waste[probe.waste.length - 1];
			if (!offered.has(card)) {
				offered.add(card);
				const src = { type: "waste" };
				const foundation = { type: "foundation", suit: suit(card) };
				if (canMove(probe, src, foundation)) out.push({ draws, move: { src, dst: foundation } });
				for (let col = 0; col < COLUMNS; col++) {
					const dst = { type: "tableau", col };
					if (canMove(probe, src, dst)) out.push({ draws, move: { src, dst } });
				}
			}
		}
		if (!drawStock(probe, DRAW)) break;
	}
	return out;
}

/**
 * How promising a position is. Cards upstairs are progress, cards still face
 * down are the debt, and a pile still waiting in the stock is mild clutter.
 */
function promise(board) {
	let up = 0;
	for (const count of board.foundations) up += count;
	let hidden = 0;
	let empty = 0;
	for (const col of board.tableau) {
		hidden += col.down;
		if (!col.cards.length) empty++;
	}
	return up * 3 - hidden * 2 + empty - (board.stock.length + board.waste.length) * 0.2;
}

/*
 * Beam search: expand a frontier of the most promising positions, keep the best
 * few hundred, go again. Klondike punishes depth-first search — one bad early
 * commitment and it spends its whole budget down a dead branch — where a beam
 * keeps several plans alive at once for the same money.
 *
 * It is not exhaustive, so it will miss winnable games. That is the safe
 * direction to be wrong in: a missed game is one we do not ship, never one we
 * ship a false promise about.
 */
function solve(start, budget, width) {
	const seen = new Set();
	const root = { board: cloneBoard(start), prev: null, steps: [] };
	autoSend(root.board, root.steps);
	if (isWon(root.board)) return root.steps;
	seen.add(key(root.board));

	let frontier = [root];
	let expanded = 0;

	for (let depth = 0; depth < DEPTH_CAP && frontier.length; depth++) {
		const next = [];
		// Only positions that actually make the cut are closed off. Marking every
		// position we merely looked at would wall off whole regions on the
		// strength of one glance at them.
		const level = new Set();
		for (const node of frontier) {
			if (expanded++ > budget) return null;
			const from = node.board;
			for (const option of options(from)) {
				const board = cloneBoard(from);
				for (let i = 0; i < option.draws; i++) drawStock(board, DRAW);
				if (!canMove(board, option.move.src, option.move.dst)) continue;
				applyMove(board, option.move.src, option.move.dst);

				const steps = [];
				for (let i = 0; i < option.draws; i++) steps.push({ draw: true });
				steps.push(option.move);
				// Sending up cards that cannot be needed below never loses a
				// winnable game, and it keeps the frontier from filling with
				// positions that differ only in bookkeeping.
				autoSend(board, steps);

				const child = { board, prev: node, steps };
				if (isWon(board)) return unwind(child);
				const k = key(board);
				if (seen.has(k) || level.has(k)) continue;
				level.add(k);
				child.key = k;
				next.push(child);
			}
			// The children hold on to this node for the move list, but nobody needs
			// its board again — and a beam that keeps every ancestor's board alive
			// runs the heap out long before it runs the budget out.
			node.board = null;
		}
		next.sort((a, b) => promise(b.board) - promise(a.board));
		frontier = next.slice(0, width);
		for (const node of frontier) seen.add(node.key);
	}
	return null;
}

function unwind(node) {
	const path = [];
	for (let n = node; n; n = n.prev) path.unshift(...n.steps);
	return path;
}

/*
 * Sends up every card that cannot be needed below, exactly the way the game's
 * autoPlaySafe does, but recording each card as it goes so the path replays in
 * the order the cards actually became reachable.
 */
function autoSend(board, path) {
	let sent = 0;
	for (let again = true; again; ) {
		again = false;
		for (const src of playableSources(board)) {
			const card = cardsOf(board, src)[0];
			if (card === undefined || !safeToAutoPlay(board, card)) continue;
			const dst = { type: "foundation", suit: suit(card) };
			if (!canMove(board, src, dst)) continue;
			applyMove(board, src, dst);
			path.push({ auto: true, card });
			sent++;
			again = true;
			break;
		}
	}
	return sent;
}

// --- verification ---

/*
 * Replays a solution through the rules the game plays by. Anything the search
 * believed but the rules do not agree with fails here, and the seed is dropped.
 */
function verify(gameNumber, path) {
	const board = dealBoard(gameNumber);
	for (const step of path) {
		if (step.auto) {
			const card = step.card;
			const s = suit(card);
			if (board.foundations[s] !== rank(card)) return false;
			// find it wherever it legally sits and send it up
			const src = findPlayable(board, card);
			if (!src) return false;
			if (!canMove(board, src, { type: "foundation", suit: s })) return false;
			applyMove(board, src, { type: "foundation", suit: s });
			continue;
		}
		if (step.draw) {
			if (!drawStock(board, DRAW)) return false;
			continue;
		}
		if (!canMove(board, step.src, step.dst)) return false;
		applyMove(board, step.src, step.dst);
	}
	return isWon(board);
}

function findPlayable(board, card) {
	if (board.waste.length && board.waste[board.waste.length - 1] === card) return { type: "waste" };
	for (let col = 0; col < 7; col++) {
		const column = board.tableau[col];
		const index = column.cards.length - 1;
		if (index >= column.down && column.cards[index] === card) return { type: "tableau", col, index };
	}
	return null;
}

// --- bank ---
function encodeBitmap(bits) {
	const bytes = new Uint8Array(Math.ceil(bits.length / 8));
	for (let i = 0; i < bits.length; i++) if (bits[i]) bytes[i >> 3] |= 128 >> (i & 7);
	return Buffer.from(bytes).toString("base64");
}

// --- run ---
if (CHECK_DRAWS) {
	checkDraws();
	process.exit(0);
}

if (MERGE) {
	/*
	 * The bank stops at the last seed every shard has passed. Beyond that the
	 * shards have only settled some of the seeds, and banking a half-covered
	 * stretch would mean a later run fills the gaps, inserts games in the middle
	 * and renumbers every game after them.
	 */
	const files = MERGE.split(",");
	const shards = files.map((file) => JSON.parse(readFileSync(file, "utf8")));
	const covered = Math.min(...shards.map((shard) => shard.upTo));
	const strides = new Set(shards.map((shard) => shard.stride));
	const offsets = new Set(shards.map((shard) => shard.offset));
	if (strides.size !== 1 || offsets.size !== shards.length || offsets.size !== [...strides][0]) {
		console.error("these shards do not cut the seeds up between them cleanly");
		process.exit(1);
	}

	const found = new Set();
	for (const shard of shards) {
		for (const seed of shard.winnable) if (seed <= covered) found.add(seed);
	}
	const bits = new Uint8Array(covered);
	for (const seed of found) bits[seed - 1] = 1;
	writeBank(bits, found.size, covered, OUT ?? BANK);
	console.log(
		`merged ${files.length} shards: seeds 1-${covered} fully settled, ${found.size} games ` +
			`(${((found.size / covered) * 100).toFixed(1)}%)`
	);
	process.exit(0);
}

/*
 * A scan is long enough that it has to survive being stopped. The shard file is
 * rewritten every so often with how far it got, so a run can be cut short and
 * merged as it stands, or picked up again later from where it left off.
 */
let winnable = [];
let upTo = OFFSET; // highest seed this shard has settled
if (PARTIAL) {
	try {
		const previous = JSON.parse(readFileSync(PARTIAL, "utf8"));
		if (previous.stride === STRIDE && previous.offset === OFFSET) {
			winnable = previous.winnable;
			upTo = previous.upTo;
			console.log(`resuming past seed ${upTo}, ${winnable.length} kept so far`);
		}
	} catch {
		// no shard yet, or one cut a different way — start over
	}
}

const saveShard = () => {
	if (!PARTIAL) return;
	mkdirSync(dirname(PARTIAL), { recursive: true });
	writeFileSync(PARTIAL, JSON.stringify({ stride: STRIDE, offset: OFFSET, upTo, winnable }));
};

const first = upTo > OFFSET ? upTo + STRIDE : OFFSET + 1;
console.log(
	`seeds ${first}-${TO} step ${STRIDE} at draw ${DRAW}, beams ${WIDTHS.join("/")}, ` +
		`up to ${NODE_CAP} positions each`
);
let scanned = 0;
let gaveUp = 0;
let rejected = 0;
const started = Date.now();

for (let seed = first; seed <= TO; seed += STRIDE) {
	let path = null;
	for (const width of WIDTHS) {
		path = solve(dealBoard(seed), NODE_CAP, width);
		if (path) break;
	}
	if (!path) {
		gaveUp++;
	} else if (verify(seed, path)) {
		winnable.push(seed);
	} else {
		rejected++;
		console.warn(`seed ${seed}: the search claimed a win the rules did not confirm`);
	}
	upTo = seed;
	scanned++;
	if (scanned % 20 === 0) saveShard();
	if (scanned % 100 === 0) {
		const rate = (Date.now() - started) / scanned;
		// stderr, because a redirected stdout sits in a buffer for minutes
		console.error(
			`  through ${seed} · ${winnable.length} winnable · ${rate.toFixed(0)}ms each`
		);
	}
}
saveShard();

const elapsed = ((Date.now() - started) / 1000).toFixed(0);
console.log(
	`done in ${elapsed}s: ${winnable.length} winnable, ${gaveUp} unproven, ${rejected} rejected by the rules`
);
if (rejected > 0) {
	console.error("the search and the rules disagreed — refusing to write a bank");
	process.exit(1);
}

if (PARTIAL) {
	console.log(`wrote shard ${PARTIAL}`);
} else if (OUT) {
	const bits = new Uint8Array(upTo);
	for (const seed of winnable) bits[seed - 1] = 1;
	writeBank(bits, winnable.length, upTo, OUT);
} else {
	console.log("nothing written — pass --partial to keep a shard, or --out to write a bank");
}

function writeBank(bits, count, covered, out) {
	const encoded = encodeBitmap(bits);
	const file = `/*
 * Games proved winnable, one bit per seed, seeds 1-${covered}.
 *
 * Generated by tools/solve.mjs — do not edit. Every bit set here means a
 * solution was found AND replayed through src/rules.ts, the module the game
 * itself plays by, ending with all four foundations full. So a game dealt from
 * this bank can always be finished. Seeds the search could not settle are left
 * out rather than guessed at, which is why this is smaller than the set of
 * games that are winnable in principle.
 *
 * Judged at draw three, which a draw-one game can always replay — three single
 * draws land the same cards on the waste in the same order — so both modes are
 * covered — and tools/solve.mjs --check-draws tests that rather than asserting it.
 *
 * Game numbers are positions in this list, so scanning further seeds only
 * appends and old numbers keep their cards. Widening the search instead would
 * prove seeds that were skipped before and shift every number after them, which
 * would quietly repoint everybody's saved games — so the search settings are
 * part of the bank, not a knob to turn later.
 */

export const SCANNED = ${covered};

const BITS =
	"${encoded.replace(/(.{100})/g, '$1" +\n\t"')}";

/** The seed behind each game number, in order — game #1 is GAMES[0]. */
export const GAMES: number[] = (() => {
	const bytes = atob(BITS);
	const games: number[] = [];
	for (let i = 0; i < SCANNED; i++) {
		if ((bytes.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1) games.push(i + 1);
	}
	return games;
})();
`;
	writeFileSync(out, file);
	console.log(`wrote ${out} — ${count} games, ${(encoded.length / 1024).toFixed(1)} kB encoded`);
}

/*
 * The bank is judged at draw three and claimed for draw one as well, on the
 * grounds that a draw-one player can mirror any draw-three turn by turning
 * min(3, stock) cards one at a time — or, with the stock spent, recycling once.
 * That is an argument, so here it is as a test: walk hundreds of games through
 * every stock split there is and compare the two.
 */
function checkDraws() {
	const same = (a, b) =>
		JSON.stringify([a.stock, a.waste, a.foundations, a.tableau]) ===
		JSON.stringify([b.stock, b.waste, b.foundations, b.tableau]);

	let compared = 0;
	let recycles = 0;
	let mismatches = 0;
	for (let seed = 1; seed <= 400; seed++) {
		const board = dealBoard(seed);
		for (let step = 0; step < 120; step++) {
			const three = cloneBoard(board);
			const one = cloneBoard(board);
			const turns = board.stock.length ? Math.min(DRAW, board.stock.length) : 1;
			drawStock(three, DRAW);
			for (let i = 0; i < turns; i++) drawStock(one, 1);
			compared++;
			if (!board.stock.length) recycles++;
			if (!same(three, one)) {
				mismatches++;
				console.error(`seed ${seed} step ${step}: stock ${board.stock.length}, waste ${board.waste.length}`);
			}
			// wander on, so the stock and waste split every way they can
			const moves = legalMoves(board);
			if (moves.length && step % 3 === 0) {
				const move = moves[step % moves.length];
				if (canMove(board, move.src, move.dst)) applyMove(board, move.src, move.dst);
				else drawStock(board, DRAW);
			} else if (!drawStock(board, DRAW)) {
				break;
			}
		}
	}
	console.log(`${compared} turns compared across 400 games (${recycles} of them recycles)`);
	console.log(mismatches ? `${mismatches} MISMATCHES` : "draw one mirrors draw three exactly");
	if (mismatches) process.exit(1);
}
