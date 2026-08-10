/**
 * Acceptance specs for "Operator-audited reseal of a protected DECIDE artifact" (#1281).
 *
 * Stories: `.docs/stories/no-operator-command-to-reseal-a-protected-decide-a.md`
 * Plan:    `.docs/plans/no-operator-command-to-reseal-a-protected-decide-a.md`
 * ADRs:    `adr-2026-08-09-operator-only-scoped-artifact-reseal` and
 *          `adr-2026-08-09-reseal-audit-rides-the-existing-event-spine` (APPROVED)
 *
 * Story-flow classification (writing-system-tests §3a):
 * - Stories 1 and 4's parser/help assertions are single-operation contracts owned by TDD.
 * - Stories 2, 3, 5, 6, 7, and 8 cross the public reseal dispatch, real Git/seal state,
 *   verification, audit, and/or halt retirement boundaries and are acceptance-covered here.
 *
 * Real entry points and adversarial call sites (writing-system-tests §3b/§3d):
 * 1. `dispatchResealCommand` is the operator command's production dispatcher. The in-process
 *    calls below use only its injectable terminal/output seams while retaining real Git, seal,
 *    audit, and halt-marker behavior.
 * 2. `bin/conduct-ts reseal` is the production pre-boot CLI path. The child-process cases prove
 *    command-table/index wiring and the non-TTY build-agent boundary without importing the new
 *    primitive directly.
 * 3. `verifyProtectedArtifactSeal` is the existing BUILD-entry guard. Post-reseal assertions
 *    drive it with real committed content so a helper-only implementation cannot pass.
 *
 * RED strategy: `reseal-cli.ts` does not exist before implementation. It is dynamically imported
 * from inside each relevant test so Vitest collects and executes the file; failures are ordinary
 * test failures naming the missing implementation, never collection errors or skipped specs.
 *
 * Verify-claims: all asserted behavior and field names below are pinned by the accepted stories,
 * plan, or ADRs. The dispatcher dependency-object shape follows the repository's existing CLI
 * convention and the plan's required injectable interactivity seam; it is test plumbing, not a
 * product assertion. No unconfirmed load-bearing assumption remains.
 */

import { execFile as execFileCb } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { execa } from 'execa';

import {
  createProtectedArtifactSeal,
  PROTECTED_ARTIFACT_SEAL_PATH,
  verifyProtectedArtifactSeal,
  type ProtectedArtifactSeal,
} from '../../src/engine/protected-artifact-seal.js';
import {
  HALT_CLASS_MARKER,
  HALT_MARKER,
  PROTECTED_ARTIFACT_HALT_CLASS,
} from '../../src/engine/halt-marker.js';
import { HALT_CLEARED_MARKER } from '../../src/engine/daemon-rekick.js';

const execFile = promisify(execFileCb);
const REPO_ROOT = join(process.cwd(), '..', '..');
const REAL_CONDUCT_TS = join(REPO_ROOT, 'bin', 'conduct-ts');
const RESEAL_MODULE = '../../src/engine/reseal-cli.js';
const SLUG = 'operator-reseal-fixture';
const P1 = '.docs/plans/recoverable-plan.md';
const P2 = '.docs/stories/unrelated-story.md';

interface ResealDispatch {
  kind: 'reseal';
  slug: string;
  paths: string[];
  reason: string;
  clearHalt: boolean;
}

interface ResealDependencies {
  cwd: string;
  isInteractive: boolean;
  out: (line: string) => void;
  err: (line: string) => void;
}

interface ResealModule {
  detectResealCommand(argv: string[]): ResealDispatch | null;
  dispatchResealCommand(command: ResealDispatch, deps: ResealDependencies): Promise<number>;
}

interface Fixture {
  root: string;
  worktree: string;
  git(args: string[]): Promise<string>;
  baseline: string;
}

let fixture: Fixture;
const scratchRoots: string[] = [];

