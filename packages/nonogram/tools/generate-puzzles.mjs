/*
 * Build-time nonogram puzzle bank generator.
 *
 * Every shipped puzzle is verified to be solvable by *line logic alone* — the
 * way a person actually solves one: look at a single row or column, work out
 * which of its cells are the same in every arrangement its clue allows, mark
 * those, repeat. A puzzle is only kept if that loop finishes the whole grid,
 * so no puzzle here ever needs a guess (and, as a consequence, each has
 * exactly one solution).
 *
 * Difficulty is the grid size — 10x10, 15x15, 20x20 — and within a size the
 * puzzles are ordered by how many solving passes the loop needed, so puzzle #1
 * is the gentlest of its bucket.
 *
 * Pictures are grown rather than sprinkled: random noise is smoothed by a
 * cellular automaton (and often mirrored), which yields the blobby, connected
 * shapes that make for readable clues instead of static.
 *
 * Usage: node tools/generate-puzzles.mjs   (writes src/puzzles.ts)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BUCKETS = [
  { name: 'easy', size: 10, count: 300 },
  { name: 'medium', size: 15, count: 250 },
  { name: 'hard', size: 20, count: 200 },
];

const UNKNOWN = 0;
const FILLED = 1;
const BLANK = 2;

// --- clues ----------------------------------------------------------------

function lineClues(cells) {
  const clues = [];
  let run = 0;
  for (const cell of cells) {
    if (cell === FILLED) run++;
    else if (run) {
      clues.push(run);
      run = 0;
    }
  }
  if (run) clues.push(run);
  return clues;
}

function gridClues(grid, n) {
  const rows = [];
  const cols = [];
  for (let r = 0; r < n; r++) {
    rows.push(lineClues(Array.from({ length: n }, (_, c) => grid[r * n + c])));
  }
  for (let c = 0; c < n; c++) {
    cols.push(lineClues(Array.from({ length: n }, (_, r) => grid[r * n + c])));
  }
  return { rows, cols };
}

// --- exact single-line solver ---------------------------------------------

/*
 * Marks every cell of one line that is forced — filled in every arrangement
 * the clue allows, or blank in every one. Feasibility is a small DP over
 * (cell index, clue index); the forward walk then visits only the states
 * reachable from the start, so each cell learns whether it can be filled,
 * blank, or neither.
 *
 * Returns 1 if the line changed, 0 if not, -1 on contradiction.
 */
function solveLine(cells, clues) {
  const n = cells.length;
  const k = clues.length;

  // fits[i][j]: clues[j..] can be laid out in cells[i..]
  const fits = Array.from({ length: n + 1 }, () => new Int8Array(k + 1).fill(-1));

  const tailBlankable = new Uint8Array(n + 1);
  tailBlankable[n] = 1;
  for (let i = n - 1; i >= 0; i--) {
    tailBlankable[i] = cells[i] !== FILLED && tailBlankable[i + 1] ? 1 : 0;
  }

  const canPlace = (i, len) => {
    if (i + len > n) return false;
    for (let x = i; x < i + len; x++) if (cells[x] === BLANK) return false;
    return i + len === n || cells[i + len] !== FILLED;
  };

  const check = (i, j) => {
    if (j === k) return tailBlankable[i];
    if (i >= n) return 0;
    const memo = fits[i][j];
    if (memo !== -1) return memo;
    let ok = 0;
    if (cells[i] !== FILLED && check(i + 1, j)) ok = 1;
    if (!ok && canPlace(i, clues[j]) && check(Math.min(i + clues[j] + 1, n), j + 1)) ok = 1;
    fits[i][j] = ok;
    return ok;
  };

  if (!check(0, 0)) return -1;

  const canFill = new Uint8Array(n);
  const canBlank = new Uint8Array(n);
  const seen = Array.from({ length: n + 1 }, () => new Uint8Array(k + 1));
  const stack = [[0, 0]];
  seen[0][0] = 1;

  while (stack.length) {
    const [i, j] = stack.pop();
    if (j === k) {
      for (let x = i; x < n; x++) canBlank[x] = 1;
      continue;
    }
    if (i >= n) continue;
    if (cells[i] !== FILLED && check(i + 1, j)) {
      canBlank[i] = 1;
      if (!seen[i + 1][j]) {
        seen[i + 1][j] = 1;
        stack.push([i + 1, j]);
      }
    }
    const len = clues[j];
    const next = Math.min(i + len + 1, n);
    if (canPlace(i, len) && check(next, j + 1)) {
      for (let x = i; x < i + len; x++) canFill[x] = 1;
      if (i + len < n) canBlank[i + len] = 1; // the gap cell after the block
      if (!seen[next][j + 1]) {
        seen[next][j + 1] = 1;
        stack.push([next, j + 1]);
      }
    }
  }

  let changed = 0;
  for (let i = 0; i < n; i++) {
    const state = canFill[i] * 2 + canBlank[i];
    if (state === 0) return -1;
    const forced = state === 2 ? FILLED : state === 1 ? BLANK : UNKNOWN;
    if (!forced) continue;
    if (cells[i] === UNKNOWN) {
      cells[i] = forced;
      changed = 1;
    } else if (cells[i] !== forced) {
      return -1;
    }
  }
  return changed;
}

