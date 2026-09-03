/*
 * Build-time Numberlink puzzle bank generator.
 *
 * A puzzle is a square grid with numbered pairs of endpoints; the player joins
 * every pair with a path of side-by-side squares so that no two paths cross
 * and no square is left empty. Every puzzle shipped here has exactly one such
 * filling, which is what makes the "every square gets used" rule a real
 * deduction tool instead of a nuisance.
 *
 * Puzzles are made backwards: the grid is first covered with random paths
 * (the intended solution), their ends become the numbered endpoints, and a
 * solver then counts the fillings of that grid. Only grids with exactly one
 * survive. Difficulty is the grid size — 5x5, 7x7, 9x9 — and within a size
 * the puzzles are ordered by how many real choices the solver had to weigh,
 * so puzzle #1 is the gentlest of its bucket.
 *
 * Usage: node tools/generate-puzzles.mjs   (writes src/puzzles.ts)
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// `longest` caps the length a path aims for; with the grid size it sets how
// many pairs a cover tends to end up with, and `pairs` is the range kept
const BUCKETS = [
  { name: 'easy', size: 5, count: 300, longest: 7, pairs: [4, 6] },
  { name: 'medium', size: 7, count: 250, longest: 13, pairs: [6, 9] },
  { name: 'hard', size: 9, count: 200, longest: 20, pairs: [8, 12] },
];

// the solver gives up on a grid after this many steps and the grid is dropped
const NODE_BUDGET = 400000;
const MIN_PATH = 3;

const FREE = -1;

function neighborsOf(n) {
  const nb = [];
  for (let i = 0; i < n * n; i++) {
    const r = Math.floor(i / n);
    const c = i % n;
    const list = [];
    if (r > 0) list.push(i - n);
    if (r < n - 1) list.push(i + n);
    if (c > 0) list.push(i - 1);
    if (c < n - 1) list.push(i + 1);
    nb.push(list);
  }
  return nb;
}

function shuffle(list) {
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

// --- path cover -----------------------------------------------------------

/*
 * Covers the grid with paths by random walks: each walk starts on a free
 * square, wanders while it can (leaning on straight runs, which read better
 * than tight squiggles), and stops at a random target length. Stubs of one or
 * two squares are then glued to the end of a neighbouring path; a stub with no
 * path end beside it sinks the whole attempt.
 *
 * No path is ever allowed to own a whole 2x2 block. A path that hairpins
 * through one leaves a pocket its neighbour could take instead, and almost
 * every such cover has a second filling; without them most covers are unique.
 */
function randomCover(n, nb, longest) {
  const owner = new Int16Array(n * n).fill(FREE);
  const paths = [];

  const blocks = (i) => {
    const r = Math.floor(i / n);
    const c = i % n;
    const list = [];
    for (const dr of [-1, 0]) {
      for (const dc of [-1, 0]) {
        if (r + dr >= 0 && r + dr + 1 < n && c + dc >= 0 && c + dc + 1 < n) {
          list.push((r + dr) * n + c + dc);
        }
      }
    }
    return list;
  };

  // would giving square `i` to path `id` complete a 2x2 block of that path?
  const closesBlock = (i, id) =>
    blocks(i).some((b) => [b, b + 1, b + n, b + n + 1].every((j) => j === i || owner[j] === id));

  const walk = (path, fromHead) => {
    let dir = 0;
    for (;;) {
      const at = fromHead ? path[path.length - 1] : path[0];
      const options = nb[at].filter((j) => owner[j] === FREE && !closesBlock(j, paths.length));
      if (!options.length) return;
      let next = options[Math.floor(Math.random() * options.length)];
      if (dir && Math.random() < 0.5 && options.includes(at + dir)) next = at + dir;
      dir = next - at;
      owner[next] = paths.length;
      if (fromHead) path.push(next);
      else path.unshift(next);
      if (path.length >= path.target) return;
    }
  };

  for (const start of shuffle([...Array(n * n).keys()])) {
    if (owner[start] !== FREE) continue;
    const path = [start];
    path.target = MIN_PATH + Math.floor(Math.random() * (longest - MIN_PATH + 1));
    owner[start] = paths.length;
    walk(path, true);
    if (path.length < path.target) walk(path, false);
    paths.push(path);
  }

  for (let p = 0; p < paths.length; p++) {
    const stub = paths[p];
    if (stub.length >= MIN_PATH) continue;
    let glued = false;
    for (const x of shuffle([stub[0], stub[stub.length - 1]])) {
      const rest = x === stub[0] ? stub : [...stub].reverse();
      for (const y of shuffle([...nb[x]])) {
        const q = owner[y];
        if (q === p) continue;
        const host = paths[q];
        if (y !== host[0] && y !== host[host.length - 1]) continue;
        for (const cell of stub) owner[cell] = q;
        if (stub.some((cell) => closesBlock(cell, q))) {
          for (const cell of stub) owner[cell] = p;
          continue;
        }
        if (y === host[host.length - 1]) host.push(...rest);
        else host.unshift(...[...rest].reverse());
        glued = true;
        break;
      }
      if (glued) break;
    }
    if (!glued) return null;
    stub.length = 0;
  }

  return paths.filter((path) => path.length);
}

// --- solver -----------------------------------------------------------------

/*
 * Counts the fillings of a grid, stopping at two. Each step extends one
 * unfinished path by a square — always the path with the fewest legal moves,
 * so forced moves are played first — and after every step two checks cut the
 * tree: each unfinished path must still be able to reach its goal through free
 * squares, and every free square must still have two neighbours it could be
 * threaded between. `choices` counts the steps where more than one move was
 * on the table, which is the number a person would experience as difficulty.
 */
