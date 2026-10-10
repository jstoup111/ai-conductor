// Covers: task:2, task:1, task:9, task:10, task:11, task:13, task:15
import { describe, expect, it, vi } from 'vitest';

import {
  COVERAGE_BINDING_COMPLETION_STATUSES,
  COVERAGE_BINDING_ENVELOPE_STATUSES,
  coverageBindingEnvelopePath,
  parseCoverageBindingEnvelope,
  projectChildOwnership,
  readCoverageBindingEnvelope,
  writeCoverageBindingEnvelope,
  type CoverageBindingEnvelope,
  type CoverageBindingEnvelopeFilesystem,
} from '../../src/engine/coverage-binding-envelope.js';

function memoryFilesystem(files: Record<string, string> = {}): CoverageBindingEnvelopeFilesystem & { readonly files: Record<string, string>; readonly renameCalls: Array<[string, string]> } {
  const renameCalls: Array<[string, string]> = [];
  return {
    files,
    renameCalls,
    readFile: vi.fn(async (path: string) => {
      if (!(path in files)) throw new Error('missing');
      return files[path]!;
    }),
    mkdir: vi.fn(async () => undefined),
    writeFile: vi.fn(async (path: string, contents: string) => { files[path] = contents; }),
    rename: vi.fn(async (from: string, to: string) => {
      renameCalls.push([from, to]);
      files[to] = files[from]!;
      delete files[from];
    }),
  };
}

