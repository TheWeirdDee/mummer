import { describe, expect, it, vi } from 'vitest';
import { isTransientConnectError, resilientD1, retryTransient, transientStats } from './resilient-d1.js';

const portExhausted = () => Object.assign(new TypeError('fetch failed'), { cause: Object.assign(new Error('connect EADDRINUSE 127.0.0.1:54063'), { code: 'EADDRINUSE' }) });

describe('resilient D1 test guard', () => {
  it('recognises only connect-time port exhaustion as transient', () => {
    expect(isTransientConnectError(portExhausted())).toBe(true);
    expect(isTransientConnectError(Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNRESET' } }))).toBe(false);
    expect(isTransientConnectError(new Error('D1_ERROR: UNIQUE constraint failed'))).toBe(false);
    expect(isTransientConnectError(undefined)).toBe(false);
  });

  it('retries a failed connect and then succeeds, counting and logging the retry', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const before = transientStats.retries;
    let calls = 0;
    const result = await retryTransient(async () => {
      if (++calls < 3) throw portExhausted();
      return 'ok';
    }, 'test');
    expect(result).toBe('ok');
    expect(calls).toBe(3);
    expect(transientStats.retries - before).toBe(2);
    expect(warn).toHaveBeenCalledTimes(2);
    warn.mockRestore();
  });

  it('never retries other errors, so real failures and constraint errors surface unchanged', async () => {
    let calls = 0;
    const real = new Error('D1_ERROR: UNIQUE constraint failed: members.pseudonym');
    await expect(
      retryTransient(async () => {
        calls++;
        throw real;
      }, 'test'),
    ).rejects.toBe(real);
    expect(calls).toBe(1);
  });

  it('gives up after a bounded number of attempts and rethrows the original error', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    let calls = 0;
    const err = portExhausted();
    await expect(
      retryTransient(async () => {
        calls++;
        throw err;
      }, 'test'),
    ).rejects.toBe(err);
    expect(calls).toBe(7);
    warn.mockRestore();
  }, 20_000);

  it('wraps statements and batches without changing results, and unwraps statements for batch()', async () => {
    const seen: string[] = [];
    let first = true;
    const raw = {
      prepare(sql: string) {
        const stmt = {
          sql,
          bind: () => stmt,
          run: async () => {
            if (first) {
              first = false;
              throw portExhausted();
            }
            seen.push(`run:${sql}`);
            return { success: true };
          },
          all: async () => ({ results: [sql] }),
          first: async () => ({ sql }),
          raw: async () => [[sql]],
        };
        return stmt;
      },
      batch: async (stmts: { sql: string }[]) => {
        // Statements reaching the real binding must be the originals, not proxies.
        seen.push(`batch:${stmts.map((s) => s.sql).join(',')}`);
        return stmts.map(() => ({ success: true }));
      },
      exec: async () => ({ count: 1 }),
    } as unknown as D1Database;
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const db = resilientD1(raw);
    const s = db.prepare('INSERT 1').bind('x');
    expect(await s.run()).toEqual({ success: true }); // first attempt failed to connect, second went through
    expect(await db.prepare('SELECT 2').all()).toEqual({ results: ['SELECT 2'] });
    expect(await db.batch([db.prepare('A'), db.prepare('B').bind(1)])).toHaveLength(2);
    expect(seen).toEqual(['run:INSERT 1', 'batch:A,B']);
    vi.restoreAllMocks();
  });
});
