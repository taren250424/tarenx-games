import "../../shared/ads/ad-slot.css";
import "../../shared/theme/base.css";
import "./style.css";
import { createSfx } from "../../shared/audio/sfx.ts";
import { mountIcons, setSoundIcon } from "../../shared/ui/icons.ts";
import { markPlayed } from "../../shared/progress/recent.ts";
import { ads } from "../../shared/ads/ads.ts";
import { PUZZLES, type Difficulty } from "./puzzles.ts";
import {
	TARGET,
	apply,
	equals,
	format,
	frac,
	nextStep,
	solutions,
	solvable,
	type Frac,
	type Op,
} from "./solve.ts";

mountIcons();
markPlayed();

interface Session {
	key: string; // "difficulty:index"
	cards: (Frac | null)[]; // the four slots; a merged-away card is null
	trail: string[]; // the merges so far, as "a op b = c"
	elapsed: number; // seconds
	hintsLeft: number;
}

interface Progress {
	current: string;
	best: Record<string, number>; // key -> best seconds
	session: Session | null;
	settings: { sound: boolean };
}

interface Snapshot {
	cards: (Frac | null)[];
	trail: string[];
}

const STORAGE_KEY = "tarenx.24-game.progress";
const DIFFICULTIES: Difficulty[] = ["easy", "medium", "hard"];
const HINTS_PER_HAND = 3;
const HINT_MS = 1600;

// --- state ---
let difficulty: Difficulty = "easy";
let puzzleIndex = 0;
let cards: (Frac | null)[] = [];
let trail: string[] = [];
let selected = -1;
let op: Op | null = null;
let hintsLeft = HINTS_PER_HAND;
let elapsed = 0;
let history: Snapshot[] = [];
let won = false;
let revealed = false;
let hintTimer = 0;

// --- elements ---
const tableEl = document.getElementById("table") as HTMLElement;
const cardsEl = document.getElementById("cards") as HTMLElement;
const opsEl = document.getElementById("ops") as HTMLElement;
const trailEl = document.getElementById("trail") as HTMLElement;
const statusEl = document.getElementById("status") as HTMLElement;
const puzzleSelectEl = document.getElementById("puzzle-select") as HTMLSelectElement;
const timeEl = document.getElementById("time") as HTMLElement;
const bestEl = document.getElementById("best") as HTMLElement;
const solvedEl = document.getElementById("solved") as HTMLElement;
const hintsEl = document.getElementById("hints") as HTMLElement;
const soundBtn = document.getElementById("sound-btn") as HTMLButtonElement;
const overlayEl = document.getElementById("end-overlay") as HTMLElement;
const endTitleEl = document.getElementById("end-title") as HTMLElement;
const endStatsEl = document.getElementById("end-stats") as HTMLElement;
const nextBtn = document.getElementById("next-btn") as HTMLButtonElement;
const retryBtn = document.getElementById("retry-btn") as HTMLButtonElement;

const cardEls = [...cardsEl.querySelectorAll<HTMLButtonElement>(".card")];
const opEls = [...opsEl.querySelectorAll<HTMLButtonElement>("button")];

