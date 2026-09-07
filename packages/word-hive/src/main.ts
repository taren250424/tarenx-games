import "../../shared/ads/ad-slot.css";
import "../../shared/theme/base.css";
import "./style.css";
import { createSfx } from "../../shared/audio/sfx.ts";
import { mountIcons, setSoundIcon } from "../../shared/ui/icons.ts";
import { markPlayed } from "../../shared/progress/recent.ts";
import { ads } from "../../shared/ads/ads.ts";
import { WORDS } from "./words.ts";

mountIcons();
markPlayed();

type Size = "small" | "medium" | "large";

interface Stats {
	played: number;
	genius: number;
	perfect: number;
}

interface Session {
	letters: string; // the centre first, then the outer six in display order
	found: string[];
	revealed: boolean;
	celebrated: boolean; // the Genius sheet has been shown once
}

interface Progress {
	size: Size;
	stats: Stats;
	recent: string[];
	session: Session | null;
	settings: { sound: boolean };
}

const STORAGE_KEY = "tarenx.word-hive.progress";
const HIVE_SIZE = 7;
const MIN_LENGTH = 4;
const MAX_TYPED = 19;
const PANGRAM_BONUS = 7;
// How many words a puzzle of each size has, centre letter included.
const SIZES: Record<Size, [number, number]> = { small: [20, 35], medium: [36, 60], large: [61, 120] };
const SIZE_LABEL: Record<Size, string> = { small: "Small", medium: "Medium", large: "Large" };
// Each rank is reached at a share of the puzzle's total score.
const RANKS: [number, string][] = [
	[0, "Beginner"],
	[2, "Warming Up"],
	[5, "Moving Up"],
	[8, "Good"],
	[15, "Solid"],
	[25, "Nice"],
	[40, "Great"],
	[50, "Amazing"],
	[70, "Genius"],
	[100, "Perfect"],
];
const GENIUS = RANKS.length - 2;
// How many past letter sets to avoid repeating.
const RECENT_MEMORY = 30;

// --- dictionary ---
// A word's letters as one bit per letter: a word fits a puzzle when its bits
// are a subset of the hive's and include the centre's.
const bit = (letter: string) => 1 << (letter.charCodeAt(0) - 97);
const maskOf = (word: string) => [...word].reduce((m, c) => m | bit(c), 0);

const words = WORDS.split("\n");
const masks = new Uint32Array(words.map(maskOf));
const isPangram = (word: string) => new Set(word).size === HIVE_SIZE;
const letterSets = [...new Set(words.filter(isPangram).map((w) => [...new Set(w)].sort().join("")))];

// --- state ---
let letters = ""; // centre first
let answers: string[] = [];
let answerSet = new Set<string>();
let maxScore = 0;
let found: string[] = [];
let typed = "";
let revealed = false;
let celebrated = false;

const center = () => letters[0];
const outer = () => letters.slice(1);
const hiveMask = () => maskOf(letters);

// --- elements ---
const entryEl = document.getElementById("entry") as HTMLElement;
const hiveEl = document.getElementById("hive") as HTMLElement;
const rankBarEl = document.getElementById("rank-bar") as HTMLElement;
const foundCountEl = document.getElementById("found-count") as HTMLElement;
const foundListEl = document.getElementById("found-list") as HTMLElement;
const sizeSelectEl = document.getElementById("size-select") as HTMLSelectElement;
const newBtn = document.getElementById("new-btn") as HTMLButtonElement;
const revealBtn = document.getElementById("reveal-btn") as HTMLButtonElement;
const deleteBtn = document.getElementById("delete-btn") as HTMLButtonElement;
const shuffleBtn = document.getElementById("shuffle-btn") as HTMLButtonElement;
const enterBtn = document.getElementById("enter-btn") as HTMLButtonElement;
const soundBtn = document.getElementById("sound-btn") as HTMLButtonElement;
const scoreEl = document.getElementById("score") as HTMLElement;
const rankEl = document.getElementById("rank") as HTMLElement;
const wordsEl = document.getElementById("words") as HTMLElement;
const toastEl = document.getElementById("toast") as HTMLElement;
const overlayEl = document.getElementById("end-overlay") as HTMLElement;
const endTitleEl = document.getElementById("end-title") as HTMLElement;
const endTextEl = document.getElementById("end-text") as HTMLElement;
const endListEl = document.getElementById("end-list") as HTMLElement;
const keepBtn = document.getElementById("keep-btn") as HTMLButtonElement;
const againBtn = document.getElementById("again-btn") as HTMLButtonElement;

