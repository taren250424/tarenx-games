import "../../shared/ads/ad-slot.css";
import "../../shared/theme/base.css";
import "./style.css";
import { createSfx } from "../../shared/audio/sfx.ts";
import { PUZZLES, type Difficulty } from "./puzzles.ts";

const UNKNOWN = 0;
const FILLED = 1;
const BLANK = 2;

interface Session {
	key: string; // "difficulty:index"
	cells: string; // one char per cell: 0 unknown, 1 filled, 2 crossed
	elapsed: number; // seconds
	hintsLeft: number;
}

interface Progress {
	current: string;
	best: Record<string, number>; // key -> best seconds
	session: Session | null;
	settings: { sound: boolean; mistakes: boolean };
}

const STORAGE_KEY = "tarenx.nonogram.progress";
const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const HINTS_PER_PUZZLE = 3;

// A grid is one byte per cell: UNKNOWN, FILLED or BLANK.
type Grid = Uint8Array<ArrayBufferLike>;

// --- state ---
let difficulty: Difficulty = "easy";
let puzzleIndex = 0;
let size = 10;
let solution: Grid = new Uint8Array(0);
let cells: Grid = new Uint8Array(0);
let rowClues: number[][] = [];
let colClues: number[][] = [];
let cursor = -1;
let hintsLeft = HINTS_PER_PUZZLE;
let elapsed = 0;
let history: Grid[] = [];
let won = false;

// --- elements ---
const boardEl = document.getElementById("board") as HTMLElement;
const cellsEl = document.getElementById("cells") as HTMLElement;
const rowCluesEl = document.getElementById("row-clues") as HTMLElement;
const colCluesEl = document.getElementById("col-clues") as HTMLElement;
const puzzleSelectEl = document.getElementById("puzzle-select") as HTMLSelectElement;
const timeEl = document.getElementById("time") as HTMLElement;
const bestEl = document.getElementById("best") as HTMLElement;
const hintsEl = document.getElementById("hints") as HTMLElement;
const leftEl = document.getElementById("left") as HTMLElement;
const soundBtn = document.getElementById("sound-btn") as HTMLButtonElement;
const mistakesCheck = document.getElementById("mistakes-check") as HTMLInputElement;
const overlayEl = document.getElementById("win-overlay") as HTMLElement;
const winStatsEl = document.getElementById("win-stats") as HTMLElement;
const nextBtn = document.getElementById("next-btn") as HTMLButtonElement;

let cellEls: HTMLElement[] = [];
let rowClueEls: HTMLElement[] = [];
let colClueEls: HTMLElement[] = [];

// --- audio ---
const play = createSfx(
	["fill", "cross", "erase", "error", "hint", "button", "win"] as const,
	() => progress.settings.sound
);

// --- persistence ---
function loadProgress(): Progress {
	const fallback: Progress = {
		current: "easy:0",
		best: {},
		session: null,
		settings: { sound: true, mistakes: true },
	};
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<Progress>;
			return {
				current: typeof parsed.current === "string" ? parsed.current : fallback.current,
				best: parsed.best && typeof parsed.best === "object" ? parsed.best : {},
				session: parsed.session ?? null,
				settings: {
					sound: parsed.settings?.sound ?? true,
					mistakes: parsed.settings?.mistakes ?? true,
				},
			};
		}
	} catch {
		// corrupted storage — start fresh
	}
	return fallback;
}

function saveProgress() {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
	} catch {
		// storage full or blocked — keep playing with in-memory progress
	}
}

const progress = loadProgress();

function puzzleKey(): string {
	return `${difficulty}:${puzzleIndex}`;
}

function saveSession() {
	progress.session = won
		? null
		: { key: puzzleKey(), cells: cells.join(""), elapsed, hintsLeft };
	saveProgress();
}

// --- puzzle data ---
function decode(encoded: string, n: number): Grid {
	const bytes = atob(encoded);
	const grid = new Uint8Array(n * n);
	for (let i = 0; i < grid.length; i++) {
		grid[i] = (bytes.charCodeAt(i >> 3) >> (7 - (i & 7))) & 1;
	}
	return grid;
}

