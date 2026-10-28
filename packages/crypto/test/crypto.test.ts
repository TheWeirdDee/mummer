import { beforeAll, describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { base16, base64urlnopad } from '@scure/base';
import { argon2id } from '@noble/hashes/argon2.js';
import { z } from 'zod';
import {
  ackCommitment,
  buildDrawPayload,
  buildFragment,
  CryptoError,
  decodeKey,
  encodeKey,
  generateId,
  generateKeyPair,
  generateReference,
  generateToken,
  hashToken,
  isToken,
  normalizeReference,
  openAssignment,
  openBackup,
  openBytes,
  MAX_PLAINTEXT_BYTES,
  SEALED_BYTES,
  openPayload,
  openProfile,
  parseFragment,
  publicKeyFromSecret,
  ready,
  resealAssignment,
  sealBackup,
  sealBytes,
  sealPayload,
  sealProfile,
  timingSafeEqual,
  wipe,
  type KeyPair,
} from '../src/index.js';

const ADDRESS = 'u1l8xunezsvhq8fgzfl7404m450nwnd76zshscn6nfys7vyz2ywyh4cc5daaq0c7q2su5lqfh23sp7fkf3kt27ve5948mzpfdvckzaect2jtte308mkwlycj2u0eac077wu70vqcetkxf';
const GROUP = 'a'.repeat(32);

beforeAll(async () => {
  await ready();
});

describe('known-answer vectors', () => {
  it('SHA-256 token hashing matches an independent implementation (node:crypto)', () => {
    for (const t of ['', 'abc', 'A'.repeat(43), 'x_-9'.repeat(11)]) {
      expect(hashToken(t)).toBe(createHash('sha256').update(t, 'utf8').digest('hex'));
    }
    // FIPS 180-4 example: SHA-256("abc")
    expect(hashToken('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });

  it('argon2id (the backup KDF) matches the RFC 9106 section 5.3 test vector', () => {
    const tag = argon2id(new Uint8Array(32).fill(1), new Uint8Array(16).fill(2), {
      t: 3,
      m: 32,
      p: 4,
      dkLen: 32,
      key: new Uint8Array(8).fill(3),
      personalization: new Uint8Array(12).fill(4),
    });
    expect(base16.encode(tag).toLowerCase()).toBe('0d640df58d78766c08c037a34a8b53c9d01ef0452d75b65eb52520e96b01e659');
  });

  it('ack commitment is deterministic, domain-separated and matches an independent encoding', () => {
    const c = ackCommitment(GROUP, 'b'.repeat(32), 'MUM-7Q4K-X2J9-PA3M-WV8T-C');
    const enc = (s: string) => Buffer.concat([Buffer.from([s.length >> 8, s.length & 255]), Buffer.from(s)]);
    const expected = createHash('sha256')
      .update(Buffer.concat(['mummer/ack-commitment/v1', GROUP, 'b'.repeat(32), 'MUM-7Q4K-X2J9-PA3M-WV8T-C'].map(enc)))
      .digest('hex');
    expect(c).toBe(expected);
    expect(ackCommitment('c'.repeat(32), 'b'.repeat(32), 'MUM-7Q4K-X2J9-PA3M-WV8T-C')).not.toBe(c); // group-bound
    expect(ackCommitment(GROUP, 'd'.repeat(32), 'MUM-7Q4K-X2J9-PA3M-WV8T-C')).not.toBe(c); // recipient-bound
  });
});

describe('keys', () => {
  it('generates distinct X25519 key pairs of the right size, and derives the public key from the secret', async () => {
    const a = await generateKeyPair();
    const b = await generateKeyPair();
    expect(a.publicKey).toHaveLength(32);
    expect(a.secretKey).toHaveLength(32);
    expect(encodeKey(a.publicKey)).not.toBe(encodeKey(b.publicKey));
    expect(publicKeyFromSecret(a.secretKey)).toEqual(a.publicKey);
  });

  it('round-trips and rejects malformed encodings', async () => {
    const a = await generateKeyPair();
    expect(decodeKey(encodeKey(a.publicKey))).toEqual(a.publicKey);
    for (const bad of ['', 'short', 'A'.repeat(42), 'A'.repeat(44), 'A'.repeat(42) + '+', 'A'.repeat(42) + '=', ' ' + 'A'.repeat(42)]) {
      expect(() => decodeKey(bad)).toThrow(CryptoError);
    }
    expect(() => encodeKey(new Uint8Array(31))).toThrow(CryptoError);
  });
});

describe('sealed boxes', () => {
  let alice: KeyPair;
  let bob: KeyPair;
  beforeAll(async () => {
    alice = await generateKeyPair();
    bob = await generateKeyPair();
  });

  it('round-trips arbitrary bytes, including empty and unicode', () => {
    for (const text of ['', 'hello', 'héllo wörld 🎁', 'x'.repeat(4000)]) {
      const plain = new TextEncoder().encode(text);
      expect(openBytes(sealBytes(plain, alice.publicKey), alice.publicKey, alice.secretKey)).toEqual(plain);
    }
  });

  it('is probabilistic: sealing the same plaintext twice gives different ciphertexts', () => {
    const p = new TextEncoder().encode('same');
    expect(sealBytes(p, alice.publicKey)).not.toEqual(sealBytes(p, alice.publicKey));
  });

  it('rejects the wrong key', () => {
    const sealed = sealBytes(new TextEncoder().encode('secret'), alice.publicKey);
    expect(() => openBytes(sealed, bob.publicKey, bob.secretKey)).toThrowError(expect.objectContaining({ code: 'decrypt_failed' }));
    expect(() => openBytes(sealed, alice.publicKey, bob.secretKey)).toThrow(CryptoError);
  });

  it('rejects tampering at every region of the ciphertext', () => {
    const sealed = sealBytes(new TextEncoder().encode('secret'), alice.publicKey);
    const positions = [0, 1, 31, 32, 47, 48, 100, 200, sealed.length - 17, sealed.length - 16, sealed.length - 1];
    for (const pos of positions) {
      const bad = sealed.slice();
      bad[pos] = bad[pos]! ^ 0x01;
      expect(() => openBytes(bad, alice.publicKey, alice.secretKey)).toThrow(CryptoError);
    }
  });

  it('rejects truncated, extended and empty ciphertexts', () => {
    const sealed = sealBytes(new TextEncoder().encode('secret'), alice.publicKey);
    expect(() => openBytes(sealed.slice(0, sealed.length - 1), alice.publicKey, alice.secretKey)).toThrow(CryptoError);
    expect(() => openBytes(new Uint8Array([...sealed, 0]), alice.publicKey, alice.secretKey)).toThrow(CryptoError);
    expect(() => openBytes(new Uint8Array(0), alice.publicKey, alice.secretKey)).toThrow(CryptoError);
    expect(() => openBytes(new Uint8Array(20_000), alice.publicKey, alice.secretKey)).toThrow(CryptoError);
  });

  it('pads every plaintext to one fixed size, so ciphertext length reveals nothing about the content', () => {
    const len = (n: number) => sealBytes(new Uint8Array(n).fill(65), alice.publicKey).length;
    for (const n of [0, 1, 200, 255, 256, 257, 1_000, 2_048, 4_000, MAX_PLAINTEXT_BYTES]) expect(len(n)).toBe(SEALED_BYTES);
    expect(SEALED_BYTES).toBe(4_096 + 48);
  });

  it('refuses plaintexts that would not fit in the fixed size, instead of using a bigger bucket', () => {
    expect(() => sealBytes(new Uint8Array(MAX_PLAINTEXT_BYTES + 1), alice.publicKey)).toThrowError(expect.objectContaining({ code: 'too_large' }));
    expect(() => sealBytes(new Uint8Array(9000), alice.publicKey)).toThrowError(expect.objectContaining({ code: 'too_large' }));
  });

  it('accepts only the one ciphertext length that is ever produced', () => {
    const sealed = sealBytes(new TextEncoder().encode('x'), alice.publicKey);
    expect(openBytes(sealed, alice.publicKey, alice.secretKey)).toBeTruthy();
    expect(() => openBytes(sealed.slice(0, SEALED_BYTES - 1), alice.publicKey, alice.secretKey)).toThrow(CryptoError);
    expect(() => openBytes(new Uint8Array(SEALED_BYTES + 256), alice.publicKey, alice.secretKey)).toThrow(CryptoError);
    expect(() => openBytes(new Uint8Array(304), alice.publicKey, alice.secretKey)).toThrow(CryptoError); // the old 256-byte bucket
  });

  it('the worst-case profile and assignment the schemas allow both fit, and seal to the same length as an empty one', async () => {
    const host = await generateKeyPair();
    const groupId = 'a'.repeat(32);
    const worstName = '😀'.repeat(32);
    const worstWishlist = '😀'.repeat(280); // 4 bytes each: the largest UTF-8 the length limit allows
    const asciiWishlist = '"'.repeat(280); // every character needs escaping in JSON: 2 bytes each
    const worstAddress = 'u1' + 'q'.repeat(998);
    const mk = async (i: number, name: string, wishlist: string, address: string) => ({ id: String(i).repeat(32), publicKey: encodeKey((await generateKeyPair()).publicKey), profile: { v: 1 as const, kind: 'profile' as const, groupId, pseudonym: name, wishlist, address } });
    const members = [await mk(1, worstName, worstWishlist, worstAddress), await mk(2, 'Bo', '', 'u1' + 'q'.repeat(30)), await mk(3, 'Cy', asciiWishlist, worstAddress)];
    const hostKey = encodeKey(host.publicKey);
    const profileLengths = members.map((m) => sealProfile(m.profile, hostKey).length);
    expect(new Set(profileLengths).size).toBe(1);
    const assignments = { [members[0]!.id]: members[1]!.id, [members[1]!.id]: members[2]!.id, [members[2]!.id]: members[0]!.id };
    const draw = buildDrawPayload({ groupId, drawVersion: 1, budgetCents: 25_000, members, assignments });
    const bundleLengths = draw.bundles.map((b) => b.sealedBundle.length);
    expect(new Set(bundleLengths).size).toBe(1);
    expect(bundleLengths[0]).toBe(profileLengths[0]);
  });

  it('the metadata-only pairing attack from the 28 October audit finds no unique pairing when wishlists differ in length', async () => {
    const host = await generateKeyPair();
    const groupId = 'b'.repeat(32);
    const hostKey = encodeKey(host.publicKey);
    // Four people whose wishlists are 0, 90, 180 and 270 emoji long: the audit's setup, which used to give every pairing away.
    const people = await Promise.all([0, 90, 180, 270].map(async (n, i) => ({ id: String(i + 1).repeat(32), publicKey: encodeKey((await generateKeyPair()).publicKey), profile: { v: 1 as const, kind: 'profile' as const, groupId, pseudonym: `Audit${i}`, wishlist: '🎁'.repeat(n), address: 'u1' + 'q'.repeat(140) } })));
    const assignments = Object.fromEntries(people.map((m, i) => [m.id, people[(i + 1) % 4]!.id]));
    const profileSizes = people.map((m) => base64urlnopad.decode(sealProfile(m.profile, hostKey)).length);
    const draw = buildDrawPayload({ groupId, drawVersion: 1, budgetCents: 2500, members: people, assignments });
    const bundleSizes = draw.bundles.map((b) => base64urlnopad.decode(b.sealedBundle).length);
    // What an observer of stored lengths can do: a giver's bundle can go to any recipient whose profile has the same length.
    const candidates = bundleSizes.map((bs, giver) => profileSizes.map((ps, r) => (r !== giver && ps === bs ? r : -1)).filter((r) => r >= 0));
    for (const c of candidates) expect(c.length).toBe(3); // every other member is equally likely: nothing learned
    expect(new Set([...profileSizes, ...bundleSizes]).size).toBe(1);
  });

  it('openPayload validates encoding, JSON and schema, never leaking raw errors', () => {
    const schema = z.object({ v: z.literal(1), n: z.number() }).strict();
    const good = sealPayload({ v: 1, n: 7 }, encodeKey(alice.publicKey));
    expect(openPayload(good, alice.publicKey, alice.secretKey, schema)).toEqual({ v: 1, n: 7 });
    expect(() => openPayload(sealPayload({ v: 2, n: 7 }, encodeKey(alice.publicKey)), alice.publicKey, alice.secretKey, schema)).toThrow(CryptoError);
    expect(() => openPayload(sealPayload({ v: 1, n: 7, extra: 1 }, encodeKey(alice.publicKey)), alice.publicKey, alice.secretKey, schema)).toThrow(CryptoError);
    for (const bad of ['', '!!!', 'A'.repeat(20_000), good.slice(0, -2), good + 'A', ' ' + good]) {
      expect(() => openPayload(bad, alice.publicKey, alice.secretKey, schema)).toThrow(CryptoError);
    }
    // Valid ciphertext whose plaintext is not JSON.
    const notJson = base64urlnopad.encode(sealBytes(new TextEncoder().encode('not json {'), alice.publicKey));
    expect(() => openPayload(notJson, alice.publicKey, alice.secretKey, schema)).toThrowError(expect.objectContaining({ code: 'malformed_payload' }));
    // Valid ciphertext whose plaintext is invalid UTF-8.
    const badUtf8 = base64urlnopad.encode(sealBytes(new Uint8Array([0xff, 0xfe, 0xfd]), alice.publicKey));
    expect(() => openPayload(badUtf8, alice.publicKey, alice.secretKey, schema)).toThrow(CryptoError);
  });
});

describe('tokens and ids', () => {
  it('generates 256-bit tokens and 128-bit ids with no collisions in 5,000 samples', () => {
    const tokens = new Set<string>();
    const ids = new Set<string>();
    for (let i = 0; i < 5000; i++) {
      const t = generateToken();
      expect(isToken(t)).toBe(true);
      expect(t).toHaveLength(43);
      tokens.add(t);
      const id = generateId();
      expect(id).toMatch(/^[0-9a-f]{32}$/);
      ids.add(id);
    }
    expect(tokens.size).toBe(5000);
    expect(ids.size).toBe(5000);
  });

  it('token bits look uniform (every one of 6 sampled bit positions near 50%)', () => {
    const N = 4000;
    const ones = new Array(8).fill(0);
    for (let i = 0; i < N; i++) {
      const bytes = base64urlnopad.decode(generateToken());
      for (let b = 0; b < 8; b++) ones[b] += (bytes[5]! >> b) & 1;
    }
    for (const c of ones) expect(Math.abs(c / N - 0.5)).toBeLessThan(0.05);
  });

  it('timingSafeEqual', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
    expect(timingSafeEqual('', '')).toBe(true);
  });

  it('isToken is strict', () => {
    expect(isToken('A'.repeat(43))).toBe(true);
    expect(isToken('A'.repeat(42))).toBe(false);
    expect(isToken('A'.repeat(42) + '=')).toBe(false);
    expect(isToken(123)).toBe(false);
  });
});

describe('gift references', () => {
  it('has the documented shape and passes its own check', () => {
    for (let i = 0; i < 500; i++) {
      const r = generateReference();
      expect(r).toMatch(/^MUM-[0-9A-HJKMNP-TV-Z]{4}(-[0-9A-HJKMNP-TV-Z]{4}){3}-[0-9A-HJKMNP-TV-Z]$/);
      expect(normalizeReference(r)).toBe(r);
    }
  });

  it('has no collisions in 20,000 draws (80 bits)', () => {
    const s = new Set<string>();
    for (let i = 0; i < 20_000; i++) s.add(generateReference());
    expect(s.size).toBe(20_000);
  });

  it('normalizes case, spacing, missing prefix and Crockford look-alikes', () => {
    const r = generateReference();
    const loose = r.toLowerCase().replace(/-/g, ' ');
    expect(normalizeReference(loose)).toBe(r);
    expect(normalizeReference(r.slice(4))).toBe(r);
    expect(normalizeReference(r.replace(/0/g, 'o').replace(/1/g, 'l'))).toBe(r);
  });

  it('detects every single-character error', () => {
    const alphabet = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
    for (let n = 0; n < 50; n++) {
      const r = generateReference();
      const chars = r.replace(/-/g, '').slice(3); // 17 data+check characters
      for (let i = 0; i < chars.length; i++) {
        for (const c of alphabet) {
          if (c === chars[i]) continue;
          const mutated = chars.slice(0, i) + c + chars.slice(i + 1);
          expect(normalizeReference(mutated)).toBeUndefined();
        }
      }
    }
  });

  it('detects the large majority of adjacent transpositions', () => {
    let detected = 0;
    let total = 0;
    for (let n = 0; n < 300; n++) {
      const chars = generateReference().replace(/-/g, '').slice(3);
      const i = n % (chars.length - 1);
      if (chars[i] === chars[i + 1]) continue;
      const swapped = chars.slice(0, i) + chars[i + 1] + chars[i] + chars.slice(i + 2);
      total++;
      if (normalizeReference(swapped) === undefined) detected++;
    }
    expect(detected / total).toBeGreaterThan(0.9);
  });

  it('rejects junk', () => {
    for (const bad of ['', 'MUM-', 'hello', 'MUM-UUUU-UUUU-UUUU-UUUU-U', 'x'.repeat(100), 'MUM-7Q4K-X2J9-PA3M-WV8T']) {
      expect(normalizeReference(bad)).toBeUndefined();
    }
  });
});

describe('private link fragments', () => {
  it('round-trips and is order-insensitive', async () => {
    const kp = await generateKeyPair();
    const token = generateToken();
    const frag = buildFragment({ secretKey: kp.secretKey, token });
    expect(frag).toMatch(/^#k=[A-Za-z0-9_-]{43}&t=[A-Za-z0-9_-]{43}$/);
    const parsed = parseFragment(frag)!;
    expect(parsed.secretKey).toEqual(kp.secretKey);
    expect(parsed.token).toBe(token);
    const swapped = `#t=${token}&k=${encodeKey(kp.secretKey)}`;
    expect(parseFragment(swapped)?.token).toBe(token);
  });

  it('rejects malformed, duplicated and extra parameters', async () => {
    const kp = await generateKeyPair();
    const k = encodeKey(kp.secretKey);
    const t = generateToken();
    for (const bad of ['', '#', '#k=' + k, '#t=' + t, `#k=${k}&k=${k}`, `#k=${k}&t=${t}&x=1`, `#k=${k}&t=short`, `#k=short&t=${t}`, `#k=${k}&t=${t}&`, `k=${k};t=${t}`, 'x'.repeat(500)]) {
      expect(parseFragment(bad)).toBeUndefined();
    }
  });
});

describe('passphrase backup', () => {
  const contents = async () => {
    const kp = await generateKeyPair();
    return { v: 1 as const, kind: 'mummer-backup' as const, role: 'member' as const, groupId: GROUP, memberId: 'c'.repeat(32), secretKey: encodeKey(kp.secretKey), token: generateToken() };
  };

  it('round-trips with the right passphrase', async () => {
    const c = await contents();
    const blob = sealBackup(c, 'correct horse battery staple');
    expect(blob.startsWith('MUMBK1.')).toBe(true);
    expect(openBackup(blob, 'correct horse battery staple')).toEqual(c);
  });

  it('rejects a wrong passphrase, tampering and truncation', async () => {
    const c = await contents();
    const blob = sealBackup(c, 'correct horse battery staple');
    expect(() => openBackup(blob, 'wrong passphrase here')).toThrowError(expect.objectContaining({ code: 'decrypt_failed' }));
    const flip = blob.slice(0, 40) + (blob[40] === 'A' ? 'B' : 'A') + blob.slice(41);
    expect(() => openBackup(flip, 'correct horse battery staple')).toThrow(CryptoError);
    expect(() => openBackup(blob.slice(0, -4), 'correct horse battery staple')).toThrow(CryptoError);
    expect(() => openBackup('MUMBK1.', 'correct horse battery staple')).toThrow(CryptoError);
    expect(() => openBackup('nonsense', 'correct horse battery staple')).toThrow(CryptoError);
  });

  it('refuses short passphrases and does not contain the secrets in clear', async () => {
    const c = await contents();
    expect(() => sealBackup(c, 'short')).toThrowError(expect.objectContaining({ code: 'weak_passphrase' }));
    const blob = sealBackup(c, 'correct horse battery staple');
    expect(blob).not.toContain(c.secretKey);
    expect(blob).not.toContain(c.token);
  });

  it('uses a fresh salt and nonce each time', async () => {
    const c = await contents();
    expect(sealBackup(c, 'correct horse battery staple')).not.toBe(sealBackup(c, 'correct horse battery staple'));
  });

  it('requires a member id for member backups and forbids one for admin backups', async () => {
    const c = await contents();
    expect(() => sealBackup({ ...c, memberId: undefined }, 'correct horse battery staple')).toThrow();
    expect(() => sealBackup({ ...c, role: 'admin' }, 'correct horse battery staple')).toThrow();
  });
});

describe('wipe', () => {
  it('zeroes buffers', () => {
    const b = new Uint8Array([1, 2, 3]);
    wipe(b, undefined);
    expect(Array.from(b)).toEqual([0, 0, 0]);
  });
});

describe('profiles, draw packaging and assignments', () => {
  const profile = (name: string, groupId = GROUP) => ({ v: 1 as const, kind: 'profile' as const, groupId, pseudonym: name, wishlist: `${name} likes socks`, address: ADDRESS });

  it('profile: only the host key opens it; context is enforced', async () => {
    const host = await generateKeyPair();
    const other = await generateKeyPair();
    const sealed = sealProfile(profile('Ada'), encodeKey(host.publicKey));
    expect(openProfile(sealed, host.publicKey, host.secretKey, { groupId: GROUP, pseudonym: 'Ada' }).wishlist).toBe('Ada likes socks');
    expect(() => openProfile(sealed, other.publicKey, other.secretKey, { groupId: GROUP })).toThrow(CryptoError);
    expect(() => openProfile(sealed, host.publicKey, host.secretKey, { groupId: 'f'.repeat(32) })).toThrowError(expect.objectContaining({ code: 'context_mismatch' }));
    expect(() => openProfile(sealed, host.publicKey, host.secretKey, { groupId: GROUP, pseudonym: 'Eve' })).toThrowError(expect.objectContaining({ code: 'context_mismatch' }));
  });

  async function setup(n: number) {
    const names = ['Ada', 'Grace', 'Linus', 'Margaret', 'Dennis', 'Barbara', 'Ken', 'Radia'].slice(0, n);
    const members = await Promise.all(
      names.map(async (name, i) => {
        const kp = await generateKeyPair();
        return { kp, id: i.toString(16).padStart(2, '0').repeat(16), publicKey: encodeKey(kp.publicKey), profile: profile(name) };
      }),
    );
    // A single cycle: i -> i+1
    const assignments: Record<string, string> = {};
    members.forEach((m, i) => (assignments[m.id] = members[(i + 1) % members.length]!.id));
    return { members, assignments };
  }

  it('each giver opens exactly their own bundle; nobody else can', async () => {
    const { members, assignments } = await setup(5);
    const payload = buildDrawPayload({ groupId: GROUP, drawVersion: 1, budgetCents: 2500, members, assignments });
    expect(payload.bundles).toHaveLength(5);
    expect(payload.commitments).toHaveLength(5);
    for (const m of members) {
      const sealed = payload.bundles.find((b) => b.memberId === m.id)!.sealedBundle;
      const opened = openAssignment(sealed, m.kp.publicKey, m.kp.secretKey, { groupId: GROUP, memberId: m.id, drawVersion: 1 });
      expect(opened.recipient.memberId).toBe(assignments[m.id]);
      expect(opened.recipient.address).toBe(ADDRESS);
      for (const other of members.filter((x) => x.id !== m.id)) {
        expect(() => openAssignment(sealed, other.kp.publicKey, other.kp.secretKey, { groupId: GROUP, memberId: other.id, drawVersion: 1 })).toThrow(CryptoError);
      }
    }
  });

  it('commitments match the reference inside the giver bundle, filed under the recipient', async () => {
    const { members, assignments } = await setup(5);
    const payload = buildDrawPayload({ groupId: GROUP, drawVersion: 1, budgetCents: 2500, members, assignments });
    for (const m of members) {
      const opened = openAssignment(payload.bundles.find((b) => b.memberId === m.id)!.sealedBundle, m.kp.publicKey, m.kp.secretKey, { groupId: GROUP, memberId: m.id, drawVersion: 1 });
      const commitment = payload.commitments.find((c) => c.memberId === opened.recipient.memberId)!.commitment;
      expect(commitment).toBe(ackCommitment(GROUP, opened.recipient.memberId, opened.reference));
    }
  });

  it('both arrays are sorted by member id so list order cannot reveal the cycle', async () => {
    const { members, assignments } = await setup(6);
    const shuffledMembers = [members[3]!, members[0]!, members[5]!, members[1]!, members[4]!, members[2]!];
    const p = buildDrawPayload({ groupId: GROUP, drawVersion: 1, budgetCents: 2500, members: shuffledMembers, assignments });
    const sorted = (xs: { memberId: string }[]) => xs.map((x) => x.memberId).join() === [...xs.map((x) => x.memberId)].sort().join();
    expect(sorted(p.bundles)).toBe(true);
    expect(sorted(p.commitments)).toBe(true);
  });

  it('rejects cross-group, cross-member and cross-draw replay of a bundle', async () => {
    const { members, assignments } = await setup(4);
    const payload = buildDrawPayload({ groupId: GROUP, drawVersion: 1, budgetCents: 2500, members, assignments });
    const m = members[0]!;
    const sealed = payload.bundles.find((b) => b.memberId === m.id)!.sealedBundle;
    expect(() => openAssignment(sealed, m.kp.publicKey, m.kp.secretKey, { groupId: 'e'.repeat(32), memberId: m.id, drawVersion: 1 })).toThrowError(expect.objectContaining({ code: 'context_mismatch' }));
    expect(() => openAssignment(sealed, m.kp.publicKey, m.kp.secretKey, { groupId: GROUP, memberId: members[1]!.id, drawVersion: 1 })).toThrowError(expect.objectContaining({ code: 'context_mismatch' }));
    expect(() => openAssignment(sealed, m.kp.publicKey, m.kp.secretKey, { groupId: GROUP, memberId: m.id, drawVersion: 2 })).toThrowError(expect.objectContaining({ code: 'context_mismatch' }));
  });

  it('nothing the server would store contains plaintext addresses, wishlists, names or references', async () => {
    const { members, assignments } = await setup(5);
    const payload = buildDrawPayload({ groupId: GROUP, drawVersion: 1, budgetCents: 2500, members, assignments });
    const hostKey = await generateKeyPair();
    const sealedProfiles = members.map((m) => sealProfile(m.profile, encodeKey(hostKey.publicKey)));
    const stored = JSON.stringify([payload, sealedProfiles]);
    const decodedAll = [...payload.bundles.map((b) => b.sealedBundle), ...sealedProfiles].map((s) => Buffer.from(base64urlnopad.decode(s)).toString('latin1')).join('|');
    for (const needle of [ADDRESS, ADDRESS.slice(10, 40), 'socks', 'Grace', 'Linus', 'MUM-', 'wishlist', 'address']) {
      expect(stored).not.toContain(needle);
      expect(decodedAll).not.toContain(needle);
    }
  });

  it('refuses self-assignment and unknown recipients when packaging', async () => {
    const { members } = await setup(4);
    const self: Record<string, string> = {};
    members.forEach((m) => (self[m.id] = m.id));
    expect(() => buildDrawPayload({ groupId: GROUP, drawVersion: 1, budgetCents: 2500, members, assignments: self })).toThrow(CryptoError);
    const unknown: Record<string, string> = {};
    members.forEach((m) => (unknown[m.id] = 'z'.repeat(32)));
    expect(() => buildDrawPayload({ groupId: GROUP, drawVersion: 1, budgetCents: 2500, members, assignments: unknown })).toThrow(CryptoError);
  });

  it('rotation: a re-sealed bundle opens with the new key only', async () => {
    const { members, assignments } = await setup(4);
    const payload = buildDrawPayload({ groupId: GROUP, drawVersion: 1, budgetCents: 2500, members, assignments });
    const m = members[0]!;
    const opened = openAssignment(payload.bundles.find((b) => b.memberId === m.id)!.sealedBundle, m.kp.publicKey, m.kp.secretKey, { groupId: GROUP, memberId: m.id, drawVersion: 1 });
    const fresh = await generateKeyPair();
    const resealed = resealAssignment(opened, encodeKey(fresh.publicKey));
    expect(openAssignment(resealed, fresh.publicKey, fresh.secretKey, { groupId: GROUP, memberId: m.id, drawVersion: 1 })).toEqual(opened);
    expect(() => openAssignment(resealed, m.kp.publicKey, m.kp.secretKey, { groupId: GROUP, memberId: m.id, drawVersion: 1 })).toThrow(CryptoError);
  });
});
