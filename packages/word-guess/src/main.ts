import "../../shared/ads/ad-slot.css";
import "../../shared/theme/base.css";
import "./style.css";
import { createSfx } from "../../shared/audio/sfx.ts";

type Mark = "correct" | "present" | "absent";
type Status = "playing" | "won" | "lost";

interface WordModule {
	LENGTH: number;
	ANSWERS: string;
	ALLOWED: string;
}

interface Pack {
	length: number;
	answers: string;
	allowed: string;
}

interface Stats {
	played: number;
	won: number;
	streak: number;
	best: number;
	dist: number[]; // wins bucketed by the guess number that landed it
}

interface Session {
	length: number;
	answer: string;
	rows: string[];
	status: Status;
}

interface Progress {
	current: number; // word length
	stats: Record<string, Stats>;
	recent: Record<string, string[]>;
	session: Session | null;
	settings: { sound: boolean; hard: boolean; contrast: boolean };
}

const LENGTHS = [4, 5, 6];
const STORAGE_KEY = "tarenx.word-guess.progress";
// Word banks are a chunk each, so only the length being played is downloaded.
const MODULES: Record<number, () => Promise<WordModule>> = {
	4: () => import("./words-4.ts"),
	5: () => import("./words-5.ts"),
	6: () => import("./words-6.ts"),
};

// Keep in sync with the flip animation in style.css.
const FLIP_MS = 320;
const FLIP_STAGGER = 230;
// How many past answers to avoid repeating, per length.
const RECENT_MEMORY = 40;

const KEY_ROWS = ["qwertyuiop", "asdfghjkl", "zxcvbnm"];

const guessesFor = (length: number) => length + 1;

// --- state ---
let pack: Pack | null = null;
let length = 5;
let answer = "";
let rows: string[] = [];
let current = "";
let status: Status = "playing";
let revealing = false;

// --- elements ---
const boardEl = document.getElementById("board") as HTMLElement;
const keyboardEl = document.getElementById("keyboard") as HTMLElement;
const lengthSelectEl = document.getElementById("length-select") as HTMLSelectElement;
const newBtn = document.getElementById("new-btn") as HTMLButtonElement;
const hardBtn = document.getElementById("hard-btn") as HTMLButtonElement;
const contrastBtn = document.getElementById("contrast-btn") as HTMLButtonElement;
const soundBtn = document.getElementById("sound-btn") as HTMLButtonElement;
const streakEl = document.getElementById("streak") as HTMLElement;
const bestEl = document.getElementById("best") as HTMLElement;
const winRateEl = document.getElementById("win-rate") as HTMLElement;
const toastEl = document.getElementById("toast") as HTMLElement;
const overlayEl = document.getElementById("end-overlay") as HTMLElement;
const endTitleEl = document.getElementById("end-title") as HTMLElement;
const endWordEl = document.getElementById("end-word") as HTMLElement;
const endStatsEl = document.getElementById("end-stats") as HTMLElement;
const againBtn = document.getElementById("again-btn") as HTMLButtonElement;

// --- persistence ---
function emptyStats(): Stats {
	return { played: 0, won: 0, streak: 0, best: 0, dist: [] };
}

