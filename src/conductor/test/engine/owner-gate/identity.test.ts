// Test: owner-gate identity resolution (identity.ts)
//
// Covers the ordered resolution chain configured → gh → unresolved:
//   - normalizeOwnerId: case/whitespace tolerance, blank → null, no fuzzy match
//   - configuredOwner: FR-1 configured owner + blank → unresolved
//   - ghLoginOwner: FR-2 happy path + FR-2 negative (non-zero/absent/blank)
//   - resolveDaemonOwner: configured wins, gh fallback, neither → unresolved

import { describe, it, expect } from 'vitest';
import {
  normalizeOwnerId,
  configuredOwner,
  ghLoginOwner,
  resolveDaemonOwner,
  type GhRunner,
} from '../../../src/engine/owner-gate/identity.js';

/** A gh stub that returns `stdout` from `gh api user`. */
function ghReturning(stdout: string): GhRunner {
  return async () => ({ stdout });
}

/** A gh stub that throws — models a non-zero exit or an absent binary. */
function ghThrowing(): GhRunner {
  return async () => {
    throw new Error('gh: command failed / not found');
  };
}

describe('normalizeOwnerId', () => {
  it('is case- and whitespace-insensitive', () => {
    expect(normalizeOwnerId('  Alice ')).toBe(normalizeOwnerId('alice'));
    expect(normalizeOwnerId('  Alice ')).toBe('alice');
  });

  it('keeps distinct ids distinct (no substring/fuzzy match)', () => {
    expect(normalizeOwnerId('alice')).not.toBe(normalizeOwnerId('alice-bot'));
  });

  it('maps blank / whitespace / absent to null', () => {
    expect(normalizeOwnerId('   ')).toBeNull();
    expect(normalizeOwnerId('')).toBeNull();
    expect(normalizeOwnerId(null)).toBeNull();
    expect(normalizeOwnerId(undefined)).toBeNull();
  });
});

describe('configuredOwner (FR-1)', () => {
  it('resolves a configured spec_owner, normalized', () => {
    expect(configuredOwner({ spec_owner: 'Alice' })).toEqual({ resolved: true, id: 'alice' });
  });

  it('treats blank / whitespace / absent spec_owner as unresolved', () => {
    expect(configuredOwner({ spec_owner: '' })).toEqual({ resolved: false });
    expect(configuredOwner({ spec_owner: '   ' })).toEqual({ resolved: false });
    expect(configuredOwner({})).toEqual({ resolved: false });
  });
});

describe('ghLoginOwner (FR-2)', () => {
  it('resolves the authenticated gh login, normalized', async () => {
    await expect(ghLoginOwner(ghReturning('bob\n'), '/repo')).resolves.toEqual({
      resolved: true,
      id: 'bob',
    });
  });

  it('degrades a thrown gh error (non-zero exit / absent binary) to unresolved', async () => {
    await expect(ghLoginOwner(ghThrowing(), '/repo')).resolves.toEqual({ resolved: false });
  });

  it('degrades a blank / empty gh payload to unresolved (never an empty-string id)', async () => {
    await expect(ghLoginOwner(ghReturning(''), '/repo')).resolves.toEqual({ resolved: false });
    await expect(ghLoginOwner(ghReturning('   \n'), '/repo')).resolves.toEqual({ resolved: false });
  });

  it('degrades a literal JSON-null / "null" / "undefined" login to unresolved (not an id of "null")', async () => {
    // `gh api user --jq .login` prints the literal text "null" for a JSON null
    // login (and "undefined" for an absent field). These must NOT become owner ids.
    await expect(ghLoginOwner(ghReturning('null\n'), '/repo')).resolves.toEqual({ resolved: false });
    await expect(ghLoginOwner(ghReturning('NULL'), '/repo')).resolves.toEqual({ resolved: false });
    await expect(ghLoginOwner(ghReturning('undefined\n'), '/repo')).resolves.toEqual({
      resolved: false,
    });
  });
});

describe('resolveDaemonOwner chain (FR-1/2/3)', () => {
  it('prefers the configured owner over gh', async () => {
    const r = await resolveDaemonOwner({ spec_owner: 'Alice' }, ghReturning('bob'), '/repo');
    expect(r).toEqual({ resolved: true, id: 'alice' });
  });

  it('falls back to gh when unconfigured', async () => {
    const r = await resolveDaemonOwner({}, ghReturning('bob'), '/repo');
    expect(r).toEqual({ resolved: true, id: 'bob' });
  });

  it('is unresolved when neither configured nor gh-authed', async () => {
    const r = await resolveDaemonOwner({}, ghThrowing(), '/repo');
    expect(r).toEqual({ resolved: false });
  });
});

// Task 18 (FR-14): identity change. resolveDaemonOwner reads the CURRENT config
// on every call — there is no memoization — so a reconfigured spec_owner takes
// effect on the next pass. An invalid (blank) new id falls through the chain.
describe('resolveDaemonOwner reads current config each pass (FR-14, no caching)', () => {
  it('a reconfigured spec_owner is honored on the very next call', async () => {
    const gh = ghReturning('bob');
    const first = await resolveDaemonOwner({ spec_owner: 'alice' }, gh, '/repo');
    expect(first).toEqual({ resolved: true, id: 'alice' });
    // Operator reconfigures to alice2 — the next call must reflect it (no cache).
    const second = await resolveDaemonOwner({ spec_owner: 'alice2' }, gh, '/repo');
    expect(second).toEqual({ resolved: true, id: 'alice2' });
  });

  it('an invalid (blank) new spec_owner falls through to the gh login', async () => {
    const r = await resolveDaemonOwner({ spec_owner: '   ' }, ghReturning('bob'), '/repo');
    expect(r).toEqual({ resolved: true, id: 'bob' });
  });
});
