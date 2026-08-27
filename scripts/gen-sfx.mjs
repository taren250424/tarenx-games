// Synthesizes each game's sound effects as 16-bit mono WAV files under its
// public/audio/ directory. The files are committed; re-run this script only
// when tuning the sounds. The noise generator is not seeded, so regeneration
// changes the bytes of every file it writes — pass game names to regenerate
// only those games.
//
//   node scripts/gen-sfx.mjs [game ...]

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const RATE = 22050;

function silence(seconds) {
	return new Float64Array(Math.round(seconds * RATE));
}

// Adds a sine tone (with optional pitch sweep and extra harmonics) into `out`.
function tone(out, { freq, endFreq = freq, start = 0, dur, amp = 1, attack = 0.005, tau = dur / 3, harmonics = [] }) {
	const s0 = Math.round(start * RATE);
	const n = Math.round(dur * RATE);
	let phase = 0;
	for (let i = 0; i < n && s0 + i < out.length; i++) {
		const t = i / RATE;
		const f = freq + (endFreq - freq) * (i / n);
		phase += (2 * Math.PI * f) / RATE;
		const env = Math.min(1, t / attack) * Math.exp(-t / tau);
		let v = Math.sin(phase);
		for (const [mult, a] of harmonics) v += a * Math.sin(phase * mult);
		out[s0 + i] += amp * env * v;
	}
}

// Adds a decaying noise burst into `out`. `lowpass` in (0, 1]: smaller = duller.
function noise(out, { start = 0, dur, amp = 1, tau = dur / 3, lowpass = 1 }) {
	const s0 = Math.round(start * RATE);
	const n = Math.round(dur * RATE);
	let y = 0;
	for (let i = 0; i < n && s0 + i < out.length; i++) {
		const t = i / RATE;
		y += lowpass * (Math.random() * 2 - 1 - y);
		out[s0 + i] += amp * Math.exp(-t / tau) * y;
	}
}

function writeWav(file, samples) {
	let peak = 0;
	for (const v of samples) peak = Math.max(peak, Math.abs(v));
	const scale = peak > 0 ? 0.85 / peak : 0;
	const buf = Buffer.alloc(44 + samples.length * 2);
	buf.write("RIFF", 0);
	buf.writeUInt32LE(36 + samples.length * 2, 4);
	buf.write("WAVE", 8);
	buf.write("fmt ", 12);
	buf.writeUInt32LE(16, 16); // fmt chunk size
	buf.writeUInt16LE(1, 20); // PCM
	buf.writeUInt16LE(1, 22); // mono
	buf.writeUInt32LE(RATE, 24);
	buf.writeUInt32LE(RATE * 2, 28); // byte rate
	buf.writeUInt16LE(2, 32); // block align
	buf.writeUInt16LE(16, 34); // bits per sample
	buf.write("data", 36);
	buf.writeUInt32LE(samples.length * 2, 40);
	for (let i = 0; i < samples.length; i++) {
		const v = Math.max(-1, Math.min(1, samples[i] * scale));
		buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
	}
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, buf);
	console.log(`${file} (${buf.length} bytes)`);
}

// C major notes used by the jingles
const C5 = 523.25;
const E5 = 659.25;
const G5 = 783.99;
const C6 = 1046.5;

// --- blockdrop ---
const blockdrop = {};

// hard-drop thud: low pitch drop + dull noise impact
blockdrop.drop = silence(0.18);
tone(blockdrop.drop, { freq: 130, endFreq: 42, dur: 0.16, amp: 1, tau: 0.05 });
noise(blockdrop.drop, { dur: 0.06, amp: 0.55, tau: 0.015, lowpass: 0.25 });

// line clear: bright upward sweep with a light octave shimmer
blockdrop.clear = silence(0.4);
tone(blockdrop.clear, { freq: 420, endFreq: 1250, dur: 0.32, amp: 1, tau: 0.14, harmonics: [[2, 0.35]] });

// level up: quick ascending arpeggio
blockdrop.levelup = silence(0.6);
[C5, E5, G5, C6].forEach((f, i) => {
	tone(blockdrop.levelup, { freq: f, start: i * 0.09, dur: 0.22, amp: 0.8, tau: 0.07, harmonics: [[2, 0.25]] });
});

