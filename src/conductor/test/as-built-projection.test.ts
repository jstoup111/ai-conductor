// Covers: task:6
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import {
  AS_BUILT_PROJECTION_VERSION,
  buildAsBuiltProjection,
  renderAsBuiltProjection,
} from '../src/engine/as-built-projection.js';

const execFileAsync = promisify(execFile);
const dirs: string[] = [];

async function fixture(): Promise<string> {
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
  await writeFile(join(root, '.docs', 'architecture', 'system.md'), '# Diagram\n');
  await writeFile(join(root, 'tracked.ts'), 'export const unchanged = true;\n');
  await git('add', '.');
  await git('commit', '-m', 'base');

  await git('checkout', '-b', 'feature/projection');
  await writeFile(join(root, 'tracked.ts'), 'export const changed = true;\n');
  await writeFile(join(root, '.docs', 'decisions', 'adr-diff.md'), `# ADR

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
});
