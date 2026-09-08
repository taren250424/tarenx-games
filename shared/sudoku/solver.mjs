/*
 * The 9×9 sudoku engine for every sudoku-family game's build tool: the unit
 * and peer tables, a full-grid generator, a solution counter for proving
 * uniqueness, and the human solving techniques a grader runs, one function
 * each, so a variant can put its own techniques between them.
 *
 * A board is 81 digits, row-major, 0 for empty. Candidates are a bitmask per
 * cell, bit d-1 for digit d. A technique takes (board, cands, place), makes
 * at most one deduction, and says whether it changed anything; `place` is
 * how it commits a digit so the caller's bookkeeping stays in step.
 *
 * Usage
 *   import { generateSolved, countSolutions, grade } from "../../shared/sudoku/solver.mjs";
 *   const solution = generateSolved();
 *   countSolutions(puzzle) === 1;              // unique
 *   grade(puzzle);                             // 1 easy · 2 medium · 3 hard · 4 beyond
 *
 * A variant grades with its own list of [technique, level] pairs built from
 * the exports below and its own. Every technique here is sound — it only
 * drops candidates no solution uses — so a grid the techniques complete is
 * proven unique without a search.
 */

export const ALL = 0x1ff;

export const UNITS = []; // 27 units of 9 cell indices
for (let r = 0; r < 9; r++) UNITS.push(Array.from({ length: 9 }, (_, c) => r * 9 + c));
for (let c = 0; c < 9; c++) UNITS.push(Array.from({ length: 9 }, (_, r) => r * 9 + c));
for (let br = 0; br < 3; br++)
  for (let bc = 0; bc < 3; bc++)
    UNITS.push(
      Array.from({ length: 9 }, (_, k) => (br * 3 + Math.floor(k / 3)) * 9 + bc * 3 + (k % 3))
    );

export const PEERS = Array.from({ length: 81 }, () => new Set());
for (const unit of UNITS)
  for (const a of unit)
    for (const b of unit) if (a !== b) PEERS[a].add(b);

export function popcount(x) {
  let n = 0;
  while (x) {
    x &= x - 1;
    n++;
  }
  return n;
}

export function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

export function randInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

export function* combinations(arr, size, start = 0, acc = []) {
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

// --- full solution generation (diagonal boxes + backtracking) -------------

export function generateSolved() {
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

function peerMask(board, i) {
  let mask = ALL;
  for (const p of PEERS[i]) if (board[p]) mask &= ~(1 << (board[p] - 1));
  return mask;
}

export function countSolutions(board, limit = 2) {
  // most-constrained-cell heuristic
  let best = -1;
  let bestMask = 0;
  let bestCount = 10;
  for (let i = 0; i < 81; i++) {
    if (board[i]) continue;
    const mask = peerMask(board, i);
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

// --- human techniques -----------------------------------------------------

export function candidates(board) {
  const cands = new Array(81).fill(0);
  for (let i = 0; i < 81; i++) if (!board[i]) cands[i] = peerMask(board, i);
  return cands;
}

export function placer(board, cands) {
  return (i, d) => {
    board[i] = d;
    cands[i] = 0;
    for (const p of PEERS[i]) cands[p] &= ~(1 << (d - 1));
  };
}

export function nakedSingle(board, cands, place) {
  for (let i = 0; i < 81; i++) {
    if (!board[i] && popcount(cands[i]) === 1) {
      place(i, Math.log2(cands[i]) + 1);
      return true;
    }
  }
  return false;
}

export function hiddenSingle(board, cands, place) {
  for (const unit of UNITS) {
    for (let d = 1; d <= 9; d++) {
      const bit = 1 << (d - 1);
      const spots = unit.filter((i) => cands[i] & bit);
      if (spots.length === 1 && !board[spots[0]]) {
        place(spots[0], d);
        return true;
      }
    }
  }
  return false;
}

// Pointing and claiming: for each box/line pair, if a digit's candidates in
// one unit all fall inside the other unit, eliminate it from the rest of the
// other unit.
export function lockedCandidates(board, cands) {
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
          if (changed) return true;
        }
        // claiming: digit in line confined to the box → clear rest of box
        if (inLine.length >= 2 && inLine.every((i) => box.includes(i))) {
          let changed = false;
          for (const i of inBox) if (!line.includes(i)) (cands[i] &= ~bit), (changed = true);
          if (changed) return true;
        }
      }
    }
  }
  return false;
}

// `units` may be any cell groups whose digits are all distinct — a variant
// passes its own groups alongside the rows, columns and boxes.
export function nakedSubset(size, units = UNITS) {
  return (board, cands) => {
    for (const unit of units) {
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
        if (changed) return true;
      }
    }
    return false;
  };
}

export function hiddenSubset(size) {
  return (board, cands) => {
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
        if (changed) return true;
      }
    }
    return false;
  };
}

export function xWing(board, cands) {
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
          if (changed) return true;
        }
      }
    }
  }
  return false;
}

// --- grading --------------------------------------------------------------

// The classic ladder, tried in this order: level 1 = singles, 2 = locked
// candidates / pairs, 3 = triples / X-wing.
export const SUDOKU_STEPS = [
  [nakedSingle, 1],
  [hiddenSingle, 1],
  [lockedCandidates, 2],
  [nakedSubset(2), 2],
  [nakedSubset(3), 3],
  [hiddenSubset(2), 2],
  [hiddenSubset(3), 3],
  [xWing, 3],
];

// Makes one deduction with the first technique that has one and returns its
// level, or 0 when none applies.
export function step(board, cands, place, steps = SUDOKU_STEPS) {
  for (const [technique, level] of steps) {
    if (technique(board, cands, place)) return level;
  }
  return 0;
}

// Solves the puzzle by technique alone and returns the hardest level it
// needed, or 4 when it gets stuck (chains or guessing required).
export function grade(puzzle, steps = SUDOKU_STEPS) {
  const board = puzzle.slice();
  const cands = candidates(board);
  const place = placer(board, cands);
  let maxLevel = 1;
  for (;;) {
    if (!board.includes(0)) return maxLevel;
    const level = step(board, cands, place, steps);
    if (level === 0) return 4;
    if (level > maxLevel) maxLevel = level;
  }
}
