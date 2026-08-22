/*
 * Build-time word bank generator.
 *
 * Pulls two tiers from the English Speller Database (ESDB, the successor to
 * SCOWL) and turns them into one module per word length:
 *
 *   answers — size 35 ("small"): words an ordinary speaker recognises. Sampling
 *             the next tier up turns up abaft, cozen, demur, fakir, tumid and
 *             whelk, which are real words but feel like a cheat as an answer,
 *             so 35 is where the line sits.
 *   allowed — size 70: a wide dictionary, so typing a real word never gets
 *             rejected even when it would never be the answer.
 *
 * Answers additionally drop plurals and third-person verbs (SHOES, WALKS): a
 * trailing S makes the last tile a giveaway. Both lists drop slurs; answers
 * also drop crude and violent words that are fine to type but jarring to be
 * asked for.
 *
 * The generated files are committed — re-run this only to refresh the lists.
 *
 * Usage: node tools/build-words.mjs   (writes src/words-{4,5,6}.ts)
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CACHE = path.join(ROOT, "tools", ".cache");
const SRC = path.join(ROOT, "src");

const LENGTHS = [4, 5, 6];
const ANSWER_TIER = 35;
const ALLOWED_TIER = 70;

// Slurs. Removed from both lists: they should not be answers, and accepting
// them as guesses only invites people to type them at the board.
const SLURS = new Set([
	"abo", "chink", "coon", "dago", "darkie", "fag", "faggot", "gippo", "gook",
	"gyp", "gypped", "jap", "kaffir", "kafir", "kike", "negro", "nigga",
	"nigger", "paki", "pickaninny", "raghead", "retard", "spic", "spick",
	"tranny", "wetback", "wog", "wop", "yid",
]);

// Ordinary dictionary words that make a poor thing to demand of a player.
// Still accepted as guesses — being told "not a word" for a real word is worse.
const NOT_ANSWERS = new Set([
	"arse", "bitch", "bloody", "boobs", "booze", "cocks", "crap", "crappy",
	"cunt", "damn", "dick", "dildo", "dyke", "fatso", "fuck", "hell", "horny",
	"incest", "jizz", "molest", "murder", "nazi", "penis", "piss", "porn",
	"porno", "prick", "pubic", "pussy", "queer", "rape", "raped", "rapes",
	"rapist", "satan", "screw", "semen", "sex", "sexy", "shit", "shits",
	"shitty", "slut", "sluts", "suicide", "turd", "twat", "vagina", "wanker",
	"whore", "whores",
]);

// The morphology rules below key off "is the stem also a word", which misreads
// a handful of ordinary words: NUMBER looks like NUMB + comparative because
// NUMBEST exists, CUTTER like CUT + ER because of CUTEST, WICKED like a past
// tense because WICK is a word. These are worth having as answers, so they are
// put back by hand. Not an exhaustive list — it is what turned up on review.
const KEEP_AS_ANSWERS = new Set([
	"cutter", "diver", "dogged", "earner", "elder", "gamer", "infer", "inner",
	"jagged", "liver", "lower", "mutter", "number", "opener", "outing", "rating",
	"rugged", "temper", "wicked",
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
		console.log(`size ${size}: using cached ${path.relative(ROOT, file)}`);
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

const LICENCE = `// Word lists derived from the English Speller Database (ESDB, previously
// SCOWL) at https://wordlist.aspell.net — size ${ANSWER_TIER} for answers, size ${ALLOWED_TIER} for
// accepted guesses, US spelling.
//
// Copyright 2000-2026 by Kevin Atkinson
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

function emit(length, answers, allowed) {
	const body = `// Generated by tools/build-words.mjs — do not edit by hand.
//
${LICENCE}

export const LENGTH = ${length};

// Sorted and concatenated with no separator — every word is exactly LENGTH
// characters, so slice(i * LENGTH) reads one and a binary search tests one.
export const ANSWERS =
	"${answers.join("")}";

export const ALLOWED =
	"${allowed.join("")}";
`;
	const file = path.join(SRC, `words-${length}.ts`);
	fs.writeFileSync(file, body);
	return file;
}

async function main() {
	const answerTier = parseTier(await fetchTier(ANSWER_TIER));
	const allowedTier = parseTier(await fetchTier(ALLOWED_TIER));

	// Judging a trailing S needs the widest vocabulary available: SHOES is a
	// plural because SHOE is a word, while GLASS survives because GLAS is not.
	// The spelling changes have to be undone too, or BABIES and WOLVES slip past.
	const vocabulary = new Set(allowedTier);
	const isInflection = (w) => {
		if (!w.endsWith("s")) return false;
		if (vocabulary.has(w.slice(0, -1))) return true; // shoes -> shoe, walks -> walk
		if (!w.endsWith("es")) return false;
		if (vocabulary.has(w.slice(0, -2))) return true; // boxes -> box
		if (w.endsWith("ies") && vocabulary.has(`${w.slice(0, -3)}y`)) return true; // babies -> baby
		if (w.endsWith("ves")) {
			const stem = w.slice(0, -3);
			// leaves -> leaf, knives -> knife
			if (vocabulary.has(`${stem}f`) || vocabulary.has(`${stem}fe`)) return true;
		}
		return false;
	};

	// Regular -ed / -ing forms of an everyday verb are the same cheap trick as a
	// plural: MIKED, CLUING and SULKED are all technically common words, but
	// being asked for one feels like a swindle. Comparatives go too, spotted by
	// the matching superlative — that keeps agent nouns like FARMER and BOXER,
	// whose base takes no -est.
	const has = (w) => vocabulary.has(w);
	const isDerived = (w) => {
		if (w.endsWith("ed")) {
			const stems = [w.slice(0, -1), w.slice(0, -2)]; // ached -> ache, looked -> look
			if (w.endsWith("ied")) stems.push(`${w.slice(0, -3)}y`); // tried -> try
			if (/(.)\1ed$/.test(w)) stems.push(w.slice(0, -3)); // petted -> pet
			if (stems.some(has)) return true;
		}
		if (w.endsWith("ing")) {
			const stems = [w.slice(0, -3), `${w.slice(0, -3)}e`]; // owning -> own, aching -> ache
			if (/(.)\1ing$/.test(w)) stems.push(w.slice(0, -4)); // petting -> pet
			if (stems.some(has)) return true;
		}
		if (w.endsWith("est")) {
			const stems = [w.slice(0, -2), w.slice(0, -3)]; // hugest -> huge, tallest -> tall
			if (/(.)\1est$/.test(w)) stems.push(w.slice(0, -4)); // biggest -> big
			if (stems.some(has)) return true;
		}
		if (w.endsWith("er")) {
			const stems = [w.slice(0, -1), w.slice(0, -2)]; // abler -> able, bolder -> bold
			if (/(.)\1er$/.test(w)) stems.push(w.slice(0, -3)); // redder -> red
			// only a comparative if the superlative exists too
			if (stems.some((s) => has(s) && (has(`${s}st`) || has(`${s}est`)))) return true;
		}
		return false;
	};

	console.log("");
	for (const length of LENGTHS) {
		const allowed = allowedTier
			.filter((w) => w.length === length && !SLURS.has(w))
			.sort();

		const pool = answerTier.filter((w) => w.length === length);
		const answers = pool
			.filter((w) => !SLURS.has(w) && !NOT_ANSWERS.has(w))
			.filter((w) => KEEP_AS_ANSWERS.has(w) || (!isInflection(w) && !isDerived(w)))
			.sort();

		// A guess of the answer itself has to be accepted.
		const allowedSet = new Set(allowed);
		const orphans = answers.filter((w) => !allowedSet.has(w));
		if (orphans.length > 0) {
			throw new Error(
				`${length}-letter answers missing from the allowed list: ${orphans.slice(0, 5).join(", ")}`
			);
		}

		const file = emit(length, answers, allowed);
		const dropped = pool.length - answers.length;
		console.log(
			`${length} letters  answers ${String(answers.length).padStart(5)} ` +
				`(${String(dropped).padStart(4)} dropped from tier ${ANSWER_TIER})  ` +
				`allowed ${String(allowed.length).padStart(6)}  →  ${path.relative(ROOT, file)}`
		);
	}
}

main();
