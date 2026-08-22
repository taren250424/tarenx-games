/*
 * Build-time position generator.
 *
 * Samples positions from the Lichess puzzle database (CC0) and has Stockfish
 * evaluate EVERY legal move in each of them, so the game can grade any move a
 * player makes without running an engine in the browser.
 *
 *   1. Stream lichess_db_puzzle.csv.zst and keep well-tested puzzles (enough
 *      plays, high popularity, low rating deviation) until each difficulty
 *      band has a comfortable surplus; the stream is aborted early, so only a
 *      few MB of the 300 MB file are read. Kept rows are cached.
 *   2. A puzzle's FEN is the position BEFORE the opponent's setup move; apply
 *      it to get the position the player faces. That move becomes the
 *      highlighted "last move" on the board.
 *   3. Run `go depth D` with MultiPV = number of legal moves. Evaluations are
 *      cached per puzzle id, so re-running with a larger --count only
 *      evaluates the new positions.
 *   4. Write public/positions/index.json (ratings only, for picking) and
 *      cNNN.json chunks (the positions, in a seeded shuffle).
 *
 * The generated files are committed — re-run this only to refresh or extend
 * the set.
 *
 * Usage: node tools/build-positions.mjs [--count 1500] [--depth 16]
 *          [--workers 4] [--threads 1] [--engine path/to/stockfish]
 *
 * The engine defaults to the Stockfish 18 binary unpacked under
 * tools/.cache/sf/ (download from https://stockfishchess.org/download/ and
 * unzip there), or pass --engine.
 */

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import zlib from "node:zlib";
import readline from "node:readline";
import { spawn } from "node:child_process";
import { Readable, Transform } from "node:stream";
import { fileURLToPath } from "node:url";
import { Chess } from "chess.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, "tools", ".cache");
const EVAL_CACHE = path.join(CACHE, "evals");
const SAMPLE_FILE = path.join(CACHE, "puzzles-sample.csv");
const OUT = path.join(ROOT, "public", "positions");

const PUZZLE_URL = "https://database.lichess.org/lichess_db_puzzle.csv.zst";

// --- options ---
const args = Object.fromEntries(
	process.argv
		.slice(2)
		.map((a, i, all) => (a.startsWith("--") ? [a.slice(2), all[i + 1] ?? "true"] : null))
		.filter(Boolean)
);
const COUNT = Number(args.count ?? 1500);
const DEPTH = Number(args.depth ?? 16);
const WORKERS = Number(args.workers ?? Math.max(1, Math.floor(os.cpus().length / 2)));
const THREADS = Number(args.threads ?? 1);
const CHUNK = Number(args.chunk ?? 100);
const ENGINE = args.engine ?? findEngine();

// Difficulty bands and their share of the set. Keep in sync with BANDS in
// src/positions.ts.
const BANDS = [
	{ key: "easy", min: 600, max: 1199, share: 0.3 },
	{ key: "medium", min: 1200, max: 1799, share: 0.4 },
	{ key: "hard", min: 1800, max: 2600, share: 0.3 },
];
// How many candidates per band to keep in the sample relative to need, so a
// later --count increase or a seed change still has room to pick from.
const SURPLUS = 4;

const MIN_PLAYS = 300;
const MIN_POPULARITY = 80;
const MAX_DEVIATION = 90;

function findEngine() {
	const dir = path.join(CACHE, "sf");
	if (!fs.existsSync(dir)) return null;
	const walk = (d) =>
		fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => {
			const p = path.join(d, e.name);
			return e.isDirectory() ? walk(p) : /stockfish.*(\.exe)?$/i.test(e.name) && !/\.(zip|txt|md)$/i.test(e.name) ? [p] : [];
		});
	return walk(dir)[0] ?? null;
}

