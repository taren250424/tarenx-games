import "../../shared/ads/ad-slot.css";
import "../../shared/theme/base.css";
import "./style.css";
import { Chess } from "chess.js";
import { createSfx } from "../../shared/audio/sfx.ts";
import { pieceSprite } from "./pieces.ts";
import { Board, type UserMove } from "./board.ts";
import {
	BANDS,
	difficultyOf,
	loadIndex,
	loadPosition,
	pickDaily,
	pickRandom,
	todayKey,
	yesterdayKey,
	type Difficulty,
	type Index,
	type Position,
} from "./positions.ts";
import {
	GRADES,
	GRADE_EMOJI,
	GRADE_LABEL,
	formatScore,
	gradeMove,
	ordinal,
	type Grade,
	type MoveScore,
} from "./scoring.ts";

type Mode = "quick" | "daily";

interface DailyResult {
	idx: number;
	uci: string;
	points: number;
	grade: Grade;
}

interface Progress {
	settings: { sound: boolean; difficulty: Difficulty; mode: Mode };
	totals: { played: number; points: number; grades: Record<Grade, number> };
	/** Recently played position indices, so quick play avoids repeats. */
	seen: number[];
	daily: { date: string; picks: number[]; results: DailyResult[] } | null;
	dailyHistory: { days: number; bestScore: number; streak: number; lastDate: string | null };
}

const STORAGE_KEY = "tarenx.passant.progress";
const SEEN_CAP = 600;
// Pause between moves when the best line is replayed on the board.
const LINE_STEP_MS = 750;

const DIFFICULTIES: { key: Difficulty; label: string }[] = [
	{ key: "any", label: "Any difficulty" },
	{ key: "easy", label: "Easy · up to 1200" },
	{ key: "medium", label: "Medium · 1200–1800" },
	{ key: "hard", label: "Hard · 1800+" },
];

// --- elements ---
const boardSvg = document.getElementById("board") as unknown as SVGSVGElement;
const promoEl = document.getElementById("promo") as HTMLElement;
const panelEl = document.getElementById("panel") as HTMLElement;
const modeQuickBtn = document.getElementById("mode-quick") as HTMLButtonElement;
const modeDailyBtn = document.getElementById("mode-daily") as HTMLButtonElement;
const difficultySelect = document.getElementById("difficulty-select") as HTMLSelectElement;
const statsBtn = document.getElementById("stats-btn") as HTMLButtonElement;
const soundBtn = document.getElementById("sound-btn") as HTMLButtonElement;
const turnLabel = document.getElementById("turn-label") as HTMLElement;
const posRatingEl = document.getElementById("pos-rating") as HTMLElement;
const sessionScoreEl = document.getElementById("session-score") as HTMLElement;
const dailyProgressEl = document.getElementById("daily-progress") as HTMLElement;
const statsOverlay = document.getElementById("stats-overlay") as HTMLElement;
const statsBody = document.getElementById("stats-body") as HTMLElement;
const statsClose = document.getElementById("stats-close") as HTMLButtonElement;

// --- persistence ---
function defaultProgress(): Progress {
	return {
		settings: { sound: true, difficulty: "any", mode: "quick" },
		totals: { played: 0, points: 0, grades: { best: 0, excellent: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 } },
		seen: [],
		daily: null,
		dailyHistory: { days: 0, bestScore: 0, streak: 0, lastDate: null },
	};
}

function loadProgress(): Progress {
	const base = defaultProgress();
	try {
		const raw = localStorage.getItem(STORAGE_KEY);
		if (!raw) return base;
		const saved = JSON.parse(raw) as Partial<Progress>;
		return {
			settings: { ...base.settings, ...saved.settings },
			totals: { ...base.totals, ...saved.totals, grades: { ...base.totals.grades, ...saved.totals?.grades } },
			seen: Array.isArray(saved.seen) ? saved.seen : [],
			daily: saved.daily ?? null,
			dailyHistory: { ...base.dailyHistory, ...saved.dailyHistory },
		};
	} catch {
		return base;
	}
}

