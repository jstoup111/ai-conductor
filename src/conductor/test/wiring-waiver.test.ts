/**
 * Tests for waiver ref resolution (src/conductor/src/engine/wiring-probe.ts).
 *
 * `inert` waivers (see wired-into.ts's `WiredIntoInert`) carry a `ref` that
 * is either a repo-relative path or a `owner/repo#number` GitHub issue. This
 * covers path-form resolution only — checking on-disk existence, no network
 * involved. Issue-form resolution (via `gh`) is Task 20.
 */

import { describe, it, expect } from 'vitest';
import { checkInertContractContradiction, resolveWaiverRef } from '../src/engine/wiring-probe.js';
import type {
  FileExistsChecker,
  GhRunner,
  NewExport,
  ReferenceSearchRunner,
  TaskWiringContract,
} from '../src/engine/wiring-probe.js';
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

describe('resolveWaiverRef — issue-form', () => {
  const fileExists = async (_path: string) => false;
  const ref: InertRef = { form: 'issue', owner: 'acme', repo: 'widgets', number: 42 };

  it('resolves as waived when gh reports the issue is open', async () => {
    const calls: string[][] = [];
    const gh: GhRunner = async (args) => {
      calls.push([...args]);
      return { stdout: JSON.stringify({ state: 'OPEN' }) };
    };

    const result = await resolveWaiverRef(ref, fileExists, gh);

    expect(result.status).toBe('waived');
    expect(result.evidence).toContain('(gh: open)');
    expect(calls[0]).toContain('acme/widgets#42');
  });

  it('reports a gap naming the closed state when gh reports the issue is closed', async () => {
    const gh: GhRunner = async () => ({ stdout: JSON.stringify({ state: 'CLOSED' }) });

    const result = await resolveWaiverRef(ref, fileExists, gh);

    expect(result.status).toBe('gap');
    expect(result.message).toBe('inert waiver ref acme/widgets#42 is closed');
  });

  it('fails closed with a gap when the gh runner errors', async () => {
    const gh: GhRunner = async () => {
      throw new Error('HTTP 401: Bad credentials (gh error)\nsome extra detail');
    };

    const result = await resolveWaiverRef(ref, fileExists, gh);

    expect(result.status).toBe('gap');
    expect(result.message).toBe(
      'inert waiver ref #42 unverifiable (gh error: HTTP 401: Bad credentials (gh error))',
    );
  });
});

describe('checkInertContractContradiction — waived-but-wired', () => {
  const fileExists: FileExistsChecker = async () => true; // waiver path always resolves
  const gh: GhRunner = async () => ({ stdout: '' });

  it('reports a gap when a task waived as inert also has a production reference elsewhere', async () => {
    const tasks: TaskWiringContract[] = [
      {
        taskId: '21',
        files: ['src/foo.ts'],
        parseResult: { kind: 'inert', ref: { form: 'path', path: 'docs/plan.md' } },
      },
    ];
    const newExports: NewExport[] = [{ file: 'src/foo.ts', symbol: 'doStuff' }];
    const searchReferences: ReferenceSearchRunner = async (symbol) =>
      symbol === 'doStuff' ? ['src/foo.ts', 'src/bar.ts'] : [];

    const gaps = await checkInertContractContradiction(tasks, newExports, searchReferences, fileExists, gh);

    expect(gaps.length).toBe(1);
    expect(gaps[0]).toContain('task 21');
    expect(gaps[0]).toContain('«doStuff»');
    expect(gaps[0]).toContain('contract is stale');
    expect(gaps[0]).toContain('src/bar.ts');
  });

  it('does not report a gap when the inert task has no production reference outside its own file', async () => {
    const tasks: TaskWiringContract[] = [
      {
        taskId: '22',
        files: ['src/foo.ts'],
        parseResult: { kind: 'inert', ref: { form: 'path', path: 'docs/plan.md' } },
      },
    ];
    const newExports: NewExport[] = [{ file: 'src/foo.ts', symbol: 'doStuff' }];
    const searchReferences: ReferenceSearchRunner = async (symbol) =>
      symbol === 'doStuff' ? ['src/foo.ts', 'src/foo.test.ts'] : [];

    const gaps = await checkInertContractContradiction(tasks, newExports, searchReferences, fileExists, gh);

    expect(gaps.length).toBe(0);
  });

  it('does not double-report when the waiver itself fails to resolve', async () => {
    const missingFileExists: FileExistsChecker = async () => false;
    const tasks: TaskWiringContract[] = [
      {
        taskId: '23',
        files: ['src/foo.ts'],
        parseResult: { kind: 'inert', ref: { form: 'path', path: 'docs/missing.md' } },
      },
    ];
    const newExports: NewExport[] = [{ file: 'src/foo.ts', symbol: 'doStuff' }];
    const searchReferences: ReferenceSearchRunner = async () => ['src/foo.ts', 'src/bar.ts'];

    const gaps = await checkInertContractContradiction(
      tasks,
      newExports,
      searchReferences,
      missingFileExists,
      gh,
    );

    expect(gaps.length).toBe(0);
  });
});
