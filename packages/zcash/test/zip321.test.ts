import { describe, expect, it } from 'vitest';
import { buildPaymentRequest, parsePaymentRequest, verifyPaymentRequest, Zip321Error } from '../src/zip321.js';
import { buildGiftMemo, MemoError, memoToBytes, utf8Length } from '../src/memo.js';
import { formatZec, parseZec, usdCentsToZat, AmountError, MAX_ZAT } from '../src/amount.js';

const SAPLING_T = 'ztestsapling10yy2ex5dcqkclhc7z7yrnjq2z6feyjad56ptwlfgmy77dmaqqrl9gyhprdx59qgmsnyfska2kez';
const TADDR = 'tmEZhbWHTpdKMw5it8YDspUXSMGQyFwovpU';
const REF = 'MUM-7Q4K-X2J9-PA3M-WV8T-C';

describe('ZIP 321 spec examples: valid', () => {
  it('single Sapling payment with memo and message', () => {
    const p = parsePaymentRequest(`zcash:${SAPLING_T}?amount=1&memo=VGhpcyBpcyBhIHNpbXBsZSBtZW1vLg&message=Thank%20you%20for%20your%20purchase`);
    expect(p).toHaveLength(1);
    expect(p[0]!.amountZat).toBe(100_000_000n);
    expect(new TextDecoder().decode(p[0]!.memo)).toBe('This is a simple memo.');
    expect(p[0]!.message).toBe('Thank you for your purchase');
  });

  it('two payments, transparent + Sapling, unicode memo on the shielded one', () => {
    const p = parsePaymentRequest(
      `zcash:?address=${TADDR}&amount=123.456&address.1=${SAPLING_T}&amount.1=0.789&memo.1=VGhpcyBpcyBhIHVuaWNvZGUgbWVtbyDinKjwn6aE8J-PhvCfjok`,
    );
    expect(p).toHaveLength(2);
    expect(p[0]!.amountZat).toBe(12_345_600_000n);
    expect(new TextDecoder().decode(p[1]!.memo)).toBe('This is a unicode memo ✨🦄🏆🎉');
  });

  it('path-address form equals address= form', () => {
    const a = parsePaymentRequest(`zcash:${SAPLING_T}?amount=2`);
    const b = parsePaymentRequest(`zcash:?address=${SAPLING_T}&amount=2`);
    expect(a).toEqual(b);
  });

  it('non-sequential indices are fine; ordering is by index', () => {
    const p = parsePaymentRequest(`zcash:?address.7=${SAPLING_T}&amount.7=3&address.2=${TADDR}&amount.2=1`);
    expect(p.map((x) => x.amountZat)).toEqual([100_000_000n, 300_000_000n]);
  });

  it('unknown non-req parameters are ignored', () => {
    expect(parsePaymentRequest(`zcash:${SAPLING_T}?amount=1&foo=bar`)).toHaveLength(1);
  });
});

describe('ZIP 321 spec examples: invalid', () => {
  const bad: [string, string][] = [
    ['missing empty-index address', `zcash:?amount=3491405.05201255&address.1=${SAPLING_T}&amount.1=5740296.87793245`],
    ['missing address.1', `zcash:?address=${TADDR}&amount=1&amount.1=2&address.2=${SAPLING_T}`],
    ['leading zero in paramindex', `zcash:?address.0=${SAPLING_T}&amount.0=2`],
    ['duplicate amount', `zcash:?amount=1.234&amount=2.345&address=${TADDR}`],
    ['duplicate amount.1', `zcash:?amount.1=1.234&amount.1=2.345&address.1=${TADDR}`],
    ['percent-encoded amount value', `zcash:${TADDR}?amount=1%30`],
    ['percent-encoded param name', `zcash:${TADDR}?%61mount=1`],
    ['percent-encoded address', `zcash:%74mEZhbWHTpdKMw5it8YDspUXSMGQyFwovpU?amount=1`],
    ['authority component //', `zcash://${TADDR}?amount=1`],
    ['more than 8 decimals', `zcash:${SAPLING_T}?amount=0.123456789`],
    ['amount over 21M ZEC', `zcash:${SAPLING_T}?amount=21000000.00000001`],
    ['standard base64 (+ / =) memo', `zcash:${SAPLING_T}?amount=1&memo=ab+/=`],
    ['padded base64url memo', `zcash:${SAPLING_T}?amount=1&memo=VGVzdA%3D%3D`],
    ['unknown req- parameter', `zcash:${SAPLING_T}?amount=1&req-future=1`],
    ['req-asset (custom assets unsupported)', `zcash:${SAPLING_T}?req-asset=AEcn`],
    ['not a zcash URI', `bitcoin:${SAPLING_T}?amount=1`],
    ['empty URI', 'zcash:'],
    ['memo with no address at index', `zcash:${SAPLING_T}?amount=1&memo.3=VGVzdA`],
    ['negative amount', `zcash:${SAPLING_T}?amount=-1`],
    ['exponent amount', `zcash:${SAPLING_T}?amount=1e3`],
    ['memo over 512 bytes', `zcash:${SAPLING_T}?amount=1&memo=${'A'.repeat(700)}`],
  ];
  it.each(bad)('rejects: %s', (_name, uri) => {
    expect(() => parsePaymentRequest(uri)).toThrow(Zip321Error);
  });

  it('rejects a memo paired with a transparent address when the caller can classify addresses', () => {
    const uri = `zcash:${TADDR}?amount=1&memo=VGVzdA`;
    expect(() => parsePaymentRequest(uri, { isTransparent: (a) => a.startsWith('t') })).toThrow(Zip321Error);
    expect(parsePaymentRequest(uri)).toHaveLength(1);
  });
});

