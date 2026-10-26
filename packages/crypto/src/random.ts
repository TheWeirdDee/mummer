/** CSPRNG bytes from the platform (Web Crypto). Kept free of libsodium so server code can import it without loading WebAssembly. */
export function randomBytes(n: number): Uint8Array {
  if (!Number.isInteger(n) || n < 1 || n > 1024) throw new RangeError('randomBytes: n must be 1..1024');
  const out = new Uint8Array(n);
  (globalThis as unknown as { crypto: Crypto }).crypto.getRandomValues(out);
  return out;
}
