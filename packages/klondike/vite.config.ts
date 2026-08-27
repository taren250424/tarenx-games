import { defineConfig, normalizePath } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import path from 'path'

export default defineConfig({
  base: '/klondike/',
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: normalizePath(path.resolve(__dirname, '../shared/klondike')) + '/**/*',
          dest: 'shared',
          rename: { stripBase: 1 },
        }
      ]
    })
  ],
})
