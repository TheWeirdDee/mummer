// Generates raster brand assets from the project's own SVG mask and fonts (no external art):
//   apps/web/public/icon-192.png, icon-512.png, apple-touch-icon.png  (sharp, from favicon.svg)
//   apps/web/public/og-image.png                                       (Playwright render of an HTML card)
// Usage: node scripts/generate-brand-assets.mjs
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import sharp from 'sharp';
import { chromium } from '@playwright/test';

const root = resolve(import.meta.dirname, '..');
const pub = join(root, 'apps/web/public');
const svg = readFileSync(join(pub, 'favicon.svg'));

for (const [name, size] of [
  ['icon-192.png', 192],
  ['icon-512.png', 512],
  ['apple-touch-icon.png', 180],
]) {
  await sharp(svg, { density: 384 }).resize(size, size).png().toFile(join(pub, name));
  console.log('wrote', name);
}

// Social card: 1200x630, the real mask path and the real fonts.
const fonts = join(root, 'node_modules/@fontsource');
const anton = pathToFileURL(join(fonts, 'anton/files/anton-latin-400-normal.woff2')).href;
const plex = pathToFileURL(join(fonts, 'ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2')).href;
const newsreader = pathToFileURL(join(root, 'node_modules/@fontsource-variable/newsreader/files/newsreader-latin-wght-normal.woff2')).href;
const mask = 'M6 30C6 12 36 4 60 4s54 8 54 26c0 22-18 36-32 32-10-3-14-12-22-12s-12 9-22 12C24 66 6 52 6 30Z';
const eyes = 'M22 32c4-10 22-10 28 1-6 10-24 10-28-1Zm76 0c-4-10-22-10-28 1 6 10 24 10 28-1Z';
const html = `<!doctype html><meta charset="utf-8"><style>
@font-face{font-family:Anton;src:url(${anton})}
@font-face{font-family:Plex;src:url(${plex});font-weight:500}
@font-face{font-family:News;src:url(${newsreader});font-weight:200 800}
*{box-sizing:border-box}body{margin:0;width:1200px;height:630px;background:#F2ECDF;color:#17140F;position:relative;overflow:hidden;
background-image:radial-gradient(rgba(23,20,15,.12) 1.2px,transparent 1.6px);background-size:16px 16px}
.frame{position:absolute;inset:28px;border:6px solid #17140F;box-shadow:12px 12px 0 #17140F;background:#F8F4EA}
.eyebrow{position:absolute;left:84px;top:84px;font:500 24px Plex;letter-spacing:.18em;text-transform:uppercase;color:#7A1F1A}
h1{position:absolute;left:80px;top:140px;margin:0;font:400 116px/0.98 Anton;text-transform:uppercase;letter-spacing:.01em}
h1 span{color:#9E2B25;display:block}
p{position:absolute;left:84px;top:440px;width:680px;margin:0;font:400 32px/1.35 News;color:#3b362b}
.mask{position:absolute;right:96px;top:170px;width:330px}
.brand{position:absolute;right:92px;bottom:70px;font:400 44px Anton;letter-spacing:.08em;text-transform:uppercase}
</style><div class="frame"></div><div class="eyebrow">A masked gift exchange on Zcash</div>
<h1>Secret Santa.<span>Private gifts.</span></h1>
<p>Draw names, send each gift from your own wallet, and keep the details out of public view.</p>
<svg class="mask" viewBox="0 0 120 68"><path d="${mask}${eyes}" fill="#17140F" fill-rule="evenodd"/><path d="M60 9l5 6-5 6-5-6 5-6Z" fill="#9E2B25"/><path d="M14 22c10-8 24-9 32-6M106 22c-10-8-24-9-32-6" fill="none" stroke="#9E2B25" stroke-width="1.6" stroke-linecap="round"/></svg>
<div class="brand">Mummer</div>`;
const dir = mkdtempSync(join(tmpdir(), 'mummer-og-'));
const file = join(dir, 'og.html');
writeFileSync(file, html);
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1200, height: 630 } });
await page.goto(pathToFileURL(file).href);
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);
await page.screenshot({ path: join(pub, 'og-image.png') });
await browser.close();
console.log('wrote og-image.png');
