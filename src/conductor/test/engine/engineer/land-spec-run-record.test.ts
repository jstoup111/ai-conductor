// Covers: task:7

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { LandGateError, landSpec } from '../../../src/engine/engineer/land-spec.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';
import { digestArtifact, parseRunRecord, recordAcceptance, recordDraft, serializeRunRecord, type ArtifactDigest, type RunRecord } from '../../../src/engine/engineer/run-record.js';

const execFile = promisify(execFileCb);
const IDEA = 'run record landing';
const SLUG = 'run-record-landing';
const RECORD_PATH = `.docs/composer-runs/${SLUG}.json`;
let repoPath: string;

const stories = [
  '# Stories: run record landing',
  '',
  '**Status:** Accepted',
  '',
  '## Story 1: prevent draft delivery',
  '### Happy Path',
  '- Given accepted artifacts, when land runs, then it commits.',
  '',
  '### Negative Paths',
  '- Given an unaccepted artifact, when land runs, then it refuses.',
  '',
].join('\n');

const plan = [
  '# Implementation Plan: run record landing',
  '',
  `**Stories:** .docs/stories/${SLUG}.md`,
  '',
  '### Task 1: Land the artifacts',
  '**Story:** Story 1',
  '**Dependencies:** none',
  '',
  '**Done when:**',
  '- Given accepted artifacts, when land runs, then it commits.',
  '- Given an unaccepted artifact, when land runs, then it refuses.',
  '',
  '## Coverage Check',
  '',
  '| Criterion | Task ids | Quote | Disposition |',
  '| --- | --- | --- | --- |',
  '| Story 1 happy: Given accepted artifacts, when land runs, then it commits. | 1 | "Given accepted artifacts, when land runs, then it commits." | diff-local |',
  '| Story 1 negative: Given an unaccepted artifact, when land runs, then it refuses. | 1 | "Given an unaccepted artifact, when land runs, then it refuses." | diff-local |',
  '',
].join('\n');

async function git(args: string[], cwd = repoPath): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout;
}

function options() {
  return { ownerConfig: { spec_owner: 'test-owner' } };
}

async function writeRecord(worktreePath: string, accepted: readonly ArtifactDigest[]): Promise<void> {
  const base: RunRecord = {
    schemaVersion: 1,
    slug: SLUG,
    steps: {},
    needsReconfirm: [],
    ownerHistory: [],
    notes: {},
  };
  const acceptance = { actor: 'operator', provider: 'codex', decisions: [], openQuestions: [] };
  const explore = recordAcceptance(base, { ...acceptance, step: 'explore', at: '2026-11-08T12:00:00.000Z', artifacts: accepted.filter(({ path }) => path.startsWith('.docs/track/')) });
  const complexity = recordAcceptance(explore, { ...acceptance, step: 'complexity', at: '2026-11-08T12:01:00.000Z', artifacts: accepted.filter(({ path }) => path.startsWith('.docs/complexity/')) });
  const storiesAccepted = recordAcceptance(complexity, { ...acceptance, step: 'stories', at: '2026-11-08T12:02:00.000Z', artifacts: accepted.filter(({ path }) => path.startsWith('.docs/stories/')) });
  const record = recordAcceptance(storiesAccepted, { ...acceptance, step: 'plan', at: '2026-11-08T12:03:00.000Z', artifacts: accepted.filter(({ path }) => path.startsWith('.docs/plans/')) });
  await mkdir(join(worktreePath, '.docs', 'composer-runs'), { recursive: true });
  await writeFile(join(worktreePath, RECORD_PATH), serializeRunRecord(record));
}

async function currentDigests(worktreePath: string): Promise<ArtifactDigest[]> {
  const paths = [
    `.docs/track/${SLUG}.md`,
    `.docs/complexity/${SLUG}.md`,
    `.docs/stories/${SLUG}.md`,
    `.docs/plans/${SLUG}.md`,
  ];
  return Promise.all(paths.map(async (path) => digestArtifact(path, await readFile(join(worktreePath, path)))));
}

async function seedWorktree(): Promise<string> {
  const { worktreePath } = await createEngineerWorktree(repoPath, IDEA);
  await Promise.all([
    mkdir(join(worktreePath, '.docs', 'track'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'complexity'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'stories'), { recursive: true }),
    mkdir(join(worktreePath, '.docs', 'plans'), { recursive: true }),
  ]);
  await Promise.all([
    writeFile(join(worktreePath, '.docs', 'track', `${SLUG}.md`), '# Track\n\nTrack: technical\n'),
    writeFile(join(worktreePath, '.docs', 'complexity', `${SLUG}.md`), '# Complexity\n\nTier: S\n'),
    writeFile(join(worktreePath, '.docs', 'stories', `${SLUG}.md`), stories),
    writeFile(join(worktreePath, '.docs', 'plans', `${SLUG}.md`), plan),
  ]);
  return worktreePath;
}

