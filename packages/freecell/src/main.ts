import "../../shared/ads/ad-slot.css";
import "../../shared/theme/base.css";
import "./style.css";
import { createSfx } from "../../shared/audio/sfx.ts";
import { type Card, SUITS, isRed, orderedDeck, rank, suit } from "../../shared/cards/deck.ts";
import { type SlotSpec, createTable } from "../../shared/cards/table.ts";
import { DEAL_MAX, DEAL_MIN, IMPOSSIBLE_DEAL, clampDeal, deal, randomDeal } from "./deal.ts";

const EMPTY = -1;
const STORAGE_KEY = "tarenx.freecell.progress";
const MAX_UNDO = 500;

interface Board {
	free: number[]; // 4 cells, EMPTY or a card
	foundations: number[]; // cards played per suit, 0-13
	tableau: number[][]; // 8 columns, bottom card first
}

type Source =
	| { type: "free"; cell: number }
	| { type: "tableau"; col: number; index: number };

type Target =
	| { type: "free"; cell: number }
	| { type: "foundation"; suit: number }
	| { type: "tableau"; col: number };

interface Session {
	deal: number;
	board: Board;
	moves: number;
	elapsed: number;
}

interface Progress {
	deal: number;
	solved: number[];
	best: Record<string, { time: number; moves: number }>;
	session: Session | null;
	settings: { sound: boolean; autoplay: boolean };
}

// --- state ---
let board: Board = emptyBoard();
let dealNumber = DEAL_MIN;
let moves = 0;
let elapsed = 0;
let undoStack: { board: Board; moves: number }[] = [];
let selection: Source | null = null;
let finished = false;
let sweeping = false;

// --- elements ---
const boardEl = document.getElementById("board") as HTMLElement;
const dealInput = document.getElementById("deal-input") as HTMLInputElement;
const dealNoteEl = document.getElementById("deal-note") as HTMLElement;
const timeEl = document.getElementById("time") as HTMLElement;
const movesEl = document.getElementById("moves") as HTMLElement;
const bestEl = document.getElementById("best") as HTMLElement;
const solvedEl = document.getElementById("solved") as HTMLElement;
const soundBtn = document.getElementById("sound-btn") as HTMLButtonElement;
const autoCheck = document.getElementById("auto-check") as HTMLInputElement;
const undoBtn = document.getElementById("undo-btn") as HTMLButtonElement;
const finishBtn = document.getElementById("finish-btn") as HTMLButtonElement;
const overlayEl = document.getElementById("overlay") as HTMLElement;
const overlayTitleEl = document.getElementById("overlay-title") as HTMLElement;
const overlayStatsEl = document.getElementById("overlay-stats") as HTMLElement;
const overlayUndoBtn = document.getElementById("overlay-undo") as HTMLButtonElement;
const overlayNextBtn = document.getElementById("overlay-next") as HTMLButtonElement;

/*
 * Cards in a column overlap by a fixed fraction of their height. Tightening it
 * up for long columns would cover the rank in the corner, which is the one
 * thing that has to stay readable, so the table grows instead.
 */
const FAN = 0.28;

const SLOTS: SlotSpec[] = [
	...Array.from({ length: 4 }, (_, i): SlotSpec => ({ id: `free:${i}`, col: i, row: "top" })),
	...SUITS.map((glyph, i): SlotSpec => ({
		id: `foundation:${i}`,
		col: 4 + i,
		row: "top",
		glyph,
		className: "solid",
	})),
	...Array.from({ length: 8 }, (_, c): SlotSpec => ({
		id: `tableau:${c}`,
		col: c,
		row: "tableau",
		tall: true,
	})),
];

// --- audio ---
const play = createSfx(
	["deal", "move", "cell", "foundation", "nope", "button", "win"] as const,
	() => progress.settings.sound
);

