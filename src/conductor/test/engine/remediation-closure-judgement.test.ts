// Covers: task:3, task:4, task:5
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeGitRunner } from '../../src/engine/rebase.js';
import {
  buildRemediationClosureInput,
  REMEDIATION_CLOSURE_JUDGEMENT_SCHEMA,
  REMEDIATION_CLOSURE_DIFF_CAP_BYTES,
  remediationCloseIdentity,
  selectRemediationClosureCandidates,
  validateRemediationClosureOutput,
} from '../../src/engine/remediation-closure-judgement.js';

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function repository(): Promise<{ root: string; git: ReturnType<typeof makeGitRunner> }> {
  const root = await mkdtemp(join(tmpdir(), 'remediation-closure-judgement-'));
  roots.push(root);
  const git = makeGitRunner(root);
  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'fixture@example.test']);
  await git(['config', 'user.name', 'Fixture']);
  await writeFile(join(root, '.gitignore'), '.pipeline/\n');
  await git(['add', '.gitignore']);
  await git(['commit', '-q', '-m', 'chore: initial fixture']);
  return { root, git };
}

async function commit(
  fixture: { root: string; git: ReturnType<typeof makeGitRunner> },
  path: string,
  content: string,
  message: string,
): Promise<string> {
  const destination = join(fixture.root, path);
  await mkdir(join(destination, '..'), { recursive: true });
  await writeFile(destination, content, 'utf8');
  await fixture.git(['add', path]);
  await fixture.git(['commit', '-q', '-m', message]);
  return (await fixture.git(['rev-parse', 'HEAD'])).stdout.trim();
}

const candidateIds = ['rem-as-built-R5', 'rem-as-built-R11'];
const verdicts = [
  { taskId: 'rem-as-built-R5', verdict: 'resolved', rationale: 'The named repair is present.' },
  { taskId: 'rem-as-built-R11', verdict: 'partial', rationale: 'Only part of the named repair is present.' },
] as const;

describe('remediation closure judgement input', () => {
  it('carries the plan block, record sources, cited evidence and Task trailer commits', async () => {
    const fixture = await repository();
    const evidenceSha = await commit(fixture, 'evidence.txt', 'reported repair\n', 'feat: reported repair');
    const trailerSha = await commit(fixture, 'trailer.txt', 'trailer repair\n', 'feat: task repair\n\nTask: rem-as-built-R5');
    const candidate = {
      taskId: 'rem-as-built-R5',
      title: 'Repair stale close',
      closeIdentity: 'close-1',
      closeRecords: [
        { check: 'Named repair is committed.', evidence: `reported ${evidenceSha}`, source: 'reported' },
        { check: 'Targeted tests passed.', evidence: 'tests pass', source: 'verified' },
      ],
    } as const;
    const plan = new Map([['rem-as-built-R5', [
      '**Rationale:** Close was reported without its named repair.',
      '**Criterion:** R5',
      '**Governing clause:** adr-example decision 3',
      '### Done when',
      '- [ ] Named repair is committed.',
    ].join('\n')]]);

    const input = await buildRemediationClosureInput(fixture.root, [candidate], plan);

    expect(input.instruction).toContain('unverified');
    expect(input.instruction).toContain('not by itself grounds for persists or partial');
    expect(input.candidates).toHaveLength(1);
    expect(input.candidates[0]).toMatchObject({
      taskId: candidate.taskId,
      closeIdentity: candidate.closeIdentity,
      planBlock: { title: candidate.title, body: plan.get(candidate.taskId) },
      closeRecords: [
        { check: 'Named repair is committed.', source: 'reported' },
        { check: 'Targeted tests passed.', source: 'verified' },
      ],
      citedCommits: [
        { sha: evidenceSha, source: 'evidence' },
        { sha: trailerSha, source: 'task-trailer-context' },
      ],
      truncated: false,
    });
    expect(input.candidates[0]?.diff).toContain('reported repair');
    expect(input.candidates[0]?.diff).toContain('trailer repair');
  });

  it('omits an unresolvable SHA-shaped evidence token without failing the input', async () => {
    const fixture = await repository();
    const input = await buildRemediationClosureInput(fixture.root, [{
      taskId: 'rem-as-built-R5', closeIdentity: 'close-1',
      closeRecords: [{ check: 'Named repair is committed.', evidence: 'reported deadbee', source: 'reported' }],
    }], new Map([['rem-as-built-R5', 'Plan block']]));

    expect(input.candidates[0]).toMatchObject({ citedCommits: [], diff: '', truncated: false });
  });

  it('caps each candidate combined cited diff at 48,000 bytes', async () => {
    const fixture = await repository();
    const sha = await commit(fixture, 'large.txt', `${'x'.repeat(REMEDIATION_CLOSURE_DIFF_CAP_BYTES + 500)}\n`, 'feat: large repair');
    const input = await buildRemediationClosureInput(fixture.root, [{
      taskId: 'rem-as-built-R5', closeIdentity: 'close-1',
      closeRecords: [{ check: 'Named repair is committed.', evidence: sha, source: 'reported' }],
    }], new Map([['rem-as-built-R5', 'Plan block']]));

    expect(Buffer.byteLength(input.candidates[0]!.diff, 'utf8')).toBe(REMEDIATION_CLOSURE_DIFF_CAP_BYTES);
    expect(input.candidates[0]?.truncated).toBe(true);
  });
});

