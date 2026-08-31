import { defineConfig, normalizePath } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'
import path from 'path'

export default defineConfig({
  base: '/spider/',
  plugins: [
    viteStaticCopy({
      targets: [
        {
          src: normalizePath(path.resolve(__dirname, '../shared/spider')) + '/**/*',
          dest: 'shared',
          rename: { stripBase: 1 },
        }
      ]
    })
  ],
})
