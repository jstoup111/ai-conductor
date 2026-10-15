// Covers: task:22
import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import {
  parseCoherenceArtifact,
  runCoherenceGate,
  validateCoherence,
} from '../../../src/engine/engineer/coherence-validator.js';
import { AuthoringGuard } from '../../../src/engine/engineer/authoring-guard.js';

const execFile = promisify(execFileCallback);
const temporaryRepositories: string[] = [];

const storiesText = `# Stories

## Story 1: Widget

### Happy Path
- Given a widget, when shipped, then it arrives
`;
const planText = `# Plan

### Task 1: Ship widget
**Story:** Story 1

**Done when:**
- Ship the widget with arrival tracking.

## Coverage Check

| Criterion | Task ids | Quote | Disposition |
| --- | --- | --- | --- |
| Story 1 happy: Given a widget, when shipped, then it arrives | task-1 | "Ship the widget with arrival tracking." | diff-local |
`;
const coherenceArtifact = `| Row Class | Id | Cited Ids | Verdict | Quote |
| --- | --- | --- | --- | --- |
| story | story-1 | task-1 | covered | fixture |
| task | task-1 | story-1 | covered | fixture |

| Row Class | Criterion | Cited Task Ids | Verdict | Quote | Disposition |
| --- | --- | --- | --- | --- | --- |
| criterion | Story 1 happy: Given a widget, when shipped, then it arrives | task-1 | covered | "Ship the widget with arrival tracking." | diff-local |
`;

afterEach(async () => {
  await Promise.all(temporaryRepositories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('coherence covered-only regression', () => {
  it('accepts an M-tier covered-only artifact through the gate without gaps or a waiver', async () => {
    const parsed = parseCoherenceArtifact(coherenceArtifact);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) throw new Error('expected covered-only coherence artifact to parse');
    expect(parsed.rows).toHaveLength(3);
    expect(parsed.rows.every((row) => row.verdict === 'covered')).toBe(true);

    const coverage = validateCoherence({
      rows: parsed.rows,
      requiredLayers: new Set(['story', 'criterion', 'orphan-task', 'coverage-table']),
      outcomeBullets: [],
      prdText: null,
      storiesText,
      planText,
    });
    expect(coverage).toEqual({ ok: true });

    const worktreePath = await mkdtemp(join(tmpdir(), 'coherence-covered-only-'));
    temporaryRepositories.push(worktreePath);
    await execFile('git', ['init', '--initial-branch=main'], { cwd: worktreePath });
    await execFile('git', ['config', 'user.email', 'test@example.com'], { cwd: worktreePath });
    await execFile('git', ['config', 'user.name', 'Test User'], { cwd: worktreePath });
    await writeFile(join(worktreePath, 'README.md'), '# fixture\n');
    await execFile('git', ['add', '.'], { cwd: worktreePath });
    await execFile('git', ['commit', '-m', 'seed fixture'], { cwd: worktreePath });
    await mkdir(join(worktreePath, '.docs', 'coherence'), { recursive: true });
    await writeFile(join(worktreePath, '.docs', 'coherence', 'idea.md'), coherenceArtifact);

    await expect(runCoherenceGate({
      worktreePath,
      canonicalPath: worktreePath,
      tier: 'M',
      track: 'technical',
      sourceRef: undefined,
      planStem: 'idea',
      storiesText,
      planText,
      prdText: null,
      outcomeBullets: [],
      ideaFiles: new Set(['.docs/coherence/idea.md']),
      guard: new AuthoringGuard(worktreePath),
    })).resolves.toBeUndefined();
  });
});
