import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const packagesDir = path.join(rootDir, 'packages');
const hubDistDir = path.join(packagesDir, 'hub', 'dist');

async function generateSitemap() {
  const baseUrl = 'https://games.tarenx.com';
  const urls = [
    `${baseUrl}/`
  ];

  const entries = await fs.readdir(packagesDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory() && entry.name !== 'hub' && entry.name !== 'shared') {
      urls.push(`${baseUrl}/${entry.name}/`);
    }
  }

  const sitemapContent = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(url => `  <url>
    <loc>${url}</loc>
    <changefreq>weekly</changefreq>
    <priority>${url === `${baseUrl}/` ? '1.0' : '0.8'}</priority>
  </url>`).join('\n')}
</urlset>`;

  try {
    await fs.access(hubDistDir);
  } catch {
    await fs.mkdir(hubDistDir, { recursive: true });
  }

  const sitemapPath = path.join(hubDistDir, 'sitemap.xml');
  await fs.writeFile(sitemapPath, sitemapContent, 'utf-8');
  console.log(`✅ Sitemap generated at ${sitemapPath}`);
}

generateSitemap().catch(console.error);
