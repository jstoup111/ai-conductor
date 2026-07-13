/**
 * Tests for waiver ref resolution (src/conductor/src/engine/wiring-probe.ts).
 *
 * `inert` waivers (see wired-into.ts's `WiredIntoInert`) carry a `ref` that
 * is either a repo-relative path or a `owner/repo#number` GitHub issue. This
 * covers path-form resolution only — checking on-disk existence, no network
 * involved. Issue-form resolution (via `gh`) is Task 20.
 */

import { describe, it, expect } from 'vitest';
import { resolveWaiverRef } from '../src/engine/wiring-probe.js';
import type { GhRunner } from '../src/engine/wiring-probe.js';
import type { InertRef } from '../src/engine/wired-into.js';

function fakeGh(): { gh: GhRunner; calls: string[][] } {
  const calls: string[][] = [];
  const gh: GhRunner = async (args) => {
    calls.push([...args]);
    return { stdout: '' };
  };
  return { gh, calls };
}

describe('resolveWaiverRef — path-form', () => {
  it('resolves as waived when the referenced file exists on disk', async () => {
    const { gh, calls } = fakeGh();
    const fileExists = async (path: string) => path === 'src/foo.ts';
    const ref: InertRef = { form: 'path', path: 'src/foo.ts' };

    const result = await resolveWaiverRef(ref, fileExists, gh);

    expect(result.status).toBe('waived');
    expect(result.evidence).toContain('(path exists)');
    expect(calls.length).toBe(0);
  });

  it('reports a gap when the referenced file is absent', async () => {
    const { gh, calls } = fakeGh();
    const fileExists = async (_path: string) => false;
    const ref: InertRef = { form: 'path', path: 'src/missing.ts' };

    const result = await resolveWaiverRef(ref, fileExists, gh);

    expect(result.status).toBe('gap');
    expect(result.message).toBe('inert waiver ref src/missing.ts not found');
    expect(calls.length).toBe(0);
  });

  it('never shells out to gh when resolving a path-form ref', async () => {
    const { gh, calls } = fakeGh();
    const fileExists = async (_path: string) => true;
    const ref: InertRef = { form: 'path', path: 'src/bar.ts' };

    await resolveWaiverRef(ref, fileExists, gh);

    expect(calls.length).toBe(0);
  });
});
