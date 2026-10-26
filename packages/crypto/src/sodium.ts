import _sodium from 'libsodium-wrappers';

type Sodium = typeof _sodium;

let instance: Sodium | undefined;
let loading: Promise<Sodium> | undefined;

/** Initialise libsodium once. All crypto entry points call this (or require a prior `await ready()`). */
export function ready(): Promise<Sodium> {
  if (instance) return Promise.resolve(instance);
  loading ??= _sodium.ready.then(() => (instance = _sodium));
  return loading;
}

/** Synchronous access after `await ready()`. Throws if not initialised: fail visibly, never fall back. */
export function sodium(): Sodium {
  if (!instance) throw new Error('libsodium is not initialised: await ready() first');
  return instance;
}

/** Best-effort zeroing of secret buffers. JavaScript cannot guarantee no other copies exist; see docs/CRYPTOGRAPHIC_DESIGN.md. */
export function wipe(...buffers: (Uint8Array | undefined)[]): void {
  const s = instance;
  for (const b of buffers) {
    if (!b) continue;
    if (s) s.memzero(b);
    else b.fill(0);
  }
}

export { randomBytes } from './random.js';
