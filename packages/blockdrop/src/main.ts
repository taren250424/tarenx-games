import "../../shared/ads/ad-slot.css";
import "../../shared/theme/base.css";
import "./style.css";
import { createSfx } from "../../shared/audio/sfx.ts";
import { mountIcons, setSoundIcon } from "../../shared/ui/icons.ts";
import { markPlayed } from "../../shared/progress/recent.ts";
import { ads } from "../../shared/ads/ads.ts";

mountIcons();
markPlayed();

// --- constants ---
const COLS = 10;
const ROWS = 20;
const HIDDEN = 2; // spawn rows above the visible field
const TOTAL_ROWS = ROWS + HIDDEN;
const STORAGE_KEY = "tarenx.blockdrop.highscore";
const SOUND_KEY = "tarenx.blockdrop.sound";

type PieceType = "I" | "O" | "T" | "S" | "Z" | "J" | "L";

// flat, mid-weight hues that hold their own on the white well
const COLORS: Record<PieceType, string> = {
	I: "#0ea5e9",
	O: "#f59e0b",
	T: "#8b5cf6",
	S: "#22c55e",
	Z: "#ef4444",
	J: "#3b82f6",
	L: "#f97316",
};

// the well's own colours live in style.css with the rest of the page
const cssVar = (name: string) =>
	getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const WELL = cssVar("--board");
const GRID_LINE = cssVar("--grid-line");
const GHOST = cssVar("--ghost");

const SHAPES: Record<PieceType, number[][]> = {
	I: [
		[0, 0, 0, 0],
		[1, 1, 1, 1],
		[0, 0, 0, 0],
		[0, 0, 0, 0],
	],
	O: [
		[1, 1],
		[1, 1],
	],
	T: [
		[0, 1, 0],
		[1, 1, 1],
		[0, 0, 0],
	],
	S: [
		[0, 1, 1],
		[1, 1, 0],
		[0, 0, 0],
	],
	Z: [
		[1, 1, 0],
		[0, 1, 1],
		[0, 0, 0],
	],
	J: [
		[1, 0, 0],
		[1, 1, 1],
		[0, 0, 0],
	],
	L: [
		[0, 0, 1],
		[1, 1, 1],
		[0, 0, 0],
	],
};

const LINE_SCORES = [0, 100, 300, 500, 800];
const KICKS = [0, -1, 1, -2, 2];

interface Piece {
	type: PieceType;
	matrix: number[][];
	row: number;
	col: number;
}

// --- state ---
let board: (PieceType | null)[][] = [];
let current: Piece | null = null;
let queue: PieceType[] = [];
let bag: PieceType[] = [];
let hold: PieceType | null = null;
let canHold = true;
let score = 0;
let lines = 0;
let level = 1;
let highScore = Number(localStorage.getItem(STORAGE_KEY) ?? 0);
let running = false;
let paused = false;
let dropTimer = 0;
let lastTime = 0;

// --- elements ---
const canvas = document.getElementById("game") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const nextCanvas = document.getElementById("next") as HTMLCanvasElement;
const nextCtx = nextCanvas.getContext("2d")!;
const holdCanvas = document.getElementById("hold") as HTMLCanvasElement;
const holdCtx = holdCanvas.getContext("2d")!;
const scoreEl = document.getElementById("score") as HTMLElement;
const linesEl = document.getElementById("lines") as HTMLElement;
const levelEl = document.getElementById("level") as HTMLElement;
const highEl = document.getElementById("high") as HTMLElement;
const overlayEl = document.getElementById("overlay") as HTMLElement;
const overlayTitleEl = document.getElementById("overlay-title") as HTMLElement;
const overlayTextEl = document.getElementById("overlay-text") as HTMLElement;
const soundBtn = document.getElementById("sound-btn") as HTMLButtonElement;

// --- audio ---
let soundOn = localStorage.getItem(SOUND_KEY) !== "0";
const play = createSfx(["drop", "clear", "levelup", "gameover"] as const, () => soundOn);
ads.init({ sound: () => soundOn });

function updateSoundBtn() {
	setSoundIcon(soundBtn, soundOn);
}

soundBtn.addEventListener("click", () => {
	soundOn = !soundOn;
	localStorage.setItem(SOUND_KEY, soundOn ? "1" : "0");
	updateSoundBtn();
});

const CELL = 30;
const PREVIEW_CELL = 18;

function setupCanvas(c: HTMLCanvasElement, w: number, h: number) {
	const dpr = window.devicePixelRatio || 1;
	c.width = w * dpr;
	c.height = h * dpr;
	c.getContext("2d")!.setTransform(dpr, 0, 0, dpr, 0, 0);
}

