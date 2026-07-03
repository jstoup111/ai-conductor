// Test: deterministic dependency-edge parser (issue-dep-migration.ts)
//
// Task 22 scope ONLY: given an issue's source ref + body prose, deterministically
// parse "Gated on #N", "Depends on: #N[ / #M ...]", and "Blocked by #N" into
// blocked_by edges — the issue whose body is being parsed is always the one
// that is BLOCKED (it needs the referenced issue done first).
//
// Explicitly out of scope here (later tasks):
//   - manual-review classification for ambiguous/reverse/cross-repo prose (Task 23)
//   - writing the edges to the platform / confirm flow (Tasks 24-25)

import { describe, it, expect } from 'vitest';
import { parseDependencyEdges } from '../../../src/engine/engineer/issue-dep-migration.js';

describe('parseDependencyEdges', () => {
  it('parses "Gated on #217" into a blocked_by edge', () => {
    const edges = parseDependencyEdges({
      ref: 'acme/app#230',
      body: 'This work is Gated on #217 landing first.',
    });
    expect(edges).toEqual([
      { source: 'acme/app#230', target: 'acme/app#217', kind: 'gated-on', blocked_by: true },
    ]);
  });

  it('parses "Depends on: #189 / #190" into two blocked_by edges', () => {
    const edges = parseDependencyEdges({
      ref: 'acme/app#231',
      body: 'Depends on: #189 / #190 before we can start.',
    });
    expect(edges).toEqual([
      { source: 'acme/app#231', target: 'acme/app#189', kind: 'depends-on', blocked_by: true },
      { source: 'acme/app#231', target: 'acme/app#190', kind: 'depends-on', blocked_by: true },
    ]);
  });

  it('parses "Blocked by #226" into a blocked_by edge', () => {
    const edges = parseDependencyEdges({
      ref: 'acme/app#232',
      body: 'Blocked by #226 — do not start early.',
    });
    expect(edges).toEqual([
      { source: 'acme/app#232', target: 'acme/app#226', kind: 'blocked-by', blocked_by: true },
    ]);
  });

  it('parses "Depends on #189" (no colon) the same as the colon form', () => {
    const edges = parseDependencyEdges({
      ref: 'acme/app#240',
      body: 'Depends on #189 for the shared schema.',
    });
    expect(edges).toEqual([
      { source: 'acme/app#240', target: 'acme/app#189', kind: 'depends-on', blocked_by: true },
    ]);
  });

  it('parses a real-shaped multi-line body with several patterns present', () => {
    const edges = parseDependencyEdges({
      ref: 'acme/app#241',
      body: [
        'Summary: rollout of the new intake path.',
        '',
        'Gated on #217 landing first.',
        'Also Blocked by #226 — do not start early.',
      ].join('\n'),
    });
    expect(edges).toEqual([
      { source: 'acme/app#241', target: 'acme/app#217', kind: 'gated-on', blocked_by: true },
      { source: 'acme/app#241', target: 'acme/app#226', kind: 'blocked-by', blocked_by: true },
    ]);
  });

  it('yields no edges for unrecognized prose', () => {
    expect(
      parseDependencyEdges({ ref: 'acme/app#233', body: 'This issue is a Blocker for #226 (reverse direction).' }),
    ).toEqual([]);
  });

  it('yields no edges for cross-repo references', () => {
    expect(
      parseDependencyEdges({ ref: 'acme/app#234', body: 'Related work tracked at owner/other#5 (cross-repo).' }),
    ).toEqual([]);
  });

  it('yields no edges for a plain task-list mention of an issue number', () => {
    expect(
      parseDependencyEdges({
        ref: 'acme/app#228',
        body: 'Umbrella phase task list:\n- [ ] #217 wave A\n- [ ] #218 wave B\n',
      }),
    ).toEqual([]);
  });

  it('yields no edges for a body with no dependency prose at all', () => {
    expect(parseDependencyEdges({ ref: 'acme/app#299', body: 'Just a normal feature description.' })).toEqual([]);
  });
});
