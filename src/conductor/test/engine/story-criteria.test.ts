// Covers: S2.1, S2.2, S2.3, S3.1, S3.2, S3.3, task:7
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { extractAuthoritativeStoryCriteria } from '../../src/engine/artifacts.js';
import { GATE_ONLY_PREDICATES } from '../../src/engine/artifacts.js';
import { landSpec } from '../../src/engine/engineer/land-spec.js';
import { createEngineerWorktree } from '../../src/engine/engineer/worktree-authoring.js';
import type { GhRunner } from '../../src/engine/owner-gate/identity.js';
import {
  assessAcceptedStoryReadability,
  extractStoryCriterionIds,
  splitStoryBlocks,
} from '../../src/engine/story-criteria.js';

const execFile = promisify(execFileCb);
const gh: GhRunner = async () => ({ stdout: 'operator\n' });

/** One story block in the heading shape real stories files use. */
function story(id: string, happy: readonly string[], negative: readonly string[] = []): string {
  return [
    `## Story ${id}: Title for ${id}`,
    '',
    '### Acceptance Criteria',
    '',
    '#### Happy Path',
    '',
    ...happy.map((text) => `- Given ${text}, when it runs, then it holds`),
    '',
    ...(negative.length === 0 ? [] : [
      '#### Negative Paths',
      '',
      ...negative.map((text) => `- Given ${text}, when it runs, then it is refused`),
      '',
    ]),
  ].join('\n');
}

describe('extractStoryCriterionIds', () => {
  // Story heading ids use the `[A-Za-z0-9.-]` alphabet, so `5` and `5a` are
  // DISTINCT stories and `2` and `2.1` are too. Deriving the criterion id from
  // only the heading's first digit run collapsed each pair onto one id space,
  // and the colliding story's criteria deduped away inside the caller's Set —
  // unaddressable by any key a PRD audit could write.
  it('derives distinct ids for alphanumeric and nested story ids', () => {
    const stories = [
      story('2', ['a']),
      story('2.1', ['b'], ['c']),
      story('5', ['d', 'e']),
      story('5a', ['f'], ['g']),
    ].join('\n');

    expect(splitStoryBlocks(stories).map((block) => block.id))
      .toEqual(['2', '2.1', '5', '5a']);
    expect(extractStoryCriterionIds(stories)).toEqual([
      'S2.1',
      'S2.1.1',
      'S2.1.2',
      'S5.1',
      'S5.2',
      'S5a.1',
      'S5a.2',
    ]);
  });

  it('assigns every criterion a unique id across colliding heading ids', () => {
    // The shape that halted a real build: eleven criteria under Story 5 and
    // eight under Story 5a. Both stories' criteria must survive de-duplication.
    const stories = [
      story('5', Array.from({ length: 11 }, (_, index) => `precondition ${index}`)),
      story('5a', Array.from({ length: 8 }, (_, index) => `stranded pull ${index}`)),
    ].join('\n');

    const ids = extractStoryCriterionIds(stories);

    expect(ids).toHaveLength(19);
    expect(new Set(ids).size).toBe(19);
    expect(ids.filter((id) => id.startsWith('S5a.'))).toEqual([
      'S5a.1',
      'S5a.2',
      'S5a.3',
      'S5a.4',
      'S5a.5',
      'S5a.6',
      'S5a.7',
      'S5a.8',
    ]);
  });

  it('numbers happy-path criteria before negative-path criteria within a story', () => {
    expect(extractStoryCriterionIds(story('1', ['a', 'b'], ['c'])))
      .toEqual(['S1.1', 'S1.2', 'S1.3']);
  });

  it('yields no ids for a file whose stories carry no heading id', () => {
    expect(extractStoryCriterionIds('## Story: Untitled\n\n#### Happy Path\n\n- Given a, when b, then c\n'))
      .toEqual([]);
  });

  it('counts a hard-wrapped row whose "then" sits on a continuation line', () => {
    // Authors wrap rows at ~100 columns. Matching only the first line of the
    // bullet dropped every row that wrapped before "then" and shifted the
    // ordinals of every row after it.
    const text = [
      '## Story 1: Wrapped',
      '',
      '#### Happy Path',
      '- Given the shared stack is up and databases exist in both engines,',
      '  when the script is executed with no arguments,',
      '  then both databases no longer exist.',
      '- Given a namespace with odd characters, when',
      '  the script runs, then it sanitizes them.',
      '- Given `CI=true`, when it runs, then it does not prompt.',
      '',
      '#### Negative Paths',
      '- Given the credentials are wrong, when the script runs,',
      '  then it exits non-zero.',
      '',
    ].join('\n');
    expect(extractStoryCriterionIds(text)).toEqual(['S1.1', 'S1.2', 'S1.3', 'S1.4']);
  });

  it('keeps authoritative criteria aligned with ids for hard-wrapped bullets', () => {
    const text = [
      '## Story 1: First wrapped',
      '',
      '#### Happy Path',
      '- Given the first criterion begins on the bullet line,',
      '  when the continuation is indented, then it remains one criterion.',
      '- Given a second criterion, when it runs, then it follows the first.',
      '',
      '## Story 2: Also wrapped',
      '',
      '#### Negative Paths',
      '- Given the negative criterion begins on the bullet line,',
      '  when the continuation is indented, then it remains one criterion.',
      '',
    ].join('\n');

    const authoritative = extractAuthoritativeStoryCriteria(text);
    const ids = extractStoryCriterionIds(text);

    expect({ authoritative, idCount: ids.length }).toEqual({
      authoritative: [
        'Story 1 happy: Given the first criterion begins on the bullet line, when the continuation is indented, then it remains one criterion.',
        'Story 1 happy: Given a second criterion, when it runs, then it follows the first.',
        'Story 2 negative: Given the negative criterion begins on the bullet line, when the continuation is indented, then it remains one criterion.',
      ],
      idCount: 3,
    });
  });

  it('does not join a following bullet or unindented prose into the previous row', () => {
    const text = [
      '## Story 2: Boundaries',
      '',
      '#### Happy Path',
      '- Given a, when b,',
      '- then c is a separate bullet with no precondition',
      'Prose that is not part of any bullet, then',
      '- Given d, when e, then f',
      '',
    ].join('\n');
    expect(extractStoryCriterionIds(text)).toEqual(['S2.1']);
  });
});

