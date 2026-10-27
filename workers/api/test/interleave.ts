import type { World } from './harness.js';

/**
 * Deterministic interleaving for race tests.
 *
 * A handler reads some state, decides, and then writes in a D1 batch. This helper runs `action` at the exact moment such a
 * handler is about to submit the first batch containing a statement whose SQL includes `sqlIncludes`: after its reads and
 * checks, before its writes. The action runs once, can make ordinary requests (a draw, a reset, a close) and finishes before
 * the batch goes through, so the handler's checks are guaranteed stale. No timers and no randomness.
 *
 * Returns a function that restores the real database binding.
 */
export function interleaveBeforeBatch(w: World, sqlIncludes: string, action: () => Promise<void>): () => void {
  const real = w.env.DB;
  const originals = new WeakMap<object, D1PreparedStatement>();
  const sqlOf = new WeakMap<object, string>();
  let fired = false;

  const wrap = (stmt: D1PreparedStatement, sql: string): D1PreparedStatement => {
    const proxy: D1PreparedStatement = new Proxy(stmt, {
      get(target, prop) {
        if (prop === 'bind') return (...args: unknown[]) => wrap(target.bind(...(args as [])), sql);
        const value = Reflect.get(target, prop, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
    originals.set(proxy, stmt);
    sqlOf.set(proxy, sql);
    return proxy;
  };

  (w.env as { DB: D1Database }).DB = new Proxy(real, {
    get(target, prop) {
      if (prop === 'prepare') return (sql: string) => wrap(target.prepare(sql), sql);
      if (prop === 'batch') {
        return async (statements: D1PreparedStatement[]) => {
          if (!fired && statements.some((s) => sqlOf.get(s)?.includes(sqlIncludes))) {
            fired = true;
            await action();
          }
          return target.batch(statements.map((s) => originals.get(s) ?? s));
        };
      }
      const value = Reflect.get(target, prop, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });

  return () => {
    (w.env as { DB: D1Database }).DB = real;
  };
}