async function checkpoint(worktreePath: string): Promise<void> {
  await git(['add', '.docs'], worktreePath);
  await git(['commit', '-m', 'checkpoint Composer run'], worktreePath);
}

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'land-spec-run-record-'));
  await git(['init', '-b', 'main', '-q']);
  await git(['config', 'user.email', 'test@example.test']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repoPath, 'README.md'), '# repo\n');
  await git(['add', 'README.md']);
  await git(['commit', '-m', 'init']);
});

afterEach(async () => { await rm(repoPath, { recursive: true, force: true }); });

describe('landSpec Composer run-record gate', () => {
  it('refuses unaccepted track or complexity artifacts without committing', async () => {
    for (const directory of ['track', 'complexity']) {
      const worktreePath = await seedWorktree();
      await writeRecord(worktreePath, (await currentDigests(worktreePath)).filter(({ path }) => !path.startsWith(`.docs/${directory}/`)));
      await checkpoint(worktreePath);
      const before = (await git(['rev-parse', 'HEAD'], worktreePath)).trim();

      const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options())
        .catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(LandGateError);
      expect(error).toMatchObject({ gate: 'unaccepted-draft' });
      expect((error as Error).message).toContain(`.docs/${directory}/${SLUG}.md`);
      expect((await git(['rev-parse', 'HEAD'], worktreePath)).trim()).toBe(before);
    }
  });

  it('strips a fully accepted run record in the landing commit', async () => {
    const worktreePath = await seedWorktree();
    await writeRecord(worktreePath, await currentDigests(worktreePath));
    await checkpoint(worktreePath);

    await expect(landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options())).resolves.toMatchObject({ slug: SLUG });

    await expect(git(['show', `HEAD:${RECORD_PATH}`], worktreePath)).rejects.toMatchObject({ code: 128 });
    expect(await git(['show', '--name-status', '--format=', 'HEAD'], worktreePath)).toContain(`D\t${RECORD_PATH}`);
  });

  it('uses the strip parent record to refuse a post-strip edit', async () => {
    const worktreePath = await seedWorktree();
    await writeRecord(worktreePath, await currentDigests(worktreePath));
    await checkpoint(worktreePath);
    await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options());
    await writeFile(join(worktreePath, '.docs', 'stories', `${SLUG}.md`), `${stories}\nEdited after land.\n`);
    await git(['add', `.docs/stories/${SLUG}.md`], worktreePath);
    await git(['commit', '-m', 'edit stories after strip'], worktreePath);
    const before = (await git(['rev-parse', 'HEAD'], worktreePath)).trim();

    const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options())
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(LandGateError);
    expect(error).toMatchObject({ gate: 'unaccepted-draft' });
    expect((error as Error).message).toContain(`.docs/stories/${SLUG}.md`);
    expect((error as Error).message).toMatch(/stories.*draft/i);
    expect((error as Error).message).toMatch(/plan.*reconfirm/i);
    expect((await git(['rev-parse', 'HEAD'], worktreePath)).trim()).toBe(before);
  });

  it('refuses a plan that needs reconfirmation after saved draft stories are edited and re-accepted', async () => {
    const worktreePath = await seedWorktree();
    await writeRecord(worktreePath, await currentDigests(worktreePath));
    const recordPath = join(worktreePath, RECORD_PATH);
    const accepted = parseRunRecord(await readFile(recordPath, 'utf8'));
    const savedDraft = recordDraft(accepted, 'stories');
    expect(savedDraft.steps.stories).toEqual({ state: 'draft' });

    await writeFile(join(worktreePath, '.docs', 'stories', `${SLUG}.md`), `${stories}\nEdited before re-acceptance.\n`);
    const editedStories = digestArtifact(`.docs/stories/${SLUG}.md`, await readFile(join(worktreePath, '.docs', 'stories', `${SLUG}.md`)));
    const reaccepted = recordAcceptance(savedDraft, {
      step: 'stories',
      actor: 'operator',
      provider: 'codex',
      at: '2026-11-08T12:04:00.000Z',
      artifacts: [editedStories],
      decisions: [],
      openQuestions: [],
    });
    await mkdir(join(worktreePath, '.docs', 'composer-runs'), { recursive: true });
    await writeFile(recordPath, serializeRunRecord(reaccepted));
    await checkpoint(worktreePath);
    const before = (await git(['rev-parse', 'HEAD'], worktreePath)).trim();

    const error = await landSpec({ name: 'repo', canonicalPath: repoPath }, IDEA, worktreePath, undefined, options())
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(LandGateError);
    expect(error).toMatchObject({ gate: 'unaccepted-draft' });
    expect((error as Error).message).toMatch(/plan.*reconfirm/i);
    expect((await git(['rev-parse', 'HEAD'], worktreePath)).trim()).toBe(before);
  });
});