// --- persistence ---
function loadProgress(): Progress {
	const fallback: Progress = {
		size: "medium",
		stats: { played: 0, genius: 0, perfect: 0 },
		recent: [],
		session: null,
		settings: { sound: true },
	};
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<Progress>;
			return {
				size: parsed.size && parsed.size in SIZES ? parsed.size : "medium",
				stats: { ...fallback.stats, ...parsed.stats },
				recent: Array.isArray(parsed.recent) ? parsed.recent : [],
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
ads.init({ sound: () => progress.settings.sound });

function saveSession() {
	progress.session = { letters, found, revealed, celebrated };
	saveProgress();
}

// --- audio ---
const play = createSfx(["found", "pangram", "nope", "rank", "win", "button"] as const, () => progress.settings.sound);

// --- puzzle ---
function pointsFor(word: string): number {
	if (word.length === MIN_LENGTH) return 1;
	return word.length + (isPangram(word) ? PANGRAM_BONUS : 0);
}

function answersFor(hive: string): string[] {
	const set = maskOf(hive);
	const need = bit(hive[0]);
	const list: string[] = [];
	for (let i = 0; i < words.length; i++) {
		const m = masks[i];
		if ((m & ~set) === 0 && (m & need) !== 0) list.push(words[i]);
	}
	return list;
}

function setPuzzle(hive: string) {
	letters = hive;
	answers = answersFor(hive);
	answerSet = new Set(answers);
	maxScore = answers.reduce((sum, w) => sum + pointsFor(w), 0);
}

// The centre plus the sorted outer letters, so the same puzzle is recognised
// however the hive was last shuffled.
const puzzleKey = (hive: string) => hive[0] + [...hive.slice(1)].sort().join("");

function shuffled(text: string): string {
	const list = [...text];
	for (let i = list.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[list[i], list[j]] = [list[j], list[i]];
	}
	return list.join("");
}

// Random letter sets, retried until one lands in the size band and has not
// come up lately. Every set is a pangram's letters, so each puzzle has at
// least one.
function pickPuzzle(size: Size): string {
	const [min, max] = SIZES[size];
	const avoid = new Set(progress.recent);
	let fallback = "";
	for (let tries = 0; tries < 400; tries++) {
		const set = letterSets[Math.floor(Math.random() * letterSets.length)];
		const middle = set[Math.floor(Math.random() * set.length)];
		const hive = middle + shuffled(set.replace(middle, ""));
		const count = answersFor(hive).length;
		if (count < min || count > max) continue;
		if (!avoid.has(puzzleKey(hive))) return hive;
		fallback ||= hive;
	}
	return fallback || center() + shuffled(outer());
}

function rememberPuzzle(hive: string) {
	progress.recent = [...progress.recent, puzzleKey(hive)].slice(-RECENT_MEMORY);
}

// --- scoring ---
const score = () => found.reduce((sum, w) => sum + pointsFor(w), 0);

function rankIndex(points: number): number {
	const pct = maxScore > 0 ? (points / maxScore) * 100 : 0;
	let index = 0;
	for (let i = 0; i < RANKS.length; i++) if (pct >= RANKS[i][0]) index = i;
	return index;
}

// --- rendering ---
function renderEntry() {
	const hive = hiveMask();
	entryEl.innerHTML =
		[...typed]
			.map((c) => {
				const cls = c === center() ? "center" : (hive & bit(c)) === 0 ? "bad" : "";
				return `<span class="${cls}">${c.toUpperCase()}</span>`;
			})
			.join("") + `<span class="caret"></span>`;
	entryEl.classList.toggle("empty", typed.length === 0);
}

function renderHive() {
	hiveEl.innerHTML = [...letters]
		.map(
			(c, i) =>
				`<button class="cell${i === 0 ? " center" : ""}" data-letter="${c}" ` +
				`aria-label="${c.toUpperCase()}${i === 0 ? ", the centre letter" : ""}">${c.toUpperCase()}</button>`
		)
		.join("");
}

function renderFound() {
	const list = [...found].sort();
	foundCountEl.textContent =
		found.length === 0 ? "No words yet" : `${found.length} word${found.length === 1 ? "" : "s"} found`;
	foundListEl.innerHTML = list.map((w) => `<li class="${isPangram(w) ? "pangram" : ""}">${w}</li>`).join("");
}

function renderHud() {
	const points = score();
	const rank = rankIndex(points);
	scoreEl.textContent = String(points);
	rankEl.textContent = RANKS[rank][1];
	wordsEl.textContent = `${found.length}/${answers.length}`;
	rankBarEl.innerHTML = RANKS.map(
		(_, i) => `<span class="dot${i <= rank ? " reached" : ""}${i === rank ? " current" : ""}"></span>`
	).join("");
	rankBarEl.setAttribute("aria-label", `Rank ${RANKS[rank][1]}, ${points} of ${maxScore} points`);
}

let toastTimer = 0;

function toast(message: string, tone: "" | "good" = "") {
	toastEl.textContent = message;
	toastEl.className = `show ${tone}`;
	clearTimeout(toastTimer);
	toastTimer = window.setTimeout(() => toastEl.classList.remove("show"), 1400);
}

function shakeEntry() {
	entryEl.classList.remove("shake");
	void entryEl.offsetWidth;
	entryEl.classList.add("shake");
}

function reject(message: string) {
	toast(message);
	shakeEntry();
	play("nope");
	// a rejected word is cleared, so the next one can be typed straight away
	window.setTimeout(() => {
		typed = "";
		renderEntry();
	}, 380);
}

function statsLine(): string {
	const s = progress.stats;
	return `Puzzles ${s.played} · Genius ${s.genius} · Perfect ${s.perfect}`;
}

function showSheet(title: string, text: string, opts: { list?: boolean; keep?: boolean } = {}) {
	endTitleEl.textContent = title;
	endTextEl.textContent = text;
	endListEl.classList.toggle("hidden", !opts.list);
	if (opts.list) {
		const have = new Set(found);
		endListEl.innerHTML = answers
			.map((w) => `<li class="${have.has(w) ? "have" : ""}${isPangram(w) ? " pangram" : ""}">${w}</li>`)
			.join("");
	}
	keepBtn.classList.toggle("hidden", !opts.keep);
	overlayEl.classList.remove("hidden");
}

function hideSheet() {
	overlayEl.classList.add("hidden");
}

function updateToggles() {
	setSoundIcon(soundBtn, progress.settings.sound);
	revealBtn.disabled = revealed;
}

function showAnswers() {
	showSheet(
		found.length === 0 ? "The answers" : "The rest",
		`You found ${found.length} of ${answers.length} words · ${score()} of ${maxScore} points`,
		{ list: true }
	);
}

// --- game ---
function submit() {
	if (revealed) return;
	const word = typed;
	if (word.length < MIN_LENGTH) return reject("Too short");
	if (!word.includes(center())) return reject("Missing centre letter");
	if ((maskOf(word) & ~hiveMask()) !== 0) return reject("Bad letters");
	if (found.includes(word)) return reject("Already found");
	if (!answerSet.has(word)) return reject("Not in word list");

	const before = rankIndex(score());
	found.push(word);
	typed = "";
	const points = pointsFor(word);
	const pangram = isPangram(word);
	const rank = rankIndex(score());
	const praise =
		pangram ? "Pangram!" : rank > before ? RANKS[rank][1] : word.length >= 7 ? "Awesome!" : word.length >= 5 ? "Nice!" : "Good!";
	toast(`${praise} +${points}`, "good");
	play(pangram ? "pangram" : rank > before ? "rank" : "found");
	renderEntry();
	renderFound();
	renderHud();
	saveSession();

	if (found.length === answers.length) {
		progress.stats.perfect++;
		saveProgress();
		play("win");
		window.setTimeout(() => showSheet("Perfect!", `Every word found · ${score()} points · ${statsLine()}`), 700);
	} else if (rank >= GENIUS && !celebrated) {
		celebrated = true;
		progress.stats.genius++;
		saveSession();
		play("win");
		window.setTimeout(
			() =>
				showSheet("Genius!", `${score()} of ${maxScore} points · ${found.length} of ${answers.length} words`, {
					keep: true,
				}),
			700
		);
	}
}

function typeLetter(letter: string) {
	if (revealed || typed.length >= MAX_TYPED) return;
	typed += letter;
	renderEntry();
}

function backspace() {
	if (revealed) return;
	typed = typed.slice(0, -1);
	renderEntry();
}

function shuffle() {
	if (revealed) return;
	letters = center() + shuffled(outer());
	hiveEl.classList.add("shuffling");
	window.setTimeout(() => {
		renderHive();
		hiveEl.classList.remove("shuffling");
	}, 130);
	play("button");
	saveSession();
}

function reveal() {
	if (revealed) return;
	revealed = true;
	typed = "";
	renderEntry();
	updateToggles();
	saveSession();
	play("button");
	showAnswers();
}

function renderAll() {
	renderHive();
	renderEntry();
	renderFound();
	renderHud();
	updateToggles();
}

function startGame() {
	setPuzzle(pickPuzzle(progress.size));
	rememberPuzzle(letters);
	found = [];
	typed = "";
	revealed = false;
	celebrated = false;
	progress.stats.played++;
	hideSheet();
	renderAll();
	saveSession();
}

function restoreGame(saved: Session) {
	setPuzzle(saved.letters);
	found = saved.found.filter((w) => answerSet.has(w));
	typed = "";
	revealed = saved.revealed;
	celebrated = saved.celebrated;
	hideSheet();
	renderAll();
	if (revealed) showAnswers();
}

// --- input ---
document.addEventListener("keydown", (e) => {
	if (e.ctrlKey || e.metaKey || e.altKey) return;
	if (e.target instanceof HTMLSelectElement) return;
	if (!overlayEl.classList.contains("hidden")) {
		if (e.key === "Enter") {
			e.preventDefault();
			void playAgain();
		} else if (e.key === "Escape" && !keepBtn.classList.contains("hidden")) {
			hideSheet();
		}
		return;
	}
	if (e.key === "Enter") {
		e.preventDefault();
		submit();
	} else if (e.key === "Backspace") {
		e.preventDefault();
		backspace();
	} else if (e.key === " ") {
		e.preventDefault();
		shuffle();
	} else if (e.key === "Escape") {
		typed = "";
		renderEntry();
	} else if (/^[a-zA-Z]$/.test(e.key)) {
		typeLetter(e.key.toLowerCase());
	}
});

hiveEl.addEventListener("click", (e) => {
	const cell = (e.target as HTMLElement).closest<HTMLElement>(".cell");
	if (!cell) return;
	typeLetter(cell.dataset.letter!);
	cell.classList.remove("pressed");
	void cell.offsetWidth;
	cell.classList.add("pressed");
});

deleteBtn.addEventListener("click", backspace);
shuffleBtn.addEventListener("click", shuffle);
enterBtn.addEventListener("click", submit);

async function playAgain() {
	await ads.interstitial("next", "word-hive-next");
	startGame();
}

newBtn.addEventListener("click", () => {
	play("button");
	startGame();
});
revealBtn.addEventListener("click", reveal);
keepBtn.addEventListener("click", () => {
	play("button");
	hideSheet();
});
againBtn.addEventListener("click", () => void playAgain());

sizeSelectEl.addEventListener("change", () => {
	progress.size = sizeSelectEl.value as Size;
	startGame();
});

soundBtn.addEventListener("click", () => {
	progress.settings.sound = !progress.settings.sound;
	saveProgress();
	updateToggles();
});

// --- init ---
function validSession(saved: Session | null): saved is Session {
	if (!saved || typeof saved.letters !== "string" || !Array.isArray(saved.found)) return false;
	if (!/^[a-z]{7}$/.test(saved.letters) || new Set(saved.letters).size !== HIVE_SIZE) return false;
	return answersFor(saved.letters).length > 0;
}

function init() {
	sizeSelectEl.innerHTML = (Object.keys(SIZES) as Size[])
		.map((s) => `<option value="${s}">${SIZE_LABEL[s]} · ${SIZES[s][0]}–${SIZES[s][1]} words</option>`)
		.join("");
	sizeSelectEl.value = progress.size;
	const saved = progress.session;
	if (validSession(saved)) restoreGame(saved);
	else startGame();
}

init();
