import "../../shared/ads/ad-slot.css";
import "./style.css";
import { PUZZLES, type Difficulty } from "./puzzles.ts";

interface Snapshot {
	values: number[];
	notes: number[];
}

interface Session {
	key: string; // "difficulty:index"
	values: string; // 81 chars
	notes: number[]; // candidate bitmasks
	elapsed: number; // seconds
	hintsLeft: number;
}

interface Progress {
	current: string;
	best: Record<string, number>; // key -> best seconds
	session: Session | null;
	settings: { sound: boolean; mistakes: boolean };
}

const STORAGE_KEY = "tarenx.sudoku.progress";
const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const HINTS_PER_PUZZLE = 3;

// --- peers table ---
const PEERS: number[][] = Array.from({ length: 81 }, (_, i) => {
	const r = Math.floor(i / 9);
	const c = i % 9;
	const set = new Set<number>();
	for (let k = 0; k < 9; k++) {
		set.add(r * 9 + k);
		set.add(k * 9 + c);
	}
	const br = Math.floor(r / 3) * 3;
	const bc = Math.floor(c / 3) * 3;
	for (let dr = 0; dr < 3; dr++) {
		for (let dc = 0; dc < 3; dc++) {
			set.add((br + dr) * 9 + bc + dc);
		}
	}
	set.delete(i);
	return [...set];
});

// --- state ---
let difficulty: Difficulty = "easy";
let puzzleIndex = 0;
let givens: number[] = [];
let solution: number[] = [];
let values: number[] = [];
let notes: number[] = [];
let selected = -1;
let notesMode = false;
let hintsLeft = HINTS_PER_PUZZLE;
let elapsed = 0;
let history: Snapshot[] = [];
let won = false;

// --- elements ---
const boardEl = document.getElementById("board") as HTMLElement;
const puzzleSelectEl = document.getElementById("puzzle-select") as HTMLSelectElement;
const timeEl = document.getElementById("time") as HTMLElement;
const bestEl = document.getElementById("best") as HTMLElement;
const hintsEl = document.getElementById("hints") as HTMLElement;
const numpadEl = document.querySelector(".numpad") as HTMLElement;
const notesBtn = document.getElementById("notes-btn") as HTMLButtonElement;
const soundBtn = document.getElementById("sound-btn") as HTMLButtonElement;
const mistakesCheck = document.getElementById("mistakes-check") as HTMLInputElement;
const overlayEl = document.getElementById("win-overlay") as HTMLElement;
const winStatsEl = document.getElementById("win-stats") as HTMLElement;
const nextBtn = document.getElementById("next-btn") as HTMLButtonElement;

// --- audio ---
const SOUND_NAMES = ["select", "place", "erase", "error", "hint", "button", "win"] as const;
type SoundName = (typeof SOUND_NAMES)[number];
const sounds = Object.fromEntries(
	SOUND_NAMES.map((name) => [name, new Audio(`${import.meta.env.BASE_URL}audio/${name}.mp3`)])
) as Record<SoundName, HTMLAudioElement>;

function play(name: SoundName) {
	if (!progress.settings.sound) return;
	const audio = sounds[name];
	audio.currentTime = 0;
	audio.play().catch(() => {
		// autoplay blocked before first interaction — ignore
	});
}

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
		: {
				key: puzzleKey(),
				values: values.join(""),
				notes: [...notes],
				elapsed,
				hintsLeft,
			};
	saveProgress();
}

// --- solver (each shipped puzzle has a unique solution) ---
function solve(puzzle: number[]): number[] {
	const board = [...puzzle];
	const fill = (): boolean => {
		let best = -1;
		let bestMask = 0;
		let bestCount = 10;
		for (let i = 0; i < 81; i++) {
			if (board[i]) continue;
			let mask = 0x1ff;
			for (const p of PEERS[i]) {
				if (board[p]) mask &= ~(1 << (board[p] - 1));
			}
			let count = 0;
			for (let d = 0; d < 9; d++) if (mask & (1 << d)) count++;
			if (count === 0) return false;
			if (count < bestCount) {
				bestCount = count;
				best = i;
				bestMask = mask;
				if (count === 1) break;
			}
		}
		if (best === -1) return true;
		for (let d = 1; d <= 9; d++) {
			if (bestMask & (1 << (d - 1))) {
				board[best] = d;
				if (fill()) return true;
				board[best] = 0;
			}
		}
		return false;
	};
	fill();
	return board;
}

// --- puzzle lifecycle ---
function loadPuzzle(diff: Difficulty, index: number, session?: Session) {
	difficulty = diff;
	puzzleIndex = index;
	const str = PUZZLES[diff][index];
	givens = [...str].map(Number);
	solution = solve(givens);
	values = session ? [...session.values].map(Number) : [...givens];
	notes = session ? [...session.notes] : new Array(81).fill(0);
	elapsed = session ? session.elapsed : 0;
	hintsLeft = session ? session.hintsLeft : HINTS_PER_PUZZLE;
	selected = -1;
	history = [];
	won = false;

	progress.current = puzzleKey();
	saveSession();
	puzzleSelectEl.value = puzzleKey();
	overlayEl.classList.add("hidden");
	render();
}

