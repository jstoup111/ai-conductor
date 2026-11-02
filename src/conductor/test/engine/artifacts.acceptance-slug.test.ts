import { execFile as execFileCallback } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, describe, expect, it } from 'vitest';
import { checkStepCompletion } from '../../src/engine/artifacts.js';
import { parseChildId } from '../../src/engine/child-context.js';

const execFile = promisify(execFileCallback);

describe('acceptance completion preserves the supplied child feature identity', () => {
  const roots: string[] = [];
  const child = parseChildId(2)!;

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  });

  async function seed(slug: string) {
    const root = await mkdtemp(join(tmpdir(), 'acceptance-slug-'));
    roots.push(root);
    const git = async (...args: string[]) => (await execFile('git', args, { cwd: root })).stdout.trim();
    const create = async (path: string, content: string) => {
      await mkdir(join(root, path, '..'), { recursive: true });
      await writeFile(join(root, path), content);
    };
    await git('init', '-q', '-b', `feat/c2/${slug}`);
    await git('config', 'user.email', 'acceptance@example.test');
    await git('config', 'user.name', 'Acceptance test');
    await create(`.docs/plans/${slug}.md`, `# Plan
**Stories:** .docs/stories/${slug}.md

## Slices
| Slice | Title | Tasks |
| --- | --- | --- |
| 1 | Parent | 1 |
| 2 | Child | 2 |

### Task 1: Parent
**Story:** Story 1
**Dependencies:** none

### Task 2: Child
**Story:** Story 2
**Dependencies:** 1
`);
    await create(`.docs/stories/${slug}.md`, `# Stories

## Story 1: Parent
### Happy Path
- Given a parent, When it closes, Then its work is retained.

## Story 2: Child
### Happy Path
- Given a child, When it records evidence, Then its result is accepted.
### Negative Paths
- Given invalid evidence, When the child records it, Then it is refused.
`);
    // A parent's acceptance spec must not be attributed to child 2.
    await create(`test/acceptance/${slug}.acceptance.test.ts`, '// parent spec\n');
    await git('add', '.');
    await git('commit', '-qm', 'parent closure');
    const closure = await git('rev-parse', 'HEAD');
    await git('branch', `feat/c1/${slug}`, closure);
    await git('update-ref', `refs/conductor/${slug}/closed/c1`, closure);
    await create('positions.json', '[1,2]');
    const positions = await git('hash-object', '-w', 'positions.json');
    await git('update-ref', `refs/conductor/${slug}/positions`, positions);
    const marker = '.pipeline/children/2/acceptance-specs-red.json';
    await create(marker, JSON.stringify({
      outcome: 'disposition-only',
      dispositions: [
        'Story 2 happy: Given a child, When it records evidence, Then its result is accepted.',
        'Story 2 negative: Given invalid evidence, When the child records it, Then it is refused.',
      ].map((criterion) => ({
        criterion,
        disposition: 'planned-lower-layer-test',
        citation: `.docs/plans/${slug}.md:14`,
        owningTask: 'Task 2',
        layer: 'unit',
      })),
    }));
    return { root, git, create, closure, marker, context: { activeChild: child, featureDesc: slug } };
  }

  for (const slug of ['a-published-stacked-child-changes-silently-when-a-', `feature-${'a'.repeat(60)}`]) {
    it(`grounds dispositions against the exact parent closure for ${slug}`, async () => {
      const { root, context } = await seed(slug);

      await expect(checkStepCompletion(root, 'acceptance_specs', context)).resolves.toEqual({
        done: true, viaException: false,
      });
    });

    it(`validates prior-child-green against the exact parent closure for ${slug}`, async () => {
      const { root, context, create, closure, marker } = await seed(slug);
      await create(marker, JSON.stringify({
        outcome: 'specs-generated',
        command: 'local acceptance runner',
        targetSpecs: [`test/acceptance/${slug}.acceptance.test.ts`],
        executed: 1, passed: 1, failed: 0, skipped: 0, errors: 0,
        failingTests: [],
        ranAt: '2026-11-01T12:00:00.000Z',
        intentRationale: 'The parent closure already contains the behavior.',
        exception: {
          kind: 'prior-child-green',
          reason: 'The parent already delivered this behavior.',
          attribution: closure,
        },
      }));

      await expect(checkStepCompletion(root, 'acceptance_specs', context)).resolves.toEqual({
        done: true, viaException: true,
      });
    });
  }

  it('still refuses when the exact parent branch is absent', async () => {
    const slug = 'trailing-hyphen-';
    const { root, context, git } = await seed(slug);
    await git('branch', '-d', `feat/c1/${slug}`);

    await expect(checkStepCompletion(root, 'acceptance_specs', context)).resolves.toMatchObject({
      done: false,
      acceptanceRedRefusalClass: 'shape',
      reason: expect.stringContaining(`parent child 1 branch feat/c1/${slug} is missing`),
    });
  });
});