function runsOf(values: number[]): number[] {
	const runs: number[] = [];
	let run = 0;
	for (const value of values) {
		if (value === FILLED) run++;
		else if (run) {
			runs.push(run);
			run = 0;
		}
	}
	if (run) runs.push(run);
	return runs;
}

function rowOf(source: Grid, r: number): number[] {
	return Array.from({ length: size }, (_, c) => source[r * size + c]);
}

function colOf(source: Grid, c: number): number[] {
	return Array.from({ length: size }, (_, r) => source[r * size + c]);
}

// --- puzzle lifecycle ---
function loadPuzzle(diff: Difficulty, index: number, session?: Session) {
	difficulty = diff;
	puzzleIndex = index;
	size = PUZZLES[diff].size;
	solution = decode(PUZZLES[diff].puzzles[index], size);
	cells = new Uint8Array(size * size);
	if (session) {
		for (let i = 0; i < cells.length; i++) cells[i] = Number(session.cells[i]) || UNKNOWN;
	}
	rowClues = Array.from({ length: size }, (_, r) => runsOf(rowOf(solution, r)));
	colClues = Array.from({ length: size }, (_, c) => runsOf(colOf(solution, c)));
	elapsed = session ? session.elapsed : 0;
	hintsLeft = session ? session.hintsLeft : HINTS_PER_PUZZLE;
	cursor = -1;
	history = [];
	won = false;

	progress.current = puzzleKey();
	saveSession();
	puzzleSelectEl.value = puzzleKey();
	overlayEl.classList.add("hidden");
	boardEl.classList.remove("solved");
	buildBoard();
	renderAll();
}

function restart() {
	loadPuzzle(difficulty, puzzleIndex);
}

function nextPosition(): [Difficulty, number] {
	if (puzzleIndex + 1 < PUZZLES[difficulty].puzzles.length) {
		return [difficulty, puzzleIndex + 1];
	}
	const di = (DIFFICULTIES.indexOf(difficulty) + 1) % DIFFICULTIES.length;
	return [DIFFICULTIES[di], 0];
}

// --- board construction (built once per puzzle, then updated in place) ---
function buildBoard() {
	boardEl.style.setProperty("--size", String(size));
	boardEl.style.setProperty(
		"--row-clue-slots",
		String(Math.max(...rowClues.map((clue) => clue.length), 1))
	);
	boardEl.style.setProperty(
		"--col-clue-slots",
		String(Math.max(...colClues.map((clue) => clue.length), 1))
	);

	colCluesEl.innerHTML = colClues
		.map((clue) => `<div class="clue">${clue.map((n) => `<span>${n}</span>`).join("")}</div>`)
		.join("");
	rowCluesEl.innerHTML = rowClues
		.map((clue) => `<div class="clue">${clue.map((n) => `<span>${n}</span>`).join("")}</div>`)
		.join("");
	cellsEl.innerHTML = Array.from({ length: size * size }, (_, i) => {
		const r = Math.floor(i / size);
		const c = i % size;
		let cls = "cell";
		if (r === 0) cls += " top";
		if (c === 0) cls += " left";
		if (r % 5 === 0 && r !== 0) cls += " bt";
		if (c % 5 === 0 && c !== 0) cls += " bl";
		return `<div class="${cls}" data-i="${i}"></div>`;
	}).join("");

	cellEls = [...cellsEl.children] as HTMLElement[];
	rowClueEls = [...rowCluesEl.children] as HTMLElement[];
	colClueEls = [...colCluesEl.children] as HTMLElement[];
}

