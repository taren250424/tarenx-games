import "../../shared/ads/ad-slot.css";
import "./style.css";
import { createSfx } from "../../shared/audio/sfx.ts";
import { type Card, SUITS, orderedDeck, suit } from "../../shared/cards/deck.ts";
import { type SlotSpec, createTable } from "../../shared/cards/table.ts";
import { GAME_MAX, GAME_MIN, clampGame, randomGame, seedOf } from "./bank.ts";
import {
	type Board,
	type Source,
	type Target,
	applyMove,
	autoPlaySafe,
	autoTarget,
	canMove,
	canSweep,
	cardsOf,
	cloneBoard,
	dealBoard,
	drawStock,
	emptyBoard,
	grabbable,
	hasAnyMove,
	isWon,
	locate,
	playableSources,
	sameSource,
} from "./rules.ts";

const STORAGE_KEY = "tarenx.klondike.progress";
const MAX_UNDO = 500;
interface Session {
	game: number;
	draw: number;
	board: Board;
	moves: number;
	elapsed: number;
}

interface Progress {
	game: number;
	solved: string[];
	best: Record<string, { time: number; moves: number }>;
	session: Session | null;
	settings: { sound: boolean; autoplay: boolean; draw: number };
}

// --- state ---
let board: Board = emptyBoard();
let gameNumber = GAME_MIN;
let moves = 0;
let elapsed = 0;
let undoStack: { board: Board; moves: number }[] = [];
let selection: Source | null = null;
let finished = false;
let sweeping = false;

// --- elements ---
const boardEl = document.getElementById("board") as HTMLElement;
const gameInput = document.getElementById("game-input") as HTMLInputElement;
const timeEl = document.getElementById("time") as HTMLElement;
const movesEl = document.getElementById("moves") as HTMLElement;
const bestEl = document.getElementById("best") as HTMLElement;
const solvedEl = document.getElementById("solved") as HTMLElement;
const soundBtn = document.getElementById("sound-btn") as HTMLButtonElement;
const autoCheck = document.getElementById("auto-check") as HTMLInputElement;
const drawSelect = document.getElementById("draw-select") as HTMLSelectElement;
const undoBtn = document.getElementById("undo-btn") as HTMLButtonElement;
const finishBtn = document.getElementById("finish-btn") as HTMLButtonElement;
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
/** How far the top waste cards spread, in card widths — enough that the rank
 *  and the suit of the ones underneath both stay readable. */
const WASTE_FAN = 0.42;

/*
 * Seven columns. Stock and waste take the left of the top row, the four
 * foundations the right, and the gap between them is what the waste fans into.
 */
const SLOTS: SlotSpec[] = [
	{ id: "stock", col: 0, row: "top", glyph: "↻" },
	{ id: "waste", col: 1, row: "top" },
	...SUITS.map((glyph, i): SlotSpec => ({
		id: `foundation:${i}`,
		col: 3 + i,
		row: "top",
		glyph,
		className: "solid",
	})),
	...Array.from({ length: 7 }, (_, c): SlotSpec => ({
		id: `tableau:${c}`,
		col: c,
		row: "tableau",
		tall: true,
	})),
];

// --- audio ---
const play = createSfx(
	["deal", "move", "flip", "foundation", "nope", "button", "win"] as const,
	() => progress.settings.sound
);

