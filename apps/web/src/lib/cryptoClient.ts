/**
 * libsodium embeds its WebAssembly, so the crypto package is loaded lazily and
 * only on routes that handle keys (join, admin, member, recover). Public
 * marketing pages never download it.
 */
type CryptoModule = typeof import('@mummer/crypto');

let loaded: Promise<CryptoModule> | undefined;

export function loadCrypto(): Promise<CryptoModule> {
  loaded ??= import('@mummer/crypto').then(async (m) => {
    await m.ready();
    return m;
  });
  return loaded;
}
