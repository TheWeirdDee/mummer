/**
 * Test-infrastructure guard, NOT product code.
 *
 * The integration harness runs the app in Node and reaches Miniflare's real D1 over a loopback HTTP connection
 * (Miniflare closes idle sockets after one second, so pauses cause new TCP connections). Each closed connection stays in
 * TIME_WAIT for 120 s on Windows, whose dynamic port range is only 16,384 ports. A full suite opens roughly 4,000
 * connections, so a second suite, a Playwright run or a few quick reruns can exhaust the range, and the next connect
 * fails with `connect EADDRINUSE 127.0.0.1:<port>` (surfacing as `TypeError: fetch failed`, hence an HTTP 500 from the app).
 *
 * A connect that fails with EADDRINUSE / EADDRNOTAVAIL never transmitted anything, so repeating that one call is safe and
 * cannot duplicate a write. Nothing else is retried: any other error, including a D1 error or a failure after the request was
 * sent, is thrown unchanged. Every retry is logged so the condition stays visible instead of being silently absorbed.
 * Production never uses this: the deployed Worker talks to D1 through Cloudflare's binding, not loopback TCP.
 */

const TRANSIENT_CODES = new Set(['EADDRINUSE', 'EADDRNOTAVAIL']);
const MAX_RETRIES = 6;

export const transientStats = { retries: 0 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function isTransientConnectError(e: unknown): boolean {
  const code = (e as { cause?: { code?: unknown } } | null | undefined)?.cause?.code;
  return typeof code === 'string' && TRANSIENT_CODES.has(code);
}

export async function retryTransient<T>(call: () => Promise<T>, label: string): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await call();
    } catch (e) {
      if (!isTransientConnectError(e) || attempt >= MAX_RETRIES) throw e;
      transientStats.retries++;
      console.warn(`d1-transient-retry: ${label} hit ${(e as { cause: { code: string } }).cause.code}; attempt ${attempt + 1} of ${MAX_RETRIES}`);
      await sleep(Math.min(100 * 2 ** attempt, 2000));
    }
  }
}

const RETRIED_STATEMENT_METHODS = new Set(['run', 'all', 'first', 'raw']);

export function resilientD1(db: D1Database): D1Database {
  const unwrap = new WeakMap<object, object>();
  const wrapStatement = (stmt: D1PreparedStatement): D1PreparedStatement => {
    const proxy: D1PreparedStatement = new Proxy(stmt, {
      get(target, prop, receiver) {
        const value = Reflect.get(target, prop, target);
        if (prop === 'bind') {
          return (...args: unknown[]) => wrapStatement((value as (...a: unknown[]) => D1PreparedStatement).apply(target, args));
        }
        if (typeof prop === 'string' && RETRIED_STATEMENT_METHODS.has(prop)) {
          return (...args: unknown[]) => retryTransient(() => (value as (...a: unknown[]) => Promise<unknown>).apply(target, args), `statement.${prop}`);
        }
        return typeof value === 'function' ? value.bind(target) : Reflect.get(target, prop, receiver);
      },
    });
    unwrap.set(proxy, stmt);
    return proxy;
  };
  return new Proxy(db, {
    get(target, prop) {
      const value = Reflect.get(target, prop, target);
      if (prop === 'prepare') return (sql: string) => wrapStatement(target.prepare(sql));
      if (prop === 'batch') {
        return (statements: D1PreparedStatement[]) =>
          retryTransient(() => target.batch(statements.map((s) => (unwrap.get(s) as D1PreparedStatement | undefined) ?? s)), 'db.batch');
      }
      if (prop === 'exec') return (sql: string) => retryTransient(() => target.exec(sql), 'db.exec');
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
}