function saveProgress(): void {
	try {
		localStorage.setItem(STORAGE_KEY, JSON.stringify(progress));
	} catch {
		// storage full or blocked — play on without persistence
	}
}

// --- state ---
const progress = loadProgress();
let index: Index | null = null;
let mode: Mode = progress.settings.mode;
let current: { idx: number; pos: Position } | null = null;
let answered: MoveScore | null = null;
let playedMove: UserMove | null = null;
let lineTimer: number | null = null;
const session = { played: 0, points: 0 };

document.body.insertAdjacentHTML("afterbegin", pieceSprite());
const board = new Board(boardSvg, promoEl);
const sfx = createSfx(["move", "capture", "best", "good", "bad"] as const, () => progress.settings.sound);

// --- helpers ---
function uciToMove(uci: string): UserMove {
	return { from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: (uci[4] as UserMove["promotion"]) || undefined } as UserMove;
}

function moveToUci(m: UserMove): string {
	return m.from + m.to + (m.promotion ?? "");
}

/** SAN for a UCI line from a position, with move numbers: "24. Qh8+ Kg6 25. Qh6#". */
function sanLine(fen: string, ucis: string[]): string {
	const chess = new Chess(fen);
	const parts: string[] = [];
	for (const uci of ucis) {
		const n = chess.moveNumber();
		const white = chess.turn() === "w";
		let san: string;
		try {
			san = chess.move(uciToMove(uci)).san;
		} catch {
			break;
		}
		if (white) parts.push(`${n}. ${san}`);
		else if (parts.length === 0) parts.push(`${n}... ${san}`);
		else parts.push(san);
	}
	return parts.join(" ");
}

function sanOf(fen: string, uci: string): string {
	try {
		return new Chess(fen).move(uciToMove(uci)).san;
	} catch {
		return uci;
	}
}

function themeLabel(t: string): string {
	return t
		.replace(/([A-Z])/g, " $1")
		.replace(/(\d+)/g, " $1")
		.toLowerCase()
		.trim();
}

function escapeHtml(s: string): string {
	return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);
}

function stopLine(): void {
	if (lineTimer !== null) {
		window.clearTimeout(lineTimer);
		lineTimer = null;
	}
}

// --- HUD ---
function updateHud(): void {
	if (current) {
		const turn = current.pos.fen.split(" ")[1];
		turnLabel.textContent = turn === "w" ? "White to move" : "Black to move";
		turnLabel.classList.toggle("black", turn === "b");
		const band = difficultyOf(current.pos.rating);
		posRatingEl.textContent = `${current.pos.rating} · ${BANDS[band].label}`;
	} else {
		turnLabel.textContent = mode === "daily" ? "Daily done" : "—";
		posRatingEl.textContent = "—";
	}
	turnLabel.classList.toggle("idle", !current);
	sessionScoreEl.textContent = session.played
		? `${Math.round(session.points / session.played)} avg · ${session.played} played`
		: "—";
	if (mode === "daily" && progress.daily) {
		const { results, picks } = progress.daily;
		dailyProgressEl.classList.remove("hidden");
		dailyProgressEl.innerHTML =
			`<span class="daily-dots" aria-label="Daily progress">` +
			picks
				.map((_, i) => {
					const r = results[i];
					const cls = r ? `grade-${r.grade}` : i === results.length ? "current" : "";
					const style = r ? ` style="background-color: var(--grade-${r.grade})"` : "";
					return `<span class="${cls}"${style}></span>`;
				})
				.join("") +
			`</span>`;
	} else {
		dailyProgressEl.classList.add("hidden");
	}
}

// --- presenting a position ---
async function present(idx: number): Promise<void> {
	if (!index) return;
	stopLine();
	answered = null;
	playedMove = null;
	current = null;
	panelEl.innerHTML = `<p class="hint">Loading position…</p>`;
	let pos: Position;
	try {
		pos = await loadPosition(index, idx);
	} catch {
		panelEl.innerHTML = `<h3>Could not load the position</h3><p>Check your connection and try again.</p>
			<div class="actions"><button id="retry-btn">Retry</button></div>`;
		document.getElementById("retry-btn")?.addEventListener("click", () => present(idx));
		return;
	}
	current = { idx, pos };
	showStartBoard(true);
	updateHud();
	renderPrompt();
}

