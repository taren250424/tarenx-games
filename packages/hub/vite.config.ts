import fs from 'fs'
import { defineConfig, normalizePath, type Plugin } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import path from 'path'

/**
 * Renders the game list into the hub's HTML at build time so crawlers
 * see the internal links without executing JavaScript.
 *
 * Each game describes itself in its own index.html:
 *   <title>                 the name on its card
 *   <meta name="hub:tagline">   one line under the name (falls back to the
 *                           description, which is far too long for a card)
 *   <meta name="hub:category">  which chip shows it — puzzle, cards, arcade,
 *                           words or board; anything else becomes its own chip
 */
const CATEGORY_ORDER = ['puzzle', 'cards', 'arcade', 'words', 'board']
const CATEGORY_LABEL: Record<string, string> = {
  puzzle: 'Puzzle',
  cards: 'Cards',
  arcade: 'Arcade',
  words: 'Words',
  board: 'Board',
}

function meta(source: string, name: string): string | undefined {
  return source.match(new RegExp(`<meta\\s+name="${name}"\\s+content="([^"]*)"`))?.[1]
}

function label(category: string): string {
  return CATEGORY_LABEL[category] ?? category[0].toUpperCase() + category.slice(1)
}

function rank(category: string): number {
  const i = CATEGORY_ORDER.indexOf(category)
  return i < 0 ? CATEGORY_ORDER.length : i
}

function prerenderGameList(): Plugin {
  return {
    name: 'prerender-game-list',
    transformIndexHtml(html) {
      const packagesDir = path.resolve(__dirname, '..')
      const games = fs
        .readdirSync(packagesDir, { withFileTypes: true })
        .filter(
          (entry) =>
            entry.isDirectory() &&
            entry.name !== 'hub' &&
            entry.name !== 'shared'
        )
        .map((entry) => {
          const source = fs.readFileSync(
            path.join(packagesDir, entry.name, 'index.html'),
            'utf-8'
          )
          return {
            dir: entry.name,
            title: source.match(/<title>(.*?)<\/title>/)?.[1] ?? entry.name,
            tagline: meta(source, 'hub:tagline') ?? meta(source, 'description') ?? '',
            category: meta(source, 'hub:category') ?? 'other',
          }
        })

      const categories = [...new Set(games.map((g) => g.category))].sort(
        (a, b) => rank(a) - rank(b)
      )
      const chips = [['all', 'All'], ...categories.map((c) => [c, label(c)])]
        .map(
          ([key, text], i) =>
            `\t\t\t\t<button class="chip" data-filter="${key}" aria-pressed="${i === 0}">${text}</button>`
        )
        .join('\n')

      const cards = games
        .map(
          ({ dir, title, tagline, category }) => `\t\t\t\t<a class="card" href="/${dir}/" data-category="${category}">
\t\t\t\t\t<img src="shared/${dir}/logo.svg" alt="" width="64" height="64" />
\t\t\t\t\t<span class="card-name">${title}</span>
\t\t\t\t\t<span class="card-tagline">${tagline}</span>
\t\t\t\t</a>`
        )
        .join('\n')

      return html.replace(
        '<main></main>',
        `<main>
\t\t\t<nav class="chips" aria-label="Game categories">
${chips}
\t\t\t</nav>
\t\t\t<div class="grid">
${cards}
\t\t\t</div>
\t\t</main>`
      )
    },
  }
}

export default defineConfig({
  base: '/',
  plugins: [
    prerenderGameList(),
    viteStaticCopy({
      targets: [
        {
          src: normalizePath(path.resolve(__dirname, '../shared/')) + '/**/*',
          dest: 'shared',
          rename: { stripBase: 1 },
        }
      ]
    })
  ],
})
