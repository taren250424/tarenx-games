import "../../shared/ads/ad-slot.css";
import "../../shared/theme/base.css";
import "./style.css";
import { createSfx } from "../../shared/audio/sfx.ts";
import { mountIcons, setSoundIcon } from "../../shared/ui/icons.ts";
import { markPlayed } from "../../shared/progress/recent.ts";
import { ads } from "../../shared/ads/ads.ts";
import { COLLECTIONS } from "./levels.ts";

mountIcons();
markPlayed();

type Dir = "up" | "down" | "left" | "right";

interface Snapshot {
	player: number;
	boxes: Set<number>;
	moves: number;
	pushes: number;
}

interface Progress {
	current: string; // "collectionIndex:levelIndex"
	best: Record<string, number>; // "collectionIndex:levelIndex" -> best moves
	settings: { sound: boolean };
}

const STORAGE_KEY = "tarenx.sokoban.progress";

const DIRS: Record<Dir, { dr: number; dc: number }> = {
	up: { dr: -1, dc: 0 },
	down: { dr: 1, dc: 0 },
	left: { dr: 0, dc: -1 },
	right: { dr: 0, dc: 1 },
};

// --- state ---
let colIndex = 0;
let levelIndex = 0;
let width = 0;
let height = 0;
let walls = new Set<number>();
let goals = new Set<number>();
let interior = new Set<number>();
let boxes = new Set<number>();
let player = 0;
let moves = 0;
let pushes = 0;
let history: Snapshot[] = [];
let won = false;

// --- elements ---
const boardEl = document.getElementById("board") as HTMLElement;
const levelSelectEl = document.getElementById("level-select") as HTMLSelectElement;
const movesEl = document.getElementById("moves") as HTMLElement;
const pushesEl = document.getElementById("pushes") as HTMLElement;
const bestEl = document.getElementById("best") as HTMLElement;
const overlayEl = document.getElementById("win-overlay") as HTMLElement;
const winStatsEl = document.getElementById("win-stats") as HTMLElement;
const nextBtn = document.getElementById("next-btn") as HTMLButtonElement;
const soundBtn = document.getElementById("sound-btn") as HTMLButtonElement;

function loadProgress(): Progress {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<Progress>;
			if (
				typeof parsed.current === "string" &&
				parsed.best !== null &&
				typeof parsed.best === "object"
			) {
				return {
					current: parsed.current,
					best: parsed.best,
					settings: { sound: parsed.settings?.sound ?? true },
				};
			}
		}
	} catch {
		// corrupted storage — start fresh
	}
	return { current: "0:0", best: {}, settings: { sound: true } };
}

function saveProgress(progress: Progress) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
	} catch {
		// storage full or blocked — keep playing with in-memory progress
	}
}

const progress = loadProgress();

// --- audio ---
const play = createSfx(["bump", "goal", "clear"] as const, () => progress.settings.sound);
ads.init({ sound: () => progress.settings.sound });

function updateSoundBtn() {
	setSoundIcon(soundBtn, progress.settings.sound);
}

soundBtn.addEventListener("click", () => {
	progress.settings.sound = !progress.settings.sound;
	saveProgress(progress);
	updateSoundBtn();
});

function idx(r: number, c: number): number {
	return r * width + c;
}

function levelKey(ci: number, li: number): string {
	return `${ci}:${li}`;
}

function loadLevel(ci: number, li: number) {
	colIndex = ci;
	levelIndex = li;
	const rows = COLLECTIONS[ci].levels[li].rows;
	height = rows.length;
	width = Math.max(...rows.map((r) => r.length));
	walls = new Set();
	goals = new Set();
	boxes = new Set();
	moves = 0;
	pushes = 0;
	history = [];
	won = false;

	for (let r = 0; r < height; r++) {
		for (let c = 0; c < width; c++) {
			const ch = rows[r][c] ?? " ";
			const p = idx(r, c);
			if (ch === "#") walls.add(p);
			if (ch === "." || ch === "*" || ch === "+") goals.add(p);
			if (ch === "$" || ch === "*") boxes.add(p);
			if (ch === "@" || ch === "+") player = p;
		}
	}

	// flood fill from player to find interior floor cells
	interior = new Set([player]);
	const stack = [player];
	while (stack.length) {
		const p = stack.pop()!;
		for (const d of [-width, width, -1, 1]) {
			const n = p + d;
			if (!interior.has(n) && !walls.has(n)) {
				interior.add(n);
				stack.push(n);
			}
		}
	}

	progress.current = levelKey(ci, li);
	saveProgress(progress);
	levelSelectEl.value = levelKey(ci, li);
	overlayEl.classList.add("hidden");
	render();
}

function render() {
	boardEl.style.gridTemplateColumns = `repeat(${width}, var(--tile))`;
	const tiles: string[] = [];
	for (let r = 0; r < height; r++) {
		for (let c = 0; c < width; c++) {
			const p = idx(r, c);
			let cls = "tile";
			if (walls.has(p)) {
				cls += " wall";
			} else if (interior.has(p)) {
				cls += " floor";
				if (goals.has(p)) cls += " goal";
				if (boxes.has(p)) cls += goals.has(p) ? " box on-goal" : " box";
				if (player === p) cls += " player";
			} else {
				cls += " void";
			}
			tiles.push(`<div class="${cls}"></div>`);
		}
	}
	boardEl.innerHTML = tiles.join("");

	movesEl.textContent = String(moves);
	pushesEl.textContent = String(pushes);
	const best = progress.best[levelKey(colIndex, levelIndex)];
	bestEl.textContent = best === undefined ? "—" : String(best);
}

