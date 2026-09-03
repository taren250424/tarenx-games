import "../../shared/ads/ad-slot.css";
import "../../shared/theme/base.css";
import "./style.css";
import { createSfx } from "../../shared/audio/sfx.ts";
import { mountIcons, setSoundIcon } from "../../shared/ui/icons.ts";
import { PUZZLES, type Difficulty } from "./puzzles.ts";

mountIcons();

interface Session {
	key: string; // "difficulty:index"
	paths: number[][]; // per pair, the squares drawn so far in order
	elapsed: number; // seconds
	moves: number;
	hintsLeft: number;
}

interface Progress {
	current: string;
	best: Record<string, number>; // key -> best seconds
	session: Session | null;
	settings: { sound: boolean };
}

const STORAGE_KEY = "tarenx.numberlink.progress";
const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const HINTS_PER_PUZZLE = 3;
const FREE = -1;

// --- state ---
let difficulty: Difficulty = "easy";
let puzzleIndex = 0;
let size = 5;
let pairCount = 0;
let ends: [number, number][] = [];
let solutionPaths: number[][] = [];
let paths: number[][] = [];
let owner = new Int8Array(0);
let cursor = -1;
let drawing = -1; // pair being extended from the keyboard, or -1
let hintsLeft = HINTS_PER_PUZZLE;
let elapsed = 0;
let moves = 0;
let history: number[][][] = [];
let won = false;

// --- elements ---
const boardEl = document.getElementById("board") as HTMLElement;
const puzzleSelectEl = document.getElementById("puzzle-select") as HTMLSelectElement;
const timeEl = document.getElementById("time") as HTMLElement;
const bestEl = document.getElementById("best") as HTMLElement;
const pairsEl = document.getElementById("pairs") as HTMLElement;
const movesEl = document.getElementById("moves") as HTMLElement;
const hintsEl = document.getElementById("hints") as HTMLElement;
const soundBtn = document.getElementById("sound-btn") as HTMLButtonElement;
const overlayEl = document.getElementById("win-overlay") as HTMLElement;
const winStatsEl = document.getElementById("win-stats") as HTMLElement;
const nextBtn = document.getElementById("next-btn") as HTMLButtonElement;

let cellEls: HTMLElement[] = [];

// --- audio ---
const play = createSfx(
	["draw", "connect", "erase", "error", "hint", "button", "win"] as const,
	() => progress.settings.sound
);

