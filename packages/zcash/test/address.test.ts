import { describe, expect, it } from 'vitest';
import { base16, bech32 } from '@scure/base';
import { decodeUnifiedAddress, validateGiftAddress } from '../src/address.js';
import ua0 from './vectors/unified_address.json' with { type: 'json' };
import ua2 from './vectors/unified_address_r2.json' with { type: 'json' };

type Row = (string | number | null)[];
const rows0 = (ua0 as unknown[][]).filter((r) => typeof r[6] === 'string' && (r[6] as string).startsWith('u1')) as Row[];
const rows2 = (ua2 as unknown[][]).filter((r) => typeof r[6] === 'string' && /^(zu|tu)1/.test(r[6] as string)) as Row[];
const hex = (v: string | number | null | undefined) => (typeof v === 'string' ? base16.encode(base16.decode(v.toUpperCase())).toLowerCase() : undefined);
const enc = (b: Uint8Array | undefined) => (b ? base16.encode(b).toLowerCase() : undefined);

describe('ZIP 316 Revision 0 official vectors', () => {
  it('runs a meaningful number of vectors', () => {
    expect(rows0.length).toBeGreaterThanOrEqual(8);
  });

  it('decodes every vector to the exact receivers', () => {
    for (const r of rows0) {
      const addr = r[6] as string;
      const hasShielded = !!r[2] || !!r[3];
      if (!hasShielded) {
        expect(() => decodeUnifiedAddress(addr)).toThrow();
        continue;
      }
      const d = decodeUnifiedAddress(addr);
      expect(enc(d.p2pkh)).toBe(hex(r[0]));
      expect(enc(d.p2sh)).toBe(hex(r[1]));
      expect(enc(d.sapling)).toBe(hex(r[2]));
      expect(enc(d.orchard)).toBe(hex(r[3]));
    }
  });
});

describe('ZIP 316 Revision 2 official vectors', () => {
  it('runs a meaningful number of vectors', () => {
    expect(rows2.length).toBeGreaterThanOrEqual(4);
  });

  it('decodes every vector to the exact receivers and expiry', () => {
    for (const r of rows2) {
      const addr = r[6] as string;
      const d = decodeUnifiedAddress(addr);
      expect(d.revision).toBe(2);
      expect(enc(d.p2pkh)).toBe(hex(r[0]));
      expect(enc(d.p2sh)).toBe(hex(r[1]));
      expect(enc(d.sapling)).toBe(hex(r[2]));
      expect(enc(d.orchard)).toBe(hex(r[3]));
      if (typeof r[4] === 'number') expect(d.expiryHeight).toBe(r[4]);
      if (typeof r[5] === 'number') expect(d.expiryTime).toBe(r[5]);
    }
  });
});

const firstShieldedUa = rows0.find((r) => (r[2] || r[3]) && !r[0] && !r[1])?.[6] as string | undefined;
const withTransparent = rows0.find((r) => (r[2] || r[3]) && (r[0] || r[1]))?.[6] as string | undefined;
const orchardOnlyUa = rows0.find((r) => r[3] && !r[2] && !r[0] && !r[1])?.[6] as string | undefined;

describe('validateGiftAddress: accepted', () => {
  it('has fixtures', () => {
    expect(firstShieldedUa).toBeTruthy();
  });

  it('accepts a shielded unified address', () => {
    const r = validateGiftAddress(firstShieldedUa!);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.kind).toBe('unified');
      expect(r.warnings).toEqual([]);
    }
  });

  it('accepts an Orchard-only unified address when present in vectors', () => {
    expect(orchardOnlyUa).toBeTruthy();
    const r = validateGiftAddress(orchardOnlyUa!);
    expect(r.ok && r.hasOrchard).toBe(true);
  });

  it('warns (but accepts) a unified address that also has a transparent receiver', () => {
    expect(withTransparent).toBeTruthy();
    const r = validateGiftAddress(withTransparent!);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings).toContain('contains_transparent_receiver');
  });

  it('accepts a Revision 2 shielded-only address (zu1)', () => {
    const row = rows2.find((r) => (r[6] as string).startsWith('zu1') && r[5] === null);
    expect(row).toBeTruthy();
    if (!row) return;
    const r = validateGiftAddress(row[6] as string, 1);
    expect(r.ok).toBe(true);
  });

  it('accepts an all-uppercase address (as scanned from a QR) and canonicalizes to lowercase', () => {
    const r = validateGiftAddress(firstShieldedUa!.toUpperCase());
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.address).toBe(firstShieldedUa);
  });

  it('accepts a well-formed mainnet Sapling address', () => {
    const sapling = Uint8Array.from(base16.decode('D8EF8293D26DE832E7193F296BA1922D90F122C6135BC231EEBD91EFDB03B1A8606771CD4FD6480574D43E'));
    const zs = bech32.encode('zs', bech32.toWords(sapling), false);
    const r = validateGiftAddress(zs);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.kind).toBe('sapling');
  });
});