function showStartBoard(interactive: boolean): void {
	if (!current) return;
	const { pos } = current;
	board.setPosition(pos.fen, {
		orientation: pos.fen.split(" ")[1] === "w" ? "w" : "b",
		lastMove: [pos.last.slice(0, 2), pos.last.slice(2, 4)] as never,
		interactive,
	});
}

function renderPrompt(): void {
	if (!current) return;
	const { pos } = current;
	const turn = pos.fen.split(" ")[1] === "w" ? "White" : "Black";
	const lastSan = lastMoveSan(pos);
	let context = "";
	if (mode === "daily" && progress.daily) {
		context = `<p class="hint">Daily 10 · position ${progress.daily.results.length + 1} of ${progress.daily.picks.length}</p>`;
	}
	panelEl.innerHTML = `
		${context}
		<h3>${turn} to move</h3>
		<p>Your opponent just played <strong>${escapeHtml(lastSan)}</strong>. Find the best reply — click a piece and then its square, or drag it.</p>
		<p class="hint">Every legal move has been graded in advance; you will see how yours compares the moment you play it.</p>
		${mode === "quick" ? `<div class="actions"><button id="skip-btn" class="secondary">Skip this one</button></div>` : ""}
	`;
	document.getElementById("skip-btn")?.addEventListener("click", () => {
		if (current) markSeen(current.idx);
		nextQuick();
	});
}

/** SAN of the opponent's setup move, reconstructed by undoing it from the FEN. */
function lastMoveSan(pos: Position): string {
	// The FEN is after the move; rebuild the position before it is not possible
	// from the FEN alone, so describe the move by squares with the piece that
	// landed there.
	const chess = new Chess(pos.fen);
	const piece = chess.get(pos.last.slice(2, 4) as never);
	const names: Record<string, string> = { p: "pawn", n: "knight", b: "bishop", r: "rook", q: "queen", k: "king" };
	const name = piece ? names[piece.type] : "piece";
	return `${name} ${pos.last.slice(0, 2)}–${pos.last.slice(2, 4)}`;
}

// --- answering ---
function onUserMove(m: UserMove): void {
	if (!current || answered) return;
	const { pos } = current;
	const uci = moveToUci(m);
	const score = gradeMove(pos, uci);
	answered = score;
	playedMove = m;

	const move = board.playMove(m);
	board.setInteractive(false);
	sfx(move?.isCapture() ? "capture" : "move");
	window.setTimeout(() => {
		sfx(score.grade === "best" || score.grade === "excellent" ? "best" : score.grade === "good" || score.grade === "inaccuracy" ? "good" : "bad");
	}, 180);
	drawResultArrows(score);

	// record
	session.played++;
	session.points += score.points;
	progress.totals.played++;
	progress.totals.points += score.points;
	progress.totals.grades[score.grade]++;
	markSeen(current.idx);
	if (mode === "daily" && progress.daily) {
		progress.daily.results.push({ idx: current.idx, uci, points: score.points, grade: score.grade });
		if (progress.daily.results.length >= progress.daily.picks.length) finishDaily();
	}
	saveProgress();
	updateHud();
	renderResult(score);
}

function markSeen(idx: number): void {
	progress.seen = progress.seen.filter((i) => i !== idx);
	progress.seen.push(idx);
	if (progress.seen.length > SEEN_CAP) progress.seen.splice(0, progress.seen.length - SEEN_CAP);
}

function drawResultArrows(score: MoveScore): void {
	const arrows = [];
	if (score.uci !== score.bestUci) {
		arrows.push({ from: score.bestUci.slice(0, 2), to: score.bestUci.slice(2, 4), cls: "best" });
	}
	arrows.push({ from: score.uci.slice(0, 2), to: score.uci.slice(2, 4), cls: score.uci === score.bestUci ? "played best" : "played" });
	board.setArrows(arrows as never);
}

