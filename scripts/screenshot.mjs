// Capture full-page screenshots of the running app at several viewports.
// Usage: node scripts/screenshot.mjs <outDir> <width>x<height>[,<w>x<h>...] <path>[,<path>...]
// Paths are given WITHOUT a leading slash (Git Bash rewrites leading-slash arguments); use '.' for the home page.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const [outDir = 'tests/e2e/.artifacts', sizes = '390x844,1280x800', paths = '.'] = process.argv.slice(2);
const toPath = (p) => (p === '.' ? '/' : '/' + p.replace(/^\/+/, ''));
const base = process.env.BASE_URL ?? 'http://127.0.0.1:8787';
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
for (const size of sizes.split(',')) {
  const [w, h] = size.split('x').map(Number);
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
  const page = await ctx.newPage();
  const problems = [];
  page.on('console', (m) => {
    if (m.type() === 'error') problems.push(`console: ${m.text()}`);
  });
  page.on('pageerror', (e) => problems.push(`pageerror: ${e.message}`));
  for (const raw of paths.split(',')) {
    const p = toPath(raw);
    await page.goto(base + p, { waitUntil: 'networkidle' });
    await page.waitForTimeout(400);
    const name = (p === '/' ? 'home' : p.replace(/[^a-z0-9]+/gi, '-').replace(/^-|-$/g, '')) + `-${w}`;
    await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: true });
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    console.log(`${name}: horizontal overflow ${overflow}px`);
  }
  if (problems.length) console.log(problems.join('\n'));
  await ctx.close();
}
await browser.close();
