/*
 * The English Speller Database (ESDB, the successor to SCOWL) for every
 * word game's build tool: one download per size tier, cached beside this
 * file, and the words no list should carry.
 *
 * A tier is a vocabulary size — 35 is "small", the words an ordinary speaker
 * recognises; 70 is a wide dictionary. Each game's tool picks the tiers it
 * needs and does its own filtering; only the fetch, the parse, the blocklists
 * and the licence header live here.
 *
 * Usage
 *   import { loadTier, SLURS, CRUDE, ESDB_LICENCE } from "../../shared/words/esdb.mjs";
 *   const words = await loadTier(35);   // string[], plain lowercase only
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CACHE = path.join(path.dirname(fileURLToPath(import.meta.url)), ".cache");

// Slurs. No list should carry them: they should never be answers, and
// accepting them as guesses only invites people to type them at the board.
export const SLURS = new Set([
	"abo", "chink", "coon", "dago", "darkie", "fag", "faggot", "gippo", "gook",
	"gyp", "gypped", "jap", "kaffir", "kafir", "kike", "negro", "nigga",
	"nigger", "paki", "pickaninny", "raghead", "retard", "spic", "spick",
	"tranny", "wetback", "wog", "wop", "yid",
]);

// Ordinary dictionary words that make a poor thing to demand of a player.
export const CRUDE = new Set([
	"arse", "bitch", "bloody", "boobs", "booze", "cocks", "crap", "crappy",
	"cunt", "damn", "dick", "dildo", "dyke", "fatso", "fuck", "hell", "horny",
	"incest", "jizz", "molest", "murder", "nazi", "penis", "piss", "porn",
	"porno", "prick", "pubic", "pussy", "queer", "rape", "raped", "rapes",
	"rapist", "satan", "screw", "semen", "sex", "sexy", "shit", "shits",
	"shitty", "slut", "sluts", "suicide", "turd", "twat", "vagina", "wanker",
	"whore", "whores",
]);

function tierUrl(size) {
	const params = new URLSearchParams({
		max_size: String(size),
		spelling: "US",
		diacritic: "strip",
		download: "wordlist",
		encoding: "utf-8",
		format: "inline",
	});
	return `http://app.aspell.net/create?${params}`;
}

async function fetchTier(size) {
	const file = path.join(CACHE, `esdb-${size}.txt`);
	if (fs.existsSync(file)) {
		console.log(`size ${size}: using cached ${path.relative(process.cwd(), file)}`);
		return fs.readFileSync(file, "utf8");
	}
	console.log(`size ${size}: downloading...`);
	const res = await fetch(tierUrl(size));
	if (!res.ok) throw new Error(`ESDB size ${size} returned ${res.status}`);
	const text = await res.text();
	fs.mkdirSync(CACHE, { recursive: true });
	fs.writeFileSync(file, text);
	return text;
}

// The generator prefixes every list with its licence header, then a --- line.
function parseTier(text) {
	const marker = "\n---\n";
	const at = text.indexOf(marker);
	if (at === -1) throw new Error("ESDB response is missing its --- separator");
	return text
		.slice(at + marker.length)
		.split("\n")
		.map((w) => w.trim())
		// plain lowercase only: drops proper nouns, possessives, abbreviations
		.filter((w) => /^[a-z]+$/.test(w));
}

export async function loadTier(size) {
	return parseTier(await fetchTier(size));
}

// Goes at the top of every generated list, after a line saying which tiers
// the list came from.
export const ESDB_LICENCE = `// Copyright 2000-2026 by Kevin Atkinson
//
// Permission to use, copy, modify, distribute, and sell any part of the English
// Speller Database (ESDB, previously known as SCOWLv2), or word lists
// created from it, is hereby granted without fee, provided that the above
// copyright notice appears in all copies and that both the above copyright
// notice and this notice appear in supporting documentation.  Kevin Atkinson
// makes no representations about the suitability of this database for any
// purpose.  It is provided "as is" without express or implied warranty.
//
// ESDB's own upstream credits are reproduced in THIRD-PARTY-NOTICES.md at the
// repository root.`;
