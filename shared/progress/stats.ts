/*
 * The record every game keeps in the same shape: rounds played, rounds won,
 * the current winning streak and the longest one. One localStorage key holds
 * every game's records, keyed by the game's directory (see recent.ts) and
 * then by variant — a difficulty, a board size, a word length — so a game
 * reports the record for what the player is playing right now and the hub
 * can read every game's total without loading the game.
 *
 * Usage
 *   1. When a round ends: `const s = recordResult(won, variant)`.
 *      A puzzle that cannot be lost only ever records wins; a solitaire
 *      counts a game abandoned for a new one as a loss.
 *   2. In the result sheet: `el.innerHTML = statGrid(pairs)`, where
 *      `winPairs(s)` is the played / win rate / streak / best-streak row for
 *      a game that can be lost, and a game that cannot builds its own pairs
 *      (solved, best time) around `s.played`.
 *   3. The hub: `totalsFor(dir)` sums a game's variants.
 */

const KEY = "tarenx:stats";

export interface Stats {
	played: number;
	won: number;
	streak: number;
	bestStreak: number;
}

export interface StatPair {
	value: string | number;
	label: string;
}

type Store = Record<string, Record<string, Stats>>;

function gameDir(): string {
	return import.meta.env.BASE_URL.replace(/\//g, "");
}

function empty(): Stats {
	return { played: 0, won: 0, streak: 0, bestStreak: 0 };
}

function isStats(v: unknown): v is Stats {
	return (
		typeof v === "object" &&
		v !== null &&
		["played", "won", "streak", "bestStreak"].every((k) => typeof (v as Record<string, unknown>)[k] === "number")
	);
}

function read(): Store {
	try {
		const store: unknown = JSON.parse(localStorage.getItem(KEY) ?? "{}");
		if (typeof store !== "object" || store === null) return {};
		const clean: Store = {};
		for (const [dir, variants] of Object.entries(store as Record<string, unknown>)) {
			if (typeof variants !== "object" || variants === null) continue;
			clean[dir] = {};
			for (const [variant, s] of Object.entries(variants as Record<string, unknown>)) {
				if (isStats(s)) clean[dir][variant] = s;
			}
		}
		return clean;
	} catch {
		return {};
	}
}

function write(store: Store): void {
	try {
		localStorage.setItem(KEY, JSON.stringify(store));
	} catch {
		// storage disabled or full: the record is a convenience, not state
	}
}

export function statsFor(variant = "all", dir = gameDir()): Stats {
	return read()[dir]?.[variant] ?? empty();
}

export function recordResult(won: boolean, variant = "all", dir = gameDir()): Stats {
	const store = read();
	const s = store[dir]?.[variant] ?? empty();
	s.played++;
	if (won) {
		s.won++;
		s.streak++;
		s.bestStreak = Math.max(s.bestStreak, s.streak);
	} else {
		s.streak = 0;
	}
	(store[dir] ??= {})[variant] = s;
	write(store);
	return s;
}

/** Seeds a record once, for a game that kept its own before this store existed. */
export function importStats(variant: string, s: Stats, dir = gameDir()): void {
	const store = read();
	if (store[dir]?.[variant]) return;
	(store[dir] ??= {})[variant] = { ...s };
	write(store);
}

export function totalsFor(dir: string): Stats {
	const total = empty();
	for (const s of Object.values(read()[dir] ?? {})) {
		total.played += s.played;
		total.won += s.won;
		total.streak = Math.max(total.streak, s.streak);
		total.bestStreak = Math.max(total.bestStreak, s.bestStreak);
	}
	return total;
}

export function winRate(s: Stats): string {
	return s.played ? `${Math.round((s.won / s.played) * 100)}%` : "—";
}

export function winPairs(s: Stats): StatPair[] {
	return [
		{ value: s.played, label: "Played" },
		{ value: winRate(s), label: "Win rate" },
		{ value: s.streak, label: "Streak" },
		{ value: s.bestStreak, label: "Best streak" },
	];
}

export function statGrid(pairs: StatPair[]): string {
	return `<div class="stat-grid">${pairs
		.map(({ value, label }) => `<div><strong>${value}</strong><span>${label}</span></div>`)
		.join("")}</div>`;
}
