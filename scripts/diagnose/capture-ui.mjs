import { createRequire } from 'node:module';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const require = createRequire(new URL('../../apps/tv-client/package.json', import.meta.url));
const { chromium } = require('@playwright/test');
const out = new URL('../../artifacts/screenshots/', import.meta.url);
await mkdir(out, { recursive: true });
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(process.argv[2] ?? 'http://127.0.0.1:8797/');
  await page.getByText('Servidor conectado', { exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: fileURLToPath(new URL('home-1920.png', out)), fullPage: true });
  await page.getByRole('button', { name: 'Abrir biblioteca' }).click();
  await page.screenshot({ path: fileURLToPath(new URL('library-1920.png', out)), fullPage: true });
  for (const [width, height] of [[960, 540], [390, 844]]) {
    await page.setViewportSize({ width, height });
    await page.screenshot({ path: fileURLToPath(new URL(`library-${width}.png`, out)), fullPage: true });
  }
} finally { await browser.close(); }
