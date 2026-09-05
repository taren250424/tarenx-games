import "../../shared/ads/ad-slot.css";
import "../../shared/theme/base.css";
import "./style.css";
import { createSfx } from "../../shared/audio/sfx.ts";
import { icon, mountIcons, setSoundIcon } from "../../shared/ui/icons.ts";
import { markPlayed } from "../../shared/progress/recent.ts";
import { ads } from "../../shared/ads/ads.ts";

mountIcons();
markPlayed();

interface Difficulty {
	key: string;
	label: string;
	cols: number;
	rows: number;
	mines: number;
}

interface Progress {
	current: string; // difficulty key
	best: Record<string, number>; // difficulty key -> best time in seconds
	settings: { sound: boolean };
}

const DIFFICULTIES: Difficulty[] = [
	{ key: "beginner", label: "Beginner · 9×9 · 10 mines", cols: 9, rows: 9, mines: 10 },
	{ key: "intermediate", label: "Intermediate · 16×16 · 40 mines", cols: 16, rows: 16, mines: 40 },
	{ key: "expert", label: "Expert · 30×16 · 99 mines", cols: 30, rows: 16, mines: 99 },
];

const STORAGE_KEY = "tarenx.minesweeper.progress";

// --- state ---
let difficulty = DIFFICULTIES[0];
let mines = new Set<number>();
let revealed = new Set<number>();
let flagged = new Set<number>();
let counts: number[] = [];
let started = false; // mines are placed on the first reveal, never under it
let alive = true;
let won = false;
let seconds = 0;
let timerId = 0;
let flagMode = false;

// --- elements ---
const boardEl = document.getElementById("board") as HTMLElement;
const difficultySelectEl = document.getElementById("difficulty-select") as HTMLSelectElement;
const newBtn = document.getElementById("new-btn") as HTMLButtonElement;
const flagBtn = document.getElementById("flag-btn") as HTMLButtonElement;
const soundBtn = document.getElementById("sound-btn") as HTMLButtonElement;
const minesEl = document.getElementById("mines") as HTMLElement;
const timeEl = document.getElementById("time") as HTMLElement;
const bestEl = document.getElementById("best") as HTMLElement;
const overlayEl = document.getElementById("end-overlay") as HTMLElement;
const endTitleEl = document.getElementById("end-title") as HTMLElement;
const endStatsEl = document.getElementById("end-stats") as HTMLElement;
const againBtn = document.getElementById("again-btn") as HTMLButtonElement;

// --- persistence ---
function loadProgress(): Progress {
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<Progress>;
			if (parsed.best !== null && typeof parsed.best === "object") {
				return {
					current: typeof parsed.current === "string" ? parsed.current : "beginner",
					best: parsed.best,
					settings: { sound: parsed.settings?.sound ?? true },
				};
			}
		}
	} catch {
		// corrupted storage — start fresh
	}
	return { current: "beginner", best: {}, settings: { sound: true } };
}

function saveProgress(progress: Progress) {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
	} catch {
		// storage full or blocked — keep playing with in-memory progress
	}
}

const progress = loadProgress();
ads.init({ sound: () => progress.settings.sound });

// --- audio ---
const play = createSfx(["reveal", "flag", "boom", "win"] as const, () => progress.settings.sound);

function updateSoundBtn() {
	setSoundIcon(soundBtn, progress.settings.sound);
}

soundBtn.addEventListener("click", () => {
	progress.settings.sound = !progress.settings.sound;
	saveProgress(progress);
	updateSoundBtn();
});

// --- helpers ---
function neighbors(i: number): number[] {
	const r = Math.floor(i / difficulty.cols);
	const c = i % difficulty.cols;
	const out: number[] = [];
	for (let dr = -1; dr <= 1; dr++) {
		for (let dc = -1; dc <= 1; dc++) {
			if (dr === 0 && dc === 0) continue;
			const nr = r + dr;
			const nc = c + dc;
			if (nr >= 0 && nr < difficulty.rows && nc >= 0 && nc < difficulty.cols) {
				out.push(nr * difficulty.cols + nc);
			}
		}
	}
	return out;
}