// --- seeded RNG (mulberry32) so the shuffle is reproducible ---
function rng(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

function shuffle(arr, rand) {
	for (let i = arr.length - 1; i > 0; i--) {
		const j = Math.floor(rand() * (i + 1));
		[arr[i], arr[j]] = [arr[j], arr[i]];
	}
	return arr;
}

// --- step 1: sample the puzzle database ---
function bandOf(rating) {
	return BANDS.find((b) => rating >= b.min && rating <= b.max)?.key ?? null;
}

function need(bandKey) {
	const b = BANDS.find((x) => x.key === bandKey);
	// sized for the full set even on small test runs, so one fetch serves all
	return Math.ceil(Math.max(COUNT, 1500) * b.share) * SURPLUS;
}

async function ensureSample() {
	if (fs.existsSync(SAMPLE_FILE)) {
		const rows = fs.readFileSync(SAMPLE_FILE, "utf8").trim().split("\n").map(parseRow);
		const perBand = Object.fromEntries(BANDS.map((b) => [b.key, rows.filter((r) => bandOf(r.rating) === b.key).length]));
		if (BANDS.every((b) => perBand[b.key] >= need(b.key))) {
			console.log(`sample: ${rows.length} cached puzzles`, perBand);
			return rows;
		}
		console.log("sample: cache too small for --count, re-fetching", perBand);
	}

	console.log(`sample: streaming ${PUZZLE_URL}`);
	const controller = new AbortController();
	const res = await fetch(PUZZLE_URL, { signal: controller.signal });
	if (!res.ok || !res.body) throw new Error(`download failed: ${res.status}`);

	const kept = [];
	const perBand = Object.fromEntries(BANDS.map((b) => [b.key, 0]));
	let seen = 0;
	let header = null;
	const done = () => BANDS.every((b) => perBand[b.key] >= need(b.key));

	// Aborting the fetch errors the source; nothing downstream needs to hear it.
	const source = Readable.fromWeb(res.body).on("error", () => {});
	const zstd = zlib.createZstdDecompress().on("error", () => {});
	const lines = readline.createInterface({
		input: source.pipe(stripSkippableFrames()).pipe(zstd),
		crlfDelay: Infinity,
	});
	try {
		for await (const line of lines) {
			if (!header) {
				header = line;
				continue;
			}
			seen++;
			const row = parseRow(line);
			if (!row) continue;
			const band = bandOf(row.rating);
			if (!band || perBand[band] >= need(band)) continue;
			if (row.plays < MIN_PLAYS || row.popularity < MIN_POPULARITY || row.deviation > MAX_DEVIATION) continue;
			perBand[band]++;
			kept.push(line);
			if (seen % 50000 === 0) console.log(`  read ${seen} rows, kept ${kept.length}`, perBand);
			if (done()) break;
		}
	} finally {
		controller.abort();
		lines.close();
	}
	console.log(`sample: read ${seen} rows, kept ${kept.length}`, perBand);
	fs.mkdirSync(CACHE, { recursive: true });
	fs.writeFileSync(SAMPLE_FILE, kept.join("\n") + "\n");
	return kept.map(parseRow);
}

// The dump opens with a zstd "skippable frame" (a seek table), which Node's
// decoder rejects as an unknown frame descriptor; drop leading skippable
// frames and hand the decoder the first real frame.
function stripSkippableFrames() {
	let buf = Buffer.alloc(0);
	let passthrough = false;
	return new Transform({
		transform(chunk, _enc, cb) {
			if (passthrough) return cb(null, chunk);
			buf = Buffer.concat([buf, chunk]);
			for (;;) {
				if (buf.length < 8) return cb();
				const magic = buf.readUInt32LE(0);
				if (((magic & 0xfffffff0) >>> 0) === 0x184d2a50) {
					const size = buf.readUInt32LE(4);
					if (buf.length < 8 + size) return cb();
					buf = buf.subarray(8 + size);
					continue;
				}
				passthrough = true;
				const out = buf;
				buf = Buffer.alloc(0);
				return cb(null, out);
			}
		},
	});
}

// PuzzleId,FEN,Moves,Rating,RatingDeviation,Popularity,NbPlays,Themes,GameUrl,OpeningTags,DailyDate
function parseRow(line) {
	const c = line.split(",");
	if (c.length < 8) return null;
	return {
		id: c[0],
		fen: c[1],
		moves: c[2].split(" "),
		rating: Number(c[3]),
		deviation: Number(c[4]),
		popularity: Number(c[5]),
		plays: Number(c[6]),
		themes: c[7].split(" ").filter(Boolean),
	};
}

// --- step 2: the position the player faces ---
function playerPosition(row) {
	const chess = new Chess(row.fen);
	const setup = row.moves[0];
	const move = chess.move({ from: setup.slice(0, 2), to: setup.slice(2, 4), promotion: setup[4] });
	if (!move) return null;
	const legal = chess.moves({ verbose: true });
	if (legal.length < 2) return null; // nothing to choose
	return { fen: chess.fen(), last: setup, legal: legal.map(uciOf) };
}

function uciOf(m) {
	return m.from + m.to + (m.promotion ?? "");
}

// --- step 3: engine ---
class Engine {
	constructor(bin) {
		this.proc = spawn(bin, [], { stdio: ["pipe", "pipe", "inherit"] });
		this.rl = readline.createInterface({ input: this.proc.stdout });
		this.waiters = [];
		this.rl.on("line", (line) => {
			const w = this.waiters[0];
			if (w && w.onLine(line)) this.waiters.shift();
		});
	}

	send(cmd) {
		this.proc.stdin.write(cmd + "\n");
	}

	waitFor(pred, collect) {
		return new Promise((resolve) => {
			const lines = [];
			this.waiters.push({
				onLine: (line) => {
					if (collect) lines.push(line);
					if (pred(line)) {
						resolve(lines);
						return true;
					}
					return false;
				},
			});
		});
	}

	async init(threads) {
		this.send("uci");
		await this.waitFor((l) => l === "uciok");
		this.send(`setoption name Threads value ${threads}`);
		this.send("setoption name Hash value 128");
		this.send("isready");
		await this.waitFor((l) => l === "readyok");
	}

	/** Evaluate every legal move of `fen`; returns [{uci, cp|null, mate|null, pv}] best first. */
	async evaluateAll(fen, legalCount, depth) {
		this.send("ucinewgame");
		this.send(`setoption name MultiPV value ${legalCount}`);
		this.send("isready");
		await this.waitFor((l) => l === "readyok");
		this.send(`position fen ${fen}`);
		this.send(`go depth ${depth}`);
		const lines = await this.waitFor((l) => l.startsWith("bestmove"), true);
		const byIndex = new Map();
		for (const line of lines) {
			if (!line.startsWith("info ") || !line.includes(" multipv ") || !line.includes(" pv ")) continue;
			if (line.includes("bound ")) continue; // lowerbound/upperbound: not an exact score
			const m = line.match(/ depth (\d+) .*? multipv (\d+) score (cp|mate) (-?\d+)(?: \w+)* .*? pv (.+)$/);
			if (!m) continue;
			const [, d, idx, kind, val, pv] = m;
			const prev = byIndex.get(Number(idx));
			if (prev && prev.depth > Number(d)) continue;
			byIndex.set(Number(idx), {
				depth: Number(d),
				cp: kind === "cp" ? Number(val) : null,
				mate: kind === "mate" ? Number(val) : null,
				pv: pv.split(" "),
			});
		}
		return [...byIndex.entries()]
			.sort((a, b) => a[0] - b[0])
			.map(([, e]) => ({ uci: e.pv[0], cp: e.cp, mate: e.mate, pv: e.pv.slice(0, 8) }));
	}

	quit() {
		this.send("quit");
	}
}

// Puzzle ids are case-sensitive base62, but Windows file names are not, so an
// uppercase letter is spelled out ("03LO0" → "03_l_o0") to keep twins apart.
function cachePath(id) {
	const safe = id.replace(/[A-Z]/g, (c) => "_" + c.toLowerCase());
	return path.join(EVAL_CACHE, `${safe}-d${DEPTH}.json`);
}

// cp from the mover's point of view; mates sort above any cp
function scoreKey(e) {
	if (e.mate !== null) return e.mate > 0 ? 100000 - e.mate : -100000 - e.mate;
	return e.cp;
}

async function evaluatePositions(jobs) {
	fs.mkdirSync(EVAL_CACHE, { recursive: true });
	const queue = jobs.filter((j) => !fs.existsSync(cachePath(j.id)));
	console.log(`engine: ${jobs.length - queue.length} cached, ${queue.length} to evaluate, ${WORKERS} workers × ${THREADS} threads, depth ${DEPTH}`);
	if (queue.length === 0) return;
	if (!ENGINE) throw new Error("no engine: pass --engine or unpack Stockfish under tools/.cache/sf/");

	let done = 0;
	const total = queue.length;
	const t0 = Date.now();
	const worker = async () => {
		const eng = new Engine(ENGINE);
		await eng.init(THREADS);
		for (;;) {
			const job = queue.shift();
			if (!job) break;
			const t = Date.now();
			const evals = await eng.evaluateAll(job.fen, job.legal.length, DEPTH);
			const missing = job.legal.filter((u) => !evals.some((e) => e.uci === u));
			if (missing.length) console.warn(`  ${job.id}: ${missing.length} legal moves missing from engine output`);
			evals.sort((a, b) => scoreKey(b) - scoreKey(a));
			fs.writeFileSync(cachePath(job.id), JSON.stringify({ depth: DEPTH, evals }));
			done++;
			const per = (Date.now() - t0) / done;
			console.log(
				`  ${done}/${total} ${job.id} ${job.legal.length} moves ${((Date.now() - t) / 1000).toFixed(1)}s — eta ${Math.round(((queue.length) * per) / 60000)} min`
			);
		}
		eng.quit();
	};
	await Promise.all(Array.from({ length: Math.min(WORKERS, queue.length) }, worker));
}

// --- step 4: write the dataset ---
function writeOutput(jobs) {
	fs.rmSync(OUT, { recursive: true, force: true });
	fs.mkdirSync(OUT, { recursive: true });
	const positions = jobs.map((j) => {
		const { evals } = JSON.parse(fs.readFileSync(cachePath(j.id), "utf8"));
		return {
			id: j.id,
			fen: j.fen,
			last: j.last,
			rating: j.rating,
			themes: j.themes,
			moves: evals.map((e) => [e.uci, e.mate !== null ? `M${e.mate}` : e.cp]),
			pv: evals[0].pv,
		};
	});
	for (let i = 0; i < positions.length; i += CHUNK) {
		const name = `c${String(i / CHUNK).padStart(3, "0")}.json`;
		fs.writeFileSync(path.join(OUT, name), JSON.stringify(positions.slice(i, i + CHUNK)));
	}
	const index = {
		count: positions.length,
		chunkSize: CHUNK,
		depth: DEPTH,
		ratings: positions.map((p) => p.rating),
	};
	fs.writeFileSync(path.join(OUT, "index.json"), JSON.stringify(index));
	const bytes = fs.readdirSync(OUT).reduce((s, f) => s + fs.statSync(path.join(OUT, f)).size, 0);
	console.log(`wrote ${positions.length} positions in ${Math.ceil(positions.length / CHUNK)} chunks, ${(bytes / 1024).toFixed(0)} KB`);
}

// --- main ---
const rows = await ensureSample();
const rand = rng(20260822);
const picked = [];
for (const band of BANDS) {
	const pool = shuffle(
		rows.filter((r) => bandOf(r.rating) === band.key),
		rand
	);
	picked.push(...pool.slice(0, Math.ceil(COUNT * band.share)));
}
const jobs = [];
for (const row of picked.slice(0, COUNT)) {
	const pos = playerPosition(row);
	if (!pos) continue;
	jobs.push({ id: row.id, rating: row.rating, themes: row.themes, ...pos });
}
shuffle(jobs, rand);
console.log(`positions: ${jobs.length} selected`);
await evaluatePositions(jobs);
writeOutput(jobs);
