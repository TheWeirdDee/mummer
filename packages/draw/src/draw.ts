import { cryptoRandom, shuffled, type RandomSource } from './rng.js';

/**
 * Secret Santa draw: a single cycle through all members (A->B->C->...->A).
 *
 *  - No one draws themselves.
 *  - One cycle means no two people draw each other (for 3+ members) and no
 *    small closed loops, which would let givers deduce more about the draw.
 *  - With no exclusions this is Sattolo's algorithm: uniform over all
 *    (n-1)! single cycles.
 *  - With exclusions, uniform rejection sampling over Sattolo cycles is tried
 *    first (so the result is uniform over all VALID cycles). If constraints
 *    are so dense that sampling keeps failing, a bounded randomized
 *    depth-first search takes over; that path is NOT guaranteed uniform and
 *    the result says so. An exhaustive search that completes proves
 *    impossibility; a search that hits its budget is reported as inconclusive.
 *
 * The draw runs only in the host's browser. Exclusion pairs never leave it.
 */

export const MIN_MEMBERS = 4;

export interface Exclusion {
  /** This member must not give to `recipient`. */
  giver: string;
  recipient: string;
}

export interface DrawOptions {
  memberIds: readonly string[];
  exclusions?: readonly Exclusion[];
  rng?: RandomSource;
  minMembers?: number;
  /** Rejection-sampling attempts before falling back to search. */
  maxSamples?: number;
  /** Node budget for the fallback search. */
  maxSearchNodes?: number;
}

export type DrawFailure =
  | { ok: false; reason: 'too_few_members'; minMembers: number }
  | { ok: false; reason: 'duplicate_member_ids' }
  | { ok: false; reason: 'unknown_member_in_exclusion'; id: string }
  | { ok: false; reason: 'member_has_no_possible_recipient'; id: string }
  | { ok: false; reason: 'member_has_no_possible_giver'; id: string }
  | { ok: false; reason: 'unsatisfiable' }
  | { ok: false; reason: 'search_limit_reached' };

export interface DrawSuccess {
  ok: true;
  /** giver id -> recipient id */
  assignments: Record<string, string>;
  method: 'sattolo' | 'rejection_sampled' | 'constrained_search';
  /** True when the result is uniform over all valid single cycles. */
  uniform: boolean;
}

export type DrawResult = DrawSuccess | DrawFailure;

/** Uniformly random single n-cycle as a permutation p, where element k maps to p[k]. */
export function sattoloPermutation(n: number, rng: RandomSource): number[] {
  const p = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i >= 1; i--) {
    const j = rng.randomInt(i); // j in [0, i-1]: never i itself, so no fixed points and one cycle
    [p[i], p[j]] = [p[j]!, p[i]!];
  }
  return p;
}

type Forbidden = Map<string, Set<string>>;

function forbiddenMap(ids: readonly string[], exclusions: readonly Exclusion[]): { map: Forbidden; count: number } | { error: DrawFailure } {
  const known = new Set(ids);
  const map: Forbidden = new Map();
  let count = 0;
  for (const e of exclusions) {
    for (const id of [e.giver, e.recipient]) {
      if (!known.has(id)) return { error: { ok: false, reason: 'unknown_member_in_exclusion', id } };
    }
    const set = map.get(e.giver) ?? new Set<string>();
    if (!set.has(e.recipient)) count++;
    set.add(e.recipient);
    map.set(e.giver, set);
  }
  return { map, count };
}

/** Independent post-condition check. Used by tests and by the host UI before anything is sealed. */
export function validateAssignment(
  memberIds: readonly string[],
  assignments: Readonly<Record<string, string>>,
  exclusions: readonly Exclusion[] = [],
): { ok: true } | { ok: false; problem: string } {
  const n = memberIds.length;
  if (Object.keys(assignments).length !== n) return { ok: false, problem: 'wrong number of assignments' };
  const ids = new Set(memberIds);
  const recipients = new Set<string>();
  for (const g of memberIds) {
    const r = assignments[g];
    if (r === undefined || !ids.has(r)) return { ok: false, problem: `giver ${g} has no valid recipient` };
    if (r === g) return { ok: false, problem: 'self-assignment' };
    recipients.add(r);
  }
  if (recipients.size !== n) return { ok: false, problem: 'recipients are not unique' };
  for (const e of exclusions) {
    if (assignments[e.giver] === e.recipient) return { ok: false, problem: 'exclusion violated' };
  }
  // Single cycle: walking from any start returns after exactly n steps.
  const start = memberIds[0]!;
  let cur = start;
  for (let steps = 1; steps <= n; steps++) {
    cur = assignments[cur]!;
    if (cur === start) return steps === n ? { ok: true } : { ok: false, problem: `closed loop of length ${steps}` };
  }
  return { ok: false, problem: 'not a single cycle' };
}

