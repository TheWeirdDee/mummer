import { describe, expect, it } from 'vitest';
import { KNOWN_APP_ROUTES } from '../src/app.js';

const id = 'a1b2c3d4e5f60718293a4b5c6d7e8f90';

describe('client route matcher (decides real 404 vs app shell)', () => {
  it.each([
    '/',
    '/how-it-works',
    '/how-it-works/',
    '/privacy',
    '/faq',
    '/wallet-guide',
    '/evidence',
    '/stats',
    '/new',
    '/recover',
    `/g/${id}`,
    `/g/${id}/admin`,
    `/g/${id}/m/${id}`,
    `/g/${id}/`,
  ])('knows %s', (p) => {
    expect(KNOWN_APP_ROUTES.test(p)).toBe(true);
  });

  it.each([
    '/nope',
    '/index.html',
    '/g',
    '/g/',
    '/g/short',
    `/g/${id}/admin/extra`,
    `/g/${id}/m`,
    `/g/${id}/m/short`,
    `/g/${id.toUpperCase()}`,
    '/privacy/extra',
    '/api',
    '//evil.example',
    '/new%2Fx',
  ])('does not know %s', (p) => {
    expect(KNOWN_APP_ROUTES.test(p)).toBe(false);
  });
});