function renderResult(score: MoveScore): void {
	if (!current) return;
	const { pos } = current;
	const playedSan = sanOf(pos.fen, score.uci);
	const bestSan = sanOf(pos.fen, score.bestUci);
	const isBest = score.grade === "best";

	const headline = isBest
		? score.rank === 1 && pos.moves.length > 1 && scoreGap(pos) >= 5
			? "You found it — the only move that keeps everything."
			: "Spot on — that is the engine's first choice."
		: score.grade === "excellent"
			? "Practically as good as the best move."
			: score.grade === "good"
				? "A sound move, but a stronger one was available."
				: score.grade === "inaccuracy"
					? "Playable, but it lets some of the advantage slip."
					: score.grade === "mistake"
						? "That gives away a real part of the position."
						: "That loses most of what the position offered.";

	const topN = 5;
	const listed = pos.moves.slice(0, topN);
	const playedInTop = listed.some((m) => m[0] === score.uci);
	const rows = listed.map((m, i) => moveRow(pos, m[0], m[1], i + 1, score));
	if (!playedInTop) {
		rows.push(`<li class="gap" aria-hidden="true"><span class="rank">…</span><span></span><span></span></li>`);
		rows.push(moveRow(pos, score.uci, score.score, score.rank, score));
	}

	const dailyDone = mode === "daily" && progress.daily && progress.daily.results.length >= progress.daily.picks.length;
	const nextLabel = mode === "daily" ? (dailyDone ? "See today's result" : "Next position") : "Next position";

	panelEl.innerHTML = `
		<div class="grade-badge grade-${score.grade}">
			<span>${GRADE_LABEL[score.grade]}</span><span class="pts">${score.points} pts</span>
		</div>
		<p>${headline}</p>
		<div class="move-line played"><span>You played <span class="san">${escapeHtml(playedSan)}</span></span><span class="eval">${formatScore(score.score)}</span></div>
		${isBest ? "" : `<div class="move-line best"><span>Best was <span class="san">${escapeHtml(bestSan)}</span></span><span class="eval">${formatScore(score.bestScore)}</span></div>`}
		<div class="win-bar" title="Winning chance for your side: bar after your move, line after the best move"><div class="fill" style="width:${score.winBest.toFixed(1)}%"></div><div class="mark" style="--at:${score.winBest.toFixed(1)}%"></div></div>
		<div class="win-caption"><span>${ordinal(score.rank)} of ${score.total} legal moves</span><span>${isBest ? `${score.winPlayed.toFixed(0)}% winning chance` : `${score.winBest.toFixed(0)}% → ${score.winPlayed.toFixed(0)}% (−${score.loss.toFixed(1)})`}</span></div>
		<ol class="top-moves" aria-label="Top moves">${rows.join("")}</ol>
		<div class="pv" title="Best line">${escapeHtml(sanLine(pos.fen, pos.pv))}</div>
		<div class="themes">${pos.themes.map((t) => `<span class="theme">${escapeHtml(themeLabel(t))}</span>`).join("")}</div>
		<div class="actions">
			<button id="next-btn">${nextLabel}</button>
			<button id="line-btn" class="secondary">Show best line</button>
		</div>
	`;
	document.getElementById("next-btn")?.addEventListener("click", next);
	document.getElementById("line-btn")?.addEventListener("click", toggleBestLine);
	requestAnimationFrame(() => {
		const fill = panelEl.querySelector<HTMLElement>(".win-bar .fill");
		if (fill) fill.style.width = `${score.winPlayed.toFixed(1)}%`;
	});
}

function scoreGap(pos: Position): number {
	if (pos.moves.length < 2) return 100;
	return gradeMove(pos, pos.moves[1][0]).loss;
}

function moveRow(pos: Position, uci: string, s: Position["moves"][number][1], rank: number, score: MoveScore): string {
	const cls = [uci === score.uci ? "played" : "", rank === 1 ? "best" : ""].filter(Boolean).join(" ");
	return `<li class="${cls}"><span class="rank">${rank}.</span><span class="san">${escapeHtml(sanOf(pos.fen, uci))}${uci === score.uci ? " ← you" : ""}</span><span class="eval">${formatScore(s)}</span></li>`;
}

let showingLine = false;