function loadProgress(): Progress {
	const fallback: Progress = {
		current: 5,
		stats: {},
		recent: {},
		session: null,
		settings: { sound: true, hard: false, contrast: false },
	};
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<Progress>;
			return {
				current: LENGTHS.includes(Number(parsed.current)) ? Number(parsed.current) : 5,
				stats: parsed.stats && typeof parsed.stats === "object" ? parsed.stats : {},
				recent: parsed.recent && typeof parsed.recent === "object" ? parsed.recent : {},
				session: parsed.session ?? null,
				settings: {
					sound: parsed.settings?.sound ?? true,
					hard: parsed.settings?.hard ?? false,
					contrast: parsed.settings?.contrast ?? false,
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

function statsFor(len: number): Stats {
	const key = String(len);
	if (!progress.stats[key]) progress.stats[key] = emptyStats();
	const s = progress.stats[key];
	if (!Array.isArray(s.dist)) s.dist = [];
	return s;
}

function saveSession() {
	progress.session = { length, answer, rows, status };
	saveProgress();
}

// --- audio ---
const play = createSfx(["flip", "win", "lose", "nope"] as const, () => progress.settings.sound);

// --- word bank ---
const packCache = new Map<number, Pack>();

async function loadPack(len: number): Promise<Pack> {
	const cached = packCache.get(len);
	if (cached) return cached;
	const mod = await MODULES[len]();
	const loaded: Pack = { length: mod.LENGTH, answers: mod.ANSWERS, allowed: mod.ALLOWED };
	packCache.set(len, loaded);
	return loaded;
}

function wordAt(bank: string, len: number, i: number): string {
	return bank.slice(i * len, i * len + len);
}

// Both banks are sorted and fixed-width, so membership is a binary search with
// no array to build.
function isAllowed(word: string): boolean {
	if (!pack) return false;
	const n = pack.length;
	let lo = 0;
	let hi = pack.allowed.length / n - 1;
	while (lo <= hi) {
		const mid = (lo + hi) >> 1;
		const at = wordAt(pack.allowed, n, mid);
		if (at === word) return true;
		if (at < word) lo = mid + 1;
		else hi = mid - 1;
	}
	return false;
}

function pickAnswer(): string {
	if (!pack) return "";
	const count = pack.answers.length / pack.length;
	const recent = progress.recent[String(length)] ?? [];
	const avoid = new Set(recent);
	// Random draw, retried a bounded number of times — cheaper than building a
	// filtered copy of the bank for the sake of a 40-word exclusion.
	for (let tries = 0; tries < 60; tries++) {
		const word = wordAt(pack.answers, pack.length, Math.floor(Math.random() * count));
		if (!avoid.has(word)) return word;
	}
	return wordAt(pack.answers, pack.length, Math.floor(Math.random() * count));
}

function rememberAnswer(word: string) {
	const key = String(length);
	const recent = progress.recent[key] ?? [];
	recent.push(word);
	progress.recent[key] = recent.slice(-RECENT_MEMORY);
}

// --- scoring ---
// Two passes, so a repeated letter is only ever credited as many times as the
// answer actually contains it: BOOST against ROBOT marks one O present, not two.
function score(guess: string, target: string): Mark[] {
	const marks: Mark[] = Array(guess.length).fill("absent");
	const spare = new Map<string, number>();
	for (let i = 0; i < target.length; i++) {
		if (guess[i] === target[i]) marks[i] = "correct";
		else spare.set(target[i], (spare.get(target[i]) ?? 0) + 1);
	}
	for (let i = 0; i < guess.length; i++) {
		if (marks[i] === "correct") continue;
		const left = spare.get(guess[i]) ?? 0;
		if (left > 0) {
			marks[i] = "present";
			spare.set(guess[i], left - 1);
		}
	}
	return marks;
}

const ordinal = (n: number) => ["1st", "2nd", "3rd", "4th", "5th", "6th", "7th"][n] ?? `${n + 1}th`;

// Hard mode: anything already revealed has to be used again.
function hardModeError(guess: string): string | null {
	const fixed: (string | null)[] = Array(length).fill(null);
	const needed = new Map<string, number>();
	for (const row of rows) {
		const marks = score(row, answer);
		const rowNeeds = new Map<string, number>();
		for (let i = 0; i < marks.length; i++) {
			if (marks[i] === "correct") fixed[i] = row[i];
			if (marks[i] !== "absent") rowNeeds.set(row[i], (rowNeeds.get(row[i]) ?? 0) + 1);
		}
		for (const [letter, n] of rowNeeds) {
			needed.set(letter, Math.max(needed.get(letter) ?? 0, n));
		}
	}
	for (let i = 0; i < length; i++) {
		if (fixed[i] && guess[i] !== fixed[i]) {
			return `${ordinal(i)} letter must be ${fixed[i]!.toUpperCase()}`;
		}
	}
	for (const [letter, n] of needed) {
		const have = [...guess].filter((c) => c === letter).length;
		if (have < n) {
			return n > 1
				? `Guess must use ${n} ${letter.toUpperCase()}s`
				: `Guess must use ${letter.toUpperCase()}`;
		}
	}
	return null;
}

// --- rendering ---
function buildBoard() {
	boardEl.style.setProperty("--cols", String(length));
	boardEl.dataset.length = String(length);
	const total = guessesFor(length);
	boardEl.innerHTML = Array.from(
		{ length: total },
		(_, r) =>
			`<div class="row" data-row="${r}">` +
			Array.from({ length }, (_, c) => `<div class="tile" data-col="${c}"><span></span></div>`).join("") +
			`</div>`
	).join("");
}

function tilesIn(row: number): HTMLElement[] {
	return [...boardEl.querySelectorAll<HTMLElement>(`[data-row="${row}"] .tile`)];
}

function paintRow(row: number, word: string, marks: Mark[] | null) {
	const tiles = tilesIn(row);
	tiles.forEach((tile, i) => {
		const face = tile.firstElementChild as HTMLElement;
		face.textContent = (word[i] ?? "").toUpperCase();
		tile.classList.toggle("filled", Boolean(word[i]));
		tile.dataset.mark = marks ? marks[i] : "";
	});
}

function renderBoard() {
	const total = guessesFor(length);
	for (let r = 0; r < total; r++) {
		if (r < rows.length) paintRow(r, rows[r], score(rows[r], answer));
		else if (r === rows.length && status === "playing") paintRow(r, current, null);
		else paintRow(r, "", null);
	}
}

function buildKeyboard() {
	keyboardEl.innerHTML = KEY_ROWS.map((line, i) => {
		const keys = [...line].map((k) => `<button class="key" data-key="${k}">${k.toUpperCase()}</button>`);
		if (i === 2) {
			keys.unshift('<button class="key wide" data-key="enter">Enter</button>');
			keys.push('<button class="key wide" data-key="backspace" aria-label="Backspace">⌫</button>');
		}
		return `<div class="key-row">${keys.join("")}</div>`;
	}).join("");
}

const MARK_RANK: Record<Mark, number> = { absent: 0, present: 1, correct: 2 };

function renderKeyboard() {
	const best = new Map<string, Mark>();
	for (const row of rows) {
		const marks = score(row, answer);
		for (let i = 0; i < row.length; i++) {
			const seen = best.get(row[i]);
			if (!seen || MARK_RANK[marks[i]] > MARK_RANK[seen]) best.set(row[i], marks[i]);
		}
	}
	for (const key of keyboardEl.querySelectorAll<HTMLElement>("[data-key]")) {
		const letter = key.dataset.key!;
		if (letter.length !== 1) continue;
		key.dataset.mark = best.get(letter) ?? "";
	}
}

function renderHud() {
	const s = statsFor(length);
	streakEl.textContent = String(s.streak);
	bestEl.textContent = String(s.best);
	winRateEl.textContent = s.played > 0 ? `${Math.round((s.won / s.played) * 100)}%` : "—";
}

let toastTimer = 0;

function toast(message: string) {
	toastEl.textContent = message;
	toastEl.classList.add("show");
	clearTimeout(toastTimer);
	toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), 1400);
}

function shakeActiveRow() {
	const row = boardEl.querySelector<HTMLElement>(`[data-row="${rows.length}"]`);
	if (!row) return;
	row.classList.remove("shake");
	void row.offsetWidth;
	row.classList.add("shake");
}

function distributionHtml(s: Stats): string {
	const total = guessesFor(length);
	// dist is written by index and so has holes; spreading it raw hands Math.max
	// an undefined and every bar comes out NaN wide.
	const counts = Array.from({ length: total }, (_, i) => s.dist[i] ?? 0);
	const peak = Math.max(1, ...counts);
	return counts.map((n, i) => {
		const width = Math.max(8, Math.round((n / peak) * 100));
		const last = status === "won" && rows.length === i + 1;
		return `<div class="dist-row"><span>${i + 1}</span><div class="dist-bar${last ? " latest" : ""}" style="width:${width}%">${n}</div></div>`;
	}).join("");
}

function showOverlay() {
	const s = statsFor(length);
	endTitleEl.textContent = status === "won" ? "Got it!" : "Out of guesses";
	endWordEl.textContent = answer.toUpperCase();
	endStatsEl.innerHTML =
		`<div class="stat-grid">` +
		`<div><strong>${s.played}</strong><span>Played</span></div>` +
		`<div><strong>${s.played ? Math.round((s.won / s.played) * 100) : 0}%</strong><span>Win rate</span></div>` +
		`<div><strong>${s.streak}</strong><span>Streak</span></div>` +
		`<div><strong>${s.best}</strong><span>Best</span></div>` +
		`</div><div class="dist">${distributionHtml(s)}</div>`;
	overlayEl.classList.remove("hidden");
}

function hideOverlay() {
	overlayEl.classList.add("hidden");
}

function updateToggles() {
	soundBtn.textContent = progress.settings.sound ? "🔊" : "🔇";
	hardBtn.setAttribute("aria-pressed", String(progress.settings.hard));
	contrastBtn.setAttribute("aria-pressed", String(progress.settings.contrast));
	document.body.classList.toggle("high-contrast", progress.settings.contrast);
}

// --- game ---
function finish(won: boolean) {
	status = won ? "won" : "lost";
	const s = statsFor(length);
	s.played++;
	if (won) {
		s.won++;
		s.streak++;
		s.best = Math.max(s.best, s.streak);
		s.dist[rows.length - 1] = (s.dist[rows.length - 1] ?? 0) + 1;
	} else {
		s.streak = 0;
	}
	rememberAnswer(answer);
	play(won ? "win" : "lose");
	renderHud();
	saveSession();
	window.setTimeout(showOverlay, 900);
}

function submit() {
	if (status !== "playing" || revealing || !pack) return;
	if (current.length < length) {
		toast(`Needs ${length} letters`);
		shakeActiveRow();
		play("nope");
		return;
	}
	if (!isAllowed(current)) {
		toast("Not in word list");
		shakeActiveRow();
		play("nope");
		return;
	}
	if (progress.settings.hard) {
		const problem = hardModeError(current);
		if (problem) {
			toast(problem);
			shakeActiveRow();
			play("nope");
			return;
		}
	}

	const guess = current;
	const row = rows.length;
	const marks = score(guess, answer);
	rows.push(guess);
	current = "";
	revealing = true;
	saveSession();

	const tiles = tilesIn(row);
	tiles.forEach((tile, i) => {
		window.setTimeout(() => {
			tile.classList.add("flip");
			// swap the colour at the halfway point, while the tile is edge-on
			window.setTimeout(() => {
				tile.dataset.mark = marks[i];
			}, FLIP_MS / 2);
		}, i * FLIP_STAGGER);
	});
	play("flip");

	window.setTimeout(
		() => {
			revealing = false;
			for (const tile of tiles) tile.classList.remove("flip");
			renderKeyboard();
			if (guess === answer) {
				for (const [i, tile] of tiles.entries()) {
					window.setTimeout(() => tile.classList.add("bounce"), i * 90);
				}
				finish(true);
			} else if (rows.length >= guessesFor(length)) {
				finish(false);
			}
		},
		(tiles.length - 1) * FLIP_STAGGER + FLIP_MS
	);
}

function typeLetter(letter: string) {
	if (status !== "playing" || revealing) return;
	if (current.length >= length) return;
	current += letter;
	paintRow(rows.length, current, null);
	const tile = tilesIn(rows.length)[current.length - 1];
	tile?.classList.remove("pop");
	void tile?.offsetWidth;
	tile?.classList.add("pop");
}

function backspace() {
	if (status !== "playing" || revealing) return;
	current = current.slice(0, -1);
	paintRow(rows.length, current, null);
}

function startGame() {
	answer = pickAnswer();
	rows = [];
	current = "";
	status = "playing";
	revealing = false;
	hideOverlay();
	buildBoard();
	renderBoard();
	renderKeyboard();
	renderHud();
	saveSession();
}

async function setLength(next: number, restore: Session | null = null) {
	length = next;
	progress.current = next;
	lengthSelectEl.value = String(next);
	boardEl.classList.add("loading");
	pack = await loadPack(next);
	boardEl.classList.remove("loading");
	if (restore) {
		answer = restore.answer;
		rows = restore.rows;
		current = "";
		status = restore.status;
		revealing = false;
		hideOverlay();
		buildBoard();
		renderBoard();
		renderKeyboard();
		renderHud();
		if (status !== "playing") showOverlay();
	} else {
		startGame();
	}
}

// --- input ---
document.addEventListener("keydown", (e) => {
	if (e.ctrlKey || e.metaKey || e.altKey) return;
	if (!overlayEl.classList.contains("hidden")) {
		if (e.key === "Enter" || e.key === " ") {
			e.preventDefault();
			startGame();
		}
		return;
	}
	if (e.key === "Enter") {
		e.preventDefault();
		submit();
	} else if (e.key === "Backspace") {
		e.preventDefault();
		backspace();
	} else if (/^[a-zA-Z]$/.test(e.key)) {
		typeLetter(e.key.toLowerCase());
	}
});

keyboardEl.addEventListener("click", (e) => {
	const key = (e.target as HTMLElement).closest<HTMLElement>("[data-key]");
	if (!key) return;
	const value = key.dataset.key!;
	if (value === "enter") submit();
	else if (value === "backspace") backspace();
	else typeLetter(value);
});

newBtn.addEventListener("click", () => startGame());
againBtn.addEventListener("click", () => startGame());

lengthSelectEl.addEventListener("change", () => {
	void setLength(Number(lengthSelectEl.value));
});

hardBtn.addEventListener("click", () => {
	// Turning it on mid-game would retroactively invalidate guesses already made.
	if (rows.length > 0 && status === "playing" && !progress.settings.hard) {
		toast("Hard mode starts on a new word");
		return;
	}
	progress.settings.hard = !progress.settings.hard;
	saveProgress();
	updateToggles();
	toast(progress.settings.hard ? "Hard mode on" : "Hard mode off");
});

contrastBtn.addEventListener("click", () => {
	progress.settings.contrast = !progress.settings.contrast;
	saveProgress();
	updateToggles();
});

soundBtn.addEventListener("click", () => {
	progress.settings.sound = !progress.settings.sound;
	saveProgress();
	updateToggles();
});

// --- init ---
async function init() {
	lengthSelectEl.innerHTML = LENGTHS.map(
		(n) => `<option value="${n}">${n} letters · ${guessesFor(n)} guesses</option>`
	).join("");
	buildKeyboard();
	updateToggles();

	const saved = progress.session;
	const resumable = saved && LENGTHS.includes(saved.length) && saved.answer.length === saved.length;
	await setLength(resumable ? saved.length : progress.current, resumable ? saved : null);
}

void init();
