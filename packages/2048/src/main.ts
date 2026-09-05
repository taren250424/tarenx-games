import "../../shared/ads/ad-slot.css";
import "../../shared/theme/base.css";
import "./style.css";
import { createSfx } from "../../shared/audio/sfx.ts";
import { mountIcons, setSoundIcon } from "../../shared/ui/icons.ts";
import { markPlayed } from "../../shared/progress/recent.ts";
import { ads } from "../../shared/ads/ads.ts";

mountIcons();
markPlayed();

interface BoardSize {
	key: string;
	label: string;
	n: number;
}

interface Tile {
	id: number;
	value: number;
	r: number;
	c: number;
}

interface Snapshot {
	tiles: Tile[];
	score: number;
	celebrated: boolean;
	over: boolean;
}

interface Progress {
	current: string; // board size key
	best: Record<string, number>; // size key -> best score
	session: (Snapshot & { size: string }) | null;
	settings: { sound: boolean };
}

const SIZES: BoardSize[] = [
	{ key: "4", label: "Classic · 4×4", n: 4 },
	{ key: "5", label: "Roomy · 5×5", n: 5 },
	{ key: "6", label: "Sprawl · 6×6", n: 6 },
];

const TARGET = 2048;
const STORAGE_KEY = "tarenx.2048.progress";
// Slide duration in ms — keep in sync with the .tile transition in style.css.
const MOVE_MS = 110;

type Dir = "up" | "down" | "left" | "right";

const VECTORS: Record<Dir, [number, number]> = {
	up: [-1, 0],
	down: [1, 0],
	left: [0, -1],
	right: [0, 1],
};

// --- state ---
let size = SIZES[0];
let grid: (Tile | null)[][] = [];
let nextId = 1;
let score = 0;
let celebrated = false; // 2048 was reached once — don't interrupt the run again
let over = false;
let undoState: Snapshot | null = null;
const tileEls = new Map<number, HTMLElement>();

// --- elements ---
const boardEl = document.getElementById("board") as HTMLElement;
const cellsEl = document.getElementById("cells") as HTMLElement;
const tilesEl = document.getElementById("tiles") as HTMLElement;
const sizeSelectEl = document.getElementById("size-select") as HTMLSelectElement;
const newBtn = document.getElementById("new-btn") as HTMLButtonElement;
const undoBtn = document.getElementById("undo-btn") as HTMLButtonElement;
const soundBtn = document.getElementById("sound-btn") as HTMLButtonElement;
const scoreEl = document.getElementById("score") as HTMLElement;
const bestEl = document.getElementById("best") as HTMLElement;
const topTileEl = document.getElementById("top-tile") as HTMLElement;
const gainEl = document.getElementById("gain") as HTMLElement;
const overlayEl = document.getElementById("end-overlay") as HTMLElement;
const endTitleEl = document.getElementById("end-title") as HTMLElement;
const endStatsEl = document.getElementById("end-stats") as HTMLElement;
const continueBtn = document.getElementById("continue-btn") as HTMLButtonElement;
const againBtn = document.getElementById("again-btn") as HTMLButtonElement;

// --- persistence ---
function loadProgress(): Progress {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<Progress>;
			return {
				current: typeof parsed.current === "string" ? parsed.current : "4",
				best: parsed.best !== null && typeof parsed.best === "object" ? parsed.best : {},
				session: parsed.session ?? null,
				settings: { sound: parsed.settings?.sound ?? true },
			};
		}
	} catch {
		// corrupted storage — start fresh
	}
	return { current: "4", best: {}, session: null, settings: { sound: true } };
}

function saveProgress() {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
	} catch {
		// storage full or blocked — keep playing with in-memory progress
	}
}

const progress = loadProgress();
ads.init({ sound: () => progress.settings.sound });

function saveSession() {
	progress.session = { size: size.key, ...snapshot() };
	saveProgress();
}

// --- audio ---
const play = createSfx(["move", "merge", "win", "gameover"] as const, () => progress.settings.sound);

function updateSoundBtn() {
	setSoundIcon(soundBtn, progress.settings.sound);
}

// --- grid helpers ---
function inBounds(r: number, c: number): boolean {
	return r >= 0 && r < size.n && c >= 0 && c < size.n;
}

function allTiles(): Tile[] {
	const out: Tile[] = [];
	for (const row of grid) {
		for (const t of row) {
			if (t) out.push(t);
		}
	}
	return out;
}

function emptyCells(): [number, number][] {
	const out: [number, number][] = [];
	for (let r = 0; r < size.n; r++) {
		for (let c = 0; c < size.n; c++) {
			if (!grid[r][c]) out.push([r, c]);
		}
	}
	return out;
}

function topTile(): number {
	return allTiles().reduce((max, t) => Math.max(max, t.value), 0);
}

// Farthest free cell along (dr, dc), plus the cell just past it — where a
// merge partner would sit.
function slide(r: number, c: number, dr: number, dc: number) {
	let fr = r;
	let fc = c;
	while (inBounds(fr + dr, fc + dc) && !grid[fr + dr][fc + dc]) {
		fr += dr;
		fc += dc;
	}
	return { fr, fc, nr: fr + dr, nc: fc + dc };
}