function countFillings(n, nb, ends) {
  const owner = new Int8Array(n * n).fill(FREE);
  const k = ends.length;
  const head = new Int16Array(k);
  const goal = new Int16Array(k);
  const done = new Uint8Array(k);
  for (let c = 0; c < k; c++) {
    owner[ends[c][0]] = c;
    owner[ends[c][1]] = c;
    head[c] = ends[c][0];
    goal[c] = ends[c][1];
  }
  let free = n * n - 2 * k;
  let nodes = 0;
  let choices = 0;
  let solutions = 0;

  const seen = new Uint8Array(n * n);
  const queue = new Int16Array(n * n);

  const canReach = (c) => {
    seen.fill(0);
    let qh = 0;
    let qt = 0;
    queue[qt++] = head[c];
    seen[head[c]] = 1;
    while (qh < qt) {
      const at = queue[qh++];
      for (const j of nb[at]) {
        if (j === goal[c]) return true;
        if (owner[j] !== FREE || seen[j]) continue;
        seen[j] = 1;
        queue[qt++] = j;
      }
    }
    return false;
  };

  const isEnd = (j) => {
    const c = owner[j];
    return c !== FREE && !done[c] && (head[c] === j || goal[c] === j);
  };

  const consistent = () => {
    for (let c = 0; c < k; c++) if (!done[c] && !canReach(c)) return false;
    for (let i = 0; i < n * n; i++) {
      if (owner[i] !== FREE) continue;
      let ways = 0;
      for (const j of nb[i]) if (owner[j] === FREE || isEnd(j)) ways++;
      if (ways < 2) return false;
    }
    return true;
  };

  const search = () => {
    if (++nodes > NODE_BUDGET) throw new Error('budget');
    let best = -1;
    let bestMoves = null;
    for (let c = 0; c < k; c++) {
      if (done[c]) continue;
      const moves = [];
      for (const j of nb[head[c]]) if (owner[j] === FREE || j === goal[c]) moves.push(j);
      if (!moves.length) return;
      if (!bestMoves || moves.length < bestMoves.length) {
        best = c;
        bestMoves = moves;
        if (moves.length === 1) break;
      }
    }
    if (best === -1) {
      if (free === 0) solutions++;
      return;
    }
    if (bestMoves.length > 1) choices++;
    const from = head[best];
    for (const j of bestMoves) {
      const finishing = j === goal[best];
      head[best] = j;
      if (finishing) done[best] = 1;
      else {
        owner[j] = best;
        free--;
      }
      if (consistent()) search();
      if (finishing) done[best] = 0;
      else {
        owner[j] = FREE;
        free++;
      }
      head[best] = from;
      if (solutions >= 2) return;
    }
  };

  try {
    if (consistent()) search();
  } catch {
    return null;
  }
  return { solutions, choices };
}

// --- encoding ---------------------------------------------------------------

/*
 * One character per square, row-major: the pair's letter, upper-case on its
 * two endpoints and lower-case along the path between them. Pairs are lettered
 * in order of first appearance so the same grid always encodes the same way.
 */
function encode(n, paths) {
  const chars = new Array(n * n);
  const order = [];
  for (const path of paths) {
    for (const cell of path) chars[cell] = path;
  }
  for (let i = 0; i < n * n; i++) {
    const path = chars[i];
    let id = order.indexOf(path);
    if (id === -1) id = order.push(path) - 1;
    const letter = String.fromCharCode(97 + id);
    const isEnd = i === path[0] || i === path[path.length - 1];
    chars[i] = isEnd ? letter.toUpperCase() : letter;
  }
  return chars.join('');
}

// --- main loop --------------------------------------------------------------

const started = Date.now();
const banks = {};

for (const { name, size, count, longest, pairs } of BUCKETS) {
  const nb = neighborsOf(size);
  const seen = new Set();
  const puzzles = [];
  let attempts = 0;
  let covered = 0;
  let unsolvable = 0;

  while (puzzles.length < count) {
    attempts++;
    const paths = randomCover(size, nb, longest);
    if (!paths || paths.length < pairs[0] || paths.length > pairs[1]) continue;
    covered++;

    const str = encode(size, paths);
    if (seen.has(str)) continue;

    const ends = paths.map((path) => [path[0], path[path.length - 1]]);
    const result = countFillings(size, nb, ends);
    if (!result) {
      unsolvable++;
      continue;
    }
    if (result.solutions !== 1) continue;

    seen.add(str);
    puzzles.push({ str, choices: result.choices });

    if (puzzles.length % 10 === 0) {
      console.log(
        `${name} ${puzzles.length}/${count} (${attempts} attempts, ${covered} covers, ${unsolvable} over budget, ${Math.round((Date.now() - started) / 1000)}s)`
      );
    }
  }

  puzzles.sort((a, b) => a.choices - b.choices);
  banks[name] = { size, puzzles };
  console.log(`${name}: ${puzzles.length} puzzles from ${attempts} attempts`);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outPath = path.join(__dirname, '..', 'src', 'puzzles.ts');

const body = `// Generated by tools/generate-puzzles.mjs — do not edit by hand.
//
// Each puzzle is its own solution: one character per square, row-major, the
// pair's letter upper-case on its two endpoints and lower-case along the path
// between them. Every grid here has exactly one filling, and puzzles are
// ordered gentlest first within each size.

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