// --- persistence ---
function loadProgress(): Progress {
	const fallback: Progress = {
		current: "easy:0",
		best: {},
		session: null,
		settings: { sound: true },
	};
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<Progress>;
			return {
				current: typeof parsed.current === "string" ? parsed.current : fallback.current,
				best: parsed.best && typeof parsed.best === "object" ? parsed.best : {},
				session: parsed.session ?? null,
				settings: { sound: parsed.settings?.sound ?? true },
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
		: { key: puzzleKey(), paths: paths.map((p) => [...p]), elapsed, moves, hintsLeft };
	saveProgress();
}

// --- puzzle data ---
function neighbors(i: number): number[] {
	const r = Math.floor(i / size);
	const c = i % size;
	const list: number[] = [];
	if (r > 0) list.push(i - size);
	if (r < size - 1) list.push(i + size);
	if (c > 0) list.push(i - 1);
	if (c < size - 1) list.push(i + 1);
	return list;
}

function adjacent(a: number, b: number): boolean {
	const dr = Math.abs(Math.floor(a / size) - Math.floor(b / size));
	const dc = Math.abs((a % size) - (b % size));
	return dr + dc === 1;
}

/*
 * The bank stores each pair's squares but not the order they are walked in,
 * and a path may run alongside itself, so the order is recovered by searching
 * for the one walk from the first endpoint that uses every square of the pair
 * and ends on the other.
 */
function orderPath(cells: Set<number>, from: number, to: number): number[] {
	const path = [from];
	const used = new Set([from]);
	const walk = (): boolean => {
		const at = path[path.length - 1];
		if (at === to) return used.size === cells.size;
		for (const j of neighbors(at)) {
			if (!cells.has(j) || used.has(j)) continue;
			path.push(j);
			used.add(j);
			if (walk()) return true;
			path.pop();
			used.delete(j);
		}
		return false;
	};
	walk();
	return path;
}

function decode(encoded: string) {
	const cells: Set<number>[] = [];
	const endpoints: number[][] = [];
	for (let i = 0; i < encoded.length; i++) {
		const ch = encoded[i];
		const c = ch.toLowerCase().charCodeAt(0) - 97;
		(cells[c] ??= new Set()).add(i);
		if (ch !== ch.toLowerCase()) (endpoints[c] ??= []).push(i);
	}
	pairCount = cells.length;
	ends = endpoints.map(([a, b]) => [a, b]);
	solutionPaths = ends.map((pair, c) => orderPath(cells[c], pair[0], pair[1]));
}

function rebuildOwner() {
	owner = new Int8Array(size * size).fill(FREE);
	paths.forEach((path, c) => {
		for (const cell of path) owner[cell] = c;
	});
}

function pairAt(i: number): number {
	return ends.findIndex(([a, b]) => a === i || b === i);
}

function isComplete(c: number): boolean {
	const path = paths[c];
	return path.length > 1 && (path[path.length - 1] === ends[c][0] || path[path.length - 1] === ends[c][1]);
}

// --- puzzle lifecycle ---
function loadPuzzle(diff: Difficulty, index: number, session?: Session) {
	difficulty = diff;
	puzzleIndex = index;
	size = PUZZLES[diff].size;
	decode(PUZZLES[diff].puzzles[index]);
	paths = session ? session.paths.map((p) => [...p]) : ends.map(() => []);
	rebuildOwner();
	elapsed = session ? session.elapsed : 0;
	moves = session ? session.moves : 0;
	hintsLeft = session ? session.hintsLeft : HINTS_PER_PUZZLE;
	cursor = -1;
	drawing = -1;
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
	boardEl.innerHTML = Array.from({ length: size * size }, (_, i) => {
		const c = pairAt(i);
		const dot = c >= 0 ? `<span class="dot">${c + 1}</span>` : "";
		const style = c >= 0 ? ` style="--c: var(--pipe-${c})"` : "";
		let cls = "cell";
		if (i < size) cls += " edge-top";
		if (i % size === 0) cls += " edge-left";
		if (c >= 0) cls += " end";
		return `<div class="${cls}" data-i="${i}"${style}>${dot}</div>`;
	}).join("");
	cellEls = [...boardEl.children] as HTMLElement[];
}

// --- rendering ---
function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}:${String(s).padStart(2, "0")}`;
}

const ARMS = ["up", "down", "left", "right"] as const;

function armTo(from: number, to: number): (typeof ARMS)[number] {
	if (to === from - size) return "up";
	if (to === from + size) return "down";
	return to === from - 1 ? "left" : "right";
}

function renderAll() {
	const arms = cellEls.map(() => new Set<string>());
	const heads = new Set<number>();
	paths.forEach((path, c) => {
		for (let k = 0; k + 1 < path.length; k++) {
			arms[path[k]].add(armTo(path[k], path[k + 1]));
			arms[path[k + 1]].add(armTo(path[k + 1], path[k]));
		}
		if (path.length && !isComplete(c)) heads.add(path[path.length - 1]);
	});
	cellEls.forEach((el, i) => {
		const c = owner[i];
		el.classList.toggle("on", c !== FREE);
		el.classList.toggle("head", heads.has(i));
		el.classList.toggle("done", c !== FREE && isComplete(c));
		el.classList.toggle("cursor", i === cursor);
		el.classList.toggle("drawing", drawing >= 0 && c === drawing);
		for (const arm of ARMS) el.classList.toggle(arm, arms[i].has(arm));
		if (c !== FREE) el.style.setProperty("--c", `var(--pipe-${c})`);
		else if (pairAt(i) < 0) el.style.removeProperty("--c");
	});
	renderStatus();
}

function renderStatus() {
	timeEl.textContent = formatTime(elapsed);
	const best = progress.best[puzzleKey()];
	bestEl.textContent = best === undefined ? "—" : formatTime(best);
	pairsEl.textContent = `${paths.filter((_, c) => isComplete(c)).length}/${pairCount}`;
	movesEl.textContent = String(moves);
	hintsEl.textContent = String(hintsLeft);
	setSoundIcon(soundBtn, progress.settings.sound);
}

// --- actions ---
function snapshot(): number[][] {
	return paths.map((p) => [...p]);
}

function pushHistory(before: number[][]) {
	history.push(before);
	if (history.length > 200) history.shift();
}

function samePaths(a: number[][], b: number[][]): boolean {
	return a.every((p, c) => p.length === b[c].length && p.every((cell, k) => cell === b[c][k]));
}

/*
 * Cuts every other path back to just before square `i`, the way a new line
 * drawn over an old one erases the old one from that square on.
 */
function claim(i: number, c: number) {
	const d = owner[i];
	if (d === FREE || d === c) return;
	paths[d].length = paths[d].indexOf(i);
}

/*
 * One step of pair `c` onto square `j`. Backing onto the path's own squares
 * rewinds it; stepping onto the pair's other endpoint finishes it; any other
 * endpoint is a wall. Returns whether the step was legal.
 */
function step(c: number, j: number): boolean {
	const path = paths[c];
	const head = path[path.length - 1];
	if (isComplete(c) || !adjacent(head, j)) return false;
	const k = path.indexOf(j);
	if (k >= 0) {
		path.length = k + 1;
		rebuildOwner();
		return true;
	}
	const p = pairAt(j);
	if (p >= 0 && p !== c) return false;
	claim(j, c);
	path.push(j);
	rebuildOwner();
	if (p === c) play("connect");
	return true;
}

/*
 * Where a stroke or keyboard draw begins: an endpoint starts its pair afresh,
 * a square on a path cuts the path back to it. Returns the pair to extend, or
 * -1 if there is nothing to pick up here.
 */
function pickUp(i: number): number {
	const p = pairAt(i);
	if (p >= 0) {
		paths[p] = [i];
		rebuildOwner();
		return p;
	}
	const c = owner[i];
	if (c === FREE) return -1;
	const wasHead = paths[c][paths[c].length - 1] === i;
	paths[c].length = paths[c].indexOf(i) + 1;
	rebuildOwner();
	if (!wasHead) play("erase");
	return c;
}

function finishMove(before: number[][]) {
	if (samePaths(before, paths)) return;
	pushHistory(before);
	moves++;
	saveSession();
	renderAll();
	checkWin();
}

function undo() {
	if (won) return;
	const previous = history.pop();
	if (!previous) return;
	paths = previous;
	rebuildOwner();
	drawing = -1;
	moves++;
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
	// Lay down one whole pair the player has not finished — the one under the
	// cursor if that is unfinished, otherwise the one with the least drawn.
	const unfinished = paths.map((_, c) => c).filter((c) => !isComplete(c));
	if (!unfinished.length) return;
	const under = cursor >= 0 ? owner[cursor] : FREE;
	const target = unfinished.includes(under)
		? under
		: unfinished.reduce((a, b) => (paths[b].length < paths[a].length ? b : a));

	const before = snapshot();
	for (const cell of solutionPaths[target]) claim(cell, target);
	paths[target] = [...solutionPaths[target]];
	rebuildOwner();
	drawing = -1;
	hintsLeft--;
	play("hint");
	finishMove(before);
	renderStatus();
}

function checkWin() {
	if (owner.includes(FREE) || !paths.every((_, c) => isComplete(c))) return;
	won = true;
	drawing = -1;
	const key = puzzleKey();
	const best = progress.best[key];
	const isRecord = best === undefined || elapsed < best;
	if (isRecord) progress.best[key] = elapsed;
	progress.session = null;
	saveProgress();
	buildPuzzleOptions();
	puzzleSelectEl.value = key;
	winStatsEl.textContent = `${formatTime(elapsed)} · ${moves} moves${isRecord ? " · New best!" : ""}`;
	const [nd, ni] = nextPosition();
	nextBtn.textContent =
		ni === 0 && nd !== difficulty ? `Start ${label(nd)} →` : "Next Puzzle →";
	boardEl.classList.add("solved");
	overlayEl.classList.remove("hidden");
	play("win");
	renderAll();
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

// --- pointer drawing ---
interface Stroke {
	pair: number;
	before: number[][];
	last: number;
}

let stroke: Stroke | null = null;

function cellIndexAt(x: number, y: number): number {
	const el = document.elementFromPoint(x, y) as HTMLElement | null;
	const cell = el?.closest<HTMLElement>(".cell");
	if (!cell || !boardEl.contains(cell)) return -1;
	return Number(cell.dataset.i);
}

// A fast drag can skip squares; along a row or column the gap is walked one
// square at a time, and a diagonal jump is simply ignored.
function extendTo(c: number, from: number, to: number): boolean {
	const dr = Math.floor(to / size) - Math.floor(from / size);
	const dc = (to % size) - (from % size);
	if (dr !== 0 && dc !== 0) return false;
	const delta = dr !== 0 ? Math.sign(dr) * size : Math.sign(dc);
	for (let k = from + delta; ; k += delta) {
		if (!step(c, k)) return false;
		if (k === to) return true;
	}
}

boardEl.addEventListener("pointerdown", (e) => {
	const cell = (e.target as HTMLElement).closest<HTMLElement>(".cell");
	if (!cell || won || e.button !== 0) return;
	e.preventDefault();
	const i = Number(cell.dataset.i);
	const before = snapshot();
	const pair = pickUp(i);
	drawing = -1;
	cursor = i;
	if (pair < 0) {
		renderAll();
		return;
	}
	play("draw");
	stroke = { pair, before, last: i };
	boardEl.setPointerCapture(e.pointerId);
	renderAll();
});

boardEl.addEventListener("pointermove", (e) => {
	if (!stroke) return;
	e.preventDefault();
	const i = cellIndexAt(e.clientX, e.clientY);
	if (i < 0 || i === stroke.last) return;
	const path = paths[stroke.pair];
	const head = path[path.length - 1];
	if (adjacent(head, i) ? step(stroke.pair, i) : extendTo(stroke.pair, head, i)) {
		stroke.last = i;
		cursor = i;
		renderAll();
	}
});

function endStroke(e: PointerEvent) {
	if (!stroke) return;
	const { before } = stroke;
	stroke = null;
	if (boardEl.hasPointerCapture(e.pointerId)) boardEl.releasePointerCapture(e.pointerId);
	finishMove(before);
}

boardEl.addEventListener("pointerup", endStroke);
boardEl.addEventListener("pointercancel", endStroke);
boardEl.addEventListener("contextmenu", (e) => e.preventDefault());

// --- keyboard ---
let keyboardBefore: number[][] | null = null;

function moveCursor(dr: number, dc: number) {
	if (cursor < 0) {
		cursor = 0;
	} else {
		const r = Math.min(size - 1, Math.max(0, Math.floor(cursor / size) + dr));
		const c = Math.min(size - 1, Math.max(0, (cursor % size) + dc));
		cursor = r * size + c;
	}
	renderAll();
}

function stopDrawing() {
	drawing = -1;
	if (keyboardBefore) finishMove(keyboardBefore);
	keyboardBefore = null;
	renderAll();
}

function toggleDrawing() {
	if (cursor < 0 || won) return;
	if (drawing >= 0) {
		stopDrawing();
		return;
	}
	const before = snapshot();
	const pair = pickUp(cursor);
	if (pair < 0) return;
	play("draw");
	drawing = pair;
	keyboardBefore = before;
	renderAll();
}

function drawStep(dr: number, dc: number) {
	const path = paths[drawing];
	const head = path[path.length - 1];
	const r = Math.floor(head / size) + dr;
	const c = (head % size) + dc;
	if (r < 0 || r >= size || c < 0 || c >= size) return;
	const j = r * size + c;
	if (!step(drawing, j)) return;
	cursor = j;
	if (isComplete(drawing)) stopDrawing();
	else renderAll();
}

document.addEventListener("keydown", (e) => {
	if (e.ctrlKey || e.metaKey || e.altKey) return;
	if (!overlayEl.classList.contains("hidden") && (e.key === "Enter" || e.key === " ")) {
		e.preventDefault();
		nextPuzzle();
		return;
	}
	const key = e.key.toLowerCase();
	const arrows: Record<string, [number, number]> = {
		ArrowUp: [-1, 0],
		ArrowDown: [1, 0],
		ArrowLeft: [0, -1],
		ArrowRight: [0, 1],
	};
	if (e.key in arrows) {
		e.preventDefault();
		const [dr, dc] = arrows[e.key];
		if (drawing >= 0) drawStep(dr, dc);
		else moveCursor(dr, dc);
	} else if (e.key === " " || e.key === "Enter") {
		e.preventDefault();
		toggleDrawing();
	} else if (e.key === "Escape") {
		if (drawing >= 0) stopDrawing();
	} else if (e.key === "Backspace" || e.key === "Delete") {
		e.preventDefault();
		if (drawing < 0 || paths[drawing].length < 2) return;
		paths[drawing].pop();
		rebuildOwner();
		cursor = paths[drawing][paths[drawing].length - 1];
		renderAll();
	} else if (key === "z" || key === "u") {
		keyboardBefore = null;
		undo();
	} else if (key === "h") {
		keyboardBefore = null;
		hint();
	} else if (key === "r") {
		keyboardBefore = null;
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

function validSession(session: Session | null, key: string): session is Session {
	if (!session || session.key !== key || !Array.isArray(session.paths)) return false;
	if (session.paths.length !== pairCount) return false;
	return session.paths.every(
		(p, c) =>
			Array.isArray(p) &&
			(p.length === 0 || p[0] === ends[c][0] || p[0] === ends[c][1]) &&
			p.every((cell) => Number.isInteger(cell) && cell >= 0 && cell < size * size)
	);
}

function init() {
	buildPuzzleOptions();
	const [initial, i] = (progress.current ?? "easy:0").split(":") as [Difficulty, string];
	let d = initial;
	let index = Number(i);
	if (!PUZZLES[d]?.puzzles[index]) {
		d = "easy";
		index = 0;
	}
	size = PUZZLES[d].size;
	decode(PUZZLES[d].puzzles[index]);
	const session = progress.session;
	loadPuzzle(d, index, validSession(session, `${d}:${index}`) ? session : undefined);
}

init();