function move(dir: Dir) {
	if (won) return;
	const { dr, dc } = DIRS[dir];
	const delta = dr * width + dc;
	const target = player + delta;
	if (walls.has(target)) {
		play("bump");
		return;
	}

	if (boxes.has(target)) {
		const beyond = target + delta;
		if (walls.has(beyond) || boxes.has(beyond)) {
			play("bump");
			return;
		}
		history.push({ player, boxes: new Set(boxes), moves, pushes });
		boxes.delete(target);
		boxes.add(beyond);
		if (goals.has(beyond)) play("goal");
		pushes++;
	} else {
		history.push({ player, boxes: new Set(boxes), moves, pushes });
	}
	player = target;
	moves++;
	render();
	checkWin();
}

function undo() {
	const snapshot = history.pop();
	if (!snapshot || won) return;
	player = snapshot.player;
	boxes = snapshot.boxes;
	moves = snapshot.moves;
	pushes = snapshot.pushes;
	render();
}

function restart() {
	loadLevel(colIndex, levelIndex);
}

function checkWin() {
	for (const b of boxes) {
		if (!goals.has(b)) return;
	}
	won = true;
	play("clear");
	const key = levelKey(colIndex, levelIndex);
	const best = progress.best[key];
	const isRecord = best === undefined || moves < best;
	if (isRecord) {
		progress.best[key] = moves;
		saveProgress(progress);
		buildLevelOptions();
		levelSelectEl.value = key;
	}
	winStatsEl.textContent = `${moves} moves · ${pushes} pushes${isRecord ? " · New best!" : ""}`;
	const [nc, nl] = nextPosition();
	const isWrap = nc === 0 && nl === 0 && !(colIndex === 0 && levelIndex === 0);
	nextBtn.textContent = isWrap
		? "Play Again from the Start"
		: nl === 0
			? `Start ${COLLECTIONS[nc].name} →`
			: "Next Level →";
	overlayEl.classList.remove("hidden");
	render();
}

function nextPosition(): [number, number] {
	if (levelIndex + 1 < COLLECTIONS[colIndex].levels.length) {
		return [colIndex, levelIndex + 1];
	}
	return [(colIndex + 1) % COLLECTIONS.length, 0];
}

async function nextLevel() {
	const [nc, nl] = nextPosition();
	await ads.interstitial("next", "sokoban-next");
	loadLevel(nc, nl);
}

// --- input ---
document.addEventListener("keydown", (e) => {
	const keyMap: Record<string, Dir> = {
		ArrowUp: "up",
		ArrowDown: "down",
		ArrowLeft: "left",
		ArrowRight: "right",
		w: "up",
		s: "down",
		a: "left",
		d: "right",
	};
	if (!overlayEl.classList.contains("hidden") && (e.key === "Enter" || e.key === " ")) {
		e.preventDefault();
		void nextLevel();
		return;
	}
	const dir = keyMap[e.key];
	if (dir) {
		e.preventDefault();
		move(dir);
	} else if (e.key === "z" || e.key === "u") {
		undo();
	} else if (e.key === "r") {
		restart();
	}
});

// touch swipe on board
let touchStartX = 0;
let touchStartY = 0;
boardEl.addEventListener(
	"touchstart",
	(e) => {
		touchStartX = e.touches[0].clientX;
		touchStartY = e.touches[0].clientY;
	},
	{ passive: true }
);
boardEl.addEventListener("touchend", (e) => {
	const dx = e.changedTouches[0].clientX - touchStartX;
	const dy = e.changedTouches[0].clientY - touchStartY;
	if (Math.max(Math.abs(dx), Math.abs(dy)) < 24) return;
	if (Math.abs(dx) > Math.abs(dy)) {
		move(dx > 0 ? "right" : "left");
	} else {
		move(dy > 0 ? "down" : "up");
	}
});

// buttons
(document.getElementById("undo-btn") as HTMLButtonElement).addEventListener("click", undo);
(document.getElementById("restart-btn") as HTMLButtonElement).addEventListener("click", restart);
nextBtn.addEventListener("click", () => void nextLevel());

for (const btn of document.querySelectorAll<HTMLButtonElement>("[data-dir]")) {
	btn.addEventListener("click", () => move(btn.dataset.dir as Dir));
}

levelSelectEl.addEventListener("change", () => {
	const [ci, li] = levelSelectEl.value.split(":").map(Number);
	loadLevel(ci, li);
});

// --- init ---
function buildLevelOptions() {
	levelSelectEl.innerHTML = COLLECTIONS.map((collection, ci) => {
		const options = collection.levels
			.map((level, li) => {
				const done = progress.best[levelKey(ci, li)] !== undefined ? " ✓" : "";
				return `<option value="${ci}:${li}">${li + 1}. ${level.name}${done}</option>`;
			})
			.join("");
		return `<optgroup label="${collection.name}">${options}</optgroup>`;
	}).join("");
}

function init() {
	buildLevelOptions();
	updateSoundBtn();
	let [ci, li] = (progress.current ?? "0:0").split(":").map(Number);
	if (!COLLECTIONS[ci]?.levels[li]) {
		ci = 0;
		li = 0;
	}
	loadLevel(ci, li);
}

init();