function toggleBestLine(): void {
	if (!current || !answered) return;
	const btn = document.getElementById("line-btn");
	if (showingLine) {
		stopLine();
		showingLine = false;
		showStartBoard(false);
		if (playedMove) board.playMove(playedMove);
		drawResultArrows(answered);
		if (btn) btn.textContent = "Show best line";
		return;
	}
	showingLine = true;
	if (btn) btn.textContent = "Back to your move";
	const { pos } = current;
	showStartBoard(false);
	let i = 0;
	const step = () => {
		if (!showingLine || i >= pos.pv.length) {
			lineTimer = null;
			return;
		}
		const m = board.playMove(uciToMove(pos.pv[i]));
		sfx(m?.isCapture() ? "capture" : "move");
		i++;
		lineTimer = window.setTimeout(step, LINE_STEP_MS);
	};
	lineTimer = window.setTimeout(step, 300);
}

function next(): void {
	stopLine();
	showingLine = false;
	if (mode === "quick") nextQuick();
	else startDaily();
}

// --- quick play ---
function nextQuick(): void {
	if (!index) return;
	const idx = pickRandom(index, progress.settings.difficulty, new Set(progress.seen));
	present(idx);
}

// --- daily ---
function startDaily(): void {
	if (!index) return;
	const date = todayKey();
	if (!progress.daily || progress.daily.date !== date) {
		progress.daily = { date, picks: pickDaily(index, date), results: [] };
		saveProgress();
	}
	const { picks, results } = progress.daily;
	if (results.length >= picks.length) {
		renderDailySummary();
		return;
	}
	present(picks[results.length]);
}

function finishDaily(): void {
	if (!progress.daily) return;
	const total = progress.daily.results.reduce((s, r) => s + r.points, 0);
	const h = progress.dailyHistory;
	const today = progress.daily.date;
	if (h.lastDate !== today) {
		h.streak = h.lastDate === yesterdayKey() ? h.streak + 1 : 1;
		h.lastDate = today;
		h.days++;
	}
	h.bestScore = Math.max(h.bestScore, total);
}

function dailyShareText(): string {
	if (!progress.daily) return "";
	const { date, results } = progress.daily;
	const total = results.reduce((s, r) => s + r.points, 0);
	const squares = results.map((r) => GRADE_EMOJI[r.grade]).join("");
	return `Passant Daily ${date}\n${squares} ${total}/${results.length * 100}\nhttps://games.tarenx.com/passant/`;
}

async function renderDailySummary(): Promise<void> {
	if (!index || !progress.daily) return;
	stopLine();
	current = null;
	answered = null;
	const { results, picks } = progress.daily;
	const total = results.reduce((s, r) => s + r.points, 0);
	const h = progress.dailyHistory;
	// show the last position on a locked board
	const lastIdx = picks[picks.length - 1];
	try {
		const pos = await loadPosition(index, lastIdx);
		current = { idx: lastIdx, pos };
		showStartBoard(false);
		const r = results[results.length - 1];
		if (r) {
			board.playMove(uciToMove(r.uci));
			drawResultArrows(gradeMove(pos, r.uci));
		}
		current = null;
	} catch {
		// board stays as it was
	}
	updateHud();
	const best = results.filter((r) => r.grade === "best").length;
	panelEl.innerHTML = `
		<h3>Daily 10 · ${progress.daily.date}</h3>
		<div class="big-score">${total}<span style="font-size:1rem;color:var(--muted)"> / ${results.length * 100}</span></div>
		<p>${best} of ${results.length} best moves found. ${h.streak > 1 ? `Streak: ${h.streak} days.` : "Come back tomorrow for a new set."}</p>
		<div class="share-box" id="share-box">${escapeHtml(dailyShareText())}</div>
		<div class="actions">
			<button id="copy-btn">Copy result</button>
			<button id="to-quick-btn" class="secondary">Keep playing</button>
		</div>
	`;
	document.getElementById("copy-btn")?.addEventListener("click", async () => {
		const btn = document.getElementById("copy-btn");
		try {
			await navigator.clipboard.writeText(dailyShareText());
			if (btn) btn.textContent = "Copied!";
		} catch {
			if (btn) btn.textContent = "Select the text above to copy";
		}
	});
	document.getElementById("to-quick-btn")?.addEventListener("click", () => setMode("quick"));
}