setupCanvas(canvas, COLS * CELL, ROWS * CELL);
setupCanvas(nextCanvas, 5 * PREVIEW_CELL, 12 * PREVIEW_CELL);
setupCanvas(holdCanvas, 5 * PREVIEW_CELL, 4 * PREVIEW_CELL);

// --- helpers ---
function emptyBoard(): (PieceType | null)[][] {
	return Array.from({ length: TOTAL_ROWS }, () => Array(COLS).fill(null));
}

function refillBag(): PieceType[] {
	const types: PieceType[] = ["I", "O", "T", "S", "Z", "J", "L"];
	for (let i = types.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[types[i], types[j]] = [types[j], types[i]];
	}
	return types;
}

function drawFromBag(): PieceType {
	if (bag.length === 0) bag = refillBag();
	return bag.pop()!;
}

function spawnPiece(type?: PieceType): Piece {
	if (!type && queue.length === 0) queue.push(drawFromBag());
	const t = type ?? queue.shift()!;
	while (queue.length < 3) queue.push(drawFromBag());
	const matrix = SHAPES[t].map((row) => [...row]);
	return {
		type: t,
		matrix,
		row: 0,
		col: Math.floor((COLS - matrix[0].length) / 2),
	};
}

function collides(matrix: number[][], row: number, col: number): boolean {
	for (let r = 0; r < matrix.length; r++) {
		for (let c = 0; c < matrix[r].length; c++) {
			if (!matrix[r][c]) continue;
			const br = row + r;
			const bc = col + c;
			if (bc < 0 || bc >= COLS || br >= TOTAL_ROWS) return true;
			if (br >= 0 && board[br][bc]) return true;
		}
	}
	return false;
}

function rotateMatrix(matrix: number[][]): number[][] {
	const n = matrix.length;
	return Array.from({ length: n }, (_, r) =>
		Array.from({ length: n }, (_, c) => matrix[n - 1 - c][r])
	);
}

function dropInterval(): number {
	return Math.max(70, 820 * Math.pow(0.82, level - 1));
}

// --- actions ---
function tryMove(dr: number, dc: number): boolean {
	if (!current) return false;
	if (!collides(current.matrix, current.row + dr, current.col + dc)) {
		current.row += dr;
		current.col += dc;
		return true;
	}
	return false;
}

function rotate() {
	if (!current || current.type === "O") return;
	const rotated = rotateMatrix(current.matrix);
	for (const kick of KICKS) {
		if (!collides(rotated, current.row, current.col + kick)) {
			current.matrix = rotated;
			current.col += kick;
			return;
		}
	}
}

function softDrop() {
	if (tryMove(1, 0)) {
		score += 1;
		dropTimer = 0;
	}
}

function hardDrop() {
	if (!current) return;
	let dist = 0;
	while (tryMove(1, 0)) dist++;
	score += dist * 2;
	play("drop");
	lockPiece();
}

function holdPiece() {
	if (!current || !canHold) return;
	const held = hold;
	hold = current.type;
	current = held ? spawnPiece(held) : spawnPiece();
	canHold = false;
	dropTimer = 0;
}

function ghostRow(): number {
	if (!current) return 0;
	let row = current.row;
	while (!collides(current.matrix, row + 1, current.col)) row++;
	return row;
}

function lockPiece() {
	if (!current) return;
	const { matrix, row, col, type } = current;
	for (let r = 0; r < matrix.length; r++) {
		for (let c = 0; c < matrix[r].length; c++) {
			if (matrix[r][c] && row + r >= 0) {
				board[row + r][col + c] = type;
			}
		}
	}

	// clear lines
	let cleared = 0;
	for (let r = TOTAL_ROWS - 1; r >= 0; r--) {
		if (board[r].every((cell) => cell !== null)) {
			board.splice(r, 1);
			board.unshift(Array(COLS).fill(null));
			cleared++;
			r++; // recheck same row index
		}
	}
	if (cleared > 0) {
		score += LINE_SCORES[cleared] * level;
		lines += cleared;
		const newLevel = Math.floor(lines / 10) + 1;
		play(newLevel > level ? "levelup" : "clear");
		level = newLevel;
	}

	canHold = true;
	current = spawnPiece();
	dropTimer = 0;

	if (collides(current.matrix, current.row, current.col)) {
		endGame();
	}
}