// --- rendering ---
function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}:${String(s).padStart(2, "0")}`;
}

function renderCell(i: number) {
	const el = cellEls[i];
	if (!el) return;
	el.classList.toggle("filled", cells[i] === FILLED);
	el.classList.toggle("crossed", cells[i] === BLANK);
	el.classList.toggle("cursor", i === cursor);
	el.classList.toggle(
		"wrong",
		progress.settings.mistakes && cells[i] === FILLED && solution[i] !== FILLED
	);
}

function sameRuns(a: number[], b: number[]): boolean {
	return a.length === b.length && a.every((n, i) => n === b[i]);
}

function renderLine(index: number, isRow: boolean) {
	const values = isRow ? rowOf(cells, index) : colOf(cells, index);
	const clue = isRow ? rowClues[index] : colClues[index];
	const el = isRow ? rowClueEls[index] : colClueEls[index];
	if (!el) return;
	// A line reads as done once its filled runs match the clue exactly — the
	// crosses are the player's bookkeeping and don't count.
	el.classList.toggle("done", sameRuns(runsOf(values), clue));
}

function renderAll() {
	for (let i = 0; i < cells.length; i++) renderCell(i);
	for (let k = 0; k < size; k++) {
		renderLine(k, true);
		renderLine(k, false);
	}
	renderStatus();
}

function renderStatus() {
	timeEl.textContent = formatTime(elapsed);
	const best = progress.best[puzzleKey()];
	bestEl.textContent = best === undefined ? "—" : formatTime(best);
	hintsEl.textContent = String(hintsLeft);
	let remaining = 0;
	for (let i = 0; i < cells.length; i++) {
		if (solution[i] === FILLED && cells[i] !== FILLED) remaining++;
	}
	leftEl.textContent = String(remaining);
	soundBtn.textContent = progress.settings.sound ? "🔊" : "🔇";
}

// --- actions ---
function pushHistory() {
	history.push(cells.slice());
	if (history.length > 200) history.shift();
}

function setCell(i: number, state: number) {
	if (cells[i] === state) return false;
	cells[i] = state;
	renderCell(i);
	renderLine(Math.floor(i / size), true);
	renderLine(i % size, false);
	return true;
}

function undo() {
	if (won) return;
	const snapshot = history.pop();
	if (!snapshot) return;
	cells = snapshot;
	play("button");
	saveSession();
	renderAll();
}

function hint() {
	if (won) return;
	if (hintsLeft <= 0) {
		play("error");
		return;
	}
	// Reveal a square the player has not got right yet. Missing fills are worth
	// far more than missing crosses, so spend the hint on one of those first,
	// and prefer the row under the cursor so it lands where they are working.
	const missing: number[] = [];
	const wrong: number[] = [];
	for (let i = 0; i < cells.length; i++) {
		const truth = solution[i] === FILLED ? FILLED : BLANK;
		if (cells[i] === truth) continue;
		wrong.push(i);
		if (truth === FILLED) missing.push(i);
	}
	if (!wrong.length) return;
	const candidates = missing.length ? missing : wrong;
	const nearCursor =
		cursor >= 0
			? candidates.filter((i) => Math.floor(i / size) === Math.floor(cursor / size))
			: [];
	const pool = nearCursor.length ? nearCursor : candidates;
	const target = pool[Math.floor(Math.random() * pool.length)];

	pushHistory();
	setCell(target, solution[target] === FILLED ? FILLED : BLANK);
	cursor = target;
	renderCell(target);
	hintsLeft--;
	play("hint");
	saveSession();
	renderStatus();
	checkWin();
}

function checkWin() {
	for (let i = 0; i < cells.length; i++) {
		if ((cells[i] === FILLED) !== (solution[i] === FILLED)) return;
	}
	won = true;
	const key = puzzleKey();
	const best = progress.best[key];
	const isRecord = best === undefined || elapsed < best;
	if (isRecord) progress.best[key] = elapsed;
	progress.session = null;
	saveProgress();
	buildPuzzleOptions();
	puzzleSelectEl.value = key;
	winStatsEl.textContent = `${formatTime(elapsed)}${isRecord ? " · New best!" : ""}`;
	const [nd, ni] = nextPosition();
	nextBtn.textContent =
		ni === 0 && nd !== difficulty ? `Start ${label(nd)} →` : "Next Puzzle →";
	boardEl.classList.add("solved");
	overlayEl.classList.remove("hidden");
	play("win");
	renderStatus();
}

function nextPuzzle() {
	const [nd, ni] = nextPosition();
	loadPuzzle(nd, ni);
}

function randomPuzzle() {
	const bank = PUZZLES[difficulty].puzzles;
	let index = puzzleIndex;
	if (bank.length > 1) {
		while (index === puzzleIndex) index = Math.floor(Math.random() * bank.length);
	}
	loadPuzzle(difficulty, index);
}

function moveCursor(dr: number, dc: number) {
	if (cursor < 0) {
		cursor = 0;
	} else {
		const previous = cursor;
		const r = Math.min(size - 1, Math.max(0, Math.floor(cursor / size) + dr));
		const c = Math.min(size - 1, Math.max(0, (cursor % size) + dc));
		cursor = r * size + c;
		renderCell(previous);
	}
	renderCell(cursor);
}

/*
 * One keyboard or mouse action on a cell: left button paints filled (or wipes
 * a filled cell), right button paints a cross (or wipes one). The state the
 * first cell of a drag lands on is then repeated for the whole stroke, which
 * is what makes dragging across a row feel predictable.
 */
function targetStateFor(i: number, crossing: boolean): number {
	if (crossing) return cells[i] === BLANK ? UNKNOWN : BLANK;
	return cells[i] === FILLED ? UNKNOWN : FILLED;
}

function applyPaint(i: number, state: number) {
	if (won) return;
	setCell(i, state);
}

// One click of the sound per stroke, not per cell — dragging across a row
// would otherwise machine-gun the speaker.
function playPaint(state: number) {
	play(state === FILLED ? "fill" : state === BLANK ? "cross" : "erase");
}

// --- pointer painting ---
interface Stroke {
	state: number;
	origin: number;
	last: number;
	axis: "row" | "col" | null;
}

let stroke: Stroke | null = null;

function cellIndexAt(x: number, y: number): number {
	const el = document.elementFromPoint(x, y) as HTMLElement | null;
	const cell = el?.closest<HTMLElement>(".cell");
	if (!cell || !cellsEl.contains(cell)) return -1;
	return Number(cell.dataset.i);
}

function extendStroke(i: number) {
	if (!stroke || i < 0 || i === stroke.last) return;
	const originRow = Math.floor(stroke.origin / size);
	const originCol = stroke.origin % size;
	const row = Math.floor(i / size);
	const col = i % size;

	if (!stroke.axis) {
		if (row === originRow) stroke.axis = "row";
		else if (col === originCol) stroke.axis = "col";
		else return;
	}
	if (stroke.axis === "row" && row !== originRow) return;
	if (stroke.axis === "col" && col !== originCol) return;

	// fill in every cell between the last painted one and this one, so a fast
	// drag doesn't leave gaps
	const step = stroke.axis === "row" ? 1 : size;
	const from = stroke.last;
	const delta = i > from ? step : -step;
	for (let k = from + delta; ; k += delta) {
		applyPaint(k, stroke.state);
		if (k === i) break;
	}
	stroke.last = i;
}

cellsEl.addEventListener("pointerdown", (e) => {
	const cell = (e.target as HTMLElement).closest<HTMLElement>(".cell");
	if (!cell || won) return;
	e.preventDefault();
	const i = Number(cell.dataset.i);
	const crossing = e.button === 2 || e.shiftKey || e.ctrlKey;
	const previous = cursor;
	cursor = i;
	if (previous >= 0) renderCell(previous);
	pushHistory();
	const state = targetStateFor(i, crossing);
	applyPaint(i, state);
	playPaint(state);
	renderCell(i);
	stroke = { state, origin: i, last: i, axis: null };
	cellsEl.setPointerCapture(e.pointerId);
});

// Crosshair: the row and column under the pointer are lit through two bars
// positioned by CSS variables, which on a 20x20 board is the difference
// between reading a clue and counting cells with a finger.
function setHover(i: number) {
	if (i < 0) {
		cellsEl.classList.remove("hovering");
		return;
	}
	cellsEl.classList.add("hovering");
	cellsEl.style.setProperty("--hover-row", String(Math.floor(i / size)));
	cellsEl.style.setProperty("--hover-col", String(i % size));
}

cellsEl.addEventListener("pointermove", (e) => {
	const i = cellIndexAt(e.clientX, e.clientY);
	setHover(i);
	if (!stroke) return;
	e.preventDefault();
	extendStroke(i);
});

cellsEl.addEventListener("pointerleave", () => setHover(-1));

function endStroke(e: PointerEvent) {
	if (!stroke) return;
	const previous = cursor;
	cursor = stroke.last;
	stroke = null;
	if (cellsEl.hasPointerCapture(e.pointerId)) cellsEl.releasePointerCapture(e.pointerId);
	if (previous !== cursor) renderCell(previous);
	renderCell(cursor);
	saveSession();
	renderStatus();
	checkWin();
}

cellsEl.addEventListener("pointerup", endStroke);
cellsEl.addEventListener("pointercancel", endStroke);
cellsEl.addEventListener("contextmenu", (e) => e.preventDefault());

// --- keyboard ---
document.addEventListener("keydown", (e) => {
	if (e.ctrlKey || e.metaKey || e.altKey) return;
	if (!overlayEl.classList.contains("hidden") && (e.key === "Enter" || e.key === " ")) {
		e.preventDefault();
		nextPuzzle();
		return;
	}
	const key = e.key.toLowerCase();
	if (e.key === "ArrowUp") {
		e.preventDefault();
		moveCursor(-1, 0);
	} else if (e.key === "ArrowDown") {
		e.preventDefault();
		moveCursor(1, 0);
	} else if (e.key === "ArrowLeft") {
		e.preventDefault();
		moveCursor(0, -1);
	} else if (e.key === "ArrowRight") {
		e.preventDefault();
		moveCursor(0, 1);
	} else if (e.key === " " || key === "f" || key === "x" || e.key === "Delete" || e.key === "Backspace") {
		e.preventDefault();
		if (cursor < 0 || won) return;
		const crossing = key === "x" || e.key === "Delete" || e.key === "Backspace";
		pushHistory();
		const state = targetStateFor(cursor, crossing);
		applyPaint(cursor, state);
		playPaint(state);
		renderCell(cursor);
		saveSession();
		renderStatus();
		checkWin();
	} else if (key === "z" || key === "u") {
		undo();
	} else if (key === "h") {
		hint();
	} else if (key === "r") {
		restart();
	}
});

// --- controls ---
(document.getElementById("undo-btn") as HTMLButtonElement).addEventListener("click", undo);
(document.getElementById("hint-btn") as HTMLButtonElement).addEventListener("click", hint);
(document.getElementById("random-btn") as HTMLButtonElement).addEventListener("click", () => {
	play("button");
	randomPuzzle();
});
(document.getElementById("restart-btn") as HTMLButtonElement).addEventListener("click", () => {
	play("button");
	restart();
});
soundBtn.addEventListener("click", () => {
	progress.settings.sound = !progress.settings.sound;
	saveProgress();
	play("button");
	renderStatus();
});
mistakesCheck.addEventListener("change", () => {
	progress.settings.mistakes = mistakesCheck.checked;
	saveProgress();
	renderAll();
});
nextBtn.addEventListener("click", nextPuzzle);

puzzleSelectEl.addEventListener("change", () => {
	const [d, i] = puzzleSelectEl.value.split(":");
	loadPuzzle(d as Difficulty, Number(i));
});

// --- timer ---
setInterval(() => {
	if (won || document.visibilityState !== "visible") return;
	elapsed++;
	timeEl.textContent = formatTime(elapsed);
}, 1000);

window.addEventListener("pagehide", saveSession);

// --- init ---
function label(diff: Difficulty): string {
	return diff.charAt(0).toUpperCase() + diff.slice(1);
}

function buildPuzzleOptions() {
	puzzleSelectEl.innerHTML = DIFFICULTIES.map((diff) => {
		const bank = PUZZLES[diff];
		const options = bank.puzzles
			.map((_, i) => {
				const done = progress.best[`${diff}:${i}`] !== undefined ? " ✓" : "";
				return `<option value="${diff}:${i}">${label(diff)} #${i + 1}${done}</option>`;
			})
			.join("");
		return `<optgroup label="${label(diff)} — ${bank.size}×${bank.size}">${options}</optgroup>`;
	}).join("");
}

function init() {
	mistakesCheck.checked = progress.settings.mistakes;
	buildPuzzleOptions();
	const [initial, i] = (progress.current ?? "easy:0").split(":") as [Difficulty, string];
	let d = initial;
	let index = Number(i);
	if (!PUZZLES[d]?.puzzles[index]) {
		d = "easy";
		index = 0;
	}
	const session = progress.session;
	const expected = PUZZLES[d].size ** 2;
	if (session && session.key === `${d}:${index}` && session.cells.length === expected) {
		loadPuzzle(d, index, session);
	} else {
		loadPuzzle(d, index);
	}
}

init();
