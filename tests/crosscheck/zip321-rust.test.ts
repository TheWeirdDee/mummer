import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildGiftMemo, buildPaymentRequest, parsePaymentRequest, validateGiftAddress } from '@mummer/zcash';

/**
 * Independent-implementation cross-check. Every URI Mummer builds is parsed by the REFERENCE Rust parser
 * (`zip321` crate from librustzcash) and must decode to the same address, amount and memo bytes.
 *
 * This shows that another implementation of ZIP 321 accepts Mummer's output. It does NOT show that any wallet (Zodl
 * included) does. It runs only on demand (`npm run test:crosscheck`) because it needs a Rust toolchain and downloads crates.
 */

const crate = resolve(import.meta.dirname, '../../tools/zip321-crosscheck');
const vectors = JSON.parse(readFileSync(resolve(import.meta.dirname, '../../packages/zcash/test/vectors/unified_address.json'), 'utf8')) as unknown[][];

function addresses(count: number): string[] {
  const out: string[] = [];
  for (const r of vectors) {
    const a = r[6];
    if (typeof a !== 'string' || !a.startsWith('u1')) continue;
    if (validateGiftAddress(a).ok) out.push(a);
    if (out.length === count) break;
  }
  return out;
}

function runRust(lines: string[]): string[] {
  const r = spawnSync('cargo', ['run', '--quiet', '--release', '--manifest-path', resolve(crate, 'Cargo.toml')], { input: lines.join('\n') + '\n', encoding: 'utf8', timeout: 900_000 });
  if (r.error || r.status !== 0) throw new Error(`cargo failed: ${r.error?.message ?? r.stderr}`);
  return r.stdout.trim().split('\n');
}

const REF = 'MUM-AAAA-AAAA-AAAA-AAAA-0';

describe('Mummer ZIP 321 output versus the reference Rust parser', () => {
  it('the crate is present', () => {
    expect(existsSync(resolve(crate, 'Cargo.toml'))).toBe(true);
  });

  it('every URI Mummer builds decodes identically', () => {
    const addrs = addresses(12);
    expect(addrs.length).toBeGreaterThanOrEqual(8);
    const cases: { uri: string; address: string; zat: bigint; memoHex: string }[] = [];
    const amounts = [1n, 5_000n, 123_456_789n, 79_260_000n, 2_100_000_000_000_000n];
    const notes = ['', 'Happy holidays!', 'café ☕ 🎁', 'a'.repeat(300), 'line one\nline two'];
    addrs.forEach((address, i) => {
      for (const note of notes) {
        const memo = buildGiftMemo({ reference: REF, note });
        const memoBytes = new TextEncoder().encode(memo);
        const zat = amounts[i % amounts.length]!;
        cases.push({ uri: buildPaymentRequest({ address, amountZat: zat, memo }), address, zat, memoHex: Buffer.from(memoBytes).toString('hex') });
      }
    });
    const out = runRust(cases.map((c) => c.uri));
    expect(out).toHaveLength(cases.length);
    out.forEach((line, i) => {
      const c = cases[i]!;
      const [tag, index, address, amount, memo] = line.split('\t');
      expect(tag, `${line} <- ${c.uri.slice(0, 80)}`).toBe('OK');
      expect(index).toBe('0');
      expect(address).toBe(c.address);
      expect(BigInt(amount!)).toBe(c.zat);
      // The reference parser returns the memo padded to 512 bytes; the meaningful prefix must match exactly and the rest be zero.
      expect(memo!.startsWith(c.memoHex)).toBe(true);
      expect(/^0*$/.test(memo!.slice(c.memoHex.length))).toBe(true);
      // And Mummer's own parser agrees with the reference one.
      const ours = parsePaymentRequest(c.uri);
      expect(ours[0]!.address).toBe(address);
    });
  });

  it('the reference parser rejects what Mummer rejects', () => {
    const [address] = addresses(1);
    const bad = [
      `zcash:${address}?amount=1&memo=ab+/=`, // standard base64
      `zcash:${address}?amount=0.123456789`, // too many decimals
      `zcash:${address}?amount=-1`,
      `zcash:${address}?amount=1&req-asset=x`, // unknown required parameter
    ];
    const out = runRust(bad);
    out.forEach((line, i) => {
      expect(line.startsWith('ERR'), `${bad[i]} -> ${line}`).toBe(true);
      expect(() => parsePaymentRequest(bad[i]!)).toThrow();
    });
  });
});
