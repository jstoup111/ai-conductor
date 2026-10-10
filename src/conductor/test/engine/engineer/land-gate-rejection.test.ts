import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execFile as execFileCb } from 'node:child_process';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import {
  classifyLandGateRejection,
  landGateError,
  landSpec,
} from '../../../src/engine/engineer/land-spec.js';
import { createEngineerWorktree } from '../../../src/engine/engineer/worktree-authoring.js';
import { EVENT_SINKS } from '../../../src/engine/event-sinks.js';
import type { GhRunner } from '../../../src/engine/tracker-client.js';
import type { GitRunner } from '../../../src/engine/rebase.js';

const execFile = promisify(execFileCb);
let repoPath: string;

async function git(args: string[], cwd = repoPath): Promise<string> {
  return (await execFile('git', args, { cwd })).stdout.trim();
}

async function seedLandableWorktree(): Promise<string> {
  const { worktreePath } = await createEngineerWorktree(repoPath, 'dependency gate');
  await rm(join(worktreePath, '.docs', 'coherence'), { recursive: true, force: true });
  await Promise.all(['specs', 'stories', 'plans'].map((directory) => (
    mkdir(join(worktreePath, '.docs', directory), { recursive: true })
  )));
  await writeFile(join(worktreePath, '.docs/specs/dependency-gate.md'), '# PRD: dependency gate\n\nApproved.\n');
  await writeFile(join(worktreePath, '.docs/stories/dependency-gate.md'), [
    '# Stories: dependency gate',
    '',
    '**Status:** Accepted',
    '',
    '## Story 1: gate',
    '### Acceptance Criteria',
    '#### Happy Path',
    '- Given X, when Y, then Z.',
    '',
    '#### Negative Paths',
    '- Given invalid input, when land runs, then it refuses.',
    '',
  ].join('\n'));
  await writeFile(join(worktreePath, '.docs/plans/dependency-gate.md'), [
    '# Implementation Plan: dependency gate',
    '',
    '**Stories:** .docs/stories/dependency-gate.md',
    '',
    '## Task Dependency Graph',
    '```',
    '1',
    '```',
    '',
  ].join('\n'));
  return worktreePath;
}

/** Records the tracker and git proposal reads while returning a controlled result. */
function recordingDependencyProposalDouble({ unavailable = false }: { unavailable?: boolean } = {}): {
  gh: GhRunner;
  git: GitRunner;
  calls: string[];
} {
  const calls: string[] = [];
  return {
    calls,
    gh: async (args) => {
      const command = args.join(' ');
      calls.push(command);
      if (unavailable) throw new Error('tracker unavailable');
      if (command.includes('issue view 536') && command.includes('--json body')) {
        return { stdout: JSON.stringify({ body: 'Depends on #600.' }) };
      }
      if (command.includes('dependencies/blocked_by')) return { stdout: '[]' };
      if (command.includes('issue list')) return { stdout: '[]' };
      throw new Error(`unexpected tracker read: ${command}`);
    },
    git: async (args) => {
      calls.push(`git ${args.join(' ')}`);
      if (args[0] === 'for-each-ref') return { exitCode: 0, stdout: '', stderr: '' };
      throw new Error(`unexpected git read: ${args.join(' ')}`);
    },
  };
}

beforeEach(async () => {
  repoPath = await mkdtemp(join(tmpdir(), 'land-gate-rejection-'));
  await git(['init', '-b', 'main', '-q']);
  await git(['config', 'user.email', 'test@example.test']);
  await git(['config', 'user.name', 'Test']);
  await writeFile(join(repoPath, 'README.md'), '# repo\n');
  await git(['add', 'README.md']);
  await git(['commit', '-m', 'init']);
});

afterEach(async () => {
  await rm(repoPath, { recursive: true, force: true });
});

describe('land-gate rejection classification', () => {
  it('preserves a closed gate identifier and its operator-facing reason', () => {
    const error = landGateError('stories-not-approved', 'stories must be accepted');

    expect(classifyLandGateRejection(error)).toEqual({
      gate: 'stories-not-approved',
      reason: 'stories must be accepted',
    });
    expect(error.message).toBe('stories must be accepted');
  });

  // Covers: task:8
  it.each([
    'plan-task-count',
    'adr-filename',
    'architecture-mermaid-missing',
  ] as const)(
    'classifies the %s gate with its stable identifier',
    (gate) => {
      expect(classifyLandGateRejection(landGateError(gate, 'unchanged message'))).toEqual({
        gate,
        reason: 'unchanged message',
      });
    },
  );

  it.each([
    {
      name: 'leaves a proposed dependency undecided',
      gate: 'dependency-proposals-undecided',
      options: {},
    },
    {
      name: 'cannot read dependency proposals without a skip acknowledgement',
      gate: 'dependency-check-unavailable',
      options: { unavailable: true },
    },
    {
      name: 'receives a contradictory dependency decision',
      gate: 'dependency-decisions-invalid',
      options: { acceptedDependencies: ['owner/repo#600'], declinedDependencies: ['owner/repo#600'] },
    },
  ] as const)('classifies the real dependency gate when it $name', async ({ gate, options }) => {
    const worktreePath = await seedLandableWorktree();
    const proposal = recordingDependencyProposalDouble('unavailable' in options ? options : undefined);
    const error = await landSpec(
      { name: 'target', canonicalPath: repoPath },
      'dependency gate',
      worktreePath,
      'owner/repo#536',
      {
        ownerConfig: { spec_owner: 'operator' },
        gh: proposal.gh,
        dependencyGit: proposal.git,
        ...options,
      },
    ).catch((reason: unknown) => reason);

    expect(proposal.calls.length).toBeGreaterThan(0);
    expect(error).toBeInstanceOf(Error);
    expect(classifyLandGateRejection(error)).toMatchObject({ gate });
    expect(classifyLandGateRejection(error).gate).not.toBe('unclassified');
  });

  it('classifies unexpected failures as unclassified', () => {
    expect(classifyLandGateRejection(new Error('unexpected')).gate).toBe('unclassified');
  });

  it('caps only the recorded reason and marks the truncation', () => {
    const error = new Error('x'.repeat(1_100));
    const rejection = classifyLandGateRejection(error);

    expect(rejection.reason).toHaveLength(1_000);
    expect(rejection.reason.endsWith('… [truncated]')).toBe(true);
    expect(error.message).toHaveLength(1_100);
    expect(Buffer.byteLength(JSON.stringify({
      type: 'land_gate_rejected',
      ...rejection,
      project: 'project-name',
      worktreePath: '/tmp/worktree',
      sourceRef: 'owner/repo#123',
      ts: new Date().toISOString(),
    }))).toBeLessThan(4_096);
  });

  it('persists rejection events without rendering, auditing, or exporting them', () => {
    expect(EVENT_SINKS.land_gate_rejected).toEqual({
      render: false,
      persist: true,
      audit: false,
      otel: false,
    });
  });
});
