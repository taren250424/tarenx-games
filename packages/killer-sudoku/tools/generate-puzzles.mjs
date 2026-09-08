/*
 * Build-time killer sudoku puzzle bank generator.
 *
 * A killer puzzle is a full grid with cages laid over it and no digits
 * given: each cage shows the sum of its cells, and no digit repeats inside
 * one. The tool generates a solved grid with the shared engine, grows cages
 * over it at random, and grades the puzzle by the techniques a player needs.
 * The techniques are sound, so a puzzle they finish is proven to have that
 * one solution — no search needed:
 *
 *   easy   — cage combinations in small cages, singles, the 45 rule on one
 *            row, column or box
 *   medium — also combinations in big cages, a digit a cage must hold
 *            pointing at its peers, locked candidates, pairs, the 45 rule
 *            across two units
 *   hard   — also triples, X-wing, the 45 rule across three units
 *
 * Puzzles that cannot be finished this way are rejected, so every shipped
 * puzzle is solvable by pure logic.
 *
 * Usage: node tools/generate-puzzles.mjs   (writes src/puzzles.ts)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PEERS,
  UNITS,
  candidates,
  generateSolved,
  hiddenSingle,
  hiddenSubset,
  lockedCandidates,
  nakedSingle,
  nakedSubset,
  placer,
  popcount,
  randInt,
  shuffle,
  step,
  xWing,
} from '../../shared/sudoku/solver.mjs';

const PER_DIFFICULTY = 100;
const IDS = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
// one-cell cages are digits given away; a few are fine, a scatter is not
const MAX_SINGLETONS = 3;

// How big the cages are, by the difficulty an attempt aims for: a weight per
// size 1–5. One-cell cages give a digit away, so only the easy mix has them.
const SIZE_WEIGHTS = {
  easy: [2, 45, 38, 15, 0],
  medium: [0, 30, 40, 25, 5],
  hard: [0, 20, 35, 30, 15],
};

// --- cage layout ----------------------------------------------------------

const NEIGHBOURS = Array.from({ length: 81 }, (_, i) => {
  const r = Math.floor(i / 9);
  const c = i % 9;
  const out = [];
  if (r > 0) out.push(i - 9);
  if (r < 8) out.push(i + 9);
  if (c > 0) out.push(i - 1);
  if (c < 8) out.push(i + 1);
  return out;
});

function pickSize(weights) {
  let roll = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let size = 1; size <= weights.length; size++) {
    roll -= weights[size - 1];
    if (roll < 0) return size;
  }
  return weights.length;
}

// Grows cages over the solved grid: each starts at a free cell and takes
// random free neighbours whose digit it does not hold yet. A cage left with
// one cell joins a neighbour that can take it, so singletons only survive
// where the mix allows them.
function layoutCages(solution, weights) {
  const cageOf = new Array(81).fill(-1);
  const cages = [];
  for (const start of shuffle(Array.from({ length: 81 }, (_, k) => k))) {
    if (cageOf[start] !== -1) continue;
    const target = pickSize(weights);
    const cells = [start];
    const digits = new Set([solution[start]]);
    cageOf[start] = cages.length;
    while (cells.length < target) {
      const options = [];
      for (const c of cells)
        for (const n of NEIGHBOURS[c])
          if (cageOf[n] === -1 && !digits.has(solution[n]) && !options.includes(n)) options.push(n);
      if (options.length === 0) break;
      const next = options[randInt(0, options.length - 1)];
      cells.push(next);
      digits.add(solution[next]);
      cageOf[next] = cages.length;
    }
    cages.push(cells);
  }
  const maxSize = weights.length;
  for (const cage of cages) {
    if (cage.length !== 1) continue;
    const cell = cage[0];
    const hosts = shuffle(
      [...new Set(NEIGHBOURS[cell].map((n) => cageOf[n]))].filter((id) => {
        const host = cages[id];
        return host.length > 1 && host.length < maxSize && !host.some((c) => solution[c] === solution[cell]);
      })
    );
    if (hosts.length === 0) continue;
    cages[hosts[0]].push(cell);
    cageOf[cell] = hosts[0];
    cage.length = 0;
  }
  return cages.filter((cage) => cage.length > 0).map((cells) => cells.sort((a, b) => a - b));
}

function connected(cells) {
  const set = new Set(cells);
  const seen = new Set([cells[0]]);
  const queue = [cells[0]];
  while (queue.length > 0) {
    for (const n of NEIGHBOURS[queue.pop()]) {
      if (set.has(n) && !seen.has(n)) {
        seen.add(n);
        queue.push(n);
      }
    }
  }
  return seen.size === cells.length;
}

// Cuts a cage into two connected cages of at least `minPart` cells each —
// two more sums to lean on, same solution — or null when it cannot.
function splitCage(cage, minPart) {
  if (cage.length < minPart * 2) return null;
  for (let tries = 0; tries < 20; tries++) {
    const size = randInt(minPart, cage.length - minPart);
    const part = [cage[randInt(0, cage.length - 1)]];
    while (part.length < size) {
      const options = [];
      for (const c of part)
        for (const n of NEIGHBOURS[c]) if (cage.includes(n) && !part.includes(n) && !options.includes(n)) options.push(n);
      part.push(options[randInt(0, options.length - 1)]);
    }
    const rest = cage.filter((c) => !part.includes(c));
    if (connected(rest)) return [part.sort((a, b) => a - b), rest];
  }
  return null;
}

// --- the puzzle's own constraints ------------------------------------------

function makeCages(cells, solution) {
  const cageOf = new Array(81).fill(-1);
  const cages = cells.map((cage, id) => {
    for (const c of cage) cageOf[c] = id;
    return { cells: cage, sum: cage.reduce((s, c) => s + solution[c], 0) };
  });
  return { cages, cageOf };
}

// --- killer techniques ----------------------------------------------------

// Every way the open cells of a cage can be filled: distinct digits the cage
// does not hold, each a candidate of its cell, adding up to what is left.
// Returns the digits each cell can take and the digits every filling uses.
function cageFillings(cage, board, cands) {
  const open = [];
  let need = cage.sum;
  let held = 0;
  for (const c of cage.cells) {
    if (board[c]) {
      need -= board[c];
      held |= 1 << (board[c] - 1);
    } else open.push(c);
  }
  const possible = new Array(open.length).fill(0);
  let always = 0x1ff;
  let any = false;
  const walk = (k, used, sum, picks) => {
    if (k === open.length) {
      if (sum !== need) return;
      any = true;
      always &= used;
      for (let n = 0; n < open.length; n++) possible[n] |= 1 << (picks[n] - 1);
      return;
    }
    const mask = cands[open[k]] & ~used & ~held;
    for (let d = 1; d <= 9; d++) {
      if (!(mask & (1 << (d - 1))) || sum + d > need) continue;
      picks[k] = d;
      walk(k + 1, used | (1 << (d - 1)), sum + d, picks);
    }
  };
  walk(0, 0, 0, new Array(open.length).fill(0));
  return { open, possible, always: any ? always : 0 };
}

// Drops from each cell the digits no filling of its cage puts there. Small
// cages are the bread and butter of the game; enumerating a big one is
// real work, so it counts a level higher.
function cageCombos(cages, maxOpen) {
  return (board, cands) => {
    for (const cage of cages) {
      const { open, possible } = cageFillings(cage, board, cands);
      if (open.length === 0 || open.length > maxOpen) continue;
      let changed = false;
      for (let n = 0; n < open.length; n++) {
        if (cands[open[n]] & ~possible[n]) {
          cands[open[n]] &= possible[n];
          changed = true;
        }
      }
      if (changed) return true;
    }
    return false;
  };
}

// A digit every filling of a cage uses is in the cage: if only one of its
// cells can take it, it goes there; otherwise it leaves the cells outside
// the cage that see every one of those spots.
function cageLocked(cages) {
  return (board, cands, place) => {
    for (const cage of cages) {
      const { open, possible, always } = cageFillings(cage, board, cands);
      if (open.length < 2) continue;
      for (let d = 1; d <= 9; d++) {
        const bit = 1 << (d - 1);
        if (!(always & bit)) continue;
        const spots = open.filter((_, n) => possible[n] & bit);
        if (spots.length === 1) {
          place(spots[0], d);
          return true;
        }
        let changed = false;
        for (const p of PEERS[spots[0]]) {
          if (cands[p] & bit && !cage.cells.includes(p) && spots.every((s) => PEERS[s].has(p))) {
            cands[p] &= ~bit;
            changed = true;
          }
        }
        if (changed) return true;
      }
    }
    return false;
  };
}

// The regions the 45 rule is applied to: every run of `span` consecutive
// rows or columns, and every `span` boxes side by side in a band or stack.
function regions(span) {
  const out = [];
  for (let a = 0; a + span <= 9; a++) {
    out.push(UNITS.slice(a, a + span).flat());
    out.push(UNITS.slice(9 + a, 9 + a + span).flat());
  }
  for (let band = 0; band < 3; band++) {
    for (let a = 0; a + span <= 3; a++) {
      out.push(UNITS.slice(18 + band * 3 + a, 18 + band * 3 + a + span).flat());
      out.push(
        Array.from({ length: span }, (_, k) => UNITS[18 + (a + k) * 3 + band]).flat()
      );
    }
  }
  return out.map((cells) => ({ set: new Set(cells), total: 45 * span }));
}

// The 45 rule: a region of whole units sums to 45 each. The cages inside it
// account for part of that; what is left is the sum of the region's cells in
// cages that cross its edge (innies), and equally the cells those cages have
// outside it are what the crossing cages exceed it by (outies).
function rule45(cages, cageOf, span) {
  const zones = regions(span).map(({ set, total }) => {
    const contained = [];
    const crossing = [];
    for (const id of new Set([...set].map((c) => cageOf[c]))) {
      (cages[id].cells.every((x) => set.has(x)) ? contained : crossing).push(id);
    }
    const innies = [];
    const outies = [];
    for (const id of crossing) for (const c of cages[id].cells) (set.has(c) ? innies : outies).push(c);
    const sumContained = contained.reduce((s, id) => s + cages[id].sum, 0);
    const sumCrossing = crossing.reduce((s, id) => s + cages[id].sum, 0);
    return {
      innies,
      innieSum: total - sumContained,
      outies,
      outieSum: sumContained + sumCrossing - total,
    };
  });
  return (board, cands, place) => {
    for (const zone of zones) {
      if (
        settle(zone.innies, zone.innieSum, board, cands, place) ||
        settle(zone.outies, zone.outieSum, board, cands, place)
      ) {
        return true;
      }
    }
    return false;
  };
}

// Pins the cells of a group to a known sum: one open cell takes the rest,
// and two or three keep only the digits some way of reaching it puts there.
// Cells that see each other take different digits; the rest may repeat.
function settle(cells, sum, board, cands, place) {
  const open = [];
  for (const c of cells) {
    if (board[c]) sum -= board[c];
    else open.push(c);
  }
  if (open.length === 0 || open.length > 3) return false;
  if (open.length === 1) {
    if (sum >= 1 && sum <= 9 && cands[open[0]] & (1 << (sum - 1))) {
      place(open[0], sum);
      return true;
    }
    return false;
  }
  const possible = new Array(open.length).fill(0);
  const walk = (k, total, picks) => {
    if (k === open.length) {
      if (total !== sum) return;
      for (let n = 0; n < open.length; n++) possible[n] |= 1 << (picks[n] - 1);
      return;
    }
    for (let d = 1; d <= 9; d++) {
      if (!(cands[open[k]] & (1 << (d - 1))) || total + d > sum) continue;
      if (picks.some((e, n) => n < k && e === d && PEERS[open[k]].has(open[n]))) continue;
      picks[k] = d;
      walk(k + 1, total + d, picks);
    }
  };
  walk(0, 0, new Array(open.length).fill(0));
  let changed = false;
  for (let n = 0; n < open.length; n++) {
    if (cands[open[n]] & ~possible[n]) {
      cands[open[n]] &= possible[n];
      changed = true;
    }
  }
  return changed;
}

function killerSteps(cages, cageOf) {
  const cageUnits = [...UNITS, ...cages.map((cage) => cage.cells)];
  return [
    [nakedSingle, 1],
    [hiddenSingle, 1],
    [cageCombos(cages, 3), 1],
    [rule45(cages, cageOf, 1), 1],
    [cageCombos(cages, 5), 2],
    [cageLocked(cages), 2],
    [lockedCandidates, 2],
    [nakedSubset(2, cageUnits), 2],
    [hiddenSubset(2), 2],
    [rule45(cages, cageOf, 2), 2],
    [nakedSubset(3, cageUnits), 3],
    [hiddenSubset(3), 3],
    [xWing, 3],
    [rule45(cages, cageOf, 3), 3],
  ];
}

// Solves from an empty grid by technique alone: the hardest level it needed
// and the grid it reached, or level 4 when it got stuck.
function gradeKiller(cages, cageOf) {
  const board = new Array(81).fill(0);
  const cands = candidates(board);
  const place = placer(board, cands);
  const steps = killerSteps(cages, cageOf);
  let maxLevel = 1;
  for (;;) {
    if (!board.includes(0)) return { level: maxLevel, board };
    const level = step(board, cands, place, steps);
    if (level === 0) return { level: 4, board };
    if (level > maxLevel) maxLevel = level;
  }
}

// --- main loop ------------------------------------------------------------

const buckets = { easy: [], medium: [], hard: [] };
const seen = new Set();
const LEVEL_TO_BUCKET = { 1: 'easy', 2: 'medium', 3: 'hard' };
const AIMS = ['easy', 'medium', 'hard'];

const started = Date.now();
let attempts = 0;
let stuck = 0;
let splits = 0;

// Solves the layout by technique; while it gets stuck, cuts a cage that
// still has an open cell in two and solves the new layout from the start —
// what was deduced under the old cage leaned on its digits being distinct,
// which the two halves no longer say. Cages of four or more are cut first,
// so a cage of three is cut down to a single cell — a digit given away —
// only when nothing else will do.
function settleLayout(cells, solution) {
  for (;;) {
    const { cages, cageOf } = makeCages(cells, solution);
    const { level, board } = gradeKiller(cages, cageOf);
    if (level < 4) return { level, board, cells };
    const open = cells.filter((cage) => cage.some((c) => !board[c]));
    const big = open.filter((cage) => cage.length >= 4);
    const pool = big.length > 0 ? big : open.filter((cage) => cage.length === 3);
    if (pool.length === 0) return null;
    const victim = pool[randInt(0, pool.length - 1)];
    const halves = splitCage(victim, big.length > 0 ? 2 : 1);
    if (!halves) return null;
    splits++;
    cells = cells.filter((cage) => cage !== victim).concat(halves);
  }
}

while (Object.values(buckets).some((b) => b.length < PER_DIFFICULTY)) {
  attempts++;
  const open = AIMS.filter((name) => buckets[name].length < PER_DIFFICULTY);
  const aim = open[randInt(0, open.length - 1)];

  const solution = generateSolved();
  const settled = settleLayout(layoutCages(solution, SIZE_WEIGHTS[aim]), solution);
  if (!settled) {
    stuck++;
    continue;
  }
  const { level, board, cells } = settled;
  if (cells.length > IDS.length || cells.filter((cage) => cage.length === 1).length > MAX_SINGLETONS) continue;
  if (board.some((d, i) => d !== solution[i])) {
    throw new Error(`a technique is unsound: solved to a different grid\n${solution.join('')}\n${board.join('')}`);
  }
  const bucket = LEVEL_TO_BUCKET[level];
  if (buckets[bucket].length >= PER_DIFFICULTY) continue;

  const layout = new Array(81);
  cells.forEach((cage, id) => {
    for (const c of cage) layout[c] = IDS[id];
  });
  const entry = { solution: solution.join(''), cages: layout.join('') };
  const key = entry.solution + entry.cages;
  if (seen.has(key)) continue;
  seen.add(key);
  buckets[bucket].push(entry);

  if (attempts % 25 === 0 || Object.values(buckets).every((b) => b.length >= PER_DIFFICULTY)) {
    console.log(
      `attempt ${attempts}: easy ${buckets.easy.length} · medium ${buckets.medium.length} · hard ${buckets.hard.length} (${stuck} stuck, ${splits} splits, ${Math.round((Date.now() - started) / 1000)}s)`
    );
  }
}

// more cages mean more sums to lean on, so puzzle #1 is the gentlest
for (const bucket of Object.values(buckets)) {
  bucket.sort((a, b) => cageCount(b.cages) - cageCount(a.cages));
}

function cageCount(layout) {
  return new Set(layout).size;
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '..', 'src', 'puzzles.ts');

const body = `// Generated by tools/generate-puzzles.mjs — do not edit by hand.
//
// A puzzle is its solved grid — 81 digits, row-major — and its cage layout,
// one character per cell naming the cage it belongs to. A cage's sum is the
// sum of its solution digits. Every layout pins down exactly one grid, and
// each is solvable with human techniques only: easy = cage combinations,
// singles and the 45 rule on one unit; medium = + a cage's forced digits,
// locked candidates, pairs and the 45 rule across two units; hard = + triples,
// X-wing and the 45 rule across three units.

export type Difficulty = "easy" | "medium" | "hard";

export interface Puzzle {
	solution: string;
	cages: string;
}

export const PUZZLES: Record<Difficulty, Puzzle[]> = {
${Object.entries(buckets)
  .map(
    ([name, list]) =>
      `\t${name}: [\n${list
        .map((p) => `\t\t{ solution: "${p.solution}", cages: "${p.cages}" },`)
        .join('\n')}\n\t],`
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