function restart() {
	loadPuzzle(difficulty, puzzleIndex);
}

function nextPosition(): [Difficulty, number] {
	if (puzzleIndex + 1 < PUZZLES[difficulty].length) {
		return [difficulty, puzzleIndex + 1];
	}
	const di = (DIFFICULTIES.indexOf(difficulty) + 1) % DIFFICULTIES.length;
	return [DIFFICULTIES[di], 0];
}

// --- rendering ---
function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}:${String(s).padStart(2, "0")}`;
}

function conflictSet(): Set<number> {
	const conflicts = new Set<number>();
	for (let i = 0; i < 81; i++) {
		if (!values[i]) continue;
		for (const p of PEERS[i]) {
			if (values[p] === values[i]) {
				conflicts.add(i);
				conflicts.add(p);
			}
		}
	}
	return conflicts;
}

function render() {
	const conflicts = conflictSet();
	const selectedValue = selected >= 0 ? values[selected] : 0;
	const cells: string[] = [];
	for (let i = 0; i < 81; i++) {
		const r = Math.floor(i / 9);
		const c = i % 9;
		let cls = "cell";
		if (r % 3 === 0 && r !== 0) cls += " bt";
		if (c % 3 === 0 && c !== 0) cls += " bl";
		if (givens[i]) cls += " given";
		if (i === selected) cls += " selected";
		else if (selected >= 0 && PEERS[i].includes(selected)) cls += " peer";
		if (selectedValue && values[i] === selectedValue && i !== selected) cls += " same";
		if (conflicts.has(i)) cls += " conflict";
		if (
			progress.settings.mistakes &&
			!givens[i] &&
			values[i] &&
			values[i] !== solution[i]
		) {
			cls += " wrong";
		}

		let content = "";
		if (values[i]) {
			content = String(values[i]);
		} else if (notes[i]) {
			let marks = "";
			for (let d = 1; d <= 9; d++) {
				marks += `<span class="note">${notes[i] & (1 << (d - 1)) ? d : ""}</span>`;
			}
			content = `<span class="notes">${marks}</span>`;
		}
		cells.push(`<button class="${cls}" data-i="${i}">${content}</button>`);
	}
	boardEl.innerHTML = cells.join("");

	const counts = new Array(10).fill(0);
	for (const v of values) counts[v]++;
	numpadEl.innerHTML = Array.from({ length: 9 }, (_, k) => {
		const d = k + 1;
		const left = 9 - counts[d];
		return `<button data-digit="${d}" class="${left <= 0 ? "done" : ""}">
			<span class="digit">${d}</span><span class="count">${left > 0 ? left : ""}</span>
		</button>`;
	}).join("");

	timeEl.textContent = formatTime(elapsed);
	const best = progress.best[puzzleKey()];
	bestEl.textContent = best === undefined ? "—" : formatTime(best);
	hintsEl.textContent = String(hintsLeft);
	notesBtn.classList.toggle("active", notesMode);
	notesBtn.setAttribute("aria-pressed", String(notesMode));
	soundBtn.textContent = progress.settings.sound ? "🔊" : "🔇";
}

// --- actions ---
function pushHistory() {
	history.push({ values: [...values], notes: [...notes] });
}

function input(d: number) {
	if (won || selected < 0 || givens[selected]) return;
	if (notesMode) {
		if (values[selected]) return;
		pushHistory();
		notes[selected] ^= 1 << (d - 1);
		play("select");
	} else {
		if (values[selected] === d) return;
		pushHistory();
		values[selected] = d;
		notes[selected] = 0;
		// entering a digit clears it from the notes of every peer
		for (const p of PEERS[selected]) notes[p] &= ~(1 << (d - 1));
		const isWrong = progress.settings.mistakes && d !== solution[selected];
		play(isWrong ? "error" : "place");
	}
	saveSession();
	render();
	checkWin();
}

function erase() {
	if (won || selected < 0 || givens[selected]) return;
	if (!values[selected] && !notes[selected]) return;
	pushHistory();
	values[selected] = 0;
	notes[selected] = 0;
	play("erase");
	saveSession();
	render();
}

function undo() {
	const snapshot = history.pop();
	if (!snapshot || won) return;
	values = snapshot.values;
	notes = snapshot.notes;
	play("button");
	saveSession();
	render();
}

function hint() {
	if (won) return;
	if (hintsLeft <= 0) {
		play("error");
		return;
	}
	// fix the selected cell if it needs fixing, otherwise the first unsolved cell
	const target =
		selected >= 0 && !givens[selected] && values[selected] !== solution[selected]
			? selected
			: values.findIndex((v, i) => !givens[i] && v !== solution[i]);
	if (target < 0) return;
	pushHistory();
	values[target] = solution[target];
	notes[target] = 0;
	for (const p of PEERS[target]) notes[p] &= ~(1 << (solution[target] - 1));
	selected = target;
	hintsLeft--;
	play("hint");
	saveSession();
	render();
	checkWin();
}

function checkWin() {
	for (let i = 0; i < 81; i++) {
		if (values[i] !== solution[i]) return;
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
	const isWrap = nd === "easy" && ni === 0 && !(difficulty === "easy" && puzzleIndex === 0);
	nextBtn.textContent = isWrap
		? "Play Again from the Start"
		: ni === 0
			? `Start ${label(nd)} →`
			: "Next Puzzle →";
	overlayEl.classList.remove("hidden");
	play("win");
	render();
}

function nextPuzzle() {
	const [nd, ni] = nextPosition();
	loadPuzzle(nd, ni);
}

function moveSelection(dr: number, dc: number) {
	if (selected < 0) {
		selected = 0;
	} else {
		const r = Math.min(8, Math.max(0, Math.floor(selected / 9) + dr));
		const c = Math.min(8, Math.max(0, (selected % 9) + dc));
		selected = r * 9 + c;
	}
	render();
}

// --- input events ---
boardEl.addEventListener("click", (e) => {
	const cell = (e.target as HTMLElement).closest<HTMLElement>(".cell");
	if (!cell) return;
	selected = Number(cell.dataset.i);
	play("select");
	render();
});

numpadEl.addEventListener("click", (e) => {
	const btn = (e.target as HTMLElement).closest<HTMLElement>("[data-digit]");
	if (!btn) return;
	input(Number(btn.dataset.digit));
});

document.addEventListener("keydown", (e) => {
	if (e.ctrlKey || e.metaKey || e.altKey) return;
	if (!overlayEl.classList.contains("hidden") && (e.key === "Enter" || e.key === " ")) {
		e.preventDefault();
		nextPuzzle();
		return;
	}
	if (e.key >= "1" && e.key <= "9") {
		input(Number(e.key));
	} else if (e.key === "Delete" || e.key === "Backspace" || e.key === "0") {
		e.preventDefault();
		erase();
	} else if (e.key === "ArrowUp") {
		e.preventDefault();
		moveSelection(-1, 0);
	} else if (e.key === "ArrowDown") {
		e.preventDefault();
		moveSelection(1, 0);
	} else if (e.key === "ArrowLeft") {
		e.preventDefault();
		moveSelection(0, -1);
	} else if (e.key === "ArrowRight") {
		e.preventDefault();
		moveSelection(0, 1);
	} else if (e.key === "n") {
		notesMode = !notesMode;
		play("button");
		render();
	} else if (e.key === "z" || e.key === "u") {
		undo();
	} else if (e.key === "h") {
		hint();
	} else if (e.key === "r") {
		restart();
	}
});

(document.getElementById("undo-btn") as HTMLButtonElement).addEventListener("click", undo);
(document.getElementById("erase-btn") as HTMLButtonElement).addEventListener("click", erase);
(document.getElementById("hint-btn") as HTMLButtonElement).addEventListener("click", hint);
(document.getElementById("restart-btn") as HTMLButtonElement).addEventListener("click", () => {
	play("button");
	restart();
});
notesBtn.addEventListener("click", () => {
	notesMode = !notesMode;
	play("button");
	render();
});
soundBtn.addEventListener("click", () => {
	progress.settings.sound = !progress.settings.sound;
	saveProgress();
	play("button");
	render();
});
mistakesCheck.addEventListener("change", () => {
	progress.settings.mistakes = mistakesCheck.checked;
	saveProgress();
	render();
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
		const options = PUZZLES[diff]
			.map((_, i) => {
				const done = progress.best[`${diff}:${i}`] !== undefined ? " ✓" : "";
				return `<option value="${diff}:${i}">${label(diff)} #${i + 1}${done}</option>`;
			})
			.join("");
		return `<optgroup label="${label(diff)}">${options}</optgroup>`;
	}).join("");
}

function init() {
	mistakesCheck.checked = progress.settings.mistakes;
	buildPuzzleOptions();
	const [initial, i] = (progress.current ?? "easy:0").split(":") as [Difficulty, string];
	let d = initial;
	let index = Number(i);
	if (!PUZZLES[d]?.[index]) {
		d = "easy";
		index = 0;
	}
	const session = progress.session;
	if (session && session.key === `${d}:${index}` && session.values.length === 81) {
		loadPuzzle(d, index, session);
	} else {
		loadPuzzle(d, index);
	}
}

init();
