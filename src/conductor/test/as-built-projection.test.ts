// Covers: task:6, task:7, task:8
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readdir, readFile, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import * as asBuiltProjection from '../src/engine/as-built-projection.js';
import {
  AS_BUILT_PROJECTION_VERSION,
  buildAsBuiltProjection,
  renderAsBuiltProjection,
} from '../src/engine/as-built-projection.js';

const execFileAsync = promisify(execFile);
const dirs: string[] = [];

async function fixture({
  includeDiffAdr = true,
  includeDiagram = true,
}: {
  includeDiffAdr?: boolean;
  includeDiagram?: boolean;
} = {}): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'as-built-projection-'));
  dirs.push(root);
  const git = async (...args: string[]) => {
    await execFileAsync('git', ['-C', root, ...args]);
  };

  await execFileAsync('git', ['init', '-b', 'main', root]);
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'user.name', 'Test');
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await mkdir(join(root, '.docs', 'stories'), { recursive: true });
  await mkdir(join(root, '.docs', 'decisions'), { recursive: true });
  await mkdir(join(root, '.docs', 'architecture'), { recursive: true });
  await writeFile(join(root, '.docs', 'plans', 'feature.md'), `# Plan

**Stories:** .docs/stories/feature.md

## Architecture Obligation Coverage

| Decision | Disposition | Tasks | Evidence |
| --- | --- | --- | --- |
| adr-plan-one#D1 | task | task-1 | first done condition |
| adr-plan-two#D2 | task | task-2 | second done condition |

### Task 1: First

**Done when:**
- first done condition

### Task 2: Second

**Done when:**
- second done condition
`);
  await writeFile(join(root, '.docs', 'stories', 'feature.md'), `# Stories

## Story 1: Projection

### Happy Path
- Given a sealed criterion, when projected, then it remains authoritative.

### Negative Paths
- Given a missing input, when projected, then it is reported.
`);
  await writeFile(join(root, '.docs', 'decisions', 'adr-plan-one.md'), `# ADR

Status: APPROVED

## Decision

1. First plan decision.
`);
  await writeFile(join(root, '.docs', 'decisions', 'adr-plan-two.md'), `# ADR

Status: APPROVED

## Decision

2. Second plan decision.
`);
  if (includeDiagram) await writeFile(join(root, '.docs', 'architecture', 'system.md'), '# Diagram\n');
  await writeFile(join(root, 'tracked.ts'), 'export const unchanged = true;\n');
  await git('add', '.');
  await git('commit', '-m', 'base');

  await git('checkout', '-b', 'feature/projection');
  await writeFile(join(root, 'tracked.ts'), 'export const changed = true;\n');
  if (includeDiffAdr) await writeFile(join(root, '.docs', 'decisions', 'adr-diff.md'), `# ADR

Status: APPROVED

## Decision

3. Diff decision.
`);
  await git('add', '.');
  await git('commit', '-m', 'feature change');
  return root;
}

afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

async function commit(root: string, message: string): Promise<void> {
  await execFileAsync('git', ['-C', root, 'add', '.']);
  await execFileAsync('git', ['-C', root, 'commit', '-m', message]);
}

async function largestCorpusBytes(directory: string): Promise<number> {
  const names = await readdir(directory, { recursive: true });
  const sizes = await Promise.all(names
    .filter((name) => name.endsWith('.md'))
    .map(async (name) => Buffer.byteLength(await readFile(join(directory, name), 'utf-8'))));
  return Math.max(...sizes);
}

async function diffDigest(root: string, path: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', root, 'diff', 'main..HEAD', '--', path]);
  return `sha256:${createHash('sha256').update(stdout).digest('hex')}`;
}