describe('buildPaymentRequest', () => {
  const address = 'u1' + 'q'.repeat(20);

  it('round-trips address, amount and memo exactly', () => {
    const memo = buildGiftMemo({ reference: REF, note: 'Happy holidays! 🎁 – Santa' });
    const uri = buildPaymentRequest({ address, amountZat: 12_345_678n, memo, label: 'Mummer gift', message: 'Secret Santa & friends' });
    const [p] = parsePaymentRequest(uri);
    expect(p!.address).toBe(address);
    expect(p!.amountZat).toBe(12_345_678n);
    expect(new TextDecoder().decode(p!.memo)).toBe(memo);
    expect(p!.label).toBe('Mummer gift');
    expect(p!.message).toBe('Secret Santa & friends');
    expect(() => verifyPaymentRequest(uri, { address, amountZat: 12_345_678n, memo })).not.toThrow();
  });

  it('never emits +, / or = in the memo (base64url, no padding)', () => {
    for (let n = 1; n < 200; n += 7) {
      const memo = 'é'.repeat(n);
      const uri = buildPaymentRequest({ address, amountZat: 1n, memo });
      const m = /memo=([^&]*)/.exec(uri)![1]!;
      expect(m).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it('refuses zero/negative amounts and oversize memos', () => {
    expect(() => buildPaymentRequest({ address, amountZat: 0n })).toThrow(Zip321Error);
    expect(() => buildPaymentRequest({ address, amountZat: -1n })).toThrow(Zip321Error);
    expect(() => buildPaymentRequest({ address, amountZat: 1n, memo: 'x'.repeat(513) })).toThrow(Zip321Error);
  });

  it('percent-encodes labels so ampersands and equals signs cannot inject parameters', () => {
    const uri = buildPaymentRequest({ address, amountZat: 500_000_000n, label: 'a&amount=999999&b=c', message: 'x#y?z' });
    const [p] = parsePaymentRequest(uri);
    expect(p!.amountZat).toBe(500_000_000n);
    expect(p!.label).toBe('a&amount=999999&b=c');
    expect(p!.message).toBe('x#y?z');
  });

  it('verifyPaymentRequest catches address substitution, amount and memo tampering', () => {
    const memo = buildGiftMemo({ reference: REF });
    const uri = buildPaymentRequest({ address, amountZat: 100n, memo });
    const exp = { address, amountZat: 100n, memo };
    expect(() => verifyPaymentRequest(uri.replace(address, 'u1' + 'p'.repeat(20)), exp)).toThrow(/address/);
    expect(() => verifyPaymentRequest(uri.replace('amount=0.000001', 'amount=0.000002'), exp)).toThrow(/amount/);
    expect(() => verifyPaymentRequest(uri.replace(/memo=[^&]*/, 'memo=QUJD'), exp)).toThrow(/memo/);
    expect(() => verifyPaymentRequest(uri + '&address.1=u1zzzz&amount.1=1', exp)).toThrow(/exactly one/);
  });
});

describe('memo', () => {
  it('counts UTF-8 bytes, not characters', () => {
    expect(utf8Length('é')).toBe(2);
    expect(utf8Length('🎁')).toBe(4);
  });

  it('accepts a note up to 400 bytes and rejects 401', () => {
    expect(() => buildGiftMemo({ reference: REF, note: 'a'.repeat(400) })).not.toThrow();
    expect(() => buildGiftMemo({ reference: REF, note: 'a'.repeat(401) })).toThrow(MemoError);
    expect(() => buildGiftMemo({ reference: REF, note: '🎁'.repeat(101) })).toThrow(MemoError); // 404 bytes
    expect(() => buildGiftMemo({ reference: REF, note: '🎁'.repeat(100) })).not.toThrow(); // 400 bytes
  });

  it('always stays within 512 bytes', () => {
    const memo = buildGiftMemo({ reference: REF, note: '🎁'.repeat(100) });
    expect(memoToBytes(memo).length).toBeLessThanOrEqual(512);
  });

  it('rejects control characters and malformed references', () => {
    expect(() => buildGiftMemo({ reference: REF, note: 'a\u0000b' })).toThrow(MemoError);
    expect(() => buildGiftMemo({ reference: REF, note: 'a' + String.fromCharCode(0x2028) + 'b' })).toThrow(MemoError);
    expect(() => buildGiftMemo({ reference: 'MUM-NOPE' })).toThrow(MemoError);
    expect(() => buildGiftMemo({ reference: REF.replace('7Q4K', '7I4K') })).toThrow(MemoError); // I is not in the alphabet
  });

  it('puts the reference first', () => {
    expect(buildGiftMemo({ reference: REF, note: 'hi' })).toBe(`MUMMER ${REF}\nhi`);
    expect(buildGiftMemo({ reference: REF })).toBe(`MUMMER ${REF}`);
  });
});

describe('exact money arithmetic', () => {
  it('formats and parses without float error', () => {
    expect(formatZec(0n)).toBe('0');
    expect(formatZec(1n)).toBe('0.00000001');
    expect(formatZec(100_000_000n)).toBe('1');
    expect(formatZec(1_050_000_000n)).toBe('10.5');
    expect(parseZec('0.1')).toBe(10_000_000n);
    expect(parseZec('0.00000001')).toBe(1n);
    expect(formatZec(parseZec('21000000'))).toBe('21000000');
    expect(() => parseZec('0.123456789')).toThrow(AmountError);
    expect(() => parseZec('.5')).toThrow(AmountError);
    expect(() => parseZec('5.')).toThrow(AmountError);
    expect(() => formatZec(MAX_ZAT + 1n)).toThrow(AmountError);
  });

  it('round-trips any zatoshi count', () => {
    for (const z of [1n, 9n, 10n, 99_999_999n, 123_456_789n, 2_099_999_999_999_999n]) expect(parseZec(formatZec(z))).toBe(z);
  });

  it('converts a USD budget to ZEC, rounded to 4 decimals, using integers only', () => {
    // $10 at $31.54/ZEC = 0.317057...; rounded to 4 d.p. = 0.3171
    expect(usdCentsToZat(1000, '31.54')).toBe(31_710_000n);
    // exact: $25 at $50 = 0.5 ZEC
    expect(usdCentsToZat(2500, '50')).toBe(50_000_000n);
    // tiny budget at huge price is floored to one quote step, never zero
    expect(usdCentsToZat(1, '100000')).toBe(10_000n);
    // half-up rounding at the 4th decimal: 0.00005 -> 0.0001, 0.00015 -> 0.0002
    expect(usdCentsToZat(1, '200')).toBe(10_000n);
    expect(usdCentsToZat(3, '200')).toBe(20_000n); // 0.00015 -> 0.0002
  });

  it('rejects bad budgets and prices', () => {
    expect(() => usdCentsToZat(0, '30')).toThrow(AmountError);
    expect(() => usdCentsToZat(10.5, '30')).toThrow(AmountError);
    expect(() => usdCentsToZat(1000, '0')).toThrow(AmountError);
    expect(() => usdCentsToZat(1000, '-5')).toThrow(AmountError);
    expect(() => usdCentsToZat(1000, '1e2')).toThrow(AmountError);
    expect(() => usdCentsToZat(1000, 'NaN')).toThrow(AmountError);
  });
});