describe('remediation closure judgement contract', () => {
  it('returns exactly one unchanged verdict for every candidate', () => {
    expect(validateRemediationClosureOutput({ verdicts }, candidateIds)).toEqual({ kind: 'valid', verdicts });
  });

  it.each([
    ['missing candidate id', { verdicts: [verdicts[0]] }],
    ['extra non-candidate task id', { verdicts: [...verdicts, { taskId: 'rem-as-built-R404', verdict: 'persists', rationale: 'Unexpected task.' }] }],
    ['additional verdict key', { verdicts: [{ ...verdicts[0], unexpected: true }, verdicts[1]] }],
    ['unknown verdict', { verdicts: [{ ...verdicts[0], verdict: 'unknown' }, verdicts[1]] }],
    ['empty rationale', { verdicts: [{ ...verdicts[0], rationale: '' }, verdicts[1]] }],
  ])('rejects a result with %s', (_name, output) => {
    expect(validateRemediationClosureOutput(output, candidateIds)).toMatchObject({ kind: 'invalid' });
  });

  it('exports a closed entry schema matching the verdict contract', () => {
    const entries = REMEDIATION_CLOSURE_JUDGEMENT_SCHEMA.properties.verdicts as {
      items: { additionalProperties: boolean; required: readonly string[]; properties: Record<string, unknown> };
    };
    expect(entries.items).toMatchObject({
      additionalProperties: false,
      required: ['taskId', 'verdict', 'rationale'],
      properties: {
        verdict: { enum: ['resolved', 'persists', 'partial'] },
        rationale: { minLength: 1 },
      },
    });
  });
});

describe('remediation closure candidates', () => {
  const closeRecords = [
    { check: 'The named repair is committed.', evidence: 'abc123', source: 'reported' },
    { check: 'Targeted tests pass.', evidence: 'test:repair.test.ts::passes', source: 'verified' },
  ] as const;

  it('keys a close by task, reopen count, and ordered check evidence only', () => {
    const identity = remediationCloseIdentity('rem-as-built-R5', 0, closeRecords);

    expect(remediationCloseIdentity('rem-as-built-R5', 0, [
      { ...closeRecords[0], source: 'unverified' },
      { ...closeRecords[1], source: 'operator-accepted' },
    ])).toBe(identity);
    expect(remediationCloseIdentity('rem-as-built-R5', 1, closeRecords)).not.toBe(identity);
    expect(remediationCloseIdentity('rem-as-built-R5', 0, [
      { ...closeRecords[0], check: 'A different check.' },
      closeRecords[1],
    ])).not.toBe(identity);
    expect(remediationCloseIdentity('rem-as-built-R5', 0, [
      { ...closeRecords[0], evidence: 'different evidence' },
      closeRecords[1],
    ])).not.toBe(identity);
  });

  it('selects only resolved, in-scope engine remediation closes without pending or citation work', () => {
    const status = {
      tasks: [
        { id: 'rem-as-built-R5', title: 'eligible', status: 'completed', commit: 'old-sha', startHead: 'old-head', doneWhen: closeRecords },
        { id: 'rem-as-built-R6', status: 'completed', doneWhen: closeRecords },
        { id: 'rem-as-built-R7', status: 'completed', doneWhen: [{ ...closeRecords[0], source: 'pending-judgement' }] },
        { id: 'rem-as-built-R8', status: 'completed', doneWhen: closeRecords },
        { id: 'rem-as-built-R9', status: 'pending', doneWhen: closeRecords },
        { id: 'ordinary-10', status: 'completed', doneWhen: closeRecords },
      ],
    };

    const selected = selectRemediationClosureCandidates({
      status,
      scopeTaskIds: ['rem-as-built-R5', 'rem-as-built-R7', 'rem-as-built-R8', 'rem-as-built-R9', 'ordinary-10'],
      resolvedIds: new Set(['rem-as-built-R5', 'rem-as-built-R6', 'rem-as-built-R7', 'rem-as-built-R8', 'ordinary-10']),
      state: {},
      openCitationTaskIds: new Set(['rem-as-built-R8']),
    });

    expect(selected).toEqual([expect.objectContaining({ taskId: 'rem-as-built-R5', title: 'eligible' })]);
  });

  it.each(['resolved', 'persists', 'partial', 'unjudged'] as const)(
    'excludes a close already carrying a %s verdict',
    (verdict) => {
      const identity = remediationCloseIdentity('rem-as-built-R5', 0, closeRecords);
      expect(selectRemediationClosureCandidates({
        status: { tasks: [{ id: 'rem-as-built-R5', status: 'completed', doneWhen: closeRecords }] },
        scopeTaskIds: ['rem-as-built-R5'],
        resolvedIds: new Set(['rem-as-built-R5']),
        state: { 'rem-as-built-R5': { reopenCount: 0, verdicts: { [identity]: { verdict } } } },
        openCitationTaskIds: new Set(),
      })).toEqual([]);
    },
  );

  it('requires fresh Done-when records and gives a reclosed task a new identity after reopening', () => {
    const status = { tasks: [{
      id: 'rem-as-built-R5', status: 'completed', restored_from: 'task-trailer', doneWhen: [],
    }] };
    const input = {
      status,
      scopeTaskIds: ['rem-as-built-R5'],
      resolvedIds: new Set(['rem-as-built-R5']),
      state: { 'rem-as-built-R5': { reopenCount: 0, verdicts: {} } },
      openCitationTaskIds: new Set<string>(),
    };

    expect(selectRemediationClosureCandidates(input)).toEqual([]);
    status.tasks[0].doneWhen = [...closeRecords];
    const first = selectRemediationClosureCandidates(input);
    const reclosed = selectRemediationClosureCandidates({
      ...input,
      state: { 'rem-as-built-R5': { reopenCount: 1, verdicts: { [first[0]!.closeIdentity]: { verdict: 'persists' } } } },
    });
    expect(reclosed).toHaveLength(1);
    expect(reclosed[0]!.closeIdentity).not.toBe(first[0]!.closeIdentity);
  });
});
