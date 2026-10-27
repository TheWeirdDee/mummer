import { z } from 'zod';

/**
 * Mummer's page CSP forbids `eval` and `new Function` (script-src 'self' 'wasm-unsafe-eval'). Zod 4 normally probes whether it
 * may compile validators just-in-time by trying `new Function`; the probe is caught, but browsers still report the blocked
 * attempt as a CSP violation (Firefox shows it as a JavaScript error in the console). Turning JIT off makes zod skip the probe
 * and use its interpreted validators. Behaviour is identical; only the console noise goes away.
 *
 * This module is imported FIRST by the package entry point (see index.ts), because zod may decide at schema-construction time.
 * It is also exported as a function so tests can assert it.
 */
export function configureSchemasForStrictCsp(): void {
  z.config({ jitless: true });
}

configureSchemasForStrictCsp();