function toAssignments(ids: readonly string[], perm: readonly number[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (let k = 0; k < ids.length; k++) out[ids[k]!] = ids[perm[k]!]!;
  return out;
}

export function runDraw(opts: DrawOptions): DrawResult {
  const ids = opts.memberIds;
  const minMembers = opts.minMembers ?? MIN_MEMBERS;
  const rng = opts.rng ?? cryptoRandom();
  const exclusions = opts.exclusions ?? [];

  if (new Set(ids).size !== ids.length) return { ok: false, reason: 'duplicate_member_ids' };
  if (ids.length < minMembers) return { ok: false, reason: 'too_few_members', minMembers };

  const fm = forbiddenMap(ids, exclusions);
  if ('error' in fm) return fm.error;
  const n = ids.length;

  // Shuffle the member order first so the result does not depend on input order.
  const order = shuffled(ids, rng);
  const allowed = (g: string, r: string) => g !== r && !fm.map.get(g)?.has(r);

  if (fm.count === 0) {
    const perm = sattoloPermutation(n, rng);
    const assignments = toAssignments(order, perm);
    return { ok: true, assignments, method: 'sattolo', uniform: true };
  }

  for (const g of order) {
    if (!order.some((r) => allowed(g, r))) return { ok: false, reason: 'member_has_no_possible_recipient', id: g };
    if (!order.some((x) => allowed(x, g))) return { ok: false, reason: 'member_has_no_possible_giver', id: g };
  }

  // 1. Rejection sampling over uniform cycles: uniform over valid cycles.
  const maxSamples = opts.maxSamples ?? 3000;
  for (let t = 0; t < maxSamples; t++) {
    const perm = sattoloPermutation(n, rng);
    let valid = true;
    for (let k = 0; k < n && valid; k++) valid = allowed(order[k]!, order[perm[k]!]!);
    if (valid) return { ok: true, assignments: toAssignments(order, perm), method: 'rejection_sampled', uniform: true };
  }

  // 2. Bounded randomized search for a Hamiltonian cycle in the allowed graph.
  const budget = opts.maxSearchNodes ?? 250_000;
  let nodes = 0;
  const start = order[0]!;
  const visited = new Set<string>([start]);
  const path: string[] = [start];

  const feasible = (current: string): boolean => {
    // Every unvisited member needs a possible incoming edge from (unvisited ∪ current)
    // and a possible outgoing edge to (unvisited ∪ start).
    for (const v of order) {
      if (visited.has(v)) continue;
      let hasIn = allowed(current, v);
      let hasOut = allowed(v, start);
      for (const u of order) {
        if (hasIn && hasOut) break;
        if (u === v || visited.has(u)) continue;
        hasIn = hasIn || allowed(u, v);
        hasOut = hasOut || allowed(v, u);
      }
      if (!hasIn || !hasOut) return false;
    }
    return true;
  };

  const dfs = (current: string): boolean | 'limit' => {
    if (path.length === n) return allowed(current, start);
    if (++nodes > budget) return 'limit';
    const candidates = shuffled(
      order.filter((v) => !visited.has(v) && allowed(current, v)),
      rng,
    );
    for (const next of candidates) {
      visited.add(next);
      path.push(next);
      if (feasible(next)) {
        const r = dfs(next);
        if (r === true || r === 'limit') return r;
      }
      path.pop();
      visited.delete(next);
    }
    return false;
  };

  const found = dfs(start);
  if (found === 'limit') return { ok: false, reason: 'search_limit_reached' };
  if (!found) return { ok: false, reason: 'unsatisfiable' };
  const assignments: Record<string, string> = {};
  for (let k = 0; k < n; k++) assignments[path[k]!] = path[(k + 1) % n]!;
  return { ok: true, assignments, method: 'constrained_search', uniform: false };
}
