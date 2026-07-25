import { describe, it, expect, afterEach } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { execFile as execFileCb } from 'node:child_process';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { promisify } from 'node:util';

import { evaluateShipmentEvidence } from '../../src/engine/shipment-evidence.js';
import { renderShippedRecord, specHash } from '../../src/engine/shipped-record.js';
import { initTestRepo } from '../fixtures/git-repo.js';

const execFile = promisify(execFileCb);
const scratchDirs: string[] = [];

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
});
