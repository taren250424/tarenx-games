/*
 * Builds the banks of Spider games that are known to be winnable.
 *
 *   node tools/solve.mjs --suits N [--scan N] [--to N] [--nodes N] [--out path]
 *
 * For each seed it searches for a way to win with every card visible, then —
 * and this is the part that matters — replays the solution it found through
 * src/rules.ts, the same module the game itself plays through, and only counts
 * the seed if that replay ends with all eight runs carried off.
 *
 * So a bank cannot lie. A bug in the search can only cost us games we would
 * otherwise have shipped; it cannot put an unwinnable game in front of anybody.
 * Seeds the search gives up on are simply left out.
 *
 * Every suit count is a bank of its own — the same seed that falls over itself
 * at one suit can be hopeless at four — so --suits is required, and the shards
 * and the output file both carry it.
 *
 * The output is a bitmap over the scanned seeds, one bit each, base64 encoded.
 * No deal is ever stored: the cards still come from the seed at run time.
 */

import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
	applyMove,
	canDealRow,
	canMove,
	cloneBoard,
	dealBoard,
	dealRow,
	isWon,
	legalMoves,
} from "../src/rules.ts";
import { rankOf, suitOf } from "../src/shuffle.ts";

const HERE = dirname(fileURLToPath(import.meta.url));
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
 * settled, and without it extending a bank means scanning them all again.
 */
const SCANS = join(HERE, "scan");
const value = (name) => {
	const i = args.indexOf(`--${name}`);
	if (i < 0) return undefined;
	const next = args[i + 1];
	return next === undefined || next.startsWith("--") ? null : next;
};
const SUITS = option("suits", 0);
if (SUITS !== 1 && SUITS !== 2 && SUITS !== 4) {
	console.error("--suits 1, 2 or 4 is required: every suit count is its own bank");
	process.exit(1);
}
const partial = value("partial");
const mergeArg = value("merge");
const SCAN = option("scan", 2000);
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
const PARTIAL =
	partial === undefined ? null : (partial ?? join(SCANS, `suits${SUITS}-shard-${STRIDE}-${OFFSET}.json`));
const MERGE =
	mergeArg === undefined
		? null
		: (mergeArg ??
			readdirSync(SCANS)
				.filter((name) => name.startsWith(`suits${SUITS}-shard-`))
				.map((name) => join(SCANS, name))
				.join(","));
const NODE_CAP = option("nodes", 0); // 0 = a full run for the width, width × depth
/*
 * Most games fall to a narrow beam in a fraction of a second. Rather than pay
 * a wide one for all of them, try narrow first and only widen for the games
 * that resist — the budget then lands where it is actually needed.
 */
const WIDTHS = [40, 150, 400];
/*
 * A beam left to its own devices fills up with siblings of whichever position
 * scores best and starves every other plan; a few levels later the whole
 * frontier is one family and its unexplored neighbours are exhausted. Keeping
 * at most a handful of children per parent forces the beam to stay a spread of
 * genuinely different plans, which is what cracked the harder suit counts.
 */
const PER_PARENT = 4;
/*
 * Dealing buries all ten piles and any honest score drops accordingly, so
 * without a thumb on the scale the beam would put the deal off until it had
 * tinkered itself dry. The compensation makes freshly dealt positions compete
 * on their prospects instead of their mess.
 */
const DEAL_COMP = 7;
const outIndex = args.indexOf("--out");
/*
 * The shipped bank is only ever written by --merge, or by --out said out loud.
 * A bare scan writing it would turn a quick check of one seed into a one-game
 * bank without a word of warning.
 */
const OUT = outIndex >= 0 ? args[outIndex + 1] : null;
const BANK = join(HERE, "..", "src", `winnable-${SUITS}.ts`);

// --- search ---

/*
 * Columns are interchangeable, so sorting them collapses whole families of
 * positions onto one key — and so are cards of the same rank and suit, so the
 * key holds values rather than ids. The stock never needs spelling out: its
 * contents are fixed by the seed and how many rows have been dealt.
 */
const VAL = Array.from({ length: 104 }, (_, id) => String.fromCharCode(100 + rankOf(id) * 4 + suitOf(id, SUITS)));

/*
 * The forks below share every untouched column with the parent position, so
 * both the key fragment and the score of a column can be computed once and
 * cached on the object — a child then pays for the two columns it changed.
 *
 * The score counts what a column is worth on its own: face-down cards are the
 * debt, an empty column is the strongest tool on the table, a same-suit run is
 * the shape a win is made of — worth more the longer it has grown — and a
 * break in rank order is a dig that is still to come.
 */
const colCache = new WeakMap();

function colInfo(column) {
	let info = colCache.get(column);
	if (info) return info;
	const cards = column.cards;
	let str = `${column.down}:`;
	let score = cards.length ? -column.down * 4 : 10;
	let run = 1;
	for (let i = 0; i < cards.length; i++) {
		str += VAL[cards[i]];
		if (i > column.down) {
			if (
				rankOf(cards[i]) === rankOf(cards[i - 1]) - 1 &&
				suitOf(cards[i], SUITS) === suitOf(cards[i - 1], SUITS)
			) {
				run++;
				continue;
			}
			// a same-suit run is worth more than its cards: only long ones ever
			// grow into the king-to-ace runs that leave the table
			score += (run - 1) * Math.sqrt(run - 1);
			run = 1;
			if (rankOf(cards[i]) === rankOf(cards[i - 1]) - 1) score += 0.3;
			else score -= 1;
		}
	}
	score += (run - 1) * Math.sqrt(run - 1);
	info = { str, score };
	colCache.set(column, info);
	return info;
}