function fingerprint(content: string): string {
  return `sha256:${createHash('sha256').update(content).digest('hex')}`;
}

async function exists(path: string): Promise<boolean> {
  return readFile(path).then(
    () => true,
    () => false,
  );
}

async function writeRepoFile(root: string, path: string, content: string): Promise<void> {
  const target = join(root, path);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content, 'utf8');
}

async function makeFixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'operator-reseal-acceptance-'));
  scratchRoots.push(root);
  const worktree = join(root, '.worktrees', SLUG);
  await mkdir(worktree, { recursive: true });
  const git = async (args: string[]): Promise<string> => {
    const { stdout } = await execFile('git', args, { cwd: worktree });
    return stdout.trim();
  };

  await git(['init', '-q', '-b', 'main']);
  await git(['config', 'user.email', 'acceptance@example.test']);
  await git(['config', 'user.name', 'Acceptance Test']);
  await git(['config', 'commit.gpgsign', 'false']);
  await writeRepoFile(worktree, '.gitignore', '.pipeline/\n');
  await writeRepoFile(worktree, P1, 'plan v1\n');
  await writeRepoFile(worktree, P2, 'story v1\n');
  await git(['add', '.']);
  await git(['commit', '-q', '-m', 'decide: approve artifacts']);
  const baseline = await git(['rev-parse', 'HEAD']);
  await createProtectedArtifactSeal({ projectRoot: worktree, baselineCommit: baseline });
  await git(['checkout', '-q', '-b', 'feat/operator-reseal']);
  return { root, worktree, git, baseline };
}

async function commitChanges(changes: Record<string, string>, message: string): Promise<string> {
  for (const [path, content] of Object.entries(changes)) {
    await writeRepoFile(fixture.worktree, path, content);
  }
  await fixture.git(['add', '.']);
  await fixture.git(['commit', '-q', '-m', message]);
  return fixture.git(['rev-parse', 'HEAD']);
}

async function loadResealModule(): Promise<ResealModule> {
  const mod = (await import(RESEAL_MODULE)) as Partial<ResealModule>;
  if (
    typeof mod.detectResealCommand !== 'function' ||
    typeof mod.dispatchResealCommand !== 'function'
  ) {
    throw new Error('reseal-cli.ts does not expose the planned detector and dispatcher');
  }
  return mod as ResealModule;
}

async function dispatchReseal(options: {
  paths?: string[];
  reason?: string;
  clearHalt?: boolean;
  interactive?: boolean;
} = {}): Promise<{ code: number; stdout: string[]; stderr: string[] }> {
  const mod = await loadResealModule();
  const argv = [
    'node',
    'conduct',
    'reseal',
    '--slug',
    SLUG,
    ...((options.paths ?? [P1]).flatMap((path) => ['--path', path])),
    '--reason',
    options.reason ?? 'operator approved corrected DECIDE artifact',
    ...(options.clearHalt ? ['--clear-halt'] : []),
  ];
  const command = mod.detectResealCommand(argv);
  if (!command) throw new Error(`valid reseal argv was not detected: ${argv.join(' ')}`);
  const stdout: string[] = [];
  const stderr: string[] = [];
  const code = await mod.dispatchResealCommand(command, {
    cwd: fixture.root,
    isInteractive: options.interactive ?? true,
    out: (line) => stdout.push(line),
    err: (line) => stderr.push(line),
  });
  return { code, stdout, stderr };
}

async function readSeal(): Promise<ProtectedArtifactSeal & {
  rebaselines: Array<ProtectedArtifactSeal['rebaselines'][number] & { reason?: string }>;
}> {
  return JSON.parse(
    await readFile(join(fixture.worktree, PROTECTED_ARTIFACT_SEAL_PATH), 'utf8'),
  ) as ProtectedArtifactSeal & {
    rebaselines: Array<ProtectedArtifactSeal['rebaselines'][number] & { reason?: string }>;
  };
}