function totalCells(): number {
	return difficulty.cols * difficulty.rows;
}

function formatTime(s: number): string {
	return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

function stopTimer() {
	clearInterval(timerId);
	timerId = 0;
}

function startTimer() {
	stopTimer();
	timerId = window.setInterval(() => {
		seconds++;
		updateHud();
	}, 1000);
}

// --- game ---
function newGame(d: Difficulty = difficulty) {
	difficulty = d;
	mines = new Set();
	revealed = new Set();
	flagged = new Set();
	counts = Array(totalCells()).fill(0);
	started = false;
	alive = true;
	won = false;
	seconds = 0;
	stopTimer();
	progress.current = d.key;
	saveProgress(progress);
	difficultySelectEl.value = d.key;
	boardEl.dataset.size = d.key;
	overlayEl.classList.add("hidden");
	render();
}

// Mines go anywhere except the first-clicked cell and its neighbors,
// so the first click always opens an area.
function placeMines(safe: number) {
	const forbidden = new Set([safe, ...neighbors(safe)]);
	const pool: number[] = [];
	for (let i = 0; i < totalCells(); i++) {
		if (!forbidden.has(i)) pool.push(i);
	}
	for (let k = 0; k < difficulty.mines; k++) {
		const j = k + Math.floor(Math.random() * (pool.length - k));
		[pool[k], pool[j]] = [pool[j], pool[k]];
		mines.add(pool[k]);
	}
	for (let i = 0; i < totalCells(); i++) {
		counts[i] = neighbors(i).filter((n) => mines.has(n)).length;
	}
}

function floodReveal(start: number) {
	const stack = [start];
	while (stack.length) {
		const p = stack.pop()!;
		if (revealed.has(p) || flagged.has(p)) continue;
		revealed.add(p);
		// zero cells never touch a mine, so their whole neighborhood is safe
		if (counts[p] === 0) {
			for (const n of neighbors(p)) {
				if (!revealed.has(n)) stack.push(n);
			}
		}
	}
}

function openCell(i: number): boolean {
	if (!started) {
		placeMines(i);
		started = true;
		startTimer();
	}
	if (mines.has(i)) {
		lose(i);
		return false;
	}
	floodReveal(i);
	return true;
}

function handleReveal(i: number) {
	if (!alive || won) return;
	if (revealed.has(i)) {
		chord(i);
		return;
	}
	if (flagged.has(i)) return;
	if (openCell(i)) {
		play("reveal");
		checkWin();
	}
}

// Clicking an open number with the right amount of flags around it
// opens the remaining neighbors.
function chord(i: number) {
	const n = counts[i];
	if (n === 0) return;
	const around = neighbors(i);
	if (around.filter((p) => flagged.has(p)).length !== n) return;
	const targets = around.filter((p) => !flagged.has(p) && !revealed.has(p));
	if (targets.length === 0) return;
	for (const t of targets) {
		if (!openCell(t)) return;
	}
	play("reveal");
	checkWin();
}

function toggleFlag(i: number) {
	if (!alive || won || revealed.has(i)) return;
	if (flagged.has(i)) {
		flagged.delete(i);
	} else {
		flagged.add(i);
	}
	play("flag");
	render();
}

function lose(i: number) {
	alive = false;
	revealed.add(i); // the hit mine renders as the exploded cell
	stopTimer();
	play("boom");
	endTitleEl.textContent = "Boom!";
	endStatsEl.textContent = `Survived ${formatTime(seconds)} — better luck next field`;
	againBtn.textContent = "Try Again";
	overlayEl.classList.remove("hidden");
	render();
}

function checkWin() {
	if (revealed.size !== totalCells() - mines.size) {
		render();
		return;
	}
	won = true;
	stopTimer();
	for (const m of mines) flagged.add(m); // auto-flag what's left
	play("win");
	const best = progress.best[difficulty.key];
	const isRecord = best === undefined || seconds < best;
	if (isRecord) {
		progress.best[difficulty.key] = seconds;
		saveProgress(progress);
	}
	endTitleEl.textContent = "Field Cleared!";
	endStatsEl.textContent = `${formatTime(seconds)}${isRecord ? " · New best!" : ""}`;
	againBtn.textContent = "Play Again";
	overlayEl.classList.remove("hidden");
	render();
}

// --- rendering ---
function render() {
	boardEl.style.gridTemplateColumns = `repeat(${difficulty.cols}, var(--tile))`;
	const tiles: string[] = [];
	for (let i = 0; i < totalCells(); i++) {
		let cls = "cell";
		let content = "";
		if (revealed.has(i)) {
			cls += " open";
			if (mines.has(i)) {
				cls += " exploded";
				content = icon("mine");
			} else if (counts[i] > 0) {
				cls += ` n${counts[i]}`;
				content = String(counts[i]);
			}
		} else if (flagged.has(i)) {
			if (!alive && !mines.has(i)) {
				cls += " wrong";
				content = icon("cross");
			} else {
				cls += " flag";
				content = icon("flag");
			}
		} else if (!alive && mines.has(i)) {
			cls += " open";
			content = icon("mine");
		}
		tiles.push(`<div class="${cls}" data-i="${i}">${content}</div>`);
	}
	boardEl.innerHTML = tiles.join("");
	updateHud();
}

function updateHud() {
	minesEl.textContent = String(difficulty.mines - flagged.size);
	timeEl.textContent = formatTime(seconds);
	const best = progress.best[difficulty.key];
	bestEl.textContent = best === undefined ? "—" : formatTime(best);
}

function updateFlagBtn() {
	flagBtn.setAttribute("aria-pressed", String(flagMode));
}

// --- input ---
function cellIndex(e: Event): number | null {
	const cell = (e.target as HTMLElement).closest<HTMLElement>("[data-i]");
	return cell ? Number(cell.dataset.i) : null;
}

boardEl.addEventListener("click", (e) => {
	const i = cellIndex(e);
	if (i === null) return;
	if (flagMode && !revealed.has(i)) {
		toggleFlag(i);
	} else {
		handleReveal(i);
	}
});

boardEl.addEventListener("contextmenu", (e) => {
	e.preventDefault();
	const i = cellIndex(e);
	if (i !== null) toggleFlag(i);
});

document.addEventListener("keydown", (e) => {
	if (!overlayEl.classList.contains("hidden") && (e.key === "Enter" || e.key === " ")) {
		e.preventDefault();
		void playAgain();
		return;
	}
	if (e.key === "r" || e.key === "R") {
		newGame();
	} else if (e.key === "f" || e.key === "F") {
		flagMode = !flagMode;
		updateFlagBtn();
	}
});

async function playAgain() {
	await ads.interstitial("next", "minesweeper-next");
	newGame();
}

newBtn.addEventListener("click", () => newGame());
againBtn.addEventListener("click", () => void playAgain());

flagBtn.addEventListener("click", () => {
	flagMode = !flagMode;
	updateFlagBtn();
});

difficultySelectEl.addEventListener("change", () => {
	const d = DIFFICULTIES.find((x) => x.key === difficultySelectEl.value);
	if (d) newGame(d);
});

// --- init ---
function init() {
	difficultySelectEl.innerHTML = DIFFICULTIES.map(
		(d) => `<option value="${d.key}">${d.label}</option>`
	).join("");
	updateSoundBtn();
	updateFlagBtn();
	const saved = DIFFICULTIES.find((d) => d.key === progress.current) ?? DIFFICULTIES[0];
	newGame(saved);
}

init();