function key(board) {
	const cols = board.tableau
		.map((col) => colInfo(col).str)
		.sort()
		.join("/");
	return `${board.stock.length}|${cols}`;
}

/*
 * Lighter clones than rules.cloneBoard, for the one thing the search does all
 * day. A move touches two columns and possibly `done`; everything else can be
 * shared with the parent, which applyMove never mutates again because a parent
 * with every column topped face-up has nothing left for flipExposed to do.
 */
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

/** How promising a position is: finished runs banked, plus what each column is worth. */
function promise(board) {
	let total = board.done.length * 45 - board.stock.length * 0.15;
	for (const col of board.tableau) total += colInfo(col).score;
	return total;
}

/** Everything worth doing from a position: every legal move, and the next row. */
function options(board) {
	const out = legalMoves(board).map((move) => ({ move }));
	if (canDealRow(board)) out.push({ deal: true });
	return out;
}

/*
 * Beam search: expand a frontier of the most promising positions, keep the best
 * few hundred, go again. Spider punishes depth-first search — one bad early
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
				const board = option.deal ? forkDeal(from) : forkMove(from, option.move);
				if (option.deal) dealRow(board);
				else applyMove(board, option.move);

				const child = { board, prev: node, steps: [option.deal ? { deal: true } : option.move] };
				if (isWon(board)) return unwind(child);
				const k = key(board);
				if (seen.has(k) || level.has(k)) continue;
				level.add(k);
				child.key = k;
				child.rating = promise(board) + (option.deal ? DEAL_COMP : 0);
				next.push(child);
			}
			// The children hold on to this node for the move list, but nobody needs
			// its board again — and a beam that keeps every ancestor's board alive
			// runs the heap out long before it runs the budget out.
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
			if (frontier.length >= width) break;
		}
		for (const node of frontier) seen.add(node.key);
	}
	return null;
}

function unwind(node) {
	const path = [];
	for (let n = node; n; n = n.prev) path.unshift(...n.steps);
	return path;
}

// --- verification ---

/*
 * Replays a solution through the rules the game plays by. Anything the search
 * believed but the rules do not agree with fails here, and the seed is dropped.
 */
function verify(seed, path) {
	const board = dealBoard(seed, SUITS);
	for (const step of path) {
		if (step.deal) {
			if (!canDealRow(board)) return false;
			dealRow(board);
			continue;
		}
		if (!canMove(board, step)) return false;
		applyMove(board, step);
	}
	return isWon(board);
}

// --- bank ---
function encodeBitmap(bits) {
	const bytes = new Uint8Array(Math.ceil(bits.length / 8));
	for (let i = 0; i < bits.length; i++) if (bits[i]) bytes[i >> 3] |= 128 >> (i & 7);
	return Buffer.from(bytes).toString("base64");
}

// --- run ---
if (MERGE) {
	/*
	 * The bank stops at the last seed every shard has passed. Beyond that the
	 * shards have only settled some of the seeds, and banking a half-covered
	 * stretch would mean a later run fills the gaps, inserts games in the middle
	 * and renumbers every game after them.
	 */
	const files = MERGE.split(",");
	const shards = files.map((file) => JSON.parse(readFileSync(file, "utf8")));
	if (shards.some((shard) => shard.suits !== SUITS)) {
		console.error("these shards were scanned at a different suit count");
		process.exit(1);
	}
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
		if (previous.suits === SUITS && previous.stride === STRIDE && previous.offset === OFFSET) {
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
	writeFileSync(PARTIAL, JSON.stringify({ suits: SUITS, stride: STRIDE, offset: OFFSET, upTo, winnable }));
};

const first = upTo > OFFSET ? upTo + STRIDE : OFFSET + 1;
console.log(
	`seeds ${first}-${TO} step ${STRIDE} at ${SUITS} suit(s), beams ${WIDTHS.join("/")}, ` +
		`up to ${NODE_CAP || `width×${DEPTH_CAP}`} positions each`
);
let scanned = 0;
let gaveUp = 0;
let rejected = 0;
const started = Date.now();

for (let seed = first; seed <= TO; seed += STRIDE) {
	let path = null;
	for (const width of WIDTHS) {
		path = solve(dealBoard(seed, SUITS), NODE_CAP || width * DEPTH_CAP, width);
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
		console.error(`  through ${seed} · ${winnable.length} winnable · ${rate.toFixed(0)}ms each`);
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
 * Games proved winnable at ${SUITS} suit(s), one bit per seed, seeds 1-${covered}.
 *
 * Generated by tools/solve.mjs — do not edit. Every bit set here means a
 * solution was found AND replayed through src/rules.ts, the module the game
 * itself plays by, ending with all eight runs carried off. So a game dealt
 * from this bank can always be finished. Seeds the search could not settle are
 * left out rather than guessed at, which is why this is smaller than the set
 * of games that are winnable in principle.
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