function hasMoves(): boolean {
	if (emptyCells().length > 0) return true;
	for (let r = 0; r < size.n; r++) {
		for (let c = 0; c < size.n; c++) {
			const v = grid[r][c]?.value;
			if (v === grid[r][c + 1]?.value || v === grid[r + 1]?.[c]?.value) return true;
		}
	}
	return false;
}

// --- rendering ---
function setPos(el: HTMLElement, r: number, c: number) {
	el.style.setProperty("--r", String(r));
	el.style.setProperty("--c", String(c));
}

function createTileEl(t: Tile, cls: string) {
	const el = document.createElement("div");
	el.className = cls ? `tile ${cls}` : "tile";
	// past 8192 every tile shares one look, so the color ramp needs no more steps
	el.dataset.value = t.value <= 8192 ? String(t.value) : "max";
	el.dataset.len = String(String(t.value).length);
	const face = document.createElement("div");
	face.className = "tile-face";
	face.textContent = String(t.value);
	el.appendChild(face);
	setPos(el, t.r, t.c);
	tilesEl.appendChild(el);
	tileEls.set(t.id, el);
}

function renderCells() {
	boardEl.style.setProperty("--n", String(size.n));
	cellsEl.innerHTML = Array.from({ length: size.n * size.n }, () => '<div class="cell"></div>').join("");
}

function renderAll() {
	tilesEl.innerHTML = "";
	tileEls.clear();
	for (const t of allTiles()) createTileEl(t, "");
	updateHud();
}

function updateHud() {
	scoreEl.textContent = score.toLocaleString();
	bestEl.textContent = (progress.best[size.key] ?? 0).toLocaleString();
	const top = topTile();
	topTileEl.textContent = top > 0 ? top.toLocaleString() : "—";
	undoBtn.disabled = undoState === null;
}

function showGain(amount: number) {
	if (amount <= 0) return;
	gainEl.textContent = `+${amount}`;
	// restart the float-up animation even when merges land back to back
	gainEl.classList.remove("show");
	void gainEl.offsetWidth;
	gainEl.classList.add("show");
}

function showOverlay(title: string, stats: string, canContinue: boolean) {
	endTitleEl.textContent = title;
	endStatsEl.textContent = stats;
	continueBtn.classList.toggle("hidden", !canContinue);
	againBtn.textContent = canContinue ? "New Game" : "Play Again";
	overlayEl.classList.remove("hidden");
}

function hideOverlay() {
	overlayEl.classList.add("hidden");
}

// --- game ---
function addRandomTile(cls = "tile-new") {
	const free = emptyCells();
	if (free.length === 0) return;
	const [r, c] = free[Math.floor(Math.random() * free.length)];
	const tile: Tile = { id: nextId++, value: Math.random() < 0.9 ? 2 : 4, r, c };
	grid[r][c] = tile;
	createTileEl(tile, cls);
}

function snapshot(): Snapshot {
	return { tiles: allTiles().map((t) => ({ ...t })), score, celebrated, over };
}

function restore(s: Snapshot) {
	grid = Array.from({ length: size.n }, () => Array<Tile | null>(size.n).fill(null));
	for (const t of s.tiles) {
		if (inBounds(t.r, t.c)) grid[t.r][t.c] = { ...t };
		nextId = Math.max(nextId, t.id + 1);
	}
	score = s.score;
	celebrated = s.celebrated;
	over = s.over;
	renderAll();
}

function newGame(next: BoardSize = size) {
	size = next;
	grid = Array.from({ length: size.n }, () => Array<Tile | null>(size.n).fill(null));
	score = 0;
	celebrated = false;
	over = false;
	undoState = null;
	progress.current = size.key;
	sizeSelectEl.value = size.key;
	hideOverlay();
	renderCells();
	renderAll();
	addRandomTile("");
	addRandomTile("");
	updateHud();
	saveSession();
}

async function playAgain() {
	await ads.interstitial("next", "2048-next");
	newGame();
}

