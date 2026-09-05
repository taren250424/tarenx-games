import "../../shared/ads/ad-slot.css";
import "../../shared/theme/base.css";
import "./style.css";
import { createSfx } from "../../shared/audio/sfx.ts";
import { mountIcons, setSoundIcon } from "../../shared/ui/icons.ts";
import { markPlayed } from "../../shared/progress/recent.ts";
import { type SlotSpec, createTable } from "../../shared/cards/table.ts";
import { GAME_MIN, clampGame, gameMax, randomGame, seedOf } from "./bank.ts";
import {
	type Board,
	type Move,
	applyMove,
	autoTarget,
	canDealRow,
	canMove,
	cloneBoard,
	dealBoard,
	dealRow,
	emptyBoard,
	grabbable,
	hasAnyMove,
	isWon,
	locate,
} from "./rules.ts";
import { COLUMNS, DECK, type SuitCount, packOf } from "./shuffle.ts";

mountIcons();
markPlayed();

const STORAGE_KEY = "tarenx.spider.progress";
const MAX_UNDO = 500;

interface Session {
	suits: SuitCount;
	game: number;
	board: Board;
	moves: number;
	elapsed: number;
}

interface Progress {
	suits: SuitCount;
	games: Record<SuitCount, number>;
	solved: string[];
	best: Record<string, { time: number; moves: number }>;
	session: Session | null;
	settings: { sound: boolean };
}

// --- state ---
let board: Board = emptyBoard(1);
let gameNumber = GAME_MIN;
let moves = 0;
let elapsed = 0;
let undoStack: { board: Board; moves: number }[] = [];
let selection: { col: number; index: number } | null = null;
let finished = false;

// --- elements ---
let boardEl = document.getElementById("board") as HTMLElement;
const gameInput = document.getElementById("game-input") as HTMLInputElement;
const timeEl = document.getElementById("time") as HTMLElement;
const movesEl = document.getElementById("moves") as HTMLElement;
const bestEl = document.getElementById("best") as HTMLElement;
const solvedEl = document.getElementById("solved") as HTMLElement;
const soundBtn = document.getElementById("sound-btn") as HTMLButtonElement;
const suitsSelect = document.getElementById("suits-select") as HTMLSelectElement;
const undoBtn = document.getElementById("undo-btn") as HTMLButtonElement;
const dealBtn = document.getElementById("deal-btn") as HTMLButtonElement;
const overlayEl = document.getElementById("overlay") as HTMLElement;
const overlayTitleEl = document.getElementById("overlay-title") as HTMLElement;
const overlayStatsEl = document.getElementById("overlay-stats") as HTMLElement;
const overlayUndoBtn = document.getElementById("overlay-undo") as HTMLButtonElement;
const overlayNextBtn = document.getElementById("overlay-next") as HTMLButtonElement;

/*
 * Face-up cards need enough of a gap to read the rank in the corner; the
 * face-down ones only have to look like a pile, so they sit tighter and buy
 * back the height.
 */
const FAN_UP = 0.28;
const FAN_DOWN = 0.13;
/** How far apart the finished runs and the waiting stock rows fan, in card widths. */
const DONE_FAN = 0.55;
const STOCK_FAN = 0.25;

/*
 * Ten columns. Finished runs collect on the left of the top row and fan
 * rightward; the stock sits on the right and its five rows fan leftward, so
 * the two grow toward each other across the gap as the game progresses.
 */
const SLOTS: SlotSpec[] = [
	{ id: "done", col: 0, row: "top", glyph: "✓" },
	{ id: "stock", col: 9, row: "top", glyph: "≡" },
	...Array.from({ length: COLUMNS }, (_, c): SlotSpec => ({
		id: `tableau:${c}`,
		col: c,
		row: "tableau",
		tall: true,
	})),
];

// --- audio ---
const play = createSfx(
	["deal", "move", "flip", "complete", "nope", "button", "win"] as const,
	() => progress.settings.sound
);

// --- persistence ---
function asSuits(value: unknown): SuitCount | null {
	return value === 1 || value === 2 || value === 4 ? value : null;
}

