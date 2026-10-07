// Covers: task:2, task:1, task:9, task:10, task:11
import { describe, expect, it, vi } from 'vitest';

import {
  claimDigest,
  amendmentClaimDigest,
  conflictClaimDigest,
  COVERAGE_BINDING_COMPLETION_STATUSES,
  COVERAGE_BINDING_ENVELOPE_STATUSES,
  coverageBindingEnvelopePath,
  parseCoverageBindingEnvelope,
  parseAmendmentBatchPayload,
  parseConflictBatchPayload,
  parseJudgeBatchPayload,
  parseJudgePayload,
  issueJudgeClaimIds,
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

  it('hashes conflict identity from claim text and the canonical full task table', () => {
    const claim = {
      text: 'A sealed criterion permits credential-only assertions.',
      taskTable: [
        { id: '3', title: 'Add credential checks', doneWhen: [['The credential assertion is present.']] },
        { id: '8', title: 'Add endpoint checks', doneWhen: [['The endpoint assertion is present.']] },
      ],
    };
    const unchanged = conflictClaimDigest(claim);

    expect([
      unchanged,
      conflictClaimDigest(claim),
      conflictClaimDigest({ ...claim, taskTable: [{ ...claim.taskTable[0], title: 'Rename credential checks' }, claim.taskTable[1]] }),
      conflictClaimDigest({ ...claim, taskTable: [claim.taskTable[0], { ...claim.taskTable[1], doneWhen: [['A changed endpoint check is present.']] }] }),
    ]).toEqual([
      unchanged,
      unchanged,
      expect.not.stringMatching(new RegExp(`^${unchanged.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)),
      expect.not.stringMatching(new RegExp(`^${unchanged.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)),
    ]);
  });

  it('hashes amendment identity from its path, exact text, and plan obligations', () => {
    const unchanged = amendmentClaimDigest({
      artifactPath: '.docs/decisions/adr-feature.md',
      amendment: '> **Amended 2026-09-24 by #100:** Preserve the audit trail.',
      doneWhen: [['The audit trail is preserved.']],
    });

    expect([
      unchanged,
      amendmentClaimDigest({
        artifactPath: '.docs/decisions/adr-feature.md',
        amendment: '> **Amended 2026-09-24 by #100:** Preserve the audit trail.',
        doneWhen: [['The audit trail is preserved.']],
      }),
      amendmentClaimDigest({
        artifactPath: '.docs/decisions/adr-feature.md',
        amendment: '> **Amended 2026-09-24 by #100:** Preserve a different audit trail.',
        doneWhen: [['The audit trail is preserved.']],
      }),
      amendmentClaimDigest({
        artifactPath: '.docs/decisions/adr-feature.md',
        amendment: '> **Amended 2026-09-24 by #100:** Preserve the audit trail.',
        doneWhen: [['The audit trail is retained.']],
      }),
    ]).toEqual([
      unchanged,
      unchanged,
      expect.not.stringMatching(new RegExp(`^${unchanged.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)),
      expect.not.stringMatching(new RegExp(`^${unchanged.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)),
    ]);
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

  it('accepts only the closed judge verdict payloads', () => {
    expect([
      parseJudgePayload('{"verdict":"asserts"}'),
      parseJudgePayload('{"verdict":"does-not-assert","missingAssertion":"the check never requires emission"}'),
      parseJudgePayload('{"verdict":"partial"}'),
      parseJudgePayload('{"verdict":"does-not-assert"}'),
      parseJudgePayload('not json'),
    ]).toEqual([
      { ok: true, value: { verdict: 'asserts' } },
      { ok: true, value: { verdict: 'does-not-assert', missingAssertion: 'the check never requires emission' } },
      { ok: false, reason: expect.stringContaining('verdict') },
      { ok: false, reason: expect.stringContaining('missingAssertion') },
      { ok: false, reason: expect.stringContaining('JSON') },
    ]);
  });

  it('issues short opaque per-batch claim ids in place of digests', () => {
    const digests = [`sha256:${'a'.repeat(64)}`, `sha256:${'b'.repeat(64)}`];

    expect([...issueJudgeClaimIds(digests, 'criterion')]).toEqual([['c1', digests[0]], ['c2', digests[1]]]);
    expect([...issueJudgeClaimIds(digests, 'amendment')]).toEqual([['a1', digests[0]], ['a2', digests[1]]]);
  });

  it('resolves a batch answered with issued claim ids to the issued digests', () => {
    const first = `sha256:${'1'.repeat(64)}`;
    const second = `sha256:${'2'.repeat(64)}`;
    const parsed = parseJudgeBatchPayload(JSON.stringify({
      verdicts: [
        { id: 'c1', verdict: 'asserts' },
        { id: 'c2', verdict: 'does-not-assert', missingAssertion: 'The Done when checks omit the required emission.' },
      ],
    }), issueJudgeClaimIds([first, second], 'criterion'));

    expect(parsed).toEqual({
      ok: true,
      verdicts: new Map([
        [first, { verdict: 'asserts' }],
        [second, { verdict: 'does-not-assert', missingAssertion: 'The Done when checks omit the required emission.' }],
      ]),
    });
  });

  it('resolves an amendment batch answered with issued claim ids to the issued digests', () => {
    const digests = ['sha256:carried', 'sha256:not-carried', 'sha256:no-obligation'];
    expect(parseAmendmentBatchPayload(JSON.stringify({
      verdicts: [
        { id: 'a1', verdict: 'carried', taskIds: ['1'], contradictsCompleted: ['2'] },
        { id: 'a2', verdict: 'not-carried', missingObligation: 'The task omits the amendment obligation.' },
        { id: 'a3', verdict: 'no-plan-obligation' },
      ],
    }), issueJudgeClaimIds(digests, 'amendment'), ['1', '2'], ['2'])).toEqual({
      ok: true,
      verdicts: new Map([
        ['sha256:carried', { verdict: 'carried', taskIds: ['1'], contradictsCompleted: ['2'] }],
        ['sha256:not-carried', { verdict: 'not-carried', missingObligation: 'The task omits the amendment obligation.' }],
        ['sha256:no-obligation', { verdict: 'no-plan-obligation' }],
      ]),
    });
  });

  it('resolves a closed conflict batch to issued digests and canonical plan task ids', () => {
    const planText = [
      '# Implementation Plan: conflict parser',
      '',
      '### Task 1: First task',
      '',
      '### Task 2: Second task',
    ].join('\n');

    expect(parseConflictBatchPayload(JSON.stringify({
      verdicts: [
        { id: 'x1', verdict: 'consistent' },
        { id: 'x2', verdict: 'conflicts', taskIds: ['task-2'], conflict: 'Task 2 contradicts the sealed criterion.' },
      ],
    }), new Map([['x1', 'sha256:first'], ['x2', 'sha256:second']]), planText)).toEqual({
      ok: true,
      verdicts: new Map([
        ['sha256:first', { verdict: 'consistent' }],
        ['sha256:second', { verdict: 'conflicts', taskIds: ['2'], conflict: 'Task 2 contradicts the sealed criterion.' }],
      ]),
    });
  });

  it.each([
    ['an unknown task id', { id: 'x1', verdict: 'conflicts', taskIds: ['99'], conflict: 'Unknown task.' }, 'taskIds'],
    ['an empty task id list', { id: 'x1', verdict: 'conflicts', taskIds: [], conflict: 'Missing task.' }, 'taskIds'],
    ['an empty conflict statement', { id: 'x1', verdict: 'conflicts', taskIds: ['1'], conflict: '' }, 'conflict'],
    ['a missing issued id', { id: 'x1', verdict: 'consistent' }, 'is missing issued claim id x2'],
    ['a foreign id', { id: 'x3', verdict: 'consistent' }, 'has unknown claim id x3'],
    ['a duplicated id', { id: 'x1', verdict: 'consistent' }, 'repeats claim id x1'],
    ['an out-of-vocabulary verdict', { id: 'x1', verdict: 'unjudged' }, 'verdict'],
  ] as const)('rejects a conflict batch with %s', (_kind, entry, reason) => {
    const verdicts = reason.includes('missing')
      ? [entry]
      : reason.includes('repeats')
        ? [entry, entry]
        : [entry, { id: 'x2', verdict: 'consistent' }];

    expect(parseConflictBatchPayload(JSON.stringify({ verdicts }), new Map([
      ['x1', 'sha256:first'], ['x2', 'sha256:second'],
    ]), '### Task 1: First task\n\n### Task 2: Second task')).toEqual({
      ok: false,
      reason: expect.stringContaining(reason),
    });
  });

  it.each([
    ['a carried foreign task id', { id: 'a1', verdict: 'carried', taskIds: ['foreign'] }, 'foreign'],
    ['an empty carried task list', { id: 'a1', verdict: 'carried', taskIds: [] }, 'taskIds'],
    ['an empty missing obligation', { id: 'a1', verdict: 'not-carried', missingObligation: '' }, 'missingObligation'],
    ['a foreign completed contradiction', { id: 'a1', verdict: 'no-plan-obligation', contradictsCompleted: ['foreign'] }, 'foreign'],
  ])('rejects an amendment batch with %s', (_kind, verdict, reason) => {
    expect(parseAmendmentBatchPayload(JSON.stringify({ verdicts: [verdict] }), issueJudgeClaimIds(['sha256:first'], 'amendment'), ['1'], ['2'])).toEqual({
      ok: false,
      reason: expect.stringContaining(reason),
    });
  });

  it.each([
    ['missing', { verdicts: [{ id: 'c1', verdict: 'asserts' }] }, 'is missing issued claim id c2'],
    ['unknown', { verdicts: [{ id: 'c1', verdict: 'asserts' }, { id: 'c3', verdict: 'asserts' }] }, 'has unknown claim id c3'],
    ['repeated', { verdicts: [{ id: 'c1', verdict: 'asserts' }, { id: 'c1', verdict: 'asserts' }] }, 'repeats claim id c1'],
    ['digest-echoing', { verdicts: [{ id: 'sha256:first', verdict: 'asserts' }, { id: 'c2', verdict: 'asserts' }] }, 'has unknown claim id sha256:first'],
  ])('fails a %s claim id closed, naming the id', (_kind, payload, reason) => {
    expect(parseJudgeBatchPayload(JSON.stringify(payload), issueJudgeClaimIds(['sha256:first', 'sha256:second'], 'criterion'))).toEqual({
      ok: false,
      reason: expect.stringContaining(reason),
    });
  });

  it.each([
    ['missing', { verdicts: [{ id: 'a1', verdict: 'no-plan-obligation' }] }, 'is missing issued claim id a2'],
    ['unknown', { verdicts: [{ id: 'a1', verdict: 'no-plan-obligation' }, { id: 'c2', verdict: 'no-plan-obligation' }] }, 'has unknown claim id c2'],
    ['repeated', { verdicts: [{ id: 'a1', verdict: 'no-plan-obligation' }, { id: 'a1', verdict: 'no-plan-obligation' }] }, 'repeats claim id a1'],
  ])('fails a %s amendment claim id closed, naming the id', (_kind, payload, reason) => {
    expect(parseAmendmentBatchPayload(JSON.stringify(payload), issueJudgeClaimIds(['sha256:first', 'sha256:second'], 'amendment'), ['1'], [])).toEqual({
      ok: false,
      reason: expect.stringContaining(reason),
    });
  });

  it('ignores a surplus unissued id once every issued id is answered, reporting it as ignored', () => {
    const surplus = (verdict: Record<string, unknown>, ids: readonly string[]) => JSON.stringify({
      verdicts: [...ids.map((id) => ({ id, ...verdict })), { id: 'c9', verdict: 'not-a-verdict' }],
    });

    expect(parseConflictBatchPayload(surplus({ verdict: 'consistent' }, ['c1', 'c2']), issueJudgeClaimIds(['sha256:first', 'sha256:second'], 'criterion'), '### Task 1: First task'))
      .toEqual({ ok: true, ignoredIds: ['c9'], verdicts: new Map([['sha256:first', { verdict: 'consistent' }], ['sha256:second', { verdict: 'consistent' }]]) });
    expect(parseJudgeBatchPayload(surplus({ verdict: 'asserts' }, ['c1']), issueJudgeClaimIds(['sha256:first'], 'criterion')))
      .toEqual({ ok: true, ignoredIds: ['c9'], verdicts: new Map([['sha256:first', { verdict: 'asserts' }]]) });
    expect(parseAmendmentBatchPayload(surplus({ verdict: 'no-plan-obligation' }, ['a1']), issueJudgeClaimIds(['sha256:first'], 'amendment'), ['1'], []))
      .toEqual({ ok: true, ignoredIds: ['c9'], verdicts: new Map([['sha256:first', { verdict: 'no-plan-obligation' }]]) });
  });

  it('accepts agreeing verdicts for two claim ids sharing one digest and fails conflicting ones closed', () => {
    const issued = issueJudgeClaimIds(['sha256:shared', 'sha256:shared'], 'criterion');

    expect(parseJudgeBatchPayload(JSON.stringify({ verdicts: [{ id: 'c1', verdict: 'asserts' }, { id: 'c2', verdict: 'asserts' }] }), issued))
      .toEqual({ ok: true, verdicts: new Map([['sha256:shared', { verdict: 'asserts' }]]) });
    expect(parseJudgeBatchPayload(JSON.stringify({ verdicts: [
      { id: 'c1', verdict: 'asserts' },
      { id: 'c2', verdict: 'does-not-assert', missingAssertion: 'No check requires it.' },
    ] }), issued)).toEqual({ ok: false, reason: expect.stringContaining('claim id c2 conflicts') });
  });


  it.each([
    ['unknown verdict', { verdicts: [{ id: 'c1', verdict: 'maybe' }] }, 'verdict'],
    ['missingAssertion on asserts', { verdicts: [{ id: 'c1', verdict: 'asserts', missingAssertion: 'not allowed' }] }, 'asserts'],
    ['empty missingAssertion', { verdicts: [{ id: 'c1', verdict: 'does-not-assert', missingAssertion: '' }] }, 'missingAssertion'],
    ['non-object payload', [], 'object'],
    ['missing verdicts array', {}, 'verdicts'],
    ['non-array verdicts', { verdicts: {} }, 'array'],
    ['extra top-level key', { verdicts: [{ id: 'c1', verdict: 'asserts' }], extra: true }, 'only verdicts'],
    ['extra entry key', { verdicts: [{ id: 'c1', verdict: 'asserts', extra: true }] }, 'asserts'],
  ])('rejects a batch payload with %s', (_kind, payload, reason) => {
    expect(parseJudgeBatchPayload(JSON.stringify(payload), issueJudgeClaimIds(['sha256:first'], 'criterion'))).toEqual({
      ok: false,
      reason: expect.stringContaining(reason),
    });
  });

  it('hashes normalized criterion and Done when checks', () => {
    const unchanged = claimDigest({ criterion: ' Given  a criterion ', doneWhen: [[' First\ncheck ', 'second check']] });
    expect([
      unchanged,
      claimDigest({ criterion: 'Given a criterion', doneWhen: [['First check', 'second   check']] }),
      claimDigest({ criterion: 'A different criterion', doneWhen: [['First check', 'second check']] }),
      claimDigest({ criterion: 'Given a criterion', doneWhen: [['First check', 'changed check']] }),
    ]).toEqual([
      unchanged,
      unchanged,
      expect.not.stringMatching(new RegExp(`^${unchanged.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)),
      expect.not.stringMatching(new RegExp(`^${unchanged.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`)),
    ]);
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