// game over: slow descending minor line
blockdrop.gameover = silence(0.85);
[392, 311.13, 261.63, 196].forEach((f, i) => {
	tone(blockdrop.gameover, { freq: f, start: i * 0.15, dur: 0.32, amp: 0.8, tau: 0.1, harmonics: [[2, 0.15]] });
});

// --- sokoban ---
const sokoban = {};

// blocked move: short dull knock
sokoban.bump = silence(0.1);
tone(sokoban.bump, { freq: 110, endFreq: 65, dur: 0.09, amp: 1, tau: 0.025 });
noise(sokoban.bump, { dur: 0.04, amp: 0.5, tau: 0.01, lowpass: 0.2 });

// box lands on a goal: pleasant ding
sokoban.goal = silence(0.35);
tone(sokoban.goal, { freq: 880, dur: 0.32, amp: 1, tau: 0.09, harmonics: [[2, 0.3], [3, 0.12]] });

// level clear: rising jingle with a held final note
sokoban.clear = silence(0.9);
[C5, E5, G5].forEach((f, i) => {
	tone(sokoban.clear, { freq: f, start: i * 0.11, dur: 0.2, amp: 0.7, tau: 0.06, harmonics: [[2, 0.2]] });
});
tone(sokoban.clear, { freq: C6, start: 0.33, dur: 0.55, amp: 0.9, tau: 0.16, harmonics: [[2, 0.2]] });

// --- minesweeper ---
const minesweeper = {};

// open a square: soft pop
minesweeper.reveal = silence(0.08);
tone(minesweeper.reveal, { freq: 620, endFreq: 420, dur: 0.06, amp: 1, tau: 0.018 });

// place/remove a flag: crisp tick
minesweeper.flag = silence(0.07);
tone(minesweeper.flag, { freq: 980, dur: 0.05, amp: 1, tau: 0.014, harmonics: [[2, 0.2]] });

// hit a mine: rumbling explosion
minesweeper.boom = silence(0.6);
noise(minesweeper.boom, { dur: 0.55, amp: 1, tau: 0.13, lowpass: 0.3 });
tone(minesweeper.boom, { freq: 95, endFreq: 28, dur: 0.5, amp: 0.9, tau: 0.14 });

// field cleared: rising jingle
minesweeper.win = silence(0.9);
[E5, G5, C6].forEach((f, i) => {
	tone(minesweeper.win, { freq: f, start: i * 0.11, dur: 0.2, amp: 0.7, tau: 0.06, harmonics: [[2, 0.2]] });
});
tone(minesweeper.win, { freq: 1318.51, start: 0.33, dur: 0.55, amp: 0.9, tau: 0.16, harmonics: [[2, 0.2]] });

// --- 2048 ---
const twenty48 = {};

// tiles slide but nothing merges: soft muted swish
twenty48.move = silence(0.09);
noise(twenty48.move, { dur: 0.07, amp: 0.5, tau: 0.02, lowpass: 0.12 });
tone(twenty48.move, { freq: 300, endFreq: 210, dur: 0.06, amp: 0.35, tau: 0.02 });

// tiles merge: bright two-note blip
twenty48.merge = silence(0.18);
tone(twenty48.merge, { freq: G5, dur: 0.09, amp: 0.8, tau: 0.03, harmonics: [[2, 0.25]] });
tone(twenty48.merge, { freq: C6, start: 0.06, dur: 0.11, amp: 0.9, tau: 0.04, harmonics: [[2, 0.25]] });

// the 2048 tile appears: rising jingle with a held final note
twenty48.win = silence(0.9);
[C5, E5, G5].forEach((f, i) => {
	tone(twenty48.win, { freq: f, start: i * 0.11, dur: 0.2, amp: 0.7, tau: 0.06, harmonics: [[2, 0.2]] });
});
tone(twenty48.win, { freq: C6, start: 0.33, dur: 0.55, amp: 0.9, tau: 0.16, harmonics: [[2, 0.25], [3, 0.1]] });

// board is stuck: slow descending line
twenty48.gameover = silence(0.8);
[C5, 415.3, 349.23, 261.63].forEach((f, i) => {
	tone(twenty48.gameover, { freq: f, start: i * 0.14, dur: 0.3, amp: 0.8, tau: 0.1, harmonics: [[2, 0.15]] });
});

