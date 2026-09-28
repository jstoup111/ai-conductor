// Covers: task:1
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describeLiveHalt } from '../../src/engine/unpark-halt-warning.js';

type ExpectedLines = string[] | null | ((worktreePath: string) => string[]);

type Fixture = {
  name: string;
  haltClass?: string;
  unreadableSidecar?: boolean;
  expected: ExpectedLines;
};

async function snapshotPipeline(worktreePath: string): Promise<Map<string, Buffer>> {
  const pipelinePath = join(worktreePath, '.pipeline');
  const files = new Map<string, Buffer>();

  async function walk(path: string, relativePath: string): Promise<void> {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const childPath = join(path, entry.name);
      const childRelativePath = join(relativePath, entry.name);
      if (entry.isDirectory()) {
        await walk(childPath, childRelativePath);
      } else if (entry.isFile()) {
        files.set(childRelativePath, await readFile(childPath));
      }
    }
  }

  await walk(pipelinePath, '.pipeline');
  return files;
}

describe('engine/unpark-halt-warning', () => {
  let root: string;

  afterEach(async () => {
    if (root) await rm(root, { recursive: true, force: true });
  });

  const fixtures: Fixture[] = [
    { name: 'no HALT', expected: null },
    {
      name: 'mechanical class',
      haltClass: 'mechanical',
      expected: (worktreePath: string) => [
        "'halted-feature' still has a live HALT (class: mechanical) — it will not resume until the HALT is cleared.",
        `To resume: rm ${worktreePath}/.pipeline/HALT ${worktreePath}/.pipeline/HALT.class`,
      ],
    },
    {
      name: 'legacy class',
      haltClass: 'legacy',
      expected: (worktreePath: string) => [
        "'halted-feature' still has a live HALT (class: legacy) — it will not resume until the HALT is cleared.",
        `To resume: rm ${worktreePath}/.pipeline/HALT ${worktreePath}/.pipeline/HALT.class`,
      ],
    },
    {
      name: 'over-scope class',
      haltClass: 'over-scope',
      expected: (worktreePath: string) => [
        "'halted-feature' still has a live HALT (class: over-scope) — it will not resume until the HALT is cleared.",
        `To resume: record each decision in ${worktreePath}/.pipeline/HALT, then mv ${worktreePath}/.pipeline/HALT ${worktreePath}/.pipeline/HALT.cleared; rm -f ${worktreePath}/.pipeline/HALT.class`,
      ],
    },
    {
      name: 'kickback-cap class',
      haltClass: 'kickback-cap',
      expected: [
        "'halted-feature' still has a live HALT (class: kickback-cap) — it will not resume until the HALT is cleared.",
        'To resume: ai-conductor kickback-budget inspect --feature halted-feature, then raise or reset the budget; the daemon clears the HALT.',
      ],
    },
    ...['needs-human', 'plan-gap', 'protected-artifact', 'future-class'].map((haltClass) => ({
      name: `${haltClass} class`,
      haltClass,
      expected: [
        `'halted-feature' still has a live HALT (class: ${haltClass}) — it will not resume until the HALT is cleared.`,
        'To resume: resolve the cause recorded in <worktree>/.pipeline/HALT before the HALT is cleared — see docs/runbooks/stalled-or-stuck-feature.md',
      ],
    })),
    {
      name: 'empty class sidecar',
      haltClass: '',
      expected: [
        "'halted-feature' still has a live HALT (class: (empty)) — it will not resume until the HALT is cleared.",
        'To resume: resolve the cause recorded in <worktree>/.pipeline/HALT before the HALT is cleared — see docs/runbooks/stalled-or-stuck-feature.md',
      ],
    },
    {
      name: 'absent class sidecar',
      expected: (worktreePath: string) => [
        "'halted-feature' still has a live HALT (class: unclassified) — it will not resume until the HALT is cleared.",
        `To resume: rm ${worktreePath}/.pipeline/HALT ${worktreePath}/.pipeline/HALT.class`,
      ],
    },
    {
      name: 'directory class sidecar',
      unreadableSidecar: true,
      expected: [
        "'halted-feature' still has a live HALT (class: unreadable) — it will not resume until the HALT is cleared.",
        'To resume: resolve the cause recorded in <worktree>/.pipeline/HALT before the HALT is cleared — see docs/runbooks/stalled-or-stuck-feature.md',
      ],
    },
  ];

  it.each(fixtures)('maps $name without changing the fixture .pipeline', async (fixture) => {
    root = await mkdtemp(join(tmpdir(), 'unpark-halt-warning-'));
    const worktreePath = join(root, 'halted-feature');
    const pipelinePath = join(worktreePath, '.pipeline');
    await mkdir(pipelinePath, { recursive: true });

    if (fixture.expected !== null) {
      await writeFile(join(pipelinePath, 'HALT'), 'the halt body\n', 'utf8');
      if (fixture.unreadableSidecar) {
        await mkdir(join(pipelinePath, 'HALT.class'));
      } else if (fixture.haltClass !== undefined) {
        await writeFile(join(pipelinePath, 'HALT.class'), fixture.haltClass, 'utf8');
      }
    }

    const before = await snapshotPipeline(worktreePath);
    const actual = await describeLiveHalt(worktreePath);
    const after = await snapshotPipeline(worktreePath);

    const expected = typeof fixture.expected === 'function'
      ? fixture.expected(worktreePath)
      : fixture.expected?.map((line) => line.replace('<worktree>', worktreePath)) ?? null;
    expect(actual).toEqual(expected);
    expect(after).toEqual(before);
  });
});
