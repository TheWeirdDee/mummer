import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { addressCommitment, generateId, generateToken, hashToken, normalizeReference } from '../src/light.js';

const src = (f: string) => readFileSync(resolve(import.meta.dirname, '../src', f), 'utf8');

describe('@mummer/crypto/light (the entry the Worker imports)', () => {
  it('never imports libsodium, directly or through a sibling module', () => {
    const files = ['light.ts', 'errors.ts', 'random.ts', 'tokens.ts', 'reference.ts'];
    for (const f of files) {
      // Only import and export-from statements matter (comments may mention libsodium).
      const imports = src(f)
        .split('\n')
        .filter((l) => /^(import|export) .* from /.test(l))
        .join('\n');
      expect(imports, f).not.toMatch(/libsodium/);
      expect(imports, f).not.toMatch(/from '\.\/(sodium|keys|seal|backup|protocol|link)\.js'/);
    }
  });

  it('exposes the server-side helpers and they work without initialising sodium', () => {
    expect(generateToken()).toHaveLength(43);
    expect(generateId()).toMatch(/^[0-9a-f]{32}$/);
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(normalizeReference('not a reference')).toBeUndefined();
    expect(addressCommitment('a'.repeat(32), 'Ada', 'u1x')).toMatch(/^[0-9a-f]{64}$/);
  });

  it('address commitments are length-prefixed: shifting characters between fields changes the result', () => {
    const g = 'a'.repeat(32);
    expect(addressCommitment(g, 'Ab', 'cd')).not.toBe(addressCommitment(g, 'A', 'bcd'));
  });

  it('the nickname is NFC-normalised so visually identical names commit identically', () => {
    const g = 'a'.repeat(32);
    expect(addressCommitment(g, 'Amélie', 'x')).toBe(addressCommitment(g, 'Amélie', 'x'));
  });
});
