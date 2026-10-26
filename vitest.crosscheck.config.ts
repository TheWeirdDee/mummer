import { defineConfig } from 'vitest/config';

// Opt-in cross-checks against independent implementations (needs a Rust toolchain). Run with `npm run test:crosscheck`.
export default defineConfig({
  test: { include: ['tests/crosscheck/**/*.test.ts'], environment: 'node', testTimeout: 900_000 },
});