// --- persistence ---
function loadProgress(): Progress {
	const fallback: Progress = {
		game: GAME_MIN,
		solved: [],
		best: {},
		session: null,
		settings: { sound: true, autoplay: true, draw: 3 },
	};
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (raw) {
			const parsed = JSON.parse(raw) as Partial<Progress>;
			return {
				game: clampGame(Number(parsed.game)),
				solved: Array.isArray(parsed.solved) ? parsed.solved : [],
				best: parsed.best && typeof parsed.best === "object" ? parsed.best : {},
				session: parsed.session ?? null,
				settings: {
					sound: parsed.settings?.sound ?? true,
					autoplay: parsed.settings?.autoplay ?? true,
					draw: parsed.settings?.draw === 1 ? 1 : 3,
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

function scoreKey(): string {
	return `${gameNumber}:${progress.settings.draw}`;
}

function saveSession() {
	progress.session = finished
		? null
		: { game: gameNumber, draw: progress.settings.draw, board: cloneBoard(board), moves, elapsed };
	progress.game = gameNumber;
	saveProgress();
}

function validSession(session: Session | null): session is Session {
	if (!session) return false;
	const b = session.board;
	if (!b || !Array.isArray(b.stock) || !Array.isArray(b.waste)) return false;
	if (!Array.isArray(b.foundations) || b.foundations.length !== 4) return false;
	if (!Array.isArray(b.tableau) || b.tableau.length !== 7) return false;
	// every card has to be somewhere, exactly once
	const seen = new Set<Card>();
	for (const card of [...b.stock, ...b.waste]) seen.add(card);
	for (let s = 0; s < 4; s++) for (let k = 0; k < b.foundations[s]; k++) seen.add(k * 4 + s);
	for (const col of b.tableau) {
		if (!col || !Array.isArray(col.cards) || typeof col.down !== "number") return false;
		if (col.down > col.cards.length) return false;
		for (const card of col.cards) seen.add(card);
	}
	return seen.size === 52;
}

// --- rendering ---
function render() {
	const selected = selection ? cardsOf(board, selection) : [];

	table.render((place) => {
		for (const card of board.stock) place(card, { slot: "stock", faceDown: true });

		// only the last few of the waste are spread, and only its top card moves
		const visible = progress.settings.draw === 1 ? 1 : 3;
		const spreadFrom = Math.max(0, board.waste.length - visible);
		board.waste.forEach((card, i) => {
			const top = i === board.waste.length - 1;
			place(card, {
				slot: "waste",
				dx: Math.max(0, i - spreadFrom) * WASTE_FAN,
				grabbable: top,
				selected: selected.includes(card),
			});
		});

		for (let s = 0; s < 4; s++) {
			const count = board.foundations[s];
			for (let k = 0; k < count; k++) {
				place(k * 4 + s, {
					slot: `foundation:${s}`,
					grabbable: k === count - 1,
					selected: selected.includes(k * 4 + s),
				});
			}
		}

		for (let col = 0; col < 7; col++) {
			const column = board.tableau[col];
			let dy = 0;
			column.cards.forEach((card, index) => {
				const faceDown = index < column.down;
				place(card, {
					slot: `tableau:${col}`,
					dy,
					faceDown,
					grabbable: !faceDown,
					selected: selected.includes(card),
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
	soundBtn.textContent = progress.settings.sound ? "🔊" : "🔇";
	table.setEnabled(!finished && !sweeping);
	undoBtn.disabled = !undoStack.length || finished || sweeping;
	finishBtn.classList.toggle("hidden", !canSweep(board));
}

// --- moves ---
/** The rules know which cards are safe to send up; the setting decides whether we do. */
function autoPlay(): number {
	if (!progress.settings.autoplay) return 0;
	const sent = autoPlaySafe(board);
	moves += sent;
	return sent;
}

function pushUndo() {
	undoStack.push({ board: cloneBoard(board), moves });
	if (undoStack.length > MAX_UNDO) undoStack.shift();
}

function doMove(src: Source, dst: Target): boolean {
	if (finished || sweeping || !canMove(board, src, dst)) return false;
	pushUndo();
	const flipped = applyMove(board, src, dst);
	moves++;
	play(dst.type === "foundation" ? "foundation" : flipped ? "flip" : "move");
	selection = null;
	// Cards that fly up on their own belong to the move that freed them, so one
	// undo puts the whole thing back.
	autoPlay();
	render();
	afterMove();
	return true;
}

function drawFromStock(): boolean {
	if (finished || sweeping) return false;
	if (!board.stock.length && !board.waste.length) {
		play("nope");
		return false;
	}
	pushUndo();
	const turning = board.stock.length > 0;
	drawStock(board, progress.settings.draw);
	play(turning ? "flip" : "deal");
	moves++;
	selection = null;
	autoPlay();
	render();
	afterMove();
	return true;
}

function afterMove() {
	saveSession();
	if (isWon(board)) {
		finish();
		return;
	}
	// Once the game is decided, play it out — unless the player turned the
	// automatic moves off, in which case the Finish button waits for them.
	if (canSweep(board) && progress.settings.autoplay) {
		sweep();
		return;
	}
	if (!hasAnyMove(board)) showStuck();
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

/** The tail of a won game: keep sending the next card up until it is over. */
function sweep() {
	if (sweeping || finished) return;
	sweeping = true;
	selection = null;
	renderStatus();
	const step = () => {
		for (const src of playableSources(board)) {
			const card = cardsOf(board, src)[0];
			if (card === undefined) continue;
			const dst: Target = { type: "foundation", suit: suit(card) };
			if (!canMove(board, src, dst)) continue;
			applyMove(board, src, dst);
			moves++;
			play("foundation");
			render();
			setTimeout(step, 80);
			return;
		}
		sweeping = false;
		render();
		if (isWon(board)) finish();
	};
	setTimeout(step, 120);
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
function parseTarget(id: string): Target | null {
	const [kind, index] = id.split(":");
	if (kind === "foundation") return { type: "foundation", suit: Number(index) };
	if (kind === "tableau") return { type: "tableau", col: Number(index) };
	return null; // the stock and the waste are not places to put a card
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
	const src = locate(board, card);
	if (!src) {
		clearSelection();
		return;
	}
	if (selection) {
		if (sameSource(selection, src)) {
			selection = null;
			const dst = autoTarget(board, src);
			if (dst) doMove(src, dst);
			else {
				play("nope");
				render();
			}
			return;
		}
		const dst =
			src.type === "tableau"
				? ({ type: "tableau", col: src.col } as Target)
				: src.type === "foundation"
					? ({ type: "foundation", suit: src.suit } as Target)
					: null;
		if (dst && doMove(selection, dst)) return;
	}
	if (grabbable(board, src)) {
		selection = src;
		play("button");
	} else {
		selection = null;
	}
	render();
}

// --- table ---
const table = createTable({
	root: boardEl,
	cards: orderedDeck(),
	slots: SLOTS,
	columns: 7,
	handlers: {
		grab(card) {
			const src = locate(board, card);
			return src && grabbable(board, src) ? cardsOf(board, src) : null;
		},
		canDrop(cards, slot) {
			const dst = parseTarget(slot);
			const src = locate(board, cards[0]);
			return !!dst && !!src && canMove(board, src, dst);
		},
		drop(cards, slot) {
			const dst = slot ? parseTarget(slot) : null;
			const src = locate(board, cards[0]);
			if (dst && src && doMove(src, dst)) return;
			if (dst) play("nope");
			render(); // nothing legal under the pointer: the cards slide home
		},
		tap(hit) {
			// the stock answers a tap wherever on the pile it lands
			if (hit.slot === "stock") {
				drawFromStock();
				return;
			}
			if (hit.card !== null) {
				clickCard(hit.card);
				return;
			}
			const dst = hit.slot ? parseTarget(hit.slot) : null;
			if (dst) clickTarget(dst);
			else clearSelection();
		},
	},
});

// --- keyboard ---
document.addEventListener("keydown", (e) => {
	// only the game box swallows keys — a checkbox or button keeping focus after
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
	else if (key === "n") startGame(randomGame());
	else if (key === "escape") clearSelection();
	else if (key === " " || key === "d") {
		e.preventDefault();
		drawFromStock();
	} else if (key === "enter" && !overlayEl.classList.contains("hidden")) overlayNextBtn.click();
});

// --- game lifecycle ---
function updateUrl() {
	window.history.replaceState(null, "", `${location.pathname}?game=${gameNumber}&draw=${progress.settings.draw}`);
}

function startGame(number: number, session?: Session) {
	gameNumber = clampGame(number);
	board = session ? cloneBoard(session.board) : dealBoard(seedOf(gameNumber));
	moves = session ? session.moves : 0;
	elapsed = session ? session.elapsed : 0;
	undoStack = [];
	selection = null;
	finished = false;
	sweeping = false;
	table.reset();
	overlayEl.classList.add("hidden");
	overlayEl.classList.remove("stuck");
	gameInput.value = String(gameNumber);
	updateUrl();
	if (!session) {
		play("deal");
		autoPlay();
	}
	render();
	saveSession();
}

function restart() {
	startGame(gameNumber);
}

function stepGame(delta: number) {
	const next = gameNumber + delta;
	startGame(next < GAME_MIN ? GAME_MAX : next > GAME_MAX ? GAME_MIN : next);
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
	const wanted = clampGame(typed);
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
document.getElementById("random-btn")?.addEventListener("click", () => startGame(randomGame()));
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
drawSelect.addEventListener("change", () => {
	// The cards are the same either way, so the deal stands; only how many come
	// off the stock from here changes. Records are kept per mode.
	progress.settings.draw = Number(drawSelect.value) === 1 ? 1 : 3;
	saveProgress();
	updateUrl();
	render();
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
	if (finished) stepGame(1);
	else startGame(randomGame());
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
	// the bank decides how many games there are, so the picker says so itself
	const picker = gameInput.closest(".game-picker") as HTMLElement | null;
	if (picker) {
		picker.title = `Game number, 1-${GAME_MAX} — every one has been proved winnable. Type one in and press Enter.`;
	}

	const params = new URLSearchParams(location.search);
	const draw = Number(params.get("draw"));
	if (draw === 1 || draw === 3) progress.settings.draw = draw;
	drawSelect.value = String(progress.settings.draw);
	autoCheck.checked = progress.settings.autoplay;

	const requested = params.get("game");
	if (requested !== null) {
		startGame(Number(requested));
		return;
	}
	const session = progress.session;
	if (validSession(session)) {
		progress.settings.draw = session.draw === 1 ? 1 : 3;
		drawSelect.value = String(progress.settings.draw);
		startGame(session.game, session);
	} else {
		startGame(progress.game);
	}
}

init();