function endGame() {
	running = false;
	play("gameover");
	if (score > highScore) {
		highScore = score;
		localStorage.setItem(STORAGE_KEY, String(highScore));
	}
	showOverlay("Game Over", `Score ${score.toLocaleString()} — press R or tap to play again`);
	draw();
}

function newGame() {
	board = emptyBoard();
	bag = refillBag();
	queue = [];
	current = spawnPiece();
	hold = null;
	canHold = true;
	score = 0;
	lines = 0;
	level = 1;
	dropTimer = 0;
	lastTime = 0;
	paused = false;
	running = true;
	hideOverlay();
	requestAnimationFrame(loop);
}

function togglePause() {
	if (!running && !paused) return;
	paused = !paused;
	if (paused) {
		running = false;
		showOverlay("Paused", "Tap or press P to resume");
	} else {
		running = true;
		lastTime = 0;
		hideOverlay();
		requestAnimationFrame(loop);
	}
}

function showOverlay(title: string, text: string) {
	overlayTitleEl.textContent = title;
	overlayTextEl.textContent = text;
	overlayEl.classList.remove("hidden");
}

function hideOverlay() {
	overlayEl.classList.add("hidden");
}

// --- game loop ---
function loop(time: number) {
	if (!running) return;
	if (lastTime === 0) lastTime = time;
	const delta = time - lastTime;
	lastTime = time;
	dropTimer += delta;

	if (dropTimer >= dropInterval()) {
		dropTimer = 0;
		if (!tryMove(1, 0)) {
			lockPiece();
		}
	}

	draw();
	requestAnimationFrame(loop);
}

// --- rendering ---
function drawCell(
	context: CanvasRenderingContext2D,
	x: number,
	y: number,
	size: number,
	color: string,
	ghost = false
) {
	if (ghost) {
		context.strokeStyle = color;
		context.lineWidth = 2;
		context.strokeRect(x + 2, y + 2, size - 4, size - 4);
		return;
	}
	context.fillStyle = color;
	context.fillRect(x + 1, y + 1, size - 2, size - 2);
}

function draw() {
	ctx.fillStyle = WELL;
	ctx.fillRect(0, 0, COLS * CELL, ROWS * CELL);

	// grid
	ctx.strokeStyle = GRID_LINE;
	ctx.lineWidth = 1;
	for (let c = 1; c < COLS; c++) {
		ctx.beginPath();
		ctx.moveTo(c * CELL, 0);
		ctx.lineTo(c * CELL, ROWS * CELL);
		ctx.stroke();
	}
	for (let r = 1; r < ROWS; r++) {
		ctx.beginPath();
		ctx.moveTo(0, r * CELL);
		ctx.lineTo(COLS * CELL, r * CELL);
		ctx.stroke();
	}

	// stack
	for (let r = HIDDEN; r < TOTAL_ROWS; r++) {
		for (let c = 0; c < COLS; c++) {
			const cell = board[r][c];
			if (cell) {
				drawCell(ctx, c * CELL, (r - HIDDEN) * CELL, CELL, COLORS[cell]);
			}
		}
	}

	if (current) {
		// ghost — training wheels off from level 5
		if (level < 5) {
			const gr = ghostRow();
			for (let r = 0; r < current.matrix.length; r++) {
				for (let c = 0; c < current.matrix[r].length; c++) {
					if (current.matrix[r][c] && gr + r >= HIDDEN) {
						drawCell(
							ctx,
							(current.col + c) * CELL,
							(gr + r - HIDDEN) * CELL,
							CELL,
							GHOST,
							true
						);
					}
				}
			}
		}
		// piece
		for (let r = 0; r < current.matrix.length; r++) {
			for (let c = 0; c < current.matrix[r].length; c++) {
				if (current.matrix[r][c] && current.row + r >= HIDDEN) {
					drawCell(
						ctx,
						(current.col + c) * CELL,
						(current.row + r - HIDDEN) * CELL,
						CELL,
						COLORS[current.type]
					);
				}
			}
		}
	}

	drawPreviews();

	scoreEl.textContent = score.toLocaleString();
	linesEl.textContent = String(lines);
	levelEl.textContent = String(level);
	highEl.textContent = highScore.toLocaleString();
}

function drawMini(
	context: CanvasRenderingContext2D,
	type: PieceType,
	offsetY: number
) {
	const shape = SHAPES[type];
	const size = shape.length;
	const offsetX = ((5 - size) * PREVIEW_CELL) / 2;
	for (let r = 0; r < size; r++) {
		for (let c = 0; c < shape[r].length; c++) {
			if (shape[r][c]) {
				drawCell(
					context,
					offsetX + c * PREVIEW_CELL,
					offsetY + r * PREVIEW_CELL,
					PREVIEW_CELL,
					COLORS[type]
				);
			}
		}
	}
}