// --- word-guess ---
const wordGuess = {};

// a row of tiles turns over: dry wooden clack
wordGuess.flip = silence(0.12);
noise(wordGuess.flip, { dur: 0.05, amp: 0.6, tau: 0.012, lowpass: 0.35 });
tone(wordGuess.flip, { freq: 480, endFreq: 300, dur: 0.09, amp: 0.7, tau: 0.025 });

// rejected guess: flat low buzz
wordGuess.nope = silence(0.16);
tone(wordGuess.nope, { freq: 150, dur: 0.14, amp: 0.9, tau: 0.09, harmonics: [[2, 0.5], [3, 0.3]] });

// word found: rising jingle with a held final note
wordGuess.win = silence(0.9);
[C5, E5, G5].forEach((f, i) => {
	tone(wordGuess.win, { freq: f, start: i * 0.1, dur: 0.2, amp: 0.7, tau: 0.06, harmonics: [[2, 0.2]] });
});
tone(wordGuess.win, { freq: C6, start: 0.3, dur: 0.55, amp: 0.9, tau: 0.16, harmonics: [[2, 0.25]] });

// out of guesses: short descending sigh
wordGuess.lose = silence(0.7);
[G5, E5, 349.23, 261.63].forEach((f, i) => {
	tone(wordGuess.lose, { freq: f, start: i * 0.12, dur: 0.28, amp: 0.75, tau: 0.09, harmonics: [[2, 0.15]] });
});

// --- passant ---
const passant = {};

// piece set down: dry wooden knock
passant.move = silence(0.1);
noise(passant.move, { dur: 0.04, amp: 0.5, tau: 0.01, lowpass: 0.3 });
tone(passant.move, { freq: 420, endFreq: 260, dur: 0.08, amp: 0.8, tau: 0.022 });

// capture: heavier knock with a second piece clacking off the board
passant.capture = silence(0.16);
noise(passant.capture, { dur: 0.06, amp: 0.7, tau: 0.014, lowpass: 0.35 });
tone(passant.capture, { freq: 360, endFreq: 200, dur: 0.1, amp: 0.9, tau: 0.03 });
tone(passant.capture, { freq: 560, endFreq: 380, start: 0.05, dur: 0.08, amp: 0.5, tau: 0.02 });

// best or excellent move: bright rising two-note chime
passant.best = silence(0.45);
tone(passant.best, { freq: G5, dur: 0.14, amp: 0.7, tau: 0.05, harmonics: [[2, 0.25]] });
tone(passant.best, { freq: C6, start: 0.1, dur: 0.32, amp: 0.9, tau: 0.1, harmonics: [[2, 0.25], [3, 0.1]] });

// good move or inaccuracy: single neutral ding
passant.good = silence(0.3);
tone(passant.good, { freq: E5, dur: 0.26, amp: 0.8, tau: 0.08, harmonics: [[2, 0.2]] });

// mistake or blunder: flat low buzz
passant.bad = silence(0.25);
tone(passant.bad, { freq: 160, dur: 0.22, amp: 0.9, tau: 0.09, harmonics: [[2, 0.5], [3, 0.3]] });

// --- nonogram ---
const nonogram = {};

// fill a square: soft pencil tick
nonogram.fill = silence(0.07);
tone(nonogram.fill, { freq: 700, endFreq: 560, dur: 0.05, amp: 0.9, tau: 0.014 });
noise(nonogram.fill, { dur: 0.03, amp: 0.3, tau: 0.008, lowpass: 0.4 });

// cross a square out: the same gesture, duller and lower
nonogram.cross = silence(0.07);
tone(nonogram.cross, { freq: 360, endFreq: 280, dur: 0.05, amp: 0.9, tau: 0.013 });
noise(nonogram.cross, { dur: 0.03, amp: 0.35, tau: 0.008, lowpass: 0.25 });

// clear a square: short downward swish
nonogram.erase = silence(0.09);
noise(nonogram.erase, { dur: 0.06, amp: 0.5, tau: 0.018, lowpass: 0.15 });
tone(nonogram.erase, { freq: 380, endFreq: 210, dur: 0.06, amp: 0.4, tau: 0.02 });