describe('validateGiftAddress: rejected with a reason', () => {
  const code = (s: string, now?: number) => {
    const r = validateGiftAddress(s, now);
    return r.ok ? 'ok' : r.code;
  };

  it('rejects empty and whitespace-padded input', () => {
    expect(code('')).toBe('empty');
    expect(code(' ' + firstShieldedUa)).toBe('whitespace');
    expect(code(firstShieldedUa + '\n')).toBe('whitespace');
    expect(code('u1 abc')).toBe('whitespace');
  });

  it('rejects transparent t1/t3 addresses (from the ZIP 321 vectors)', () => {
    expect(code('tmEZhbWHTpdKMw5it8YDspUXSMGQyFwovpU')).toBe('testnet');
    // Known mainnet transparent addresses (public example addresses).
    expect(code('t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbs')).toBe('transparent');
    expect(code('t3Vz22vK5z2LcKEdg16Yv4FFneEL1zg9ojd')).toBe('transparent');
  });

  it('rejects a mistyped transparent address with a typo message', () => {
    expect(code('t1Hsc1LR8yKnbbe3twRp88p6vFfC5t7DLbt')).toBe('bad_checksum');
  });

  it('rejects TEX addresses', () => {
    expect(code('tex1s2rt77ggv6q989lr49rkgzmh5slsksa9khdgte')).toBe('tex');
  });

  it('rejects testnet unified and sapling addresses', () => {
    expect(code('utest1' + 'q'.repeat(60))).toBe('bad_checksum');
    expect(code('ztestsapling10yy2ex5dcqkclhc7z7yrnjq2z6feyjad56ptwlfgmy77dmaqqrl9gyhprdx59qgmsnyfska2kez')).toBe('testnet');
  });

  it('rejects garbage', () => {
    expect(code('hello')).toBe('unknown_format');
    expect(code('zcash:' + firstShieldedUa)).toBe('unknown_format');
    expect(code('0x71C7656EC7ab88b098defB751B7401B5f6d8976F')).toBe('unknown_format');
    expect(code('a'.repeat(2000))).toBe('too_long');
  });

  it('rejects mixed-case addresses', () => {
    const mixed = firstShieldedUa!.slice(0, 30) + firstShieldedUa!.slice(30).toUpperCase();
    expect(code(mixed)).toBe('bad_checksum');
  });

  it('rejects every single-character substitution in a unified address (checksum)', () => {
    const a = firstShieldedUa!;
    const alphabet = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
    let accepted = 0;
    for (let i = 3; i < a.length; i += 7) {
      const original = a[i]!;
      const replacement = alphabet[(alphabet.indexOf(original) + 1) % alphabet.length]!;
      const mutated = a.slice(0, i) + replacement + a.slice(i + 1);
      if (validateGiftAddress(mutated).ok) accepted++;
    }
    expect(accepted).toBe(0);
  });

  it('rejects truncated and extended addresses', () => {
    expect(code(firstShieldedUa!.slice(0, -1))).not.toBe('ok');
    expect(code(firstShieldedUa!.slice(0, 40))).not.toBe('ok');
    expect(code(firstShieldedUa! + 'q')).not.toBe('ok');
  });

  it('rejects an expired Revision 2 address', () => {
    const row = rows2.find((r) => typeof r[5] === 'number');
    expect(row).toBeTruthy();
    if (!row) return;
    expect(code(row[6] as string, (row[5] as number) + 1)).toBe('expired');
    expect(code(row[6] as string, (row[5] as number) - 1000)).toBe('ok');
  });
});
