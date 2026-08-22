// Grading a move against the precomputed evaluations of every legal move.
//
// Scores are converted to a winning percentage with the curve Lichess uses
// for its accuracy metric, and the grade is how much winning chance the move
// gave up relative to the best move. Mates count as 100% / 0%, so missing a
// forced mate costs as much as throwing away a won position.

import type { EngineScore, Position } from "./positions.ts";

export type Grade = "best" | "excellent" | "good" | "inaccuracy" | "mistake" | "blunder";

export const GRADE_LABEL: Record<Grade, string> = {
	best: "Best",
	excellent: "Excellent",
	good: "Good",
	inaccuracy: "Inaccuracy",
	mistake: "Mistake",
	blunder: "Blunder",
};

export const GRADE_EMOJI: Record<Grade, string> = {
	best: "🟩",
	excellent: "🟩",
	good: "🟨",
	inaccuracy: "🟨",
	mistake: "🟧",
	blunder: "🟥",
};

export const GRADES: Grade[] = ["best", "excellent", "good", "inaccuracy", "mistake", "blunder"];

export interface MoveScore {
	uci: string;
	grade: Grade;
	points: number;
	/** Winning chance (0–100) after the best move and after this move. */
	winBest: number;
	winPlayed: number;
	/** Percentage points of winning chance lost. */
	loss: number;
	/** 1-based rank among legal moves; ties on score share the better rank. */
	rank: number;
	total: number;
	score: EngineScore;
	bestScore: EngineScore;
	bestUci: string;
}

export function isMate(s: EngineScore): s is string {
	return typeof s === "string";
}

export function mateIn(s: string): number {
	return Number(s.slice(1));
}

/** Winning chance in percent for the side to move. */
export function winPct(s: EngineScore): number {
	if (isMate(s)) return mateIn(s) > 0 ? 100 : 0;
	const cp = Math.max(-1500, Math.min(1500, s));
	return 50 + 50 * (2 / (1 + Math.exp(-0.00368208 * cp)) - 1);
}

/** "+1.25", "-0.40", "#3", "#-2" — from the mover's point of view. */
export function formatScore(s: EngineScore): string {
	if (isMate(s)) return `#${mateIn(s)}`;
	const pawns = s / 100;
	return (pawns > 0 ? "+" : pawns < 0 ? "−" : "") + Math.abs(pawns).toFixed(2);
}

// Ordering key: mates in fewer moves beat mates in more, any mate beats any cp.
export function scoreKey(s: EngineScore): number {
	if (isMate(s)) {
		const n = mateIn(s);
		return n > 0 ? 100000 - n : -100000 - n;
	}
	return s;
}

export function gradeFromLoss(loss: number, isTop: boolean): Grade {
	if (isTop) return "best";
	if (loss < 2) return "excellent";
	if (loss < 5) return "good";
	if (loss < 10) return "inaccuracy";
	if (loss < 20) return "mistake";
	return "blunder";
}

export function pointsFromLoss(loss: number, isTop: boolean): number {
	if (isTop) return 100;
	return Math.max(0, Math.round(100 - 4 * loss));
}

export function gradeMove(pos: Position, uci: string): MoveScore {
	const best = pos.moves[0];
	const found = pos.moves.find((m) => m[0] === uci);
	// A move the engine never reported (should not happen) counts as the worst.
	const score: EngineScore = found ? found[1] : pos.moves[pos.moves.length - 1][1];
	const winBest = winPct(best[1]);
	const winPlayed = winPct(score);
	const loss = Math.max(0, winBest - winPlayed);
	const isTop = scoreKey(score) >= scoreKey(best[1]);
	// rank: number of moves strictly better, plus one
	const better = pos.moves.filter((m) => scoreKey(m[1]) > scoreKey(score)).length;
	return {
		uci,
		grade: gradeFromLoss(loss, isTop),
		points: pointsFromLoss(loss, isTop),
		winBest,
		winPlayed,
		loss,
		rank: better + 1,
		total: pos.moves.length,
		score,
		bestScore: best[1],
		bestUci: best[0],
	};
}

export function ordinal(n: number): string {
	const s = ["th", "st", "nd", "rd"];
	const v = n % 100;
	return n + (s[(v - 20) % 10] ?? s[v] ?? s[0]);
}