describe('coverage binding envelope', () => {
  it('round-trips closed conflict entries and preserves legacy envelopes', () => {
    const envelope = {
      version: 1,
      slug: 'feature',
      runId: 'run-1',
      status: 'done',
      entries: [
        ...(['consistent', 'not-applicable', 'unjudged'] as const).map((verdict) => ({
          kind: 'conflict' as const,
          digest: `sha256:${verdict}`,
          claimKind: 'criterion' as const,
          claimId: `stories#${verdict}`,
          verdict,
        })),
        {
          kind: 'conflict' as const,
          digest: 'sha256:conflicts',
          claimKind: 'adr-decision' as const,
          claimId: 'adr-boundary#D22',
          verdict: 'conflicts' as const,
          taskIds: ['8'],
          conflict: 'Task 8 requires an endpoint assertion the decision forbids.',
        },
      ],
    } as const;

    expect([
      parseCoverageBindingEnvelope(envelope),
      parseCoverageBindingEnvelope({ version: 1, slug: 'legacy', runId: 'legacy-run', status: 'done', entries: [] }),
      parseCoverageBindingEnvelope({
        ...envelope,
        entries: [{ ...envelope.entries[0], conflict: 'Unexpected field.' }],
      }),
    ]).toEqual([
      envelope,
      { version: 1, slug: 'legacy', runId: 'legacy-run', status: 'done', entries: [] },
      null,
    ]);
    expect(COVERAGE_BINDING_COMPLETION_STATUSES).toEqual(['disabled', 'done']);
  });

  it('round-trips every envelope status while keeping invalidated outside the completion set', () => {
    const entries = [
      { kind: 'criterion' as const, digest: 'sha256:one', criterion: 'Given one', taskIds: ['1'], doneWhen: [['One is asserted.']], verdict: 'asserts' as const },
      { kind: 'criterion' as const, digest: 'sha256:two', criterion: 'Given two', taskIds: ['2'], doneWhen: [['Two is asserted.']], verdict: 'not-applicable' as const },
    ];
    const envelope = { version: 1, slug: 'feature', runId: 'run-1', entries } as const;

    expect([
      ['disabled', 'done', 'failed', 'invalidated', 'partial', 'refused'].map((status) =>
        parseCoverageBindingEnvelope({ ...envelope, status }),
      ),
      COVERAGE_BINDING_ENVELOPE_STATUSES,
      COVERAGE_BINDING_COMPLETION_STATUSES,
    ]).toEqual([
      ['disabled', 'done', 'failed', 'invalidated', 'partial', 'refused'].map((status) => ({ ...envelope, status })),
      expect.arrayContaining(['invalidated', 'partial']),
      ['disabled', 'done'],
    ]);
  });

  it('round-trips optional slice membership while accepting legacy envelopes without it', () => {
    const envelope = {
      version: 1,
      slug: 'feature',
      runId: 'run-1',
      status: 'done',
      entries: [],
      sliceMembership: {
        taskSlices: { '1': 1, '2': 1, '3': 2 },
        titles: ['Foundation', 'Publication'],
      },
    } as const;

    expect([
      parseCoverageBindingEnvelope(envelope),
      parseCoverageBindingEnvelope({
        version: 1, slug: 'legacy-feature', runId: 'legacy-run', status: 'done', entries: [],
      }),
      parseCoverageBindingEnvelope({
        ...envelope,
        sliceMembership: { taskSlices: { '1': 0 }, titles: ['Foundation'] },
      }),
      parseCoverageBindingEnvelope({
        ...envelope,
        sliceMembership: { taskSlices: { '1': 1 }, titles: ['Foundation'], extra: true },
      }),
    ]).toEqual([
      envelope,
      { version: 1, slug: 'legacy-feature', runId: 'legacy-run', status: 'done', entries: [] },
      null,
      null,
    ]);
  });

  it('round-trips optional story ownership without making it completion evidence', () => {
    const envelope = {
      version: 1,
      slug: 'feature',
      runId: 'run-1',
      status: 'done',
      entries: [],
      storyOwnership: { '1': 1, 'FR-2': 2 },
    } as const;
    const invalidated = { ...envelope, status: 'invalidated' as const };

    expect([
      parseCoverageBindingEnvelope(envelope),
      parseCoverageBindingEnvelope(invalidated),
      parseCoverageBindingEnvelope({ ...envelope, storyOwnership: { '1': 1.5 } }),
      parseCoverageBindingEnvelope({ ...envelope, storyOwnership: { '1': 0 } }),
      COVERAGE_BINDING_COMPLETION_STATUSES.includes(envelope.status),
      COVERAGE_BINDING_COMPLETION_STATUSES.includes(
        parseCoverageBindingEnvelope({
          version: 1, slug: 'legacy-feature', runId: 'legacy-run', status: 'done', entries: [],
        })!.status,
      ),
    ]).toEqual([
      envelope,
      invalidated,
      null,
      null,
      true,
      true,
    ]);
  });

  it('projects a child\'s recorded tasks and stories without mutating the feature baseline', () => {
    const envelope = {
      version: 1,
      slug: 'feature',
      runId: 'run-1',
      status: 'done',
      entries: [],
      sliceMembership: {
        taskSlices: { '1': 1, '2': 1, '3': 2 },
        titles: ['Foundation', 'Delivery'],
      },
      storyOwnership: { 'FR-1': 1, 'FR-2': 2 },
    } as const;
    const baseline = JSON.stringify({
      sliceMembership: envelope.sliceMembership,
      storyOwnership: envelope.storyOwnership,
    });

    expect(projectChildOwnership(envelope, 1)).toEqual({ taskIds: ['1', '2'], storyIds: ['FR-1'] });
    expect(JSON.stringify({
      sliceMembership: envelope.sliceMembership,
      storyOwnership: envelope.storyOwnership,
    })).toBe(baseline);
  });

  it('round-trips amendment verdict entries and defaults legacy entries to criterion', () => {
    const envelope = {
      version: 1,
      slug: 'feature',
      runId: 'run-1',
      status: 'done',
      entries: [
        ...(['carried', 'not-carried', 'no-plan-obligation', 'unjudged'] as const).map((verdict) => ({
          kind: 'amendment' as const,
          digest: `sha256:${verdict}`,
          artifactPath: '.docs/decisions/adr.md',
          amendment: 'The amended decision changes the execution boundary.',
          taskIds: ['1'],
          doneWhen: [['The execution boundary is implemented.']],
          verdict,
          ...(verdict === 'not-carried' ? { missingObligation: 'The plan omits the amended obligation.' } : {}),
        })),
        {
          digest: 'sha256:legacy',
          criterion: 'Given legacy evidence',
          taskIds: ['2'],
          doneWhen: [['The legacy criterion remains supported.']],
          verdict: 'asserts' as const,
        },
      ],
    } as const;

    expect(parseCoverageBindingEnvelope(envelope)).toEqual({
      ...envelope,
      entries: [...envelope.entries.slice(0, -1), { ...envelope.entries.at(-1)!, kind: 'criterion' }],
    });
  });

  it.each([
    ['omits missingObligation for not-carried', 'not-carried', undefined],
    ['uses an empty missingObligation for not-carried', 'not-carried', ''],
    ['adds missingObligation to carried', 'carried', 'Unexpected diagnostic.'],
  ] as const)('rejects an amendment entry that %s', (_name, verdict, missingObligation) => {
    const entry = {
      kind: 'amendment', digest: 'sha256:amendment', artifactPath: '.docs/decisions/adr.md',
      amendment: 'The amended decision changes the execution boundary.', taskIds: ['1'],
      doneWhen: [['The execution boundary is implemented.']], verdict,
      ...(missingObligation === undefined ? {} : { missingObligation }),
    };
    expect(parseCoverageBindingEnvelope({ version: 1, slug: 'feature', runId: 'run-1', status: 'done', entries: [entry] })).toBeNull();
  });

  it('atomically writes and reads engine-stamped entries while missing, malformed, or structurally invalid files are ignored', async () => {
    const root = '/feature';
    const fs = memoryFilesystem();
    const entry = { kind: 'criterion' as const, digest: 'sha256:claim', criterion: 'Given a criterion', taskIds: ['11'], doneWhen: [['The requirement is asserted.']], verdict: 'asserts' as const };
    await writeCoverageBindingEnvelope(root, { version: 1, slug: 'feature', runId: 'run-1', status: 'done', entries: [entry] }, fs);
    const path = coverageBindingEnvelopePath(root);
    expect({
      envelope: await readCoverageBindingEnvelope(root, fs),
      renameCalls: fs.renameCalls,
      files: Object.keys(fs.files),
      missing: await readCoverageBindingEnvelope('/missing', fs),
    }).toEqual({
      envelope: { version: 1, slug: 'feature', runId: 'run-1', status: 'done', entries: [entry] },
      renameCalls: [[`${path}.tmp`, path]],
      files: [path],
      missing: null,
    });
    fs.files[path] = '{malformed';
    await expect(readCoverageBindingEnvelope(root, fs)).resolves.toBeNull();
    fs.files[path] = JSON.stringify({
      version: 1, slug: 'feature', runId: 'run-1', status: 'foreign', entries: [entry],
    });
    await expect(readCoverageBindingEnvelope(root, fs)).resolves.toBeNull();
  });

  it('keeps the previous envelope parseable when rename is interrupted', async () => {
    const root = '/feature';
    const path = coverageBindingEnvelopePath(root);
    const previous = { version: 1, slug: 'feature', runId: 'run-1', status: 'partial', entries: [] } as const;
    const fs = memoryFilesystem({ [path]: JSON.stringify(previous) });
    fs.rename = vi.fn(async () => { throw new Error('interrupted rename'); });

    await expect(writeCoverageBindingEnvelope(root, {
      version: 1, slug: 'feature', runId: 'run-2', status: 'done', entries: [],
    }, fs)).rejects.toThrow('interrupted rename');
    await expect(readCoverageBindingEnvelope(root, fs)).resolves.toEqual(previous);
  });

  it('refuses to write a structurally invalid envelope', async () => {
    const fs = memoryFilesystem();
    const invalidEnvelope = {
      version: 1,
      slug: 'feature',
      runId: 'run-1',
      status: 'done',
      entries: [{
        digest: 'sha256:claim',
        criterion: 'Given a criterion',
        taskIds: ['11'],
        doneWhen: [['The requirement is asserted.']],
        verdict: 'asserts',
        missingAssertion: 'asserts entries must not carry this field',
      }],
    };

    await expect(writeCoverageBindingEnvelope('/feature', invalidEnvelope as CoverageBindingEnvelope, fs))
      .rejects.toThrow('coverage-binding envelope: invalid envelope');
    expect(fs.writeFile).not.toHaveBeenCalled();
  });
});
