// Covers: task:1
import { execFile } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';

import {
  buildPrdAuditProjection,
  PRD_AUDIT_PROJECTION_VERSION,
} from '../../src/engine/prd-audit-projection.js';

const execFileAsync = promisify(execFile);
const directories: string[] = [];

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'prd-audit-projection-'));
  directories.push(root);
  const git = async (...args: string[]) => execFileAsync('git', ['-C', root, ...args]);

  await execFileAsync('git', ['init', '-b', 'main', root]);
  await git('config', 'user.email', 'test@example.com');
  await git('config', 'user.name', 'Test User');
  await mkdir(join(root, '.docs', 'plans'), { recursive: true });
  await mkdir(join(root, '.docs', 'stories'), { recursive: true });
  await mkdir(join(root, '.docs', 'specs'), { recursive: true });
  await mkdir(join(root, '.docs', 'coherence'), { recursive: true });
  await mkdir(join(root, '.pipeline'), { recursive: true });
  await writeFile(join(root, 'src.ts'), 'export const version = 1;\n');
  await git('add', '.');
  await git('commit', '-m', 'base');
  await git('checkout', '-b', 'feature/audit-fixture');

  await writeFile(join(root, '.pipeline', 'engine-state.json'), JSON.stringify({
    feature_desc: 'audit-fixture',
    activePlanPath: '.docs/plans/audit-fixture.md',
  }));
  await writeFile(join(root, '.docs', 'plans', 'audit-fixture.md'), `# Implementation Plan: Audit fixture

**Stories:** .docs/stories/audit-fixture.md

## Technical Approach

Audit the feature requirements against the delivered source.

### Task task-a: Preserve the documented outcome

**Story:** Story alpha.1
**Files:** src.ts
**Done when:**
- The published behavior preserves the documented outcome.
`);
  await writeFile(join(root, '.docs', 'stories', 'audit-fixture.md'), `# Stories

## Story alpha.1: Preserve obligations

### Happy Path
- Given the feature is audited, when its source meets the documented behavior, then the audit can pass.

### Negative Paths
- Given the feature omits the documented behavior, when its source is audited, then the audit reports the gap.
`);
  await writeFile(join(root, '.docs', 'specs', 'audit-fixture.md'), `# PRD

## Goals
- Preserve the documented outcome.

## Non-Goals
- Do not broaden unrelated behavior.

## Functional Requirements
- FR-7: The audit preserves the documented outcome.
- **FR-9:** The audit retains bolded requirement syntax.
`);
  await writeFile(join(root, '.docs', 'specs', '2026-09-30-audit-fixture.md'), `# Supplemental PRD

## Functional Requirements
- FR-8: The audit retains every applicable PRD source.
`);
  await writeFile(join(root, '.docs', 'coherence', 'audit-fixture.md'), `# Coherence

| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| fr | FR-7 | story-alpha.1 | covered | Preserve the documented outcome. |
| story | story-alpha.1 | task-a | covered | Preserve obligations. |
`);
  await writeFile(join(root, '.pipeline', 'accepted-widenings.json'), JSON.stringify({
    version: 2,
    feature: { version: 1, repository: 'fixture-repository', feature: 'audit-fixture' },
    decisions: [{
      id: 'decision-1',
      criterion: 'NC.1',
      authority: 'accept',
      rationale: 'The original scope was explicitly accepted.',
      operator: 'operator@example.test',
      revision: 1,
      originalSource: {
        id: 'prd-audit:NC.1',
        snapshot: 'The original reviewer found a scope observation.',
      },
      originalCaseId: 'case-1',
    }],
  }));
  await writeFile(join(root, 'src.ts'), 'export const version = 2;\n');
  await git('add', '.');
  await git('commit', '-m', 'feature change');
  return root;
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('PRD-audit feature projection', () => {
  it('independently resolves populated feature obligations, scoped changes, and attributable history', async () => {
    const result = await buildPrdAuditProjection(await fixture());

    expect(result).toMatchObject({
      ok: true,
      projection: {
        version: PRD_AUDIT_PROJECTION_VERSION,
        plan: { intent: 'Audit the feature requirements against the delivered source.' },
        criteria: [
          { id: 'Salpha.1.1', storyId: 'alpha.1', kind: 'happy' },
          { id: 'Salpha.1.2', storyId: 'alpha.1', kind: 'negative' },
        ],
        tasks: [{
          id: 'task-a',
          storyIds: ['alpha.1'],
          doneWhen: ['The published behavior preserves the documented outcome.'],
        }],
        prd: { sources: [
          {
            path: '.docs/specs/2026-09-30-audit-fixture.md',
            requirements: [{ id: 'FR-8', text: 'The audit retains every applicable PRD source.' }],
          },
          {
            path: '.docs/specs/audit-fixture.md',
            requirements: [
              { id: 'FR-7', text: 'The audit preserves the documented outcome.' },
              { id: 'FR-9', text: 'The audit retains bolded requirement syntax.' },
            ],
          },
        ] },
        coherence: [
          { rowClass: 'fr', id: 'FR-7', citedIds: ['story-alpha.1'] },
          { rowClass: 'story', id: 'story-alpha.1', citedIds: ['task-a'] },
        ],
        changes: expect.objectContaining({
          changedFiles: expect.arrayContaining([expect.objectContaining({ path: 'src.ts' })]),
        }),
        history: expect.objectContaining({
          decisions: [expect.objectContaining({
            criterion: 'NC.1', authority: 'accept', operator: 'operator@example.test',
            originalSource: expect.objectContaining({ id: 'prd-audit:NC.1' }),
          })],
        }),
      },
    });
  });

  it('keeps technical-work obligations while representing absent optional sources explicitly', async () => {
    const root = await fixture();
    await Promise.all([
      rm(join(root, '.docs', 'specs', 'audit-fixture.md')),
      rm(join(root, '.docs', 'specs', '2026-09-30-audit-fixture.md')),
      rm(join(root, '.pipeline', 'accepted-widenings.json')),
      rm(join(root, '.docs', 'coherence', 'audit-fixture.md')),
    ]);

    const result = await buildPrdAuditProjection(root);

    expect(result).toMatchObject({
      ok: true,
      projection: {
        version: PRD_AUDIT_PROJECTION_VERSION,
        criteria: [
          { id: 'Salpha.1.1', kind: 'happy' },
          { id: 'Salpha.1.2', kind: 'negative' },
        ],
        tasks: [{
          id: 'task-a',
          storyIds: ['alpha.1'],
          doneWhen: ['The published behavior preserves the documented outcome.'],
        }],
        prd: { kind: 'absent' },
        coherence: { kind: 'absent' },
        history: { kind: 'absent' },
      },
    });
  });
});
