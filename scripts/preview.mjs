import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const packagesDir = path.join(rootDir, 'packages');
const hubDist = path.join(packagesDir, 'hub', 'dist');

const entries = await fs.readdir(packagesDir, { withFileTypes: true });
const apps = entries
  .filter(entry => entry.isDirectory() && entry.name !== 'hub' && entry.name !== 'shared')
  .map(entry => entry.name);

for (const app of apps) {
  const appDist = path.join(packagesDir, app, 'dist');
  await fs.cp(appDist, path.join(hubDist, app), {
    recursive: true,
    force: true,
  });
}

execSync('pnpm --filter hub preview', { cwd: rootDir, stdio: 'inherit' });