async function quotedDiffHeaderPath(root: string, path: string): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', root, 'diff', 'main..HEAD', '--', path]);
  const encoded = stdout.match(/^diff --git "a\/((?:\\.|[^"\\])*)" "b\/((?:\\.|[^"\\])*)"$/m)?.[2];
  if (encoded === undefined) throw new Error('expected a quoted diff header');
  const bytes: number[] = [];
  for (let index = 0; index < encoded.length; index += 1) {
    if (encoded[index] !== '\\') {
      bytes.push(...Buffer.from(encoded[index]!));
      continue;
    }
    bytes.push(Number.parseInt(encoded.slice(index + 1, index + 4), 8));
    index += 3;
  }
  return Buffer.from(bytes).toString('utf-8');
}

describe('as-built projection', () => {
  it('builds a versioned, complete, deterministic projection from bounded authoritative inputs', async () => {
    const root = await fixture();

    const first = await buildAsBuiltProjection(root);
    const second = await buildAsBuiltProjection(root);

    expect(first).toMatchObject({ ok: true, projection: { version: AS_BUILT_PROJECTION_VERSION } });
    expect(second).toEqual(first);
    if (!first.ok || !second.ok) throw new Error('expected populated projections');

    expect(first.projection.diff.changedFiles).toEqual([{ path: '.docs/decisions/adr-diff.md', additions: 7, deletions: 0 }, { path: 'tracked.ts', additions: 1, deletions: 1 }]);
    expect(first.projection.diff.hunks.join('\n')).toContain('export const changed = true;');
    expect(first.projection.tasks).toEqual([
      { id: '1', doneWhen: ['first done condition'] },
      { id: '2', doneWhen: ['second done condition'] },
    ]);
    expect(first.projection.storyCriteria).toEqual([
      'Story 1 happy: Given a sealed criterion, when projected, then it remains authoritative.',
      'Story 1 negative: Given a missing input, when projected, then it is reported.',
    ]);
    expect(first.projection.policy.reachability).toMatchObject({ enabled: true });
    expect(first.projection.diagrams).toEqual(['.docs/architecture/system.md']);
    expect(first.projection.governingAdrs.map((adr) => adr.stem)).toEqual([
      'adr-diff', 'adr-plan-one', 'adr-plan-two',
    ]);
    expect(first.projection.governingAdrs.map((adr) => adr.decisions)).toEqual([
      [{ id: '3', text: 'Diff decision.' }],
      [{ id: '1', text: 'First plan decision.' }],
      [{ id: '2', text: 'Second plan decision.' }],
    ]);

    const renderedFirst = renderAsBuiltProjection(first.projection);
    const renderedSecond = renderAsBuiltProjection(second.projection);
    expect(renderedSecond).toBe(renderedFirst);
    expect(renderedFirst).toContain(`AS-BUILT INPUT PROJECTION v${AS_BUILT_PROJECTION_VERSION}`);
  });

  it('excludes a plan-cited SUPERSEDED ADR while preserving every other populated projection section', async () => {
    const root = await fixture();
    const before = await buildAsBuiltProjection(root);
    if (!before.ok) throw new Error('expected populated projection before superseding an ADR');

    await writeFile(join(root, '.docs', 'decisions', 'adr-plan-one.md'), `# ADR

Status: SUPERSEDED by adr-plan-two

## Decision

1. First plan decision.
`);

    const result = await buildAsBuiltProjection(root);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('expected a projection after superseding an ADR');

    expect(result.projection).toEqual({
      ...before.projection,
      governingAdrs: before.projection.governingAdrs.filter((adr) => adr.stem !== 'adr-plan-one'),
    });
    expect(renderAsBuiltProjection(result.projection)).not.toContain('adr-plan-one');
  });

  it('renders an empty governing ADR set without disabling repository-wide ADR compliance', async () => {
    const root = await fixture({ includeDiffAdr: false });
    await writeFile(join(root, '.docs', 'plans', 'feature.md'), `# Plan

**Stories:** .docs/stories/feature.md

### Task 1: First

**Done when:**
- first done condition
`);

    const result = await buildAsBuiltProjection(root);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('expected a projection with no governing ADRs');

    expect(result.projection.governingAdrs).toEqual([]);
    expect(result.projection.policy.adrCompliance).toEqual({ enabled: true, reason: 'approved ADRs present' });
    expect(renderAsBuiltProjection(result.projection)).toContain('No ADR is pre-selected; APPROVED ADRs may be read on demand.');
  });

  it('keeps an empty diagram set and the existing no-diagrams policy reason', async () => {
    const root = await fixture({ includeDiagram: false });

    const result = await buildAsBuiltProjection(root);
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('expected a projection without diagrams');

    expect(result.projection.diagrams).toEqual([]);
    expect(result.projection.policy.diagramDrift).toEqual({ enabled: false, reason: 'no diagrams' });
  });

  it('includes pending findings without requiring a ledger', async () => {
    const root = await fixture();
    const absent = await buildAsBuiltProjection(root);
    expect(absent).toMatchObject({ ok: true, projection: { priorFindings: [] } });

    await mkdir(join(root, '.pipeline'), { recursive: true });
    await writeFile(join(root, '.pipeline', 'kickback-ledger.json'), JSON.stringify({
      version: 1,
      gates: {},
      pendingAsBuiltRemediationFindings: [
        { gate: 'architecture_review_as_built', finding: 'ARCH-1', class: 'REMEDIABLE', governingClause: 'adr-plan-one decision 1', summary: 'first prior finding', outcome: 'remediated' },
        { gate: 'architecture_review_as_built', finding: 'ARCH-2', class: 'REMEDIABLE', governingClause: 'adr-plan-two decision 2', summary: 'second prior finding', outcome: 'remediated' },
      ],
    }));

    const present = await buildAsBuiltProjection(root);
    expect(present).toMatchObject({ ok: true, projection: { priorFindings: [
      { finding: 'ARCH-1', class: 'REMEDIABLE', governingClause: 'adr-plan-one decision 1', summary: 'first prior finding' },
      { finding: 'ARCH-2', class: 'REMEDIABLE', governingClause: 'adr-plan-two decision 2', summary: 'second prior finding' },
    ] } });
  });

  it('returns a pending-findings fault rather than projecting an unreadable ledger', async () => {
    const root = await fixture();
    await mkdir(join(root, '.pipeline'), { recursive: true });
    const ledger = join(root, '.pipeline', 'kickback-ledger.json');
    await writeFile(ledger, '{ not JSON');

    await expect(buildAsBuiltProjection(root)).resolves.toEqual({
      ok: false,
      fault: expect.objectContaining({ dimension: 'pending-findings', detail: expect.stringContaining(ledger) }),
    });
  });

  it('keeps the largest plan, stories, and governing-ADR decision corpus inputs within shipped byte limits', async () => {
    const repositoryRoot = resolve(process.cwd(), '../..');
    const limits = asBuiltProjection.AS_BUILT_PROJECTION_LIMITS;

    await expect(Promise.all([
      largestCorpusBytes(join(repositoryRoot, '.docs', 'plans')),
      largestCorpusBytes(join(repositoryRoot, '.docs', 'stories')),
      largestCorpusBytes(join(repositoryRoot, '.docs', 'decisions')),
    ])).resolves.toEqual(expect.arrayContaining([
      expect.any(Number), expect.any(Number), expect.any(Number),
    ]));
    const [largestPlan, largestStories, largestAdr] = await Promise.all([
      largestCorpusBytes(join(repositoryRoot, '.docs', 'plans')),
      largestCorpusBytes(join(repositoryRoot, '.docs', 'stories')),
      largestCorpusBytes(join(repositoryRoot, '.docs', 'decisions')),
    ]);

    expect({
      perFileHunks: limits.perFileHunksBytes,
      totalDiff: limits.totalDiffBytes,
      planTasks: limits.planTasksBytes,
      storyCriteria: limits.storyCriteriaBytes,
      governingAdrDecisions: limits.governingAdrDecisionsBytes,
    }).toEqual({
      perFileHunks: expect.any(Number),
      totalDiff: expect.any(Number),
      planTasks: expect.any(Number),
      storyCriteria: expect.any(Number),
      governingAdrDecisions: expect.any(Number),
    });
    expect(limits.planTasksBytes).toBeGreaterThanOrEqual(largestPlan);
    expect(limits.storyCriteriaBytes).toBeGreaterThanOrEqual(largestStories);
    expect(limits.governingAdrDecisionsBytes).toBeGreaterThanOrEqual(largestAdr);
  });

  it('omits a changed file whose hunks exceed the per-file byte cap with a content digest', async () => {
    const root = await fixture();
    await writeFile(join(root, 'oversized.ts'), `export const oversized = '${'x'.repeat(512)}';\n`);
    await writeFile(join(root, 'Z-overflow.ts'), `export const upper = '${'z'.repeat(512)}';\n`);
    await writeFile(join(root, 'a-overflow.ts'), `export const lower = '${'a'.repeat(512)}';\n`);
    await commit(root, 'oversized change');

    const result = await buildAsBuiltProjection(root, { perFileHunksBytes: 64 });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('expected an omitted-diff projection');

    expect(result.projection.diff.omittedFiles).toEqual(expect.arrayContaining([
      { path: 'oversized.ts', digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) },
      { path: 'Z-overflow.ts', digest: await diffDigest(root, 'Z-overflow.ts') },
      { path: 'a-overflow.ts', digest: await diffDigest(root, 'a-overflow.ts') },
    ]));
    expect(result.projection.diff.hunks.join('\n')).not.toContain('oversized =');
    expect(renderAsBuiltProjection(result.projection)).toContain('Omitted files may be read on demand.');
  });

  it('omits diff files beyond the total byte cap without raising a projection fault', async () => {
    const root = await fixture();
    await writeFile(join(root, 'first-overflow.ts'), `export const first = '${'a'.repeat(128)}';\n`);
    await writeFile(join(root, 'second-overflow.ts'), `export const second = '${'b'.repeat(128)}';\n`);
    await commit(root, 'total diff overflow');

    const result = await buildAsBuiltProjection(root, { totalDiffBytes: 1 });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('total diff overflow must remain projectable');

    expect(result.projection.diff.omittedFiles).toEqual(expect.arrayContaining([
      { path: 'first-overflow.ts', digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) },
      { path: 'second-overflow.ts', digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) },
    ]));
  });

  it('keeps binary diff omission digests attached to their diff-header paths', async () => {
    const root = await fixture();
    await writeFile(join(root, 'Z-binary.bin'), Buffer.from([0, 1, 2, 3]));
    await writeFile(join(root, 'a-binary.bin'), Buffer.from([0, 4, 5, 6]));
    await commit(root, 'binary diff overflow');

    const result = await buildAsBuiltProjection(root, { perFileHunksBytes: 1 });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('binary diff overflow must remain projectable');

    expect(result.projection.diff.omittedFiles).toEqual(expect.arrayContaining([
      { path: 'Z-binary.bin', digest: await diffDigest(root, 'Z-binary.bin') },
      { path: 'a-binary.bin', digest: await diffDigest(root, 'a-binary.bin') },
    ]));
  });

  it('keeps quoted diff-header paths attached to their omission digests', async () => {
    const root = await fixture();
    const path = 'é-overflow.bin';
    await writeFile(join(root, path), Buffer.from([0, 7, 8, 9]));
    await commit(root, 'quoted diff path overflow');

    const result = await buildAsBuiltProjection(root, { perFileHunksBytes: 1 });
    expect(result).toMatchObject({ ok: true });
    if (!result.ok) throw new Error('quoted diff overflow must remain projectable');

    expect(result.projection.diff.omittedFiles).toEqual(expect.arrayContaining([
      { path: await quotedDiffHeaderPath(root, path), digest: expect.stringMatching(/^sha256:[a-f0-9]{64}$/) },
    ]));
  });

  it('returns a complete plan-tasks fault instead of truncating over-limit Done when blocks', async () => {
    const root = await fixture();
    await writeFile(join(root, '.docs', 'plans', 'feature.md'), `# Plan

**Stories:** .docs/stories/feature.md

### Task 1: First

**Done when:**
- ${'required evidence '.repeat(32)}
`);

    await expect(buildAsBuiltProjection(root, { planTasksBytes: 1 })).resolves.toEqual({
      ok: false,
      fault: {
        dimension: 'plan-tasks',
        actual: expect.any(Number),
        limit: 1,
      },
    });
  });

  it('returns a complete story-criteria fault instead of truncating an over-limit sealed story', async () => {
    const root = await fixture();

    await expect(buildAsBuiltProjection(root, { storyCriteriaBytes: 1 })).resolves.toEqual({
      ok: false,
      fault: {
        dimension: 'story-criteria',
        actual: expect.any(Number),
        limit: 1,
      },
    });
  });

  it('returns a complete governing-ADR-decisions fault instead of truncating decisions', async () => {
    const root = await fixture();

    await expect(buildAsBuiltProjection(root, { governingAdrDecisionsBytes: 1 })).resolves.toEqual({
      ok: false,
      fault: {
        dimension: 'governing-adr-decisions',
        actual: expect.any(Number),
        limit: 1,
      },
    });
  });

  it('fails closed when the sealed stories or a governing ADR cannot be read as authoritative input', async () => {
    const root = await fixture();
    await rm(join(root, '.docs', 'stories', 'feature.md'));
    await expect(buildAsBuiltProjection(root)).resolves.toMatchObject({
      ok: false, fault: { dimension: 'story-criteria', detail: expect.stringContaining('.docs/stories/feature.md') },
    });

    const adrRoot = await fixture();
    await writeFile(join(adrRoot, '.docs', 'decisions', 'adr-plan-one.md'), '# ADR\n\nStatus: APPROVED\n');
    await expect(buildAsBuiltProjection(adrRoot)).resolves.toMatchObject({
      ok: false,
      fault: { dimension: 'governing-adr-decisions', detail: expect.stringContaining('adr-plan-one') },
    });
  });
});