function loadProgress(): Progress {
	const fallback: Progress = {
		suits: 1,
		games: { 1: GAME_MIN, 2: GAME_MIN, 4: GAME_MIN },
		solved: [],
		best: {},
		session: null,
		settings: { sound: true },
	};
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<Progress>;
			const suits = asSuits(parsed.suits) ?? 1;
			return {
				suits,
				games: {
					1: clampGame(1, Number(parsed.games?.[1])),
					2: clampGame(2, Number(parsed.games?.[2])),
					4: clampGame(4, Number(parsed.games?.[4])),
				},
				solved: Array.isArray(parsed.solved) ? parsed.solved : [],
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

function scoreKey(): string {
	return `${board.suits}:${gameNumber}`;
}

function saveSession() {
	progress.session = finished
		? null
		: { suits: board.suits, game: gameNumber, board: cloneBoard(board), moves, elapsed };
	progress.suits = board.suits;
	progress.games[board.suits] = gameNumber;
	saveProgress();
}

function validSession(session: Session | null): session is Session {
	if (!session || !asSuits(session.suits)) return false;
	const b = session.board;
	if (!b || b.suits !== session.suits || !Array.isArray(b.stock) || !Array.isArray(b.done)) return false;
	if (!Array.isArray(b.tableau) || b.tableau.length !== COLUMNS) return false;
	// every card has to be somewhere, exactly once
	const seen = new Set<number>();
	for (const id of b.stock) seen.add(id);
	for (const run of b.done) {
		if (!Array.isArray(run) || run.length !== 13) return false;
		for (const id of run) seen.add(id);
	}
	for (const col of b.tableau) {
		if (!col || !Array.isArray(col.cards) || typeof col.down !== "number") return false;
		if (col.down > col.cards.length) return false;
		for (const id of col.cards) seen.add(id);
	}
	return seen.size === DECK;
}

// --- rendering ---
function render() {
	const selected = selection ? new Set(board.tableau[selection.col].cards.slice(selection.index)) : new Set();

	table.render((place) => {
		// the rows still to come, fanned so you can count them at a glance
		board.stock.forEach((id, i) => {
			place(id, { slot: "stock", dx: -STOCK_FAN * Math.floor((board.stock.length - 1 - i) / COLUMNS), faceDown: true });
		});

		// finished runs, king on top
		board.done.forEach((run, r) => {
			for (let i = run.length - 1; i >= 0; i--) place(run[i], { slot: "done", dx: DONE_FAN * r });
		});

		for (let col = 0; col < COLUMNS; col++) {
			const column = board.tableau[col];
			let dy = 0;
			column.cards.forEach((id, index) => {
				const faceDown = index < column.down;
				place(id, {
					slot: `tableau:${col}`,
					dy,
					faceDown,
					grabbable: !faceDown && grabbable(board, col, index),
					selected: selected.has(id),
				});
				dy += faceDown ? FAN_DOWN : FAN_UP;
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
	const best = progress.best[scoreKey()];
	bestEl.textContent = best ? `${formatTime(best.time)} · ${best.moves}` : "—";
	solvedEl.textContent = String(progress.solved.length);
	setSoundIcon(soundBtn, progress.settings.sound);
	table.setEnabled(!finished);
	undoBtn.disabled = !undoStack.length || finished;
	dealBtn.disabled = finished || !board.stock.length;
}

// --- moves ---
function pushUndo() {
	undoStack.push({ board: cloneBoard(board), moves });
	if (undoStack.length > MAX_UNDO) undoStack.shift();
}

function doMove(move: Move): boolean {
	if (finished || !canMove(board, move)) return false;
	pushUndo();
	const { flipped, cleared } = applyMove(board, move);
	moves++;
	play(cleared ? "complete" : flipped ? "flip" : "move");
	selection = null;
	render();
	afterMove();
	return true;
}

function dealNextRow(): boolean {
	if (finished) return false;
	if (!canDealRow(board)) {
		play("nope");
		if (board.stock.length) flashEmptyColumns();
		return false;
	}
	pushUndo();
	const cleared = dealRow(board);
	play(cleared ? "complete" : "deal");
	moves++;
	selection = null;
	render();
	afterMove();
	return true;
}

/** The classic rule: no dealing over a hole. Point at what is blocking it. */
function flashEmptyColumns() {
	for (let col = 0; col < COLUMNS; col++) {
		if (board.tableau[col].cards.length) continue;
		const el = boardEl.querySelector(`[data-drop="tableau:${col}"]`);
		if (!el) continue;
		el.addEventListener("animationend", () => el.classList.remove("nudge"), { once: true });
		el.classList.remove("nudge");
		requestAnimationFrame(() => el.classList.add("nudge"));
	}
}

function afterMove() {
	saveSession();
	if (isWon(board)) {
		finish();
		return;
	}
	if (!hasAnyMove(board)) showStuck();
}

function undo() {
	if (finished) return;
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

function finish() {
	finished = true;
	selection = null;
	const key = scoreKey();
	const previous = progress.best[key];
	const record = !previous || elapsed < previous.time || moves < previous.moves;
	progress.best[key] = previous
		? { time: Math.min(previous.time, elapsed), moves: Math.min(previous.moves, moves) }
		: { time: elapsed, moves };
	if (!progress.solved.includes(key)) progress.solved.push(key);
	progress.session = null;
	saveProgress();

	overlayEl.classList.remove("stuck");
	overlayTitleEl.textContent = "Solved!";
	overlayStatsEl.textContent = `Game #${gameNumber} · ${formatTime(elapsed)} · ${moves} moves${
		record ? " · New best!" : ""
	}`;
	overlayUndoBtn.classList.add("hidden");
	overlayNextBtn.textContent = "Next game →";
	overlayEl.classList.remove("hidden");
	play("win");
	render();
}

function showStuck() {
	overlayEl.classList.add("stuck");
	overlayTitleEl.textContent = "No moves left";
	overlayStatsEl.textContent = `Game #${gameNumber} · ${moves} moves · take some back and try another line.`;
	overlayUndoBtn.classList.remove("hidden");
	overlayNextBtn.textContent = "New game";
	overlayEl.classList.remove("hidden");
	play("nope");
}

// --- clicks ---
function clearSelection() {
	if (!selection) return;
	selection = null;
	render();
}

function clickColumn(col: number) {
	if (selection && doMove({ col: selection.col, index: selection.index, dst: col })) return;
	clearSelection();
}

function clickCard(id: number) {
	const src = locate(board, id);
	if (!src) {
		clearSelection();
		return;
	}
	if (selection) {
		if (selection.col === src.col && selection.index === src.index) {
			selection = null;
			const dst = autoTarget(board, src.col, src.index);
			if (dst !== null) doMove({ col: src.col, index: src.index, dst });
			else {
				play("nope");
				render();
			}
			return;
		}
		if (doMove({ col: selection.col, index: selection.index, dst: src.col })) return;
	}
	if (grabbable(board, src.col, src.index)) {
		selection = src;
		play("button");
	} else {
		selection = null;
	}
	render();
}

// --- table ---
function parseColumn(slot: string): number | null {
	const [kind, index] = slot.split(":");
	return kind === "tableau" ? Number(index) : null;
}

// The shared card table owns the DOM and the pointer work; these four handlers
// are the whole of what Spider has to say about it.
function buildTable() {
	return createTable({
		root: boardEl,
		cards: packOf(board.suits),
		slots: SLOTS,
		columns: COLUMNS,
		minRows: 4.6,
		handlers: {
			grab(id) {
				const src = locate(board, id);
				return src && grabbable(board, src.col, src.index)
					? board.tableau[src.col].cards.slice(src.index)
					: null;
			},
			canDrop(cards, slot) {
				const dst = parseColumn(slot);
				const src = locate(board, cards[0]);
				return dst !== null && !!src && canMove(board, { col: src.col, index: src.index, dst });
			},
			drop(cards, slot) {
				const dst = slot ? parseColumn(slot) : null;
				const src = locate(board, cards[0]);
				if (dst !== null && src && doMove({ col: src.col, index: src.index, dst })) return;
				if (dst !== null) play("nope");
				render(); // nothing legal under the pointer: the cards slide home
			},
			tap(hit) {
				// the stock answers a tap wherever on the pile it lands
				if (hit.slot === "stock") {
					dealNextRow();
					return;
				}
				if (hit.card !== null && hit.slot !== "done") {
					clickCard(hit.card);
					return;
				}
				const dst = hit.slot ? parseColumn(hit.slot) : null;
				if (dst !== null) clickColumn(dst);
				else clearSelection();
			},
		},
	});
}

let table = buildTable();

/*
 * The card faces belong to the suit count — one suit paints all eight runs as
 * spades — so switching modes rebuilds the table. Replacing the root with a
 * bare clone drops the old table's elements and listeners in one go.
 */
function rebuildTable() {
	const fresh = boardEl.cloneNode(false) as HTMLElement;
	boardEl.replaceWith(fresh);
	boardEl = fresh;
	table = buildTable();
}

// --- keyboard ---
document.addEventListener("keydown", (e) => {
	// only the game box swallows keys — a select or button keeping focus after
	// a click should not turn the shortcuts off
	if (e.target === gameInput) return;
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
	else if (key === "n") startGame(randomGame(board.suits));
	else if (key === "escape") clearSelection();
	else if (key === " " || key === "d") {
		e.preventDefault();
		dealNextRow();
	} else if (key === "enter" && !overlayEl.classList.contains("hidden")) overlayNextBtn.click();
});

// --- game lifecycle ---
// the banks decide how many games there are, so the picker says so itself
function updatePickerHint() {
	const picker = gameInput.closest(".game-picker") as HTMLElement | null;
	if (picker) {
		picker.title =
			`Game number, 1-${gameMax(board.suits)} at this suit count — every one has been proved ` +
			`winnable. Type one in and press Enter.`;
	}
}

function updateUrl() {
	window.history.replaceState(null, "", `${location.pathname}?suits=${board.suits}&game=${gameNumber}`);
}

function startGame(number: number, session?: Session) {
	let suits = session ? session.suits : (asSuits(Number(suitsSelect.value)) ?? 1);
	// a suit count whose bank is still being built cannot deal a game
	if (!gameMax(suits)) suits = ([1, 2, 4] as const).find((n) => gameMax(n)) ?? 1;
	if (suits !== board.suits) {
		board = emptyBoard(suits);
		rebuildTable();
	}
	gameNumber = clampGame(suits, number);
	board = session ? cloneBoard(session.board) : dealBoard(seedOf(suits, gameNumber), suits);
	moves = session ? session.moves : 0;
	elapsed = session ? session.elapsed : 0;
	undoStack = [];
	selection = null;
	finished = false;
	table.reset();
	overlayEl.classList.add("hidden");
	overlayEl.classList.remove("stuck");
	gameInput.value = String(gameNumber);
	suitsSelect.value = String(suits);
	updatePickerHint();
	updateUrl();
	if (!session) play("deal");
	render();
	saveSession();
}

function restart() {
	startGame(gameNumber);
}

function stepGame(delta: number) {
	const next = gameNumber + delta;
	const max = gameMax(board.suits);
	startGame(next < GAME_MIN ? max : next > max ? GAME_MIN : next);
}

// --- controls ---
// The field commits on Enter or when it loses focus — nonsense in it just snaps
// back to the game on the table rather than throwing the player to #1.
function commitGameInput() {
	const typed = Number(gameInput.value.trim());
	if (!gameInput.value.trim() || !Number.isFinite(typed)) {
		gameInput.value = String(gameNumber);
		return;
	}
	const wanted = clampGame(board.suits, typed);
	if (wanted === gameNumber) gameInput.value = String(gameNumber);
	else startGame(wanted);
}

gameInput.addEventListener("keydown", (e) => {
	if (e.key === "Enter") gameInput.blur();
	else if (e.key === "Escape") {
		gameInput.value = String(gameNumber);
		gameInput.blur();
	}
});
gameInput.addEventListener("blur", commitGameInput);
gameInput.addEventListener("focus", () => gameInput.select());

document.getElementById("prev-btn")?.addEventListener("click", () => stepGame(-1));
document.getElementById("next-game-btn")?.addEventListener("click", () => stepGame(1));
document.getElementById("random-btn")?.addEventListener("click", () => startGame(randomGame(board.suits)));
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
suitsSelect.addEventListener("change", () => {
	// a different suit count is a different bank, so the deal changes with it
	const suits = asSuits(Number(suitsSelect.value)) ?? 1;
	play("button");
	startGame(progress.games[suits]);
});
undoBtn.addEventListener("click", undo);
dealBtn.addEventListener("click", () => dealNextRow());
overlayUndoBtn.addEventListener("click", () => {
	overlayEl.classList.add("hidden");
	undo();
});
document.getElementById("overlay-restart")?.addEventListener("click", restart);
overlayNextBtn.addEventListener("click", () => {
	if (finished) stepGame(1);
	else startGame(randomGame(board.suits));
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
	for (const option of suitsSelect.options) {
		const suits = asSuits(Number(option.value));
		if (suits && !gameMax(suits)) {
			option.disabled = true;
			option.title = "The bank of proved-winnable games at this suit count is still being built.";
		}
	}

	const params = new URLSearchParams(location.search);
	const wantedSuits = asSuits(Number(params.get("suits")));
	const requested = params.get("game");
	if (requested !== null || wantedSuits !== null) {
		const suits = wantedSuits ?? progress.suits;
		suitsSelect.value = String(suits);
		startGame(requested !== null ? Number(requested) : progress.games[suits]);
		return;
	}
	const session = progress.session;
	if (validSession(session)) {
		suitsSelect.value = String(session.suits);
		startGame(session.game, session);
	} else {
		suitsSelect.value = String(progress.suits);
		startGame(progress.games[progress.suits]);
	}
}

init();
