import { defineConfig, normalizePath } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import path from 'path'

export default defineConfig({
  base: '/killer-sudoku/',
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: normalizePath(path.resolve(__dirname, '../shared/killer-sudoku')) + '/**/*',
          dest: 'shared',
          rename: { stripBase: 1 },
        }
      ]
    })
  ],
})