// --- whole-grid line solver ------------------------------------------------

/*
 * Sweeps rows and columns until nothing more is forced. Returns the number of
 * passes it took, or null if the grid cannot be finished by line logic alone.
 */
function solveByLines(rows, cols, n) {
  const grid = new Uint8Array(n * n);
  const line = new Uint8Array(n);
  let passes = 0;

  for (;;) {
    let changed = false;
    passes++;

    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) line[c] = grid[r * n + c];
      const result = solveLine(line, rows[r]);
      if (result === -1) return null;
      if (result === 1) {
        for (let c = 0; c < n; c++) grid[r * n + c] = line[c];
        changed = true;
      }
    }

    for (let c = 0; c < n; c++) {
      for (let r = 0; r < n; r++) line[r] = grid[r * n + c];
      const result = solveLine(line, cols[c]);
      if (result === -1) return null;
      if (result === 1) {
        for (let r = 0; r < n; r++) grid[r * n + c] = line[r];
        changed = true;
      }
    }

    if (!changed) break;
    if (passes > 200) return null;
  }

  for (let i = 0; i < n * n; i++) if (grid[i] === UNKNOWN) return null;
  return { grid, passes };
}

// --- picture generation ----------------------------------------------------

function randomPicture(n) {
  const density = 0.44 + Math.random() * 0.16;
  const mirror = Math.random() < 0.45;
  let grid = new Uint8Array(n * n);

  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) {
      const src = mirror ? Math.min(c, n - 1 - c) : c;
      if (src === c) grid[r * n + c] = Math.random() < density ? FILLED : BLANK;
      else grid[r * n + c] = grid[r * n + src];
    }
  }

  // Smooth: a cell joins the majority of its 3x3 neighbourhood. Out-of-bounds
  // counts as blank, which pulls shapes away from the border and leaves the
  // clue lanes readable.
  const rounds = 2 + (Math.random() < 0.4 ? 1 : 0);
  for (let pass = 0; pass < rounds; pass++) {
    const next = new Uint8Array(n * n);
    for (let r = 0; r < n; r++) {
      for (let c = 0; c < n; c++) {
        let filled = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const rr = r + dr;
            const cc = c + dc;
            if (rr < 0 || rr >= n || cc < 0 || cc >= n) continue;
            if (grid[rr * n + cc] === FILLED) filled++;
          }
        }
        next[r * n + c] = filled >= 5 ? FILLED : BLANK;
      }
    }
    grid = next;
  }

  return grid;
}

