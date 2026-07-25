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

    const verdict = await evaluateShipmentEvidence({
      repoDir,
      slug,
      implementationPr: pr,
      candidateCommit: commit,
      implementationHead: 'origin/main',
    });

    expect(verdict).toEqual({
      kind: 'valid',
      slug,
      pr,
      recordPath: `.docs/shipped/${slug}.md`,
      hash,
      commit,
    });

    const repeatedVerdict = await evaluateShipmentEvidence({
      repoDir,
      slug,
      implementationPr: pr,
      candidateCommit: commit,
      implementationHead: 'origin/main',
    });

    expect(repeatedVerdict).toEqual(verdict);
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
});
