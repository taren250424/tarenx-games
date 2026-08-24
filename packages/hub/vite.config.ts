import fs from 'fs'
import { defineConfig, normalizePath, type Plugin } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import path from 'path'

/**
 * Renders the game list into the hub's HTML at build time so crawlers
 * see the internal links without executing JavaScript.
 */
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
          const title = source.match(/<title>(.*?)<\/title>/)?.[1] ?? entry.name
          const description =
            source.match(/<meta\s+name="description"\s+content="([^"]*)"/)?.[1] ??
            ''
          return { dir: entry.name, title, description }
        })

      const links = games
        .map(
          ({ dir, title, description }) => `\t\t\t<a href="/${dir}/">
\t\t\t\t<span class="game-brand">
\t\t\t\t\t<img src="shared/${dir}/logo.svg" alt="${title}" />
\t\t\t\t\t<span class="game-name">${title}</span>
\t\t\t\t</span>
\t\t\t\t<span class="game-desc">${description}</span>
\t\t\t</a>`
        )
        .join('\n')

      return html.replace('<main></main>', `<main>\n${links}\n\t\t</main>`)
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