function move(dir: Dir) {
	if (over || !overlayEl.classList.contains("hidden")) return;

	const [dr, dc] = VECTORS[dir];
	const before = snapshot();
	const rows = [...Array(size.n).keys()];
	const cols = [...Array(size.n).keys()];
	// walk from the leading edge inward, so the tiles nearest the wall settle first
	if (dr > 0) rows.reverse();
	if (dc > 0) cols.reverse();

	const mergedNow = new Set<Tile>();
	const consumed: { el: HTMLElement; r: number; c: number }[] = [];
	const born: Tile[] = [];
	let moved = false;
	let gained = 0;

	for (const r of rows) {
		for (const c of cols) {
			const tile = grid[r][c];
			if (!tile) continue;
			const { fr, fc, nr, nc } = slide(r, c, dr, dc);
			const partner = inBounds(nr, nc) ? grid[nr][nc] : null;
			// a tile born from a merge this move can't merge again
			if (partner && partner.value === tile.value && !mergedNow.has(partner)) {
				const merged: Tile = { id: nextId++, value: tile.value * 2, r: nr, c: nc };
				grid[r][c] = null;
				grid[nr][nc] = merged;
				mergedNow.add(merged);
				born.push(merged);
				gained += merged.value;
				moved = true;
				// both sources slide into the merge cell and are dropped there
				for (const src of [partner, tile]) {
					const el = tileEls.get(src.id);
					if (el) consumed.push({ el, r: nr, c: nc });
					tileEls.delete(src.id);
				}
			} else if (fr !== r || fc !== c) {
				grid[r][c] = null;
				grid[fr][fc] = tile;
				tile.r = fr;
				tile.c = fc;
				moved = true;
			}
		}
	}

	if (!moved) return;

	// survivors first — tiles born this move have no element yet and are skipped
	for (const t of allTiles()) {
		const el = tileEls.get(t.id);
		if (el) setPos(el, t.r, t.c);
	}
	for (const { el, r, c } of consumed) {
		el.classList.add("consumed");
		setPos(el, r, c);
		window.setTimeout(() => el.remove(), MOVE_MS + 60);
	}
	for (const t of born) createTileEl(t, "tile-merged");

	score += gained;
	undoState = before;
	addRandomTile();
	play(gained > 0 ? "merge" : "move");
	showGain(gained);

	const best = progress.best[size.key] ?? 0;
	if (score > best) progress.best[size.key] = score;

	if (born.some((t) => t.value >= TARGET) && !celebrated) {
		celebrated = true;
		play("win");
		showOverlay(
			"2048!",
			`${score.toLocaleString()} points. Keep going for a bigger tile?`,
			true
		);
	} else if (!hasMoves()) {
		over = true;
		play("gameover");
		const isRecord = score > best;
		showOverlay(
			"No moves left",
			`${score.toLocaleString()} points · best tile ${topTile().toLocaleString()}${isRecord ? " · New best!" : ""}`,
			false
		);
	}

	updateHud();
	saveSession();
}

function undo() {
	if (!undoState) return;
	restore(undoState);
	undoState = null;
	hideOverlay();
	updateHud();
	saveSession();
}

// --- input ---
const KEYS: Record<string, Dir> = {
	arrowup: "up",
	arrowdown: "down",
	arrowleft: "left",
	arrowright: "right",
	w: "up",
	s: "down",
	a: "left",
	d: "right",
};

document.addEventListener("keydown", (e) => {
	if (e.ctrlKey || e.metaKey || e.altKey) return;
	const key = e.key.toLowerCase();
	const dir = KEYS[key];
	if (dir) {
		e.preventDefault();
		move(dir);
		return;
	}
	if (!overlayEl.classList.contains("hidden") && (e.key === "Enter" || e.key === " ")) {
		e.preventDefault();
		if (over) void playAgain();
		else hideOverlay();
	} else if (key === "r") {
		newGame();
	} else if (key === "u") {
		undo();
	}
});

let swipeStart: { x: number; y: number } | null = null;

boardEl.addEventListener("pointerdown", (e) => {
	if (e.pointerType === "mouse") return;
	try {
		boardEl.setPointerCapture(e.pointerId);
	} catch {
		// a pointer that is already gone has nothing to capture
	}
	swipeStart = { x: e.clientX, y: e.clientY };
});

boardEl.addEventListener("pointerup", (e) => {
	if (!swipeStart) return;
	const dx = e.clientX - swipeStart.x;
	const dy = e.clientY - swipeStart.y;
	swipeStart = null;
	// short flicks are taps, not swipes
	if (Math.max(Math.abs(dx), Math.abs(dy)) < 20) return;
	move(Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? "right" : "left") : dy > 0 ? "down" : "up");
});

boardEl.addEventListener("pointercancel", () => {
	swipeStart = null;
});

newBtn.addEventListener("click", () => newGame());
againBtn.addEventListener("click", () => void playAgain());
undoBtn.addEventListener("click", () => undo());
continueBtn.addEventListener("click", () => hideOverlay());

soundBtn.addEventListener("click", () => {
	progress.settings.sound = !progress.settings.sound;
	saveProgress();
	updateSoundBtn();
});

sizeSelectEl.addEventListener("change", () => {
	const next = SIZES.find((s) => s.key === sizeSelectEl.value);
	if (next) newGame(next);
});

// --- init ---
function init() {
	sizeSelectEl.innerHTML = SIZES.map((s) => `<option value="${s.key}">${s.label}</option>`).join("");
	updateSoundBtn();

	const saved = SIZES.find((s) => s.key === progress.current) ?? SIZES[0];
	const session = progress.session;
	if (session && session.size === saved.key && session.tiles.length > 0) {
		size = saved;
		sizeSelectEl.value = size.key;
		renderCells();
		restore(session);
		if (over) {
			showOverlay(
				"No moves left",
				`${score.toLocaleString()} points · best tile ${topTile().toLocaleString()}`,
				false
			);
		}
	} else {
		newGame(saved);
	}
}

init();