// --- audio ---
const play = createSfx(
	["select", "merge", "error", "hint", "button", "win"] as const,
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
ads.init({ sound: () => progress.settings.sound });

function puzzleKey(): string {
	return `${difficulty}:${puzzleIndex}`;
}

function saveSession() {
	progress.session =
		won || revealed
			? null
			: { key: puzzleKey(), cards: cards.map((c) => c && { ...c }), trail: [...trail], elapsed, hintsLeft };
	saveProgress();
}

// --- hand lifecycle ---
function loadHand(diff: Difficulty, index: number, session?: Session) {
	difficulty = diff;
	puzzleIndex = index;
	cards = session ? session.cards.map((c) => c && frac(c.n, c.d)) : PUZZLES[diff][index].map((n) => frac(n));
	trail = session ? [...session.trail] : [];
	elapsed = session ? session.elapsed : 0;
	hintsLeft = session ? session.hintsLeft : HINTS_PER_HAND;
	selected = -1;
	op = null;
	history = [];
	won = false;
	revealed = false;
	clearHint();

	progress.current = puzzleKey();
	saveSession();
	puzzleSelectEl.value = puzzleKey();
	overlayEl.classList.add("hidden");
	tableEl.classList.remove("solved");
	renderAll();
}

function restart() {
	loadHand(difficulty, puzzleIndex);
}

function nextPosition(): [Difficulty, number] {
	if (puzzleIndex + 1 < PUZZLES[difficulty].length) {
		return [difficulty, puzzleIndex + 1];
	}
	const di = (DIFFICULTIES.indexOf(difficulty) + 1) % DIFFICULTIES.length;
	return [DIFFICULTIES[di], 0];
}

async function nextHand() {
	const [nd, ni] = nextPosition();
	await ads.interstitial("next", "24-game-next");
	loadHand(nd, ni);
}

function randomHand() {
	const bank = PUZZLES[difficulty];
	let index = puzzleIndex;
	if (bank.length > 1) {
		while (index === puzzleIndex) index = Math.floor(Math.random() * bank.length);
	}
	loadHand(difficulty, index);
}

// --- rendering ---
function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}:${String(s).padStart(2, "0")}`;
}

// "8/3" as a stacked fraction, so a card never reads as "eight divided by three"
function cardHtml(value: Frac): string {
	if (value.d === 1) return String(value.n);
	return `<span class="frac"><span>${value.n}</span><span>${value.d}</span></span>`;
}

function live(): Frac[] {
	return cards.filter((c): c is Frac => c !== null);
}

function renderCards() {
	cardEls.forEach((el, i) => {
		const value = cards[i];
		el.classList.toggle("empty", value === null);
		el.classList.toggle("selected", i === selected);
		el.disabled = value === null || won || revealed;
		el.innerHTML = value ? cardHtml(value) : "";
	});
	opEls.forEach((el) => el.setAttribute("aria-pressed", String(el.dataset.op === op)));
}

function renderTrail() {
	trailEl.innerHTML = trail.map((line) => `<li>${line}</li>`).join("");
}

function renderStatus() {
	timeEl.textContent = formatTime(elapsed);
	const best = progress.best[puzzleKey()];
	bestEl.textContent = best === undefined ? "—" : formatTime(best);
	const done = PUZZLES[difficulty].filter((_, i) => progress.best[`${difficulty}:${i}`] !== undefined).length;
	solvedEl.textContent = `${done}/${PUZZLES[difficulty].length}`;
	hintsEl.textContent = String(hintsLeft);
	setSoundIcon(soundBtn, progress.settings.sound);

	const remaining = live();
	let message = "";
	if (!won && !revealed && trail.length) {
		if (remaining.length === 1) message = `That makes ${format(remaining[0])}, not ${TARGET}. Undo and try another way.`;
		else if (!solvable(remaining)) message = `No way to reach ${TARGET} from here. Undo a step.`;
	}
	statusEl.textContent = message;
}

function renderAll() {
	renderCards();
	renderTrail();
	renderStatus();
}

// --- actions ---
function pushHistory() {
	history.push({ cards: cards.map((c) => c && { ...c }), trail: [...trail] });
	if (history.length > 50) history.shift();
}

function clearHint() {
	clearTimeout(hintTimer);
	for (const el of [...cardEls, ...opEls]) el.classList.remove("hint");
}

function merge(a: number, b: number, o: Op) {
	const value = apply(cards[a] as Frac, o, cards[b] as Frac);
	if (!value) {
		play("error");
		statusEl.textContent = "You can't divide by zero.";
		return;
	}
	pushHistory();
	trail.push(`${format(cards[a] as Frac)} ${o} ${format(cards[b] as Frac)} = ${format(value)}`);
	cards[b] = value;
	cards[a] = null;
	selected = -1;
	op = null;
	clearHint();
	cardEls[b].classList.remove("pop");
	void cardEls[b].offsetWidth;
	cardEls[b].classList.add("pop");
	play("merge");
	saveSession();
	renderAll();
	checkWin();
}

function pickCard(i: number) {
	if (won || revealed || cards[i] === null) return;
	if (selected >= 0 && selected !== i && op) {
		merge(selected, i, op);
		return;
	}
	selected = selected === i ? -1 : i;
	play("select");
	renderCards();
}

function pickOp(o: Op) {
	if (won || revealed) return;
	op = op === o ? null : o;
	play("select");
	renderCards();
}

function undo() {
	if (won || revealed) return;
	const previous = history.pop();
	if (!previous) return;
	cards = previous.cards;
	trail = previous.trail;
	selected = -1;
	op = null;
	clearHint();
	play("button");
	saveSession();
	renderAll();
}

function hint() {
	if (won || revealed) return;
	if (hintsLeft <= 0) {
		play("error");
		return;
	}
	const step = nextStep(live());
	if (!step) {
		play("error");
		renderStatus();
		return;
	}
	// map the step's positions among the live cards back onto the slots
	const slots = cards.map((c, i) => (c === null ? -1 : i)).filter((i) => i >= 0);
	clearHint();
	cardEls[slots[step.i]].classList.add("hint");
	cardEls[slots[step.j]].classList.add("hint");
	opEls.find((el) => el.dataset.op === step.op)?.classList.add("hint");
	hintTimer = window.setTimeout(clearHint, HINT_MS);
	hintsLeft--;
	play("hint");
	saveSession();
	renderStatus();
}

function reveal() {
	if (won || revealed) return;
	const hand = PUZZLES[difficulty][puzzleIndex].map((n) => frac(n));
	const found = solutions(hand);
	const shown = found.find((s) => s.ints) ?? found[0];
	revealed = true;
	selected = -1;
	op = null;
	clearHint();
	progress.session = null;
	saveProgress();
	endTitleEl.textContent = "One way";
	endStatsEl.textContent = `${shown.expr} = ${TARGET}`;
	nextBtn.textContent = nextLabel();
	retryBtn.classList.remove("hidden");
	overlayEl.classList.remove("hidden");
	play("button");
	renderAll();
}

function nextLabel(): string {
	const [nd, ni] = nextPosition();
	return ni === 0 && nd !== difficulty ? `Start ${label(nd)} →` : "Next Hand →";
}

function checkWin() {
	const remaining = live();
	if (remaining.length !== 1 || !equals(remaining[0], frac(TARGET))) return;
	won = true;
	const key = puzzleKey();
	const best = progress.best[key];
	const isRecord = best === undefined || elapsed < best;
	if (isRecord) progress.best[key] = elapsed;
	progress.session = null;
	saveProgress();
	buildPuzzleOptions();
	puzzleSelectEl.value = key;
	endTitleEl.textContent = `${TARGET}!`;
	endStatsEl.textContent = `${formatTime(elapsed)}${isRecord ? " · New best!" : ""}`;
	nextBtn.textContent = nextLabel();
	retryBtn.classList.add("hidden");
	tableEl.classList.add("solved");
	overlayEl.classList.remove("hidden");
	play("win");
	renderAll();
}

// --- input ---
cardEls.forEach((el, i) => el.addEventListener("click", () => pickCard(i)));
opEls.forEach((el) => el.addEventListener("click", () => pickOp(el.dataset.op as Op)));

const KEY_OPS: Record<string, Op> = { "+": "+", "-": "−", "*": "×", x: "×", "/": "÷" };

document.addEventListener("keydown", (e) => {
	if (e.ctrlKey || e.metaKey || e.altKey) return;
	if (!overlayEl.classList.contains("hidden") && (e.key === "Enter" || e.key === " ")) {
		e.preventDefault();
		void nextHand();
		return;
	}
	const key = e.key.toLowerCase();
	if (e.key >= "1" && e.key <= "4") {
		pickCard(Number(e.key) - 1);
	} else if (key in KEY_OPS) {
		e.preventDefault();
		pickOp(KEY_OPS[key]);
	} else if (e.key === "Escape") {
		selected = -1;
		op = null;
		renderCards();
	} else if (e.key === "Backspace" || key === "z" || key === "u") {
		e.preventDefault();
		undo();
	} else if (key === "h") {
		hint();
	} else if (key === "s") {
		reveal();
	} else if (key === "r") {
		restart();
	} else if (key === "n") {
		nextHand();
	}
});

// --- controls ---
(document.getElementById("undo-btn") as HTMLButtonElement).addEventListener("click", undo);
(document.getElementById("hint-btn") as HTMLButtonElement).addEventListener("click", hint);
(document.getElementById("solution-btn") as HTMLButtonElement).addEventListener("click", reveal);
(document.getElementById("random-btn") as HTMLButtonElement).addEventListener("click", () => {
	play("button");
	randomHand();
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
nextBtn.addEventListener("click", () => void nextHand());
retryBtn.addEventListener("click", restart);

puzzleSelectEl.addEventListener("change", () => {
	const [d, i] = puzzleSelectEl.value.split(":");
	loadHand(d as Difficulty, Number(i));
});

// --- timer ---
setInterval(() => {
	if (won || revealed || document.visibilityState !== "visible") return;
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
		return `<optgroup label="${label(diff)} — ${PUZZLES[diff].length} hands">${options}</optgroup>`;
	}).join("");
}

function validSession(session: Session | null, key: string): session is Session {
	if (!session || session.key !== key || !Array.isArray(session.cards) || session.cards.length !== 4) return false;
	return session.cards.every(
		(c) => c === null || (Number.isInteger(c?.n) && Number.isInteger(c?.d) && c.d > 0)
	);
}

function init() {
	buildPuzzleOptions();
	const [initial, i] = (progress.current ?? "easy:0").split(":") as [Difficulty, string];
	let d = initial;
	let index = Number(i);
	if (!PUZZLES[d]?.[index]) {
		d = "easy";
		index = 0;
	}
	const session = progress.session;
	loadHand(d, index, validSession(session, `${d}:${index}`) ? session : undefined);
}

init();