function drawPreviews() {
	nextCtx.clearRect(0, 0, 5 * PREVIEW_CELL, 12 * PREVIEW_CELL);
	queue.slice(0, 3).forEach((type, i) => {
		drawMini(nextCtx, type, i * 4 * PREVIEW_CELL + PREVIEW_CELL / 2);
	});

	holdCtx.clearRect(0, 0, 5 * PREVIEW_CELL, 4 * PREVIEW_CELL);
	if (hold) drawMini(holdCtx, hold, PREVIEW_CELL / 2);
}

// --- input ---
document.addEventListener("keydown", (e) => {
	if (e.key === "p" || e.key === "P") {
		togglePause();
		return;
	}
	if (e.key === "r" || e.key === "R") {
		newGame();
		return;
	}
	if (!running) {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			if (!paused) void playAgain();
		}
		return;
	}
	switch (e.key) {
		case "ArrowLeft":
			e.preventDefault();
			tryMove(0, -1);
			break;
		case "ArrowRight":
			e.preventDefault();
			tryMove(0, 1);
			break;
		case "ArrowDown":
			e.preventDefault();
			softDrop();
			break;
		case "ArrowUp":
		case "x":
			e.preventDefault();
			rotate();
			break;
		case " ":
			e.preventDefault();
			hardDrop();
			break;
		case "c":
		case "Shift":
			holdPiece();
			break;
	}
});

// touch buttons
const touchActions: Record<string, () => void> = {
	left: () => tryMove(0, -1),
	right: () => tryMove(0, 1),
	rotate: () => rotate(),
	drop: () => hardDrop(),
	hold: () => holdPiece(),
};

for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-action]")) {
	btn.addEventListener("click", () => {
		const action = btn.dataset.action!;
		if (action === "pause") {
			togglePause();
			return;
		}
		if (!running) {
			if (!paused && action !== "hold") void playAgain();
			return;
		}
		touchActions[action]?.();
	});
}

// gestures on the well: drag sideways to move a cell at a time, drag down to
// soft-drop, tap to rotate, flick down to hard-drop, swipe up to hold
let gesture: { x: number; y: number; at: number; cols: number; rows: number } | null = null;

canvas.addEventListener("pointerdown", (e) => {
	if (!running || paused || e.pointerType === "mouse") return;
	try {
		canvas.setPointerCapture(e.pointerId);
	} catch {
		// a pointer that is already gone, or a synthetic one, has nothing to capture
	}
	gesture = { x: e.clientX, y: e.clientY, at: performance.now(), cols: 0, rows: 0 };
});

canvas.addEventListener("pointermove", (e) => {
	if (!gesture) return;
	const cell = canvas.getBoundingClientRect().width / COLS;
	const cols = Math.trunc((e.clientX - gesture.x) / cell);
	while (gesture.cols < cols) {
		tryMove(0, 1);
		gesture.cols++;
	}
	while (gesture.cols > cols) {
		tryMove(0, -1);
		gesture.cols--;
	}
	const rows = Math.trunc((e.clientY - gesture.y) / cell);
	while (gesture.rows < rows) {
		softDrop();
		gesture.rows++;
	}
});

canvas.addEventListener("pointerup", (e) => {
	if (!gesture) return;
	const dx = e.clientX - gesture.x;
	const dy = e.clientY - gesture.y;
	const dt = performance.now() - gesture.at;
	const moved = gesture.cols !== 0 || gesture.rows !== 0;
	if (!moved && dt < 300 && Math.abs(dx) < 10 && Math.abs(dy) < 10) rotate();
	else if (dy > 50 && dt < 250 && dy > Math.abs(dx) * 2) hardDrop();
	else if (dy < -40 && -dy > Math.abs(dx) * 2 && !moved) holdPiece();
	gesture = null;
});

canvas.addEventListener("pointercancel", () => {
	gesture = null;
});

async function playAgain() {
	await ads.interstitial("next", "blockdrop-next");
	newGame();
}

overlayEl.addEventListener("click", () => {
	if (paused) {
		togglePause();
	} else if (!running) {
		void playAgain();
	}
});

// --- init ---
board = emptyBoard();
highEl.textContent = highScore.toLocaleString();
updateSoundBtn();
showOverlay("Block Drop", "Press Enter or tap to start");
draw();