function sealedFingerprint(seal: ProtectedArtifactSeal, path: string): string | undefined {
  return seal.protectedArtifacts.find((entry) => entry.path === path)?.fingerprint;
}

async function auditRecords(): Promise<Record<string, unknown>[]> {
  const text = await readFile(
    join(fixture.worktree, '.pipeline/audit-trail/events.jsonl'),
    'utf8',
  );
  return text.trim().split('\n').map((line) => JSON.parse(line) as Record<string, unknown>);
}

beforeEach(async () => {
  fixture = await makeFixture();
});

afterEach(async () => {
  while (scratchRoots.length > 0) {
    await rm(scratchRoots.pop()!, { recursive: true, force: true });
  }
});

describe('operator-audited scoped reseal (#1281)', () => {
  it('Stories 2, 6, and 8: reseals only P1, audits lineage and reason, then passes the real BUILD guard', async () => {
    const targetCommit = await commitChanges({ [P1]: 'plan v2 corrected\n' }, 'fix: correct plan');
    const before = await readSeal();
    const p2Before = sealedFingerprint(before, P2);

    const result = await dispatchReseal();

    expect(result.code).toBe(0);
    expect(result.stdout.join('\n')).toMatch(new RegExp(P1.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    const after = await readSeal();
    expect(after.protectedArtifacts.map((entry) => entry.path)).toEqual(
      before.protectedArtifacts.map((entry) => entry.path),
    );
    expect(sealedFingerprint(after, P1)).toBe(fingerprint('plan v2 corrected\n'));
    expect(sealedFingerprint(after, P2)).toBe(p2Before);
    expect(after.baselineCommit).toBe(targetCommit);
    expect(after.rebaselines.at(-1)).toMatchObject({
      fromCommit: fixture.baseline,
      toCommit: targetCommit,
      paths: [P1],
      reason: 'operator approved corrected DECIDE artifact',
    });

    const audit = await auditRecords();
    const resealRecord = audit.find((record) => /reseal/i.test(String(record.event)));
    expect(JSON.stringify(resealRecord)).toContain('operator approved corrected DECIDE artifact');
    expect(JSON.stringify(resealRecord)).toContain(P1);
    expect(JSON.stringify(resealRecord)).toContain(fixture.baseline);
    expect(JSON.stringify(resealRecord)).toContain(targetCommit);
    expect(JSON.stringify(resealRecord)).toContain('operator');

    await expect(verifyProtectedArtifactSeal({
      projectRoot: fixture.worktree,
      featureDesc: SLUG,
      baseBranch: 'main',
    })).resolves.toMatchObject({ ok: true });
  });

  it('Story 3: refuses all changes when an unnamed feature-authored artifact also drifted', async () => {
    await commitChanges(
      { [P1]: 'plan v2 corrected\n', [P2]: 'story changed by feature\n' },
      'build: change two sealed artifacts',
    );
    const before = await readFile(join(fixture.worktree, PROTECTED_ARTIFACT_SEAL_PATH), 'utf8');

    const result = await dispatchReseal({ paths: [P1] });

    expect(result.code).not.toBe(0);
    expect(result.stderr.join('\n')).toContain(P2);
    await expect(readFile(join(fixture.worktree, PROTECTED_ARTIFACT_SEAL_PATH), 'utf8'))
      .resolves.toBe(before);
    const audit = await auditRecords();
    expect(JSON.stringify(audit.at(-1))).toMatch(/reseal.*refus|refus.*reseal/i);
    expect(JSON.stringify(audit.at(-1))).toContain(P2);
  });

  it('Story 7: clears only a protected-artifact halt after a successful reseal', async () => {
    await commitChanges({ [P1]: 'plan v2 corrected\n' }, 'fix: correct halted plan');
    await mkdir(join(fixture.worktree, '.pipeline'), { recursive: true });
    await writeFile(join(fixture.worktree, HALT_MARKER), `Protected artifact changed: ${P1}\n`, 'utf8');
    await writeFile(
      join(fixture.worktree, HALT_CLASS_MARKER),
      PROTECTED_ARTIFACT_HALT_CLASS,
      'utf8',
    );

    const result = await dispatchReseal({ clearHalt: true });

    expect(result.code).toBe(0);
    expect(await exists(join(fixture.worktree, HALT_MARKER))).toBe(false);
    expect(await exists(join(fixture.worktree, HALT_CLASS_MARKER))).toBe(false);
    await expect(readFile(join(fixture.worktree, HALT_CLEARED_MARKER), 'utf8'))
      .resolves.toContain(`Protected artifact changed: ${P1}`);
  });

  it('Stories 5 and 8: a non-interactive step subprocess cannot reseal its own violation', async () => {
    await commitChanges({ [P1]: 'plan changed by build\n' }, 'build: mutate sealed plan');
    const before = await readFile(join(fixture.worktree, PROTECTED_ARTIFACT_SEAL_PATH), 'utf8');

    const result = await dispatchReseal({ interactive: false, reason: 'agent attempted bypass' });

    expect(result.code).not.toBe(0);
    expect(result.stderr.join('\n')).toMatch(/operator action|interactive terminal/i);
    await expect(readFile(join(fixture.worktree, PROTECTED_ARTIFACT_SEAL_PATH), 'utf8'))
      .resolves.toBe(before);
    await expect(verifyProtectedArtifactSeal({
      projectRoot: fixture.worktree,
      featureDesc: 'different-feature',
      baseBranch: 'main',
    })).resolves.toMatchObject({ ok: false, reason: expect.stringContaining(P1) });
    expect(JSON.stringify((await auditRecords()).at(-1))).toMatch(/agent attempted bypass/i);
  });

  it('Story 8: a later violation on P2 is not laundered by an earlier scoped reseal of P1', async () => {
    await commitChanges({ [P1]: 'plan v2 corrected\n' }, 'fix: correct plan');
    expect((await dispatchReseal()).code).toBe(0);
    await commitChanges({ [P2]: 'later violating story edit\n' }, 'build: mutate unrelated story');

    const verdict = await verifyProtectedArtifactSeal({
      projectRoot: fixture.worktree,
      featureDesc: SLUG,
      baseBranch: 'main',
    });

    expect(verdict).toEqual({ ok: false, reason: expect.stringContaining(P2) });
  });

  it('Story 6: the real pre-boot binary audits a whitespace-only rationale refusal in the named worktree', async () => {
    const result = await execa(
      REAL_CONDUCT_TS,
      ['reseal', '--slug', SLUG, '--path', P1, '--reason', '   '],
      { cwd: fixture.root, reject: false },
    );

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('reseal: missing rationale.');
    expect((await auditRecords()).at(-1)).toMatchObject({
      origin: 'operator',
      event: 'reseal_refused',
      condition: 'missing rationale',
    });
  }, 30_000);

  it('Stories 4–6: the real pre-boot binary refuses non-TTY invocation and audits it in the named worktree', async () => {
    await commitChanges({ [P1]: 'plan changed by build\n' }, 'build: mutate sealed plan');
    const before = await readFile(join(fixture.worktree, PROTECTED_ARTIFACT_SEAL_PATH), 'utf8');

    const result = await execa(
      REAL_CONDUCT_TS,
      [
        'reseal', '--slug', SLUG, '--path', P1,
        '--reason', 'child process must be refused',
      ],
      { cwd: fixture.root, reject: false },
    );

    expect(result.exitCode).not.toBe(0);
    expect(`${result.stdout}\n${result.stderr}`).toMatch(/operator action|interactive terminal/i);
    await expect(readFile(join(fixture.worktree, PROTECTED_ARTIFACT_SEAL_PATH), 'utf8'))
      .resolves.toBe(before);
    expect(JSON.stringify((await auditRecords()).at(-1))).toContain('child process must be refused');
  }, 30_000);
});