/*
 * A picture is worth clueing only if it is neither sparse nor near-solid, and
 * if it does not lean on too many blank lines — those solve themselves and
 * make the board feel empty.
 */
function isPresentable(grid, n) {
  let filled = 0;
  for (const cell of grid) if (cell === FILLED) filled++;
  const density = filled / (n * n);
  if (density < 0.33 || density > 0.66) return false;

  let empty = 0;
  for (let r = 0; r < n; r++) {
    let any = false;
    for (let c = 0; c < n; c++) if (grid[r * n + c] === FILLED) any = true;
    if (!any) empty++;
  }
  for (let c = 0; c < n; c++) {
    let any = false;
    for (let r = 0; r < n; r++) if (grid[r * n + c] === FILLED) any = true;
    if (!any) empty++;
  }
  return empty <= Math.floor(n / 10);
}

// --- encoding --------------------------------------------------------------

/*
 * One bit per cell, row-major, high bit first, then base64 — a 20x20 picture
 * lands in 67 characters instead of 400, which keeps a bank of hundreds of
 * puzzles cheap enough to ship in the bundle.
 */
function encode(grid) {
  const bytes = new Uint8Array(Math.ceil(grid.length / 8));
  for (let i = 0; i < grid.length; i++) {
    if (grid[i] === FILLED) bytes[i >> 3] |= 1 << (7 - (i & 7));
  }
  return Buffer.from(bytes).toString('base64');
}

// --- main loop -------------------------------------------------------------

const started = Date.now();
const banks = {};

for (const { name, size, count } of BUCKETS) {
  const seen = new Set();
  const puzzles = [];
  let attempts = 0;

  while (puzzles.length < count) {
    attempts++;
    const picture = randomPicture(size);
    if (!isPresentable(picture, size)) continue;

    const str = encode(picture);
    if (seen.has(str)) continue;

    const { rows, cols } = gridClues(picture, size);
    const solved = solveByLines(rows, cols, size);
    if (!solved) continue;

    // The solver only ever marks cells it proved; if it landed anywhere else
    // than the source picture, its deductions are unsound — fail loudly rather
    // than ship a broken puzzle.
    for (let i = 0; i < size * size; i++) {
      if (solved.grid[i] !== picture[i]) throw new Error('solver disagrees with its own picture');
    }

    seen.add(str);
    puzzles.push({ str, passes: solved.passes });

    if (puzzles.length % 10 === 0) {
      console.log(
        `${name} ${puzzles.length}/${count} (${attempts} attempts, ${Math.round((Date.now() - started) / 1000)}s)`
      );
    }
  }

  // gentlest first: fewer solving passes means the deductions come easily
  puzzles.sort((a, b) => a.passes - b.passes);
  banks[name] = { size, puzzles };
  console.log(`${name}: ${puzzles.length} puzzles from ${attempts} attempts`);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '..', 'src', 'puzzles.ts');

const body = `// Generated by tools/generate-puzzles.mjs — do not edit by hand.
//
// Each puzzle is the finished picture: one bit per cell, row-major, high bit
// first, base64-encoded. The clues are derived from it at load time. Every
// picture here is solvable by line logic alone — never a guess — and puzzles
// are ordered gentlest first within each size.

export type Difficulty = "easy" | "medium" | "hard";

export interface Bank {
	size: number;
	puzzles: string[];
}

export const PUZZLES: Record<Difficulty, Bank> = {
${Object.entries(banks)
  .map(
    ([name, { size, puzzles }]) =>
      `\t${name}: {\n\t\tsize: ${size},\n\t\tpuzzles: [\n${puzzles
        .map((p) => `\t\t\t"${p.str}",`)
        .join('\n')}\n\t\t],\n\t},`
  )
  .join('\n')}
};
`;

fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, body);
console.log(
  `wrote ${outPath}: ${Object.entries(banks)
    .map(([n, b]) => `${n} ${b.puzzles.length}`)
    .join(', ')} (${Math.round((Date.now() - started) / 1000)}s)`
);
