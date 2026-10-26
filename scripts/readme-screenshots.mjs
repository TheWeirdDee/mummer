// Crops real browser captures (tests/e2e/.artifacts/screens, produced by the responsive Playwright spec)
// into docs/screenshots/ for the README. Nothing here is mocked: every image is a crop of an actual capture.
import { mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import sharp from 'sharp';

const root = resolve(import.meta.dirname, '..');
const src = join(root, 'tests/e2e/.artifacts/screens');
const out = join(root, 'docs/screenshots');
mkdirSync(out, { recursive: true });

const jobs = [
  // [input, output, crop {left, top, width, height}]
  ['1280x800/home.png', 'landing-desktop.png', { left: 0, top: 0, width: 1280, height: 800 }],
  ['390x844/home.png', 'landing-phone.png', { left: 0, top: 0, width: 390, height: 844 }],
  ['1280x800/admin-1-waiting.png', 'host-dashboard.png', { left: 0, top: 0, width: 1280, height: 1100 }],
  ['1280x800/join-3-address-error.png', 'address-check.png', { left: 0, top: 0, width: 1280, height: 800 }],
  ['390x844/member-1-assignment-payment.png', 'payment-phone.png', { left: 0, top: 1080, width: 390, height: 1500 }],
  ['1280x800/privacy.png', 'privacy.png', { left: 0, top: 0, width: 1280, height: 1000 }],
];
for (const [input, output, region] of jobs) {
  const meta = await sharp(join(src, input)).metadata();
  const height = Math.min(region.height, (meta.height ?? region.height) - region.top);
  await sharp(join(src, input)).extract({ ...region, height }).png({ compressionLevel: 9 }).toFile(join(out, output));
  console.log('wrote docs/screenshots/' + output);
}
