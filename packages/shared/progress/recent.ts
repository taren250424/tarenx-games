/*
 * The hub's "Recently played" row.
 *
 * Every game calls `markPlayed()` once on load; the hub calls
 * `recentlyPlayed()` to read the list back. The games and the hub share one
 * origin, so one localStorage key holds the list — most recent first, capped
 * so the row stays short. A game's name is its directory, taken from Vite's
 * base path (`/2048/` → `2048`), so no game has to state it.
 */

const KEY = "tarenx:recent";
const CAP = 8;

interface Entry {
	dir: string;
	at: number;
}

function read(): Entry[] {
	try {
		const list: unknown = JSON.parse(localStorage.getItem(KEY) ?? "[]");
		return Array.isArray(list)
			? list.filter(
					(e): e is Entry =>
						typeof e === "object" && e !== null && typeof e.dir === "string" && typeof e.at === "number",
				)
			: [];
	} catch {
		return [];
	}
}

export function markPlayed(dir = import.meta.env.BASE_URL.replace(/\//g, "")): void {
	if (!dir) return;
	const rest = read().filter((e) => e.dir !== dir);
	try {
		localStorage.setItem(KEY, JSON.stringify([{ dir, at: Date.now() }, ...rest].slice(0, CAP)));
	} catch {
		// storage disabled or full: the row is a convenience, not state
	}
}

export function recentlyPlayed(limit = 4): string[] {
	return read()
		.slice(0, limit)
		.map((e) => e.dir);
}