// out of hints: flat low buzz
nonogram.error = silence(0.16);
tone(nonogram.error, { freq: 150, dur: 0.14, amp: 0.9, tau: 0.09, harmonics: [[2, 0.5], [3, 0.3]] });

// hint spent: bright rising two-note chime
nonogram.hint = silence(0.4);
tone(nonogram.hint, { freq: G5, dur: 0.12, amp: 0.7, tau: 0.045, harmonics: [[2, 0.25]] });
tone(nonogram.hint, { freq: C6, start: 0.09, dur: 0.28, amp: 0.9, tau: 0.09, harmonics: [[2, 0.25]] });

// toolbar press: crisp tick
nonogram.button = silence(0.07);
tone(nonogram.button, { freq: 760, dur: 0.05, amp: 1, tau: 0.014, harmonics: [[2, 0.2]] });

// picture finished: rising jingle with a held final note
nonogram.win = silence(0.9);
[C5, E5, G5].forEach((f, i) => {
	tone(nonogram.win, { freq: f, start: i * 0.11, dur: 0.2, amp: 0.7, tau: 0.06, harmonics: [[2, 0.2]] });
});
tone(nonogram.win, { freq: C6, start: 0.33, dur: 0.55, amp: 0.9, tau: 0.16, harmonics: [[2, 0.25], [3, 0.1]] });

// --- freecell ---
const freecell = {};

// a card is set down on the tableau: soft paper slap
freecell.move = silence(0.1);
noise(freecell.move, { dur: 0.05, amp: 0.6, tau: 0.012, lowpass: 0.45 });
tone(freecell.move, { freq: 300, endFreq: 190, dur: 0.06, amp: 0.35, tau: 0.018 });

// a card is parked in a free cell: the same slap, a touch higher and drier
freecell.cell = silence(0.09);
noise(freecell.cell, { dur: 0.04, amp: 0.5, tau: 0.01, lowpass: 0.6 });
tone(freecell.cell, { freq: 520, endFreq: 380, dur: 0.05, amp: 0.4, tau: 0.015 });

// a card goes up to a foundation: bright confirming blip
freecell.foundation = silence(0.2);
tone(freecell.foundation, { freq: G5, dur: 0.08, amp: 0.7, tau: 0.03, harmonics: [[2, 0.25]] });
tone(freecell.foundation, { freq: C6, start: 0.06, dur: 0.13, amp: 0.85, tau: 0.045, harmonics: [[2, 0.2]] });

// illegal move: flat low buzz
freecell.nope = silence(0.16);
tone(freecell.nope, { freq: 150, dur: 0.14, amp: 0.9, tau: 0.09, harmonics: [[2, 0.5], [3, 0.3]] });

// picking a card up / pressing a button: crisp tick
freecell.button = silence(0.07);
tone(freecell.button, { freq: 760, dur: 0.05, amp: 1, tau: 0.014, harmonics: [[2, 0.2]] });

// a new deal is thrown: four quick riffling slaps
freecell.deal = silence(0.4);
for (let i = 0; i < 5; i++) {
	noise(freecell.deal, { start: i * 0.055, dur: 0.05, amp: 0.55 - i * 0.05, tau: 0.012, lowpass: 0.5 });
}

// deal solved: rising jingle with a held final note
freecell.win = silence(0.9);
[C5, E5, G5].forEach((f, i) => {
	tone(freecell.win, { freq: f, start: i * 0.11, dur: 0.2, amp: 0.7, tau: 0.06, harmonics: [[2, 0.2]] });
});
tone(freecell.win, { freq: C6, start: 0.33, dur: 0.55, amp: 0.9, tau: 0.16, harmonics: [[2, 0.25], [3, 0.1]] });

const games = [
	["blockdrop", blockdrop],
	["sokoban", sokoban],
	["minesweeper", minesweeper],
	["2048", twenty48],
	["word-guess", wordGuess],
	["passant", passant],
	["nonogram", nonogram],
	["freecell", freecell],
];
const only = process.argv.slice(2);
for (const [game, sounds] of games) {
	if (only.length > 0 && !only.includes(game)) continue;
	for (const [name, samples] of Object.entries(sounds)) {
		writeWav(join(ROOT, "packages", game, "public", "audio", `${name}.wav`), samples);
	}
}