describe('assessAcceptedStoryReadability', () => {
  it('rejects a story with Negative Paths but no Happy Path section', () => {
    const stories = [
      '# Stories',
      '',
      '## Story 1: negative only',
      '',
      '### Negative Paths',
      '- **Given** a broken thing, **When** it runs, **Then** it fails loudly.',
      '',
    ].join('\n');

    expect(assessAcceptedStoryReadability(stories)).toEqual({
      stories: [{ id: '1', readable: false }],
      firstUnreadableStoryId: '1',
    });
  });

  it('reports readable, zero-criteria, and missing-negative-path stories', () => {
    const stories = [
      story('1', ['the condition is satisfied'], ['the condition is refused']),
      [
        '## Story 2: No criteria',
        '',
        '#### Happy Path',
        '',
        '- A statement without criterion clauses',
        '',
        '#### Negative Paths',
        '',
        '- Another non-criterion statement',
      ].join('\n'),
      story('3', ['the condition is satisfied']),
    ].join('\n');

    expect(assessAcceptedStoryReadability(stories)).toEqual({
      stories: [
        { id: '1', readable: true },
        { id: '2', readable: false },
        { id: '3', readable: false },
      ],
      firstUnreadableStoryId: '2',
    });
  });
});

describe('accepted-story readability consumer agreement', () => {
  let root: string;
  const gateRoots: string[] = [];

  const corpus = {
    readable: {
      accepted: true,
      stories: [
        '# Stories: readable stories only',
        '',
        '**Status:** Accepted',
        '',
        '## Story 1: Readable',
        '',
        '### Acceptance Criteria',
        '',
        '#### Happy Path',
        '',
        '- Given an operator reads Story 1, when land validates it, then the criterion is readable.',
        '',
        '#### Negative Paths',
        '',
        '- Given Story 1 has invalid input, when land validates it, then the criterion remains readable.',
      ].join('\n'),
    },
    'zero-criteria': {
      accepted: false,
      stories: [
        '# Stories',
        '',
        '**Status:** Accepted',
        '',
        '## Story 1: No criteria',
        '',
        '#### Happy Path',
        '',
        '- An outcome without the required clauses.',
        '',
        '#### Negative Paths',
        '',
        '- Another outcome without the required clauses.',
      ].join('\n'),
    },
    'missing-negative-paths': {
      accepted: false,
      stories: [
        '# Stories',
        '',
        '**Status:** Accepted',
        '',
        '## Story 1: Incomplete criteria',
        '',
        '#### Happy Path',
        '',
        '- Given a partial story, when a consumer inspects it, then it cannot land.',
      ].join('\n'),
    },
  } as const;

  async function git(args: string[], cwd = root): Promise<string> {
    const { stdout } = await execFile('git', args, { cwd });
    return stdout.trim();
  }

  async function writeLandArtifacts(feature: string, stories: string): Promise<string> {
    const worktreePath = (await createEngineerWorktree(root, feature)).worktreePath;
    await rm(join(worktreePath, '.docs', 'coherence'), { recursive: true, force: true });
    await Promise.all([
      mkdir(join(worktreePath, '.docs', 'specs'), { recursive: true }),
      mkdir(join(worktreePath, '.docs', 'stories'), { recursive: true }),
      mkdir(join(worktreePath, '.docs', 'plans'), { recursive: true }),
      mkdir(join(worktreePath, '.docs', 'track'), { recursive: true }),
      mkdir(join(worktreePath, '.docs', 'complexity'), { recursive: true }),
    ]);
    await Promise.all([
      writeFile(join(worktreePath, `.docs/specs/${feature}.md`), '# PRD\n\nApproved.\n'),
      writeFile(join(worktreePath, `.docs/stories/${feature}.md`), stories),
      writeFile(join(worktreePath, `.docs/plans/${feature}.md`), [
        `# Implementation Plan: ${feature}`,
        '',
        `**Stories:** .docs/stories/${feature}.md`,
        '',
        '### Task 1: Preserve agreement',
        '**Story:** Story 1',
        '',
        '**Done when:**',
        '- Given an operator reads Story 1, when land validates it, then the criterion is readable.',
        '- Given Story 1 has invalid input, when land validates it, then the criterion remains readable.',
        '',
        '## Coverage Check',
        '',
        '| Criterion | Task ids | Quote | Disposition |',
        '| --- | --- | --- | --- |',
        '| Story 1 happy: Given an operator reads Story 1, when land validates it, then the criterion is readable. | 1 | "Given an operator reads Story 1, when land validates it, then the criterion is readable." | diff-local |',
        '| Story 1 negative: Given Story 1 has invalid input, when land validates it, then the criterion remains readable. | 1 | "Given Story 1 has invalid input, when land validates it, then the criterion remains readable." | diff-local |',
        '',
      ].join('\n')),
      writeFile(join(worktreePath, `.docs/track/${feature}.md`), '# Track\n\nTrack: technical\n'),
      writeFile(join(worktreePath, `.docs/complexity/${feature}.md`), '# Complexity\n\nTier: S\n'),
    ]);
    return worktreePath;
  }

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'story-criteria-agreement-'));
    await git(['init', '-b', 'main', '-q']);
    await git(['config', 'user.email', 'test@example.com']);
    await git(['config', 'user.name', 'Test User']);
    await writeFile(join(root, 'README.md'), '# fixture\n');
    await git(['add', 'README.md']);
    await git(['commit', '-m', 'initial']);
  });

  afterEach(async () => {
    await Promise.all([
      rm(root, { recursive: true, force: true }),
      ...gateRoots.splice(0).map((gateRoot) => rm(gateRoot, { recursive: true, force: true })),
    ]);
  });

  it('evaluates the readable, zero-criteria, and missing-Negative-Paths corpus through both real consumers', async () => {
    for (const [shape, fixture] of Object.entries(corpus)) {
      const feature = `stories-shape-${shape}`;
      const gateRoot = await mkdtemp(join(tmpdir(), `story-criteria-gate-${shape}-`));
      gateRoots.push(gateRoot);
      await mkdir(join(gateRoot, '.docs', 'stories'), { recursive: true });
      await writeFile(join(gateRoot, `.docs/stories/${feature}.md`), fixture.stories);
      const gate = await GATE_ONLY_PREDICATES.stories!(gateRoot, { featureDesc: feature });
      expect(gate.done).toBe(fixture.accepted);

      const worktreePath = await writeLandArtifacts(feature, fixture.stories);
      const land = landSpec(
        { name: 'fixture', canonicalPath: root },
        feature,
        worktreePath,
        undefined,
        { ownerConfig: {}, gh },
      );

      if (fixture.accepted) {
        await expect(land).resolves.toMatchObject({ slug: feature });
      } else {
        await expect(land).rejects.toMatchObject({ gate: 'stories-unreadable' });
      }
    }
  });
});
