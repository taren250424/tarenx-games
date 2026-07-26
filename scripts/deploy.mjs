import fs from 'node:fs/promises';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const packagesDir = path.join(rootDir, 'packages');

const hubDist = path.join(packagesDir, 'hub', 'dist');
const cnamePath = path.join(hubDist, 'CNAME');

async function getAppNames() {
  const entries = await fs.readdir(packagesDir, { withFileTypes: true });
  return entries
    .filter(entry => entry.isDirectory() && entry.name !== 'hub' && entry.name !== 'shared')
    .map(entry => entry.name);
}

async function deploy() {
  console.log('🚀 Starting deployment preparation...');

  const apps = await getAppNames();

  try {
    // 1. Check if hub dist and all app dist folders exist
    await fs.access(hubDist);
    for (const app of apps) {
      await fs.access(path.join(packagesDir, app, 'dist'));
    }
  } catch (err) {
    console.error('❌ Error: Dist folders not found. Did you run build?');
    process.exit(1);
  }

  // 2. Copy app dists into hub dist
  for (const app of apps) {
    console.log(`📂 Copying ${app} to hub/dist/${app}...`);
    const appDist = path.join(packagesDir, app, 'dist');
    const targetDir = path.join(hubDist, app);
    await fs.cp(appDist, targetDir, { recursive: true, force: true });
  }

  // 3. Create CNAME and .nojekyll files
  console.log('🌐 Creating CNAME and .nojekyll files...');
  await fs.writeFile(cnamePath, 'games.tarenx.com');
  await fs.writeFile(path.join(hubDist, '.nojekyll'), '');

  // 4. Deploy using gh-pages
  console.log('📤 Pushing to gh-pages branch...');
  try {
    execSync('npx gh-pages -d packages/hub/dist', {
      cwd: rootDir,
      stdio: 'inherit'
    });
    console.log('✅ Deployment successful!');
  } catch (error) {
    console.error('❌ Deployment failed:', error.message);
    process.exit(1);
  }
}

deploy();