// --- modes & controls ---
function setMode(m: Mode): void {
	mode = m;
	progress.settings.mode = m;
	saveProgress();
	modeQuickBtn.setAttribute("aria-selected", String(m === "quick"));
	modeDailyBtn.setAttribute("aria-selected", String(m === "daily"));
	difficultySelect.disabled = m === "daily";
	stopLine();
	showingLine = false;
	if (m === "quick") nextQuick();
	else startDaily();
}

function renderStats(): void {
	const t = progress.totals;
	const h = progress.dailyHistory;
	const avg = t.played ? Math.round(t.points / t.played) : 0;
	const bestRate = t.played ? Math.round((t.grades.best / t.played) * 100) : 0;
	const max = Math.max(1, ...GRADES.map((g) => t.grades[g]));
	statsBody.innerHTML = `
		<div class="stats-grid">
			<div class="stat"><strong>${t.played}</strong><span>moves played</span></div>
			<div class="stat"><strong>${avg}</strong><span>average points</span></div>
			<div class="stat"><strong>${bestRate}%</strong><span>best-move rate</span></div>
			<div class="stat"><strong>${h.streak}</strong><span>daily streak</span></div>
			<div class="stat"><strong>${h.days}</strong><span>dailies played</span></div>
			<div class="stat"><strong>${h.bestScore}</strong><span>best daily score</span></div>
		</div>
		<div class="grade-bars">
			${GRADES.map(
				(g) =>
					`<div class="row"><span>${GRADE_LABEL[g]}</span><div class="bar grade-${g}" style="width:${(t.grades[g] / max) * 100}%"></div><span class="n">${t.grades[g]}</span></div>`
			).join("")}
		</div>
	`;
}

function updateSoundBtn(): void {
	soundBtn.textContent = progress.settings.sound ? "🔊" : "🔇";
	soundBtn.title = progress.settings.sound ? "Sound on" : "Sound off";
}

function bindControls(): void {
	for (const d of DIFFICULTIES) {
		const opt = document.createElement("option");
		opt.value = d.key;
		opt.textContent = d.label;
		difficultySelect.appendChild(opt);
	}
	difficultySelect.value = progress.settings.difficulty;
	difficultySelect.addEventListener("change", () => {
		progress.settings.difficulty = difficultySelect.value as Difficulty;
		saveProgress();
		if (mode === "quick" && !answered) nextQuick();
	});
	modeQuickBtn.addEventListener("click", () => setMode("quick"));
	modeDailyBtn.addEventListener("click", () => setMode("daily"));
	soundBtn.addEventListener("click", () => {
		progress.settings.sound = !progress.settings.sound;
		saveProgress();
		updateSoundBtn();
	});
	updateSoundBtn();
	statsBtn.addEventListener("click", () => {
		renderStats();
		statsOverlay.classList.remove("hidden");
	});
	statsClose.addEventListener("click", () => statsOverlay.classList.add("hidden"));
	statsOverlay.addEventListener("click", (e) => {
		if (e.target === statsOverlay) statsOverlay.classList.add("hidden");
	});
	document.addEventListener("keydown", (e) => {
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
		if (!statsOverlay.classList.contains("hidden")) {
			if (e.key === "Escape") statsOverlay.classList.add("hidden");
			return;
		}
		if ((e.key === "Enter" || e.key === " " || e.key.toLowerCase() === "n") && answered) {
			e.preventDefault();
			next();
		} else if (e.key.toLowerCase() === "l" && answered) {
			toggleBestLine();
		}
	});
	board.setMoveHandler(onUserMove);
}

async function start(): Promise<void> {
	bindControls();
	panelEl.innerHTML = `<p class="hint">Loading positions…</p>`;
	try {
		index = await loadIndex();
	} catch {
		panelEl.innerHTML = `<h3>Could not load the positions</h3><p>Check your connection and reload the page.</p>`;
		return;
	}
	setMode(mode);
}

start();
