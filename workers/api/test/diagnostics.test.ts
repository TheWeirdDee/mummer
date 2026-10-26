import { describe, expect, it } from 'vitest';
import { describeError } from '../src/app.js';

describe('error diagnostics', () => {
  it('reports the failure shape without ids, tokens or long blobs', () => {
    const id = 'a'.repeat(32);
    const blob = 'B'.repeat(60);
    const e = new TypeError(`Cannot read properties of undefined (member ${id} token ${blob})`);
    const d = describeError(e, 'POST', `/api/groups/${id}/members`);
    const text = JSON.stringify(d);
    expect(d.name).toBe('TypeError');
    expect(d.route).toBe('/api/groups/:id/members');
    expect(d.method).toBe('POST');
    expect(text).not.toContain(id);
    expect(text).not.toContain(blob);
    expect(d.message).toContain(':id');
    expect(d.frames.length).toBeGreaterThan(0);
    expect(d.frames.every((f) => !f.includes('\\') && !f.includes('file://'))).toBe(true);
  });

  it('includes the underlying cause of a network failure (code and name only, masked)', () => {
    const cause = Object.assign(new Error('read ECONNRESET for ' + 'a'.repeat(32)), { code: 'ECONNRESET' });
    const e = new TypeError('fetch failed', { cause });
    const d = describeError(e, 'POST', '/api/groups');
    expect(d.cause?.code).toBe('ECONNRESET');
    expect(d.cause?.message).toContain('ECONNRESET');
    expect(JSON.stringify(d)).not.toContain('a'.repeat(32));
    expect(describeError(new Error('x'), 'GET', '/x').cause).toBeUndefined();
  });

  it('truncates long messages and tolerates non-Error throws', () => {
    expect(describeError(new Error('word '.repeat(1000)), 'GET', '/api/x').message.length).toBe(200);
    const d = describeError('plain string', 'GET', '/api/x');
    expect(d.name).toBe('Error');
    expect(d.message).toBe('plain string');
  });
});
