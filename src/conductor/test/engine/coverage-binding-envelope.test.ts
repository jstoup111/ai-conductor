// Covers: task:1, task:2, task:11
import { describe, expect, it, vi } from 'vitest';

import {
  claimDigest,
  COVERAGE_BINDING_COMPLETION_STATUSES,
  COVERAGE_BINDING_ENVELOPE_STATUSES,
  coverageBindingEnvelopePath,
  parseCoverageBindingEnvelope,
  parseJudgeBatchPayload,
  parseJudgePayload,
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
  it('round-trips every envelope status while keeping partial outside the completion set', () => {
    const entries = [
      { digest: 'sha256:one', criterion: 'Given one', taskIds: ['1'], doneWhen: [['One is asserted.']], verdict: 'asserts' as const },
      { digest: 'sha256:two', criterion: 'Given two', taskIds: ['2'], doneWhen: [['Two is asserted.']], verdict: 'not-applicable' as const },
    ];
    const envelope = { version: 1, slug: 'feature', runId: 'run-1', entries } as const;

    expect([
      ['disabled', 'done', 'failed', 'partial', 'refused'].map((status) =>
        parseCoverageBindingEnvelope({ ...envelope, status }),
      ),
      COVERAGE_BINDING_ENVELOPE_STATUSES,
      COVERAGE_BINDING_COMPLETION_STATUSES,
    ]).toEqual([
      ['disabled', 'done', 'failed', 'partial', 'refused'].map((status) => ({ ...envelope, status })),
      expect.arrayContaining(['partial']),
      ['disabled', 'done'],
    ]);
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

  it('accepts a batch only when it returns each issued digest once with engine-safe verdict data', () => {
    const parsed = parseJudgeBatchPayload(JSON.stringify({
      verdicts: [
        { digest: 'sha256:first', verdict: 'asserts' },
        { digest: 'sha256:second', verdict: 'does-not-assert', missingAssertion: 'The Done when checks omit the required emission.' },
      ],
    }), ['sha256:first', 'sha256:second']);

    expect(parsed).toEqual({
      ok: true,
      verdicts: new Map([
        ['sha256:first', { verdict: 'asserts' }],
        ['sha256:second', { verdict: 'does-not-assert', missingAssertion: 'The Done when checks omit the required emission.' }],
      ]),
    });
  });

  it.each([
    ['missing', { verdicts: [{ digest: 'sha256:first', verdict: 'asserts' }] }, ['sha256:first', 'sha256:second'], 'sha256:second'],
    ['foreign', { verdicts: [{ digest: 'sha256:first', verdict: 'asserts' }, { digest: 'sha256:foreign', verdict: 'asserts' }] }, ['sha256:first', 'sha256:second'], 'sha256:foreign'],
    ['duplicate', { verdicts: [{ digest: 'sha256:first', verdict: 'asserts' }, { digest: 'sha256:first', verdict: 'asserts' }] }, ['sha256:first'], 'sha256:first'],
  ])('rejects a %s digest-set mismatch', (_kind, payload, issuedDigests, reason) => {
    expect(parseJudgeBatchPayload(JSON.stringify(payload), issuedDigests)).toEqual({
      ok: false,
      reason: expect.stringContaining(reason),
    });
  });

  it.each([
    ['unknown verdict', { verdicts: [{ digest: 'sha256:first', verdict: 'maybe' }] }, 'verdict'],
    ['missingAssertion on asserts', { verdicts: [{ digest: 'sha256:first', verdict: 'asserts', missingAssertion: 'not allowed' }] }, 'asserts'],
    ['empty missingAssertion', { verdicts: [{ digest: 'sha256:first', verdict: 'does-not-assert', missingAssertion: '' }] }, 'missingAssertion'],
    ['non-object payload', [], 'object'],
    ['missing verdicts array', {}, 'verdicts'],
    ['non-array verdicts', { verdicts: {} }, 'array'],
    ['extra top-level key', { verdicts: [{ digest: 'sha256:first', verdict: 'asserts' }], extra: true }, 'only verdicts'],
    ['extra entry key', { verdicts: [{ digest: 'sha256:first', verdict: 'asserts', extra: true }] }, 'asserts'],
  ])('rejects a batch payload with %s', (_kind, payload, reason) => {
    expect(parseJudgeBatchPayload(JSON.stringify(payload), ['sha256:first'])).toEqual({
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
    const entry = { digest: 'sha256:claim', criterion: 'Given a criterion', taskIds: ['11'], doneWhen: [['The requirement is asserted.']], verdict: 'asserts' as const };
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
