## Development

- **Dev**: `pnpm dev:hub` / `pnpm dev:blockdrop` — each app runs independently; hub shows UI only, links do not work
- **Preview**: `pnpm build` → `pnpm preview` — check links from hub

## Generated data

Some games ship a data file that a tool under `packages/<game>/tools/` produced.
The output is committed, so a normal build never runs these — re-run one only
when you mean to change what the game ships.

- `packages/nonogram`, `packages/sudoku` — puzzle banks, generated and graded
- `packages/passant` — chess positions, built with a local Stockfish
- `packages/word-guess` — word lists, built from a cached dictionary download
- `packages/klondike` — the bank of Klondike games proved winnable; see below

### Extending the Klondike bank

`packages/klondike/src/winnable.ts` lists the games a solver has finished, and
the game deals only from that list. `tools/scan/` holds how far each shard has
got and is committed with it, so carrying the bank further picks up where the
last run stopped rather than starting over. Raise `--to`, run the five shards,
then merge:

```sh
cd packages/klondike
for i in 0 1 2 3 4; do
  node tools/solve.mjs --stride 5 --offset $i --to 10000 --partial &
done
wait
node tools/solve.mjs --merge
```

Expect roughly 250 seeds a minute across the five, and about two thirds of them
to end up in the bank. A shard can be stopped whenever you like — `--merge`
banks only the stretch all five have finished, and the rest waits for next time.

Scanning further seeds only appends games, so existing numbers keep pointing at
the same cards. Changing the search settings would not: it would prove seeds
that were skipped before and shift every number after them. See the header of
`tools/solve.mjs`.