// --- persistence ---
function loadProgress(): Progress {
	const fallback: Progress = {
		deal: DEAL_MIN,
		solved: [],
		best: {},
		session: null,
		settings: { sound: true, autoplay: true },
	};
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<Progress>;
			return {
				deal: clampDeal(Number(parsed.deal)),
				solved: Array.isArray(parsed.solved) ? parsed.solved : [],
				best: parsed.best && typeof parsed.best === "object" ? parsed.best : {},
				session: parsed.session ?? null,
				settings: {
					sound: parsed.settings?.sound ?? true,
					autoplay: parsed.settings?.autoplay ?? true,
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

function saveSession() {
	progress.session = finished ? null : { deal: dealNumber, board: cloneBoard(board), moves, elapsed };
	progress.deal = dealNumber;
	saveProgress();
}

function validSession(session: Session | null): session is Session {
	if (!session) return false;
	const { board: b } = session;
	if (!b || !Array.isArray(b.free) || !Array.isArray(b.foundations) || !Array.isArray(b.tableau)) return false;
	if (b.free.length !== 4 || b.foundations.length !== 4 || b.tableau.length !== 8) return false;
	// every card has to be somewhere, exactly once
	const seen = new Set<number>();
	for (const card of b.free) if (card !== EMPTY) seen.add(card);
	for (let s = 0; s < 4; s++) for (let k = 0; k < b.foundations[s]; k++) seen.add(k * 4 + s);
	for (const col of b.tableau) for (const card of col) seen.add(card);
	return seen.size === 52;
}

// --- board helpers ---
function emptyBoard(): Board {
	return {
		free: [EMPTY, EMPTY, EMPTY, EMPTY],
		foundations: [0, 0, 0, 0],
		tableau: Array.from({ length: 8 }, () => []),
	};
}

function cloneBoard(source: Board): Board {
	return {
		free: [...source.free],
		foundations: [...source.foundations],
		tableau: source.tableau.map((col) => [...col]),
	};
}

function freeCount(): number {
	return board.free.filter((card) => card === EMPTY).length;
}

function emptyColumns(): number {
	return board.tableau.filter((col) => col.length === 0).length;
}

/*
 * How many cards can travel together. FreeCell has no real multi-card move —
 * the pile is shuttled one card at a time through the open cells and columns,
 * so the limit is (free cells + 1) doubled for every empty column. A column
 * that is the destination cannot be used as a staging area, so it does not
 * count.
 */
function maxMove(toEmptyColumn: boolean): number {
	const staging = Math.max(0, emptyColumns() - (toEmptyColumn ? 1 : 0));
	return (freeCount() + 1) * 2 ** staging;
}

function isSequence(cards: number[]): boolean {
	for (let i = 1; i < cards.length; i++) {
		if (rank(cards[i]) !== rank(cards[i - 1]) - 1) return false;
		if (isRed(cards[i]) === isRed(cards[i - 1])) return false;
	}
	return true;
}

function cardsOf(src: Source): number[] {
	if (src.type === "free") {
		const card = board.free[src.cell];
		return card === EMPTY ? [] : [card];
	}
	return board.tableau[src.col].slice(src.index);
}

/** Where a card currently is, or null when it has already gone to a foundation. */
function locate(card: number): Source | null {
	const cell = board.free.indexOf(card);
	if (cell >= 0) return { type: "free", cell };
	for (let col = 0; col < 8; col++) {
		const index = board.tableau[col].indexOf(card);
		if (index >= 0) return { type: "tableau", col, index };
	}
	return null;
}

function sameSource(a: Source, b: Source): boolean {
	if (a.type !== b.type) return false;
	if (a.type === "free" && b.type === "free") return a.cell === b.cell;
	if (a.type === "tableau" && b.type === "tableau") return a.col === b.col && a.index === b.index;
	return false;
}

/** Can this stack be picked up at all, ignoring where it might land? */
function grabbable(src: Source): boolean {
	const cards = cardsOf(src);
	if (!cards.length) return false;
	if (src.type === "free") return true;
	return isSequence(cards) && cards.length <= maxMove(false);
}

function canMove(src: Source, dst: Target): boolean {
	const cards = cardsOf(src);
	if (!cards.length) return false;
	if (src.type === "tableau" && !isSequence(cards)) return false;

	if (dst.type === "free") {
		if (cards.length !== 1) return false;
		if (src.type === "free" && src.cell === dst.cell) return false;
		return board.free[dst.cell] === EMPTY;
	}
	if (dst.type === "foundation") {
		if (cards.length !== 1) return false;
		return suit(cards[0]) === dst.suit && rank(cards[0]) === board.foundations[dst.suit];
	}
	if (src.type === "tableau" && src.col === dst.col) return false;
	const column = board.tableau[dst.col];
	if (column.length) {
		const top = column[column.length - 1];
		if (rank(cards[0]) !== rank(top) - 1) return false;
		if (isRed(cards[0]) === isRed(top)) return false;
	}
	return cards.length <= maxMove(column.length === 0);
}

function applyMove(src: Source, dst: Target) {
	const cards = cardsOf(src);
	if (src.type === "free") board.free[src.cell] = EMPTY;
	else board.tableau[src.col].length = src.index;

	if (dst.type === "free") board.free[dst.cell] = cards[0];
	else if (dst.type === "foundation") board.foundations[dst.suit]++;
	else board.tableau[dst.col].push(...cards);
}

function isWon(): boolean {
	return board.foundations.every((count) => count === 13);
}

/*
 * The safe-autoplay rule: a card is only sent up on its own once no lower card
 * of the opposite colour could still need it as a landing place. Aces and twos
 * are never needed.
 */
function safeToAutoPlay(card: number): boolean {
	const r = rank(card);
	if (r <= 1) return true;
	const opposite = isRed(card) ? [0, 3] : [1, 2];
	return opposite.every((s) => board.foundations[s] >= r);
}

/** Returns the number of cards it sent up. */
function autoPlay(): number {
	if (!progress.settings.autoplay) return 0;
	let sent = 0;
	for (let pass = true; pass; ) {
		pass = false;
		const candidates: Source[] = [];
		for (let cell = 0; cell < 4; cell++) {
			if (board.free[cell] !== EMPTY) candidates.push({ type: "free", cell });
		}
		for (let col = 0; col < 8; col++) {
			const column = board.tableau[col];
			if (column.length) candidates.push({ type: "tableau", col, index: column.length - 1 });
		}
		for (const src of candidates) {
			const card = cardsOf(src)[0];
			if (card === undefined || !safeToAutoPlay(card)) continue;
			const dst: Target = { type: "foundation", suit: suit(card) };
			if (!canMove(src, dst)) continue;
			applyMove(src, dst);
			moves++;
			sent++;
			pass = true;
			break;
		}
	}
	return sent;
}

/** Where a single click would send this stack: foundation, then a column, then a cell. */
function autoTarget(src: Source): Target | null {
	const cards = cardsOf(src);
	if (!cards.length) return null;

	if (cards.length === 1) {
		const foundation: Target = { type: "foundation", suit: suit(cards[0]) };
		if (canMove(src, foundation)) return foundation;
	}
	for (let col = 0; col < 8; col++) {
		if (board.tableau[col].length && canMove(src, { type: "tableau", col })) {
			return { type: "tableau", col };
		}
	}
	// Emptying one column only to fill another is never progress, so a stack
	// that already sits alone in its column stays put.
	const wouldEmptySource = src.type === "tableau" && src.index === 0;
	if (!wouldEmptySource) {
		for (let col = 0; col < 8; col++) {
			if (!board.tableau[col].length && canMove(src, { type: "tableau", col })) {
				return { type: "tableau", col };
			}
		}
	}
	if (cards.length === 1 && src.type !== "free") {
		for (let cell = 0; cell < 4; cell++) {
			if (canMove(src, { type: "free", cell })) return { type: "free", cell };
		}
	}
	return null;
}

function hasAnyMove(): boolean {
	const cellOpen = board.free.includes(EMPTY);
	for (let cell = 0; cell < 4; cell++) {
		const card = board.free[cell];
		if (card === EMPTY) continue;
		const src: Source = { type: "free", cell };
		if (canMove(src, { type: "foundation", suit: suit(card) })) return true;
		for (let col = 0; col < 8; col++) if (canMove(src, { type: "tableau", col })) return true;
	}
	for (let col = 0; col < 8; col++) {
		const column = board.tableau[col];
		if (!column.length) continue;
		if (cellOpen) return true;
		const top = column[column.length - 1];
		if (canMove({ type: "tableau", col, index: column.length - 1 }, { type: "foundation", suit: suit(top) })) {
			return true;
		}
		for (let index = 0; index < column.length; index++) {
			const src: Source = { type: "tableau", col, index };
			if (!isSequence(cardsOf(src))) continue;
			for (let dest = 0; dest < 8; dest++) {
				if (dest !== col && canMove(src, { type: "tableau", col: dest })) return true;
			}
		}
	}
	return false;
}

/*
 * Once every column runs strictly downward in rank, nothing can block anything
 * else and the rest of the game is bookkeeping — so we offer to play it out.
 */
function canSweep(): boolean {
	if (finished || sweeping || isWon()) return false;
	return board.tableau.every((column) =>
		column.every((card, i) => i === 0 || rank(card) < rank(column[i - 1]))
	);
}

// --- rendering ---
function render() {
	const selected = selection ? cardsOf(selection) : [];

	table.render((place) => {
		for (let cell = 0; cell < 4; cell++) {
			const card = board.free[cell];
			if (card === EMPTY) continue;
			place(card, { slot: `free:${cell}`, grabbable: true, selected: selected.includes(card) });
		}

		for (let s = 0; s < 4; s++) {
			for (let k = 0; k < board.foundations[s]; k++) {
				place(k * 4 + s, { slot: `foundation:${s}` });
			}
		}

		for (let col = 0; col < 8; col++) {
			board.tableau[col].forEach((card, index) => {
				place(card, {
					slot: `tableau:${col}`,
					dy: index * FAN,
					grabbable: grabbable({ type: "tableau", col, index }),
					selected: selected.includes(card),
				});
			});
		}
	});

	renderStatus();
}

function formatTime(seconds: number): string {
	const m = Math.floor(seconds / 60);
	const s = seconds % 60;
	return `${m}:${String(s).padStart(2, "0")}`;
}

function renderStatus() {
	timeEl.textContent = formatTime(elapsed);
	movesEl.textContent = String(moves);
	const best = progress.best[String(dealNumber)];
	bestEl.textContent = best ? `${formatTime(best.time)} · ${best.moves}` : "—";
	solvedEl.textContent = String(progress.solved.length);
	soundBtn.textContent = progress.settings.sound ? "🔊" : "🔇";
	table.setEnabled(!finished && !sweeping);
	undoBtn.disabled = !undoStack.length || finished || sweeping;
	finishBtn.classList.toggle("hidden", !canSweep());
}

function renderNote() {
	dealNoteEl.textContent =
		dealNumber === IMPOSSIBLE_DEAL
			? "Deal #11982 is the one deal in the classic 32,000 that has been proved unwinnable. Good luck anyway."
			: "";
}

// --- moves ---
function pushUndo() {
	undoStack.push({ board: cloneBoard(board), moves });
	if (undoStack.length > MAX_UNDO) undoStack.shift();
}

function soundFor(dst: Target): "move" | "cell" | "foundation" {
	if (dst.type === "foundation") return "foundation";
	if (dst.type === "free") return "cell";
	return "move";
}

function doMove(src: Source, dst: Target): boolean {
	if (finished || sweeping || !canMove(src, dst)) return false;
	pushUndo();
	applyMove(src, dst);
	moves++;
	play(soundFor(dst));
	selection = null;
	// Cards that fly up on their own belong to the move that freed them, so
	// one undo puts the whole thing back.
	autoPlay();
	render();
	afterMove();
	return true;
}

function afterMove() {
	saveSession();
	if (isWon()) {
		finish();
		return;
	}
	// Once the game is decided, play it out — unless the player has turned the
	// automatic moves off, in which case the Finish button waits for them.
	if (canSweep() && progress.settings.autoplay) {
		sweep();
		return;
	}
	if (!hasAnyMove()) showStuck();
}

function undo() {
	if (finished || sweeping) return;
	const previous = undoStack.pop();
	if (!previous) return;
	board = previous.board;
	moves = previous.moves;
	selection = null;
	overlayEl.classList.add("hidden");
	play("button");
	saveSession();
	render();
}

/*
 * The tail of a won game: every card is reachable in rank order, so we just
 * keep sending the next one up until the foundations are full.
 */
function sweep() {
	if (sweeping || finished) return;
	sweeping = true;
	selection = null;
	renderStatus();
	const step = () => {
		const candidates: Source[] = [];
		for (let cell = 0; cell < 4; cell++) {
			if (board.free[cell] !== EMPTY) candidates.push({ type: "free", cell });
		}
		for (let col = 0; col < 8; col++) {
			const column = board.tableau[col];
			if (column.length) candidates.push({ type: "tableau", col, index: column.length - 1 });
		}
		for (const src of candidates) {
			const card = cardsOf(src)[0];
			const dst: Target = { type: "foundation", suit: suit(card) };
			if (!canMove(src, dst)) continue;
			applyMove(src, dst);
			moves++;
			play("foundation");
			render();
			setTimeout(step, 90);
			return;
		}
		sweeping = false;
		render();
		if (isWon()) finish();
	};
	setTimeout(step, 120);
}

function finish() {
	finished = true;
	selection = null;
	const key = String(dealNumber);
	const previous = progress.best[key];
	const record = !previous || elapsed < previous.time || moves < previous.moves;
	progress.best[key] = previous
		? { time: Math.min(previous.time, elapsed), moves: Math.min(previous.moves, moves) }
		: { time: elapsed, moves };
	if (!progress.solved.includes(dealNumber)) progress.solved.push(dealNumber);
	progress.session = null;
	saveProgress();

	overlayEl.classList.remove("stuck");
	overlayTitleEl.textContent = "Solved!";
	overlayStatsEl.textContent = `Deal #${dealNumber} · ${formatTime(elapsed)} · ${moves} moves${
		record ? " · New best!" : ""
	}`;
	overlayUndoBtn.classList.add("hidden");
	overlayNextBtn.textContent = "Next deal →";
	overlayEl.classList.remove("hidden");
	play("win");
	render();
}

function showStuck() {
	overlayEl.classList.add("stuck");
	overlayTitleEl.textContent = "No moves left";
	overlayStatsEl.textContent = `Deal #${dealNumber} · ${moves} moves · take one back and try another line.`;
	overlayUndoBtn.classList.remove("hidden");
	overlayNextBtn.textContent = "New deal";
	overlayEl.classList.remove("hidden");
	play("nope");
}

// --- clicks ---
function parseSlot(id: string): Target {
	const [kind, index] = id.split(":");
	const n = Number(index);
	if (kind === "free") return { type: "free", cell: n };
	if (kind === "foundation") return { type: "foundation", suit: n };
	return { type: "tableau", col: n };
}

function clearSelection() {
	if (!selection) return;
	selection = null;
	render();
}

function clickTarget(dst: Target) {
	if (selection && doMove(selection, dst)) return;
	clearSelection();
}

function clickCard(card: Card) {
	const src = locate(card);
	// a card already on a foundation can only be somewhere to drop onto
	if (!src) {
		clickTarget({ type: "foundation", suit: suit(card) });
		return;
	}
	if (selection) {
		if (sameSource(selection, src)) {
			selection = null;
			const dst = autoTarget(src);
			if (dst) doMove(src, dst);
			else {
				play("nope");
				render();
			}
			return;
		}
		const dst: Target = src.type === "free" ? { type: "free", cell: src.cell } : { type: "tableau", col: src.col };
		if (doMove(selection, dst)) return;
	}
	if (grabbable(src)) {
		selection = src;
		play("button");
	} else {
		selection = null;
	}
	render();
}

// --- table ---
// The shared card table owns the DOM and the pointer work; the four handlers
// below are the whole of what FreeCell has to say about it.
const table = createTable({
	root: boardEl,
	cards: orderedDeck(),
	slots: SLOTS,
	columns: 8,
	handlers: {
		grab(card) {
			const src = locate(card);
			return src && grabbable(src) ? cardsOf(src) : null;
		},
		canDrop(cards, slot) {
			const src = locate(cards[0]);
			return !!src && canMove(src, parseSlot(slot));
		},
		drop(cards, slot) {
			const src = locate(cards[0]);
			if (slot && src && doMove(src, parseSlot(slot))) return;
			if (slot) play("nope");
			render(); // nothing legal under the pointer: the cards slide home
		},
		tap(hit) {
			if (hit.card !== null) clickCard(hit.card);
			else if (hit.slot) clickTarget(parseSlot(hit.slot));
			else clearSelection();
		},
	},
});

// --- keyboard ---
document.addEventListener("keydown", (e) => {
	// only the deal box swallows keys — a checkbox or button keeping focus after
	// a click should not turn the shortcuts off
	if (e.target === dealInput) return;
	if (e.altKey || e.metaKey) return;
	const key = e.key.toLowerCase();
	if (key === "z") {
		e.preventDefault();
		undo();
		return;
	}
	if (e.ctrlKey) return;
	if (key === "u") undo();
	else if (key === "r") restart();
	else if (key === "n") startDeal(randomDeal());
	else if (key === "escape") clearSelection();
	else if (key === "enter" && !overlayEl.classList.contains("hidden")) overlayNextBtn.click();
});

// --- deal lifecycle ---
function updateUrl() {
	const url = `${location.pathname}?deal=${dealNumber}`;
	window.history.replaceState(null, "", url);
}

function startDeal(number: number, session?: Session) {
	dealNumber = clampDeal(number);
	board = session ? cloneBoard(session.board) : { ...emptyBoard(), tableau: deal(dealNumber) };
	moves = session ? session.moves : 0;
	elapsed = session ? session.elapsed : 0;
	undoStack = [];
	selection = null;
	finished = false;
	sweeping = false;
	table.reset();
	overlayEl.classList.add("hidden");
	overlayEl.classList.remove("stuck");
	dealInput.value = String(dealNumber);
	renderNote();
	updateUrl();
	if (!session) {
		play("deal");
		autoPlay();
	}
	render();
	saveSession();
}

function restart() {
	startDeal(dealNumber);
}

function stepDeal(delta: number) {
	const next = dealNumber + delta;
	startDeal(next < DEAL_MIN ? DEAL_MAX : next > DEAL_MAX ? DEAL_MIN : next);
}

// --- controls ---
// The field commits on Enter or when it loses focus — nonsense in it just
// snaps back to the deal on the table rather than throwing the player to #1.
function commitDealInput() {
	const typed = Number(dealInput.value.trim());
	if (!dealInput.value.trim() || !Number.isFinite(typed)) {
		dealInput.value = String(dealNumber);
		return;
	}
	const wanted = clampDeal(typed);
	if (wanted === dealNumber) dealInput.value = String(dealNumber);
	else startDeal(wanted);
}

dealInput.addEventListener("keydown", (e) => {
	if (e.key === "Enter") dealInput.blur();
	else if (e.key === "Escape") {
		dealInput.value = String(dealNumber);
		dealInput.blur();
	}
});
dealInput.addEventListener("blur", commitDealInput);
dealInput.addEventListener("focus", () => dealInput.select());
document.getElementById("prev-btn")?.addEventListener("click", () => stepDeal(-1));
document.getElementById("next-deal-btn")?.addEventListener("click", () => stepDeal(1));
document.getElementById("random-btn")?.addEventListener("click", () => startDeal(randomDeal()));
document.getElementById("restart-btn")?.addEventListener("click", () => {
	play("button");
	restart();
});
soundBtn.addEventListener("click", () => {
	progress.settings.sound = !progress.settings.sound;
	saveProgress();
	play("button");
	renderStatus();
});
autoCheck.addEventListener("change", () => {
	progress.settings.autoplay = autoCheck.checked;
	saveProgress();
	if (!autoCheck.checked || finished || sweeping) return;
	// Switching it on can send a pile of cards up at once; that has to be one
	// undo step, not an unreachable one.
	pushUndo();
	if (autoPlay()) {
		render();
		afterMove();
	} else {
		undoStack.pop();
	}
});
undoBtn.addEventListener("click", undo);
finishBtn.addEventListener("click", () => sweep());
overlayUndoBtn.addEventListener("click", () => {
	overlayEl.classList.add("hidden");
	undo();
});
document.getElementById("overlay-restart")?.addEventListener("click", restart);
overlayNextBtn.addEventListener("click", () => {
	if (finished) stepDeal(1);
	else startDeal(randomDeal());
});

// --- timer ---
setInterval(() => {
	if (finished || document.visibilityState !== "visible") return;
	elapsed++;
	timeEl.textContent = formatTime(elapsed);
}, 1000);

window.addEventListener("pagehide", saveSession);

// --- init ---
function init() {
	autoCheck.checked = progress.settings.autoplay;

	const requested = new URLSearchParams(location.search).get("deal");
	if (requested !== null) {
		startDeal(Number(requested));
		return;
	}
	const session = progress.session;
	if (validSession(session)) startDeal(session.deal, session);
	else startDeal(progress.deal);
}

init();
