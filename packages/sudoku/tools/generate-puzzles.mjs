/*
 * Build-time sudoku puzzle bank generator.
 *
 * Generates puzzles with a guaranteed unique solution, then grades each one
 * with a human-technique solver so difficulty reflects the techniques a
 * player actually needs, not just the clue count:
 *
 *   easy   — naked/hidden singles only
 *   medium — also needs locked candidates or naked/hidden pairs
 *   hard   — also needs triples or X-wing
 *
 * Puzzles that cannot be finished with these techniques (chains/guessing
 * required) are rejected, so every shipped puzzle is solvable by pure logic.
 *
 * Usage: node tools/generate-puzzles.mjs   (writes src/puzzles.ts)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PER_DIFFICULTY = 100;

const ALL = 0x1ff; // 9 candidate bits

// --- unit / peer tables ---------------------------------------------------

const UNITS = []; // 27 units of 9 cell indices
for (let r = 0; r < 9; r++) UNITS.push(Array.from({ length: 9 }, (_, c) => r * 9 + c));
for (let c = 0; c < 9; c++) UNITS.push(Array.from({ length: 9 }, (_, r) => r * 9 + c));
for (let br = 0; br < 3; br++)
  for (let bc = 0; bc < 3; bc++)
    UNITS.push(
      Array.from({ length: 9 }, (_, k) => (br * 3 + Math.floor(k / 3)) * 9 + bc * 3 + (k % 3))
    );

const PEERS = Array.from({ length: 81 }, () => new Set());
for (const unit of UNITS)
  for (const a of unit)
    for (const b of unit) if (a !== b) PEERS[a].add(b);

// --- random helpers -------------------------------------------------------

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

// --- full solution generation (diagonal boxes + backtracking) -------------

function generateSolved() {
  const board = new Array(81).fill(0);
  // seed the three independent diagonal boxes with shuffled digits
  for (const start of [0, 30, 60]) {
    const digits = shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    const br = Math.floor(start / 27) * 3;
    const bc = Math.floor((start % 9) / 3) * 3;
    for (let k = 0; k < 9; k++) board[(br + Math.floor(k / 3)) * 9 + bc + (k % 3)] = digits[k];
  }
  return fillBoard(board) ? board : generateSolved();
}

function fillBoard(board) {
  const i = board.indexOf(0);
  if (i === -1) return true;
  let mask = ALL;
  for (const p of PEERS[i]) if (board[p]) mask &= ~(1 << (board[p] - 1));
  for (const d of shuffle([1, 2, 3, 4, 5, 6, 7, 8, 9])) {
    if (mask & (1 << (d - 1))) {
      board[i] = d;
      if (fillBoard(board)) return true;
      board[i] = 0;
    }
  }
  return false;
}

// --- solution counting (for uniqueness) -----------------------------------

function countSolutions(board, limit = 2) {
  // most-constrained-cell heuristic
  let best = -1;
  let bestMask = 0;
  let bestCount = 10;
  for (let i = 0; i < 81; i++) {
    if (board[i]) continue;
    let mask = ALL;
    for (const p of PEERS[i]) if (board[p]) mask &= ~(1 << (board[p] - 1));
    const count = popcount(mask);
    if (count === 0) return 0;
    if (count < bestCount) {
      bestCount = count;
      best = i;
      bestMask = mask;
      if (count === 1) break;
    }
  }
  if (best === -1) return 1;
  let total = 0;
  for (let d = 1; d <= 9; d++) {
    if (bestMask & (1 << (d - 1))) {
      board[best] = d;
      total += countSolutions(board, limit - total);
      board[best] = 0;
      if (total >= limit) return total;
    }
  }
  return total;
}

function popcount(x) {
  let n = 0;
  while (x) {
    x &= x - 1;
    n++;
  }
  return n;
}

// --- digging (remove clues, keep uniqueness) ------------------------------

function digPuzzle(solution, targetRemovals) {
  const board = solution.slice();
  let removed = 0;
  for (const i of shuffle(Array.from({ length: 81 }, (_, k) => k))) {
    if (removed === targetRemovals) break;
    const saved = board[i];
    board[i] = 0;
    if (countSolutions(board) === 1) removed++;
    else board[i] = saved;
  }
  return board;
}

// --- human-technique grading ----------------------------------------------

// technique levels: 1 = singles, 2 = locked candidates / pairs,
// 3 = triples / X-wing, 4 = beyond (rejected)
function grade(puzzle) {
  const board = puzzle.slice();
  const cands = new Array(81).fill(0);
  for (let i = 0; i < 81; i++) {
    if (!board[i]) {
      let mask = ALL;
      for (const p of PEERS[i]) if (board[p]) mask &= ~(1 << (board[p] - 1));
      cands[i] = mask;
    }
  }
  let maxLevel = 1;

  const place = (i, d) => {
    board[i] = d;
    cands[i] = 0;
    for (const p of PEERS[i]) cands[p] &= ~(1 << (d - 1));
  };

  for (;;) {
    if (!board.includes(0)) return maxLevel;
    const level = step(board, cands, place);
    if (level === 0) return 4; // stuck — needs techniques we don't ship
    if (level > maxLevel) maxLevel = level;
  }
}

function step(board, cands, place) {
  // 1. naked single
  for (let i = 0; i < 81; i++) {
    if (!board[i] && popcount(cands[i]) === 1) {
      place(i, Math.log2(cands[i]) + 1);
      return 1;
    }
  }
  // 2. hidden single
  for (const unit of UNITS) {
    for (let d = 1; d <= 9; d++) {
      const bit = 1 << (d - 1);
      const spots = unit.filter((i) => cands[i] & bit);
      if (spots.length === 1 && !board[spots[0]]) {
        place(spots[0], d);
        return 1;
      }
    }
  }
  // 3. locked candidates (pointing + claiming): for each box/line pair,
  // if a digit's candidates in one unit all fall inside the other unit,
  // eliminate it from the rest of the other unit.
  for (let u = 0; u < 18; u++) {
    for (let v = 18; v < 27; v++) {
      const line = UNITS[u];
      const box = UNITS[v];
      const inter = line.filter((i) => box.includes(i));
      if (inter.length < 2) continue;
      for (let d = 1; d <= 9; d++) {
        const bit = 1 << (d - 1);
        const inLine = line.filter((i) => cands[i] & bit);
        const inBox = box.filter((i) => cands[i] & bit);
        // pointing: digit in box confined to the line → clear rest of line
        if (inBox.length >= 2 && inBox.every((i) => line.includes(i))) {
          let changed = false;
          for (const i of inLine) if (!box.includes(i)) (cands[i] &= ~bit), (changed = true);
          if (changed) return 2;
        }
        // claiming: digit in line confined to the box → clear rest of box
        if (inLine.length >= 2 && inLine.every((i) => box.includes(i))) {
          let changed = false;
          for (const i of inBox) if (!line.includes(i)) (cands[i] &= ~bit), (changed = true);
          if (changed) return 2;
        }
      }
    }
  }
  // 4/5. naked subsets (pairs then triples)
  for (const size of [2, 3]) {
    for (const unit of UNITS) {
      const empty = unit.filter((i) => !board[i]);
      for (const combo of combinations(empty, size)) {
        const union = combo.reduce((m, i) => m | cands[i], 0);
        if (popcount(union) !== size) continue;
        let changed = false;
        for (const i of empty) {
          if (!combo.includes(i) && cands[i] & union) {
            cands[i] &= ~union;
            changed = true;
          }
        }
        if (changed) return size;
      }
    }
  }
  // 4/5. hidden subsets (pairs then triples)
  for (const size of [2, 3]) {
    for (const unit of UNITS) {
      const empty = unit.filter((i) => !board[i]);
      for (const digits of combinations([1, 2, 3, 4, 5, 6, 7, 8, 9], size)) {
        const mask = digits.reduce((m, d) => m | (1 << (d - 1)), 0);
        const spots = empty.filter((i) => cands[i] & mask);
        if (spots.length !== size) continue;
        if (!digits.every((d) => spots.some((i) => cands[i] & (1 << (d - 1))))) continue;
        let changed = false;
        for (const i of spots) {
          if (cands[i] & ~mask) {
            cands[i] &= mask;
            changed = true;
          }
        }
        if (changed) return size;
      }
    }
  }
  // 6. X-wing (rows and columns)
  for (let d = 1; d <= 9; d++) {
    const bit = 1 << (d - 1);
    for (const byRow of [true, false]) {
      const lines = [];
      for (let a = 0; a < 9; a++) {
        const cells = [];
        for (let b = 0; b < 9; b++) {
          const i = byRow ? a * 9 + b : b * 9 + a;
          if (cands[i] & bit) cells.push(b);
        }
        lines.push(cells);
      }
      for (let a1 = 0; a1 < 9; a1++) {
        if (lines[a1].length !== 2) continue;
        for (let a2 = a1 + 1; a2 < 9; a2++) {
          if (lines[a2].length !== 2) continue;
          if (lines[a1][0] !== lines[a2][0] || lines[a1][1] !== lines[a2][1]) continue;
          let changed = false;
          for (const b of lines[a1]) {
            for (let a = 0; a < 9; a++) {
              if (a === a1 || a === a2) continue;
              const i = byRow ? a * 9 + b : b * 9 + a;
              if (cands[i] & bit) {
                cands[i] &= ~bit;
                changed = true;
              }
            }
          }
          if (changed) return 3;
        }
      }
    }
  }
  return 0;
}

function* combinations(arr, size, start = 0, acc = []) {
  if (acc.length === size) {
    yield acc.slice();
    return;
  }
  for (let i = start; i <= arr.length - (size - acc.length); i++) {
    acc.push(arr[i]);
    yield* combinations(arr, size, i + 1, acc);
    acc.pop();
  }
}

// --- main loop ------------------------------------------------------------

const buckets = { easy: [], medium: [], hard: [] };
const seen = new Set();
const LEVEL_TO_BUCKET = { 1: 'easy', 2: 'medium', 3: 'hard' };

const started = Date.now();
let attempts = 0;

while (Object.values(buckets).some((b) => b.length < PER_DIFFICULTY)) {
  attempts++;
  const needEasy = buckets.easy.length < PER_DIFFICULTY;
  const needHard = buckets.hard.length < PER_DIFFICULTY;
  // fewer removals lean easy, more lean hard
  const removals = needEasy && !needHard ? randInt(40, 47) : randInt(46, 58);

  const solution = generateSolved();
  const puzzle = digPuzzle(solution, removals);
  const level = grade(puzzle);
  const bucket = LEVEL_TO_BUCKET[level];
  if (!bucket || buckets[bucket].length >= PER_DIFFICULTY) continue;

  const str = puzzle.join('');
  if (seen.has(str)) continue;
  seen.add(str);
  buckets[bucket].push(str);

  if (attempts % 25 === 0 || Object.values(buckets).every((b) => b.length >= PER_DIFFICULTY)) {
    console.log(
      `attempt ${attempts}: easy ${buckets.easy.length} · medium ${buckets.medium.length} · hard ${buckets.hard.length} (${Math.round((Date.now() - started) / 1000)}s)`
    );
  }
}

// sort each bucket by clue count (desc) so puzzle #1 is the gentlest
for (const bucket of Object.values(buckets)) {
  bucket.sort((a, b) => clueCount(b) - clueCount(a));
}

function clueCount(str) {
  let n = 0;
  for (const ch of str) if (ch !== '0') n++;
  return n;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '..', 'src', 'puzzles.ts');

const body = `// Generated by tools/generate-puzzles.mjs — do not edit by hand.
//
// Each puzzle is 81 chars, row-major, '0' for an empty cell. Every puzzle
// has a unique solution and is solvable with human techniques only:
// easy = singles, medium = + locked candidates & pairs, hard = + triples & X-wing.

export type Difficulty = "easy" | "medium" | "hard";

export const PUZZLES: Record<Difficulty, string[]> = {
${Object.entries(buckets)
  .map(
    ([name, list]) =>
      `\t${name}: [\n${list.map((p) => `\t\t"${p}",`).join('\n')}\n\t],`
  )
  .join('\n')}
};
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, body);
console.log(
  `wrote ${outPath}: ${Object.entries(buckets)
    .map(([n, l]) => `${n} ${l.length}`)
    .join(', ')} (${attempts} attempts, ${Math.round((Date.now() - started) / 1000)}s)`
);
