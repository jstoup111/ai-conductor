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
