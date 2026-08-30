import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { evaluateShipmentEvidence } from '../../src/engine/shipment-evidence.js';
import { renderShippedRecord, specHash } from '../../src/engine/shipped-record.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const execFile = promisify(execFileCb);
const scratchDirs: string[] = [];
const refusalPlan = '# Durable evidence\r\n';
const refusalHash = specHash(Buffer.from(refusalPlan), null).digest;

afterEach(async () => {
  await Promise.all(scratchDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe('evaluateShipmentEvidence', () => {
  it('resolves the stories half through a markdown-link Stories reference, matching the writer', async () => {
    // The regression: `**Stories:** [label](path)` captured the LABEL. The
    // shipped-record writer failed to open `[label` on the filesystem and fell
    // back to the slug stem, hashing plan + stories; the validator ran
    // `git show <commit>:[label`, which git resolves as a glob pathspec and
    // exits 0 with zero bytes, so it hashed plan + nothing. Every finish then
    // refused with shipped-record-hash-mismatch.
    const repoDir = await mkdtemp(join(tmpdir(), 'shipment-evidence-stories-link-'));
    scratchDirs.push(repoDir);
    const slug = 'linked-stories';
    const pr = 'https://github.com/acme/conductor/pull/2080';
    const stories = '# Stories\n\nS1 the criterion.\n';
    const plan = `# Linked stories\n\n**Stories:** [accepted stories](../stories/${slug}.md)\n`;
    // The record is written with the hash the WRITER computes: plan + stories.
    const hash = specHash(Buffer.from(plan), Buffer.from(stories)).digest;

    await initTestRepo(repoDir);
    await mkdir(join(repoDir, '.docs/plans'), { recursive: true });
    await mkdir(join(repoDir, '.docs/stories'), { recursive: true });
    await mkdir(join(repoDir, '.docs/shipped'), { recursive: true });
    await writeFile(join(repoDir, `.docs/plans/${slug}.md`), plan);
    await writeFile(join(repoDir, `.docs/stories/${slug}.md`), stories);
    await writeFile(
      join(repoDir, `.docs/shipped/${slug}.md`),
      renderShippedRecord({ slug, specHash: hash, pr, shipped: '2026-08-30' }),
    );
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'feat: linked stories'], { cwd: repoDir });
    const { stdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: repoDir });
    const commit = stdout.trim();

    const verdict = await evaluateShipmentEvidence(
      { repoDir, slug, implementationPr: pr, candidateCommit: commit },
      { githubRunner: async () => ({ url: pr, headRefOid: commit }) },
    );

    expect(verdict).toMatchObject({ kind: 'valid', slug, pr, hash });
  });

  it('returns the exact checked durable evidence for a pushed record on the candidate commit', async () => {
    const repoDir = await mkdtemp(join(tmpdir(), 'shipment-evidence-valid-'));
    scratchDirs.push(repoDir);
    const slug = 'durable-evidence';
    const pr = 'https://github.com/acme/conductor/pull/916';
    const plan = '# Durable evidence\r\n';
    const hash = specHash(Buffer.from(plan), null).digest;

    await initTestRepo(repoDir);
    await mkdir(join(repoDir, '.docs/plans'), { recursive: true });
    await mkdir(join(repoDir, '.docs/shipped'), { recursive: true });
    await writeFile(join(repoDir, `.docs/plans/${slug}.md`), plan);
    await writeFile(
      join(repoDir, `.docs/shipped/${slug}.md`),
      renderShippedRecord({ slug, specHash: hash, pr, shipped: '2026-07-25' }),
    );
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'feat: add durable evidence'], { cwd: repoDir });
    const { stdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: repoDir });
    const commit = stdout.trim();

    const remote = join(repoDir, 'origin.git');
    await execFile('git', ['init', '--bare', '--initial-branch=main', remote], { cwd: repoDir });
    await execFile('git', ['remote', 'add', 'origin', remote], { cwd: repoDir });
    await execFile('git', ['push', '-u', 'origin', 'main'], { cwd: repoDir });

    const githubRunner = async () => ({ url: pr, headRefOid: commit });
    const verdict = await evaluateShipmentEvidence(
      {
        repoDir,
        slug,
        implementationPr: pr,
        candidateCommit: commit,
      },
      { githubRunner },
    );

    expect(verdict).toEqual({
      kind: 'valid',
      slug,
      pr,
      recordPath: `.docs/shipped/${slug}.md`,
      hash,
      commit,
    });

    const repeatedVerdict = await evaluateShipmentEvidence(
      {
        repoDir,
        slug,
        implementationPr: pr,
        candidateCommit: commit,
      },
      { githubRunner },
    );

    expect(repeatedVerdict).toEqual(verdict);
  });

  it('validates the date-prefixed record when feature state supplies the plan suffix', async () => {
    const repoDir = await mkdtemp(join(tmpdir(), 'shipment-evidence-dated-identity-'));
    scratchDirs.push(repoDir);
    const requestedSlug = 'durable-shipped-record-enforcement-and-backfill-916-936';
    const slug = `2026-07-25-${requestedSlug}`;
    const pr = 'https://github.com/acme/conductor/pull/958';
    const plan = '# Durable evidence\n';
    const hash = specHash(Buffer.from(plan), null).digest;

    await initTestRepo(repoDir);
    await mkdir(join(repoDir, '.docs/plans'), { recursive: true });
    await mkdir(join(repoDir, '.docs/shipped'), { recursive: true });
    await writeFile(join(repoDir, `.docs/plans/${slug}.md`), plan);
    await writeFile(
      join(repoDir, `.docs/shipped/${slug}.md`),
      renderShippedRecord({ slug, specHash: hash, pr, shipped: '2026-07-26' }),
    );
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'feat: add dated durable evidence'], { cwd: repoDir });
    const { stdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: repoDir });
    const commit = stdout.trim();

    await expect(
      evaluateShipmentEvidence(
        { repoDir, slug: requestedSlug, implementationPr: pr, candidateCommit: commit },
        { githubRunner: async () => ({ url: pr, headRefOid: commit }) },
      ),
    ).resolves.toEqual({
      kind: 'valid',
      slug,
      pr,
      recordPath: `.docs/shipped/${slug}.md`,
      hash,
      commit,
    });
  });

  // #2008. FINISH publishes the PR at the commit that carries the durable
  // record, and the conductor's post-finish cost refresh then commits and
  // pushes a second shipped-record commit. The daemon audits ~1s later, so the
  // candidate is that refresh commit while the PR object still reports the
  // pre-refresh head — the branch is legitimately AHEAD of the reported head.
  // The ship is real, and what proves it is that the commit the PR merges
  // carries the record. The negative half of this pair is the `it.each` case
  // "a committed candidate not pushed to the implementation head": same
  // ahead-of-head shape, no record on the head, still refused.
  it('accepts a candidate that advanced past the reported head when that head carries the record', async () => {
    const repoDir = await mkdtemp(join(tmpdir(), 'shipment-evidence-post-finish-refresh-'));
    scratchDirs.push(repoDir);
    const slug = 'durable-evidence';
    const pr = 'https://github.com/acme/conductor/pull/2004';
    const plan = '# Durable evidence\n';
    const hash = specHash(Buffer.from(plan), null).digest;
    const recordPath = join(repoDir, `.docs/shipped/${slug}.md`);
    const record = renderShippedRecord({ slug, specHash: hash, pr, shipped: '2026-08-28' });

    await initTestRepo(repoDir);
    await mkdir(join(repoDir, '.docs/plans'), { recursive: true });
    await mkdir(join(repoDir, '.docs/shipped'), { recursive: true });
    await writeFile(join(repoDir, `.docs/plans/${slug}.md`), plan);
    await writeFile(recordPath, `${record}\n## Time\nstate: partial\n`);
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', `shipped record: ${slug}`], { cwd: repoDir });
    const { stdout: publishedStdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: repoDir });
    const publishedHead = publishedStdout.trim();

    // The post-finish refresh rewrites only the measured cost/time block; the
    // frontmatter the evaluator hashes is byte-identical.
    await writeFile(recordPath, `${record}\n## Time\nstate: measured\nactive_ms: 3935009\n`);
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', `shipped record: ${slug}`], { cwd: repoDir });
    const { stdout: refreshedStdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: repoDir });
    const candidateCommit = refreshedStdout.trim();

    await expect(
      evaluateShipmentEvidence(
        { repoDir, slug, implementationPr: pr, candidateCommit },
        { githubRunner: async () => ({ url: pr, headRefOid: publishedHead }) },
      ),
    ).resolves.toEqual({
      kind: 'valid',
      slug,
      pr,
      recordPath: `.docs/shipped/${slug}.md`,
      hash,
      commit: publishedHead,
    });
  });

  it('refuses a candidate that advanced past a head whose record binds a different PR', async () => {
    const repoDir = await mkdtemp(join(tmpdir(), 'shipment-evidence-head-record-foreign-'));
    scratchDirs.push(repoDir);
    const slug = 'durable-evidence';
    const pr = 'https://github.com/acme/conductor/pull/2004';
    const otherPr = 'https://github.com/acme/conductor/pull/1999';
    const plan = '# Durable evidence\n';
    const hash = specHash(Buffer.from(plan), null).digest;
    const recordPath = join(repoDir, `.docs/shipped/${slug}.md`);

    await initTestRepo(repoDir);
    await mkdir(join(repoDir, '.docs/plans'), { recursive: true });
    await mkdir(join(repoDir, '.docs/shipped'), { recursive: true });
    await writeFile(join(repoDir, `.docs/plans/${slug}.md`), plan);
    await writeFile(
      recordPath,
      renderShippedRecord({ slug, specHash: hash, pr: otherPr, shipped: '2026-08-28' }),
    );
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'test: record binding a foreign PR'], { cwd: repoDir });
    const { stdout: headStdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: repoDir });
    const publishedHead = headStdout.trim();

    await writeFile(recordPath, renderShippedRecord({ slug, specHash: hash, pr, shipped: '2026-08-28' }));
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'test: rebind the record locally'], { cwd: repoDir });
    const { stdout: candidateStdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: repoDir });
    const candidateCommit = candidateStdout.trim();

    await expect(
      evaluateShipmentEvidence(
        { repoDir, slug, implementationPr: pr, candidateCommit },
        { githubRunner: async () => ({ url: pr, headRefOid: publishedHead }) },
      ),
    ).resolves.toEqual({
      kind: 'refusal',
      code: 'shipment-candidate-not-on-implementation-head',
      expected: publishedHead,
      observed: candidateCommit,
    });
  });

  it('refuses a candidate when the implementation PR binding reports a different head', async () => {
    const repoDir = await mkdtemp(join(tmpdir(), 'shipment-evidence-pr-head-mismatch-'));
    scratchDirs.push(repoDir);
    const slug = 'durable-evidence';
    const pr = 'https://github.com/acme/conductor/pull/916';
    const plan = '# Durable evidence\r\n';
    const hash = specHash(Buffer.from(plan), null).digest;

    await initTestRepo(repoDir);
    await mkdir(join(repoDir, '.docs/plans'), { recursive: true });
    await mkdir(join(repoDir, '.docs/shipped'), { recursive: true });
    await writeFile(join(repoDir, `.docs/plans/${slug}.md`), plan);
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'test: add durable evidence plan'], { cwd: repoDir });
    await execFile('git', ['branch', 'implementation-pr'], { cwd: repoDir });
    await writeFile(
      join(repoDir, `.docs/shipped/${slug}.md`),
      renderShippedRecord({ slug, specHash: hash, pr, shipped: '2026-07-25' }),
    );
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'feat: add durable evidence'], { cwd: repoDir });
    const { stdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: repoDir });
    const candidateCommit = stdout.trim();

    const remote = join(repoDir, 'origin.git');
    await execFile('git', ['init', '--bare', '--initial-branch=main', remote], { cwd: repoDir });
    await execFile('git', ['remote', 'add', 'origin', remote], { cwd: repoDir });
    await execFile('git', ['push', '-u', 'origin', 'main'], { cwd: repoDir });

    await execFile('git', ['checkout', 'implementation-pr'], { cwd: repoDir });
    await writeFile(join(repoDir, 'implementation.ts'), 'export const implementation = true;\n');
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'feat: advance implementation PR separately'], { cwd: repoDir });
    await execFile('git', ['push', '-u', 'origin', 'implementation-pr'], { cwd: repoDir });
    const { stdout: prHeadStdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: repoDir });
    const prHead = prHeadStdout.trim();

    const githubRunner = async () => ({ url: pr, headRefOid: prHead });
    const verdict = await evaluateShipmentEvidence(
      {
        repoDir,
        slug,
        implementationPr: pr,
        candidateCommit,
      },
      { githubRunner },
    );

    expect(verdict).toMatchObject({
      kind: 'refusal',
      code: 'shipment-candidate-not-on-implementation-head',
    });
  });

  it.each([
    {
      name: 'absent record',
      record: undefined,
      expected: {
        kind: 'refusal',
        code: 'shipped-record-missing',
        expected: '.docs/shipped/durable-evidence.md',
        observed: null,
      },
    },
    {
      name: 'malformed record',
      record: '# this is not shipped-record frontmatter\n',
      expected: {
        kind: 'refusal',
        code: 'shipped-record-malformed',
        expected: 'parseable shipped record',
        observed: 'malformed',
      },
    },
    {
      name: 'incomplete record',
      record: `---\nslug: durable-evidence\nspec_hash: hash\npr: https://github.com/acme/conductor/pull/916\n---\n`,
      expected: {
        kind: 'refusal',
        code: 'shipped-record-incomplete',
        expected: 'shipped',
        observed: null,
      },
    },
    {
      name: 'slug mismatch',
      record: ({ hash, pr }: { hash: string; pr: string }) =>
        renderShippedRecord({ slug: 'other-evidence', specHash: hash, pr, shipped: '2026-07-25' }),
      expected: {
        kind: 'refusal',
        code: 'shipped-record-slug-mismatch',
        expected: 'durable-evidence',
        observed: 'other-evidence',
      },
    },
    {
      name: 'PR mismatch',
      record: ({ hash }: { hash: string }) =>
        renderShippedRecord({
          slug: 'durable-evidence',
          specHash: hash,
          pr: 'https://github.com/acme/conductor/pull/917',
          shipped: '2026-07-25',
        }),
      expected: {
        kind: 'refusal',
        code: 'shipped-record-pr-mismatch',
        expected: 'https://github.com/acme/conductor/pull/916',
        observed: 'https://github.com/acme/conductor/pull/917',
      },
    },
    {
      name: 'canonical hash mismatch',
      record: ({ pr }: { hash: string; pr: string }) =>
        renderShippedRecord({
          slug: 'durable-evidence',
          specHash: '0'.repeat(64),
          pr,
          shipped: '2026-07-25',
        }),
      expected: {
        kind: 'refusal',
        code: 'shipped-record-hash-mismatch',
        expected: refusalHash,
        observed: '0'.repeat(64),
      },
    },
  ])('refuses a $name without mutating its committed record', async ({ record, expected }) => {
    const repoDir = await mkdtemp(join(tmpdir(), 'shipment-evidence-refusal-'));
    scratchDirs.push(repoDir);
    const slug = 'durable-evidence';
    const pr = 'https://github.com/acme/conductor/pull/916';
    const plan = refusalPlan;
    const hash = refusalHash;
    const recordPath = join(repoDir, `.docs/shipped/${slug}.md`);

    await initTestRepo(repoDir);
    await mkdir(join(repoDir, '.docs/plans'), { recursive: true });
    await mkdir(join(repoDir, '.docs/shipped'), { recursive: true });
    await writeFile(join(repoDir, `.docs/plans/${slug}.md`), plan);
    if (record !== undefined) {
      await writeFile(recordPath, typeof record === 'function' ? record({ hash, pr }) : record);
    }
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'test: add shipment evidence refusal fixture'], { cwd: repoDir });
    const { stdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: repoDir });
    const candidateCommit = stdout.trim();

    const recordBytes = record === undefined ? null : await readFile(recordPath);
    const input = {
      repoDir,
      slug,
      implementationPr: pr,
      candidateCommit,
      implementationHead: 'origin/main',
    };

    const verdict = await evaluateShipmentEvidence(input);
    expect(verdict).toEqual(expected);
    expect(await evaluateShipmentEvidence(input)).toEqual(verdict);
    expect(record === undefined ? null : await readFile(recordPath)).toEqual(recordBytes);
  });

  it.each([
    {
      name: 'a working-tree-only record',
      prepare: async (repoDir: string, recordPath: string, record: string) => {
        await writeFile(recordPath, record);
      },
      expected: (candidateCommit: string) => ({
        kind: 'refusal',
        code: 'shipped-record-not-in-candidate',
        expected: candidateCommit,
        observed: 'working-tree-only',
      }),
    },
    {
      name: 'a committed candidate not pushed to the implementation head',
      prepare: async (repoDir: string, recordPath: string, record: string) => {
        await writeFile(recordPath, record);
        await execFile('git', ['add', '.'], { cwd: repoDir });
        await execFile('git', ['commit', '-m', 'test: add local shipment record'], { cwd: repoDir });
      },
      expected: (candidateCommit: string) => ({
        kind: 'refusal',
        code: 'shipment-candidate-not-on-implementation-head',
        expected: 'origin/main',
        observed: candidateCommit,
      }),
    },
    {
      name: 'a stale candidate behind the implementation head',
      prepare: async (repoDir: string, recordPath: string, record: string) => {
        await writeFile(recordPath, record);
        await execFile('git', ['add', '.'], { cwd: repoDir });
        await execFile('git', ['commit', '-m', 'test: add shipment record'], { cwd: repoDir });
        await execFile('git', ['push', 'origin', 'main'], { cwd: repoDir });
      },
      afterCandidate: async (repoDir: string) => {
        await writeFile(join(repoDir, 'implementation.ts'), 'export const current = true;\n');
        await execFile('git', ['add', '.'], { cwd: repoDir });
        await execFile('git', ['commit', '-m', 'feat: advance implementation'], { cwd: repoDir });
        await execFile('git', ['push', 'origin', 'main'], { cwd: repoDir });
      },
      expected: (candidateCommit: string) => ({
        kind: 'refusal',
        code: 'shipment-candidate-stale',
        expected: 'origin/main',
        observed: candidateCommit,
      }),
    },
    {
      name: 'a file dependency failure',
      dependencies: {
        readFile: async () => {
          throw new Error('EIO: durable record unavailable');
        },
      },
      expected: () => ({
        kind: 'refusal',
        code: 'shipment-evidence-file-unavailable',
        expected: '.docs/shipped/durable-evidence.md',
        observed: 'EIO: durable record unavailable',
      }),
    },
    {
      name: 'a Git runner failure',
      dependencies: {
        gitRunner: async () => {
          throw new Error('git transport unavailable');
        },
      },
      expected: () => ({
        kind: 'refusal',
        code: 'shipment-evidence-git-unavailable',
        expected: 'candidate-tree/head reachability',
        observed: 'git transport unavailable',
      }),
    },
    {
      name: 'a GitHub runner failure',
      dependencies: {
        githubRunner: async () => {
          throw new Error('GitHub API unavailable');
        },
      },
      expected: () => ({
        kind: 'refusal',
        code: 'shipment-evidence-github-unavailable',
        expected: 'https://github.com/acme/conductor/pull/916',
        observed: 'GitHub API unavailable',
      }),
    },
  ])('refuses $name read-only and deterministically', async ({ prepare, afterCandidate, dependencies, expected }) => {
    const repoDir = await mkdtemp(join(tmpdir(), 'shipment-evidence-reachability-'));
    scratchDirs.push(repoDir);
    const slug = 'durable-evidence';
    const pr = 'https://github.com/acme/conductor/pull/916';
    const recordPath = join(repoDir, `.docs/shipped/${slug}.md`);
    const record = renderShippedRecord({ slug, specHash: refusalHash, pr, shipped: '2026-07-25' });

    await initTestRepo(repoDir);
    await mkdir(join(repoDir, '.docs/plans'), { recursive: true });
    await mkdir(join(repoDir, '.docs/shipped'), { recursive: true });
    await writeFile(join(repoDir, `.docs/plans/${slug}.md`), refusalPlan);
    await execFile('git', ['add', '.'], { cwd: repoDir });
    await execFile('git', ['commit', '-m', 'test: add shipment plan'], { cwd: repoDir });

    const remote = join(repoDir, 'origin.git');
    await execFile('git', ['init', '--bare', '--initial-branch=main', remote], { cwd: repoDir });
    await execFile('git', ['remote', 'add', 'origin', remote], { cwd: repoDir });
    await execFile('git', ['push', '-u', 'origin', 'main'], { cwd: repoDir });

    if (prepare) {
      await prepare(repoDir, recordPath, record);
    } else {
      await writeFile(recordPath, record);
      await execFile('git', ['add', '.'], { cwd: repoDir });
      await execFile('git', ['commit', '-m', 'test: add shipment record'], { cwd: repoDir });
      await execFile('git', ['push', 'origin', 'main'], { cwd: repoDir });
    }
    const { stdout } = await execFile('git', ['rev-parse', 'HEAD'], { cwd: repoDir });
    const candidateCommit = stdout.trim();
    await afterCandidate?.(repoDir);

    const recordBytes = await readFile(recordPath);
    const repositoryState = await gitSnapshot(repoDir);
    const input = {
      repoDir,
      slug,
      implementationPr: pr,
      candidateCommit,
      implementationHead: 'origin/main',
    };

    const verdict = await evaluateShipmentEvidence(input, {
      githubRunner: async () => ({ url: pr, headRefOid: 'origin/main' }),
      ...dependencies,
    });
    expect(verdict).toEqual(expected(candidateCommit));
    expect(
      await evaluateShipmentEvidence(input, {
        githubRunner: async () => ({ url: pr, headRefOid: 'origin/main' }),
        ...dependencies,
      }),
    ).toEqual(verdict);
    expect(await readFile(recordPath)).toEqual(recordBytes);
    expect(await gitSnapshot(repoDir)).toEqual(repositoryState);
  });
});

async function gitSnapshot(repoDir: string): Promise<string> {
  const [{ stdout: status }, { stdout: refs }] = await Promise.all([
    execFile('git', ['status', '--porcelain'], { cwd: repoDir }),
    execFile('git', ['rev-parse', 'HEAD', 'origin/main'], { cwd: repoDir }),
  ]);
  return `${status}\n${refs}`;
}
