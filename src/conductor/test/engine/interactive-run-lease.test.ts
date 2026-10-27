// Covers: task:rem-as-built-rem-as-built-r6
import { spawn, type ChildProcess } from 'node:child_process';
import { access, chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { execa } from 'execa';
import type { FeatureDispatchLease } from '../../src/engine/feature-dispatch-lease.js';
import { acquireFeatureDispatchLease } from '../../src/engine/feature-dispatch-lease.js';
import {
  prepareInteractiveConductorRunWithLease,
} from '../../src/engine/interactive-run-lease.js';

const temporaryDirectories: string[] = [];
const REPOSITORY_ROOT = fileURLToPath(new URL('../../../../', import.meta.url));
const CONDUCT_ENTRY_POINT = join(REPOSITORY_ROOT, 'src', 'conductor', 'src', 'index.ts');
const TSX_LOADER = join(REPOSITORY_ROOT, 'src', 'conductor', 'node_modules', 'tsx', 'dist', 'loader.mjs');

interface InteractiveFixture {
  readonly root: string;
  readonly activeRoot: string;
  readonly bin: string;
  readonly home: string;
  readonly parkMarker: string;
  readonly providerDispatched: string;
  readonly providerReady: string;
  readonly providerReadyAfter: number;
  readonly providerRelease: string;
  readonly ownerSnapshot: string;
  readonly stateSnapshot: string;
  readonly contextSnapshot: string;
  readonly statePath: string;
}

interface StartedCli {
  readonly child: ChildProcess;
  readonly completed: Promise<{ readonly exitCode: number | null; readonly stdout: string; readonly stderr: string }>;
}

async function waitForPath(path: string, description: string, run?: StartedCli): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    try {
      await access(path);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
  }
  run?.child.kill();
  const result = run ? await run.completed : undefined;
  throw new Error(`Timed out waiting for ${description}: ${path}${result ? `\n${result.stdout}${result.stderr}` : ''}`);
}

async function createInteractiveFixture(
  resume: boolean,
  parkAsFifo = true,
  selectedPipelineExists = true,
): Promise<InteractiveFixture> {
  const root = await mkdtemp(join(tmpdir(), 'interactive-run-lease-entry-'));
  temporaryDirectories.push(root);
  const bin = join(root, 'bin');
  const home = join(root, 'home');
  const activeRoot = resume ? join(root, '.worktrees', 'demo') : root;
  const parkMarker = join(root, '.daemon', 'parked', 'demo');
  const providerDispatched = join(root, 'provider-dispatched');
  const providerReady = join(root, 'provider-ready');
  const providerRelease = join(root, 'provider-release');
  const ownerSnapshot = join(root, 'owner-at-provider-boundary.json');
  const stateSnapshot = join(root, 'state-at-provider-boundary.json');
  const contextSnapshot = join(root, 'managed-context-at-provider-boundary.json');
  const statePath = join(activeRoot, '.pipeline', 'conduct-state.json');
  const providerReadyAfter = resume ? 1 : 2;

  await Promise.all([
    mkdir(bin, { recursive: true }),
    mkdir(home, { recursive: true }),
    ...(selectedPipelineExists ? [
      mkdir(join(activeRoot, '.pipeline', 'children', '1'), { recursive: true }),
      mkdir(join(activeRoot, '.ai-conductor'), { recursive: true }),
    ] : []),
    mkdir(join(root, '.daemon', 'parked'), { recursive: true }),
    mkdir(join(root, '.ai-conductor'), { recursive: true }),
  ]);
  await execa('git', ['init', '-q', '-b', 'main'], { cwd: root });
  await execa('git', ['config', 'user.email', 'fixture@example.test'], { cwd: root });
  await execa('git', ['config', 'user.name', 'Fixture'], { cwd: root });
  await writeFile(join(root, 'README.md'), 'fixture\n');
  await execa('git', ['add', 'README.md'], { cwd: root });
  await execa('git', ['commit', '-qm', 'fixture'], { cwd: root });
  if (resume && !selectedPipelineExists) {
    await execa('git', ['branch', 'feat/c1/demo'], { cwd: root });
    await execa('git', ['worktree', 'add', '--detach', activeRoot, 'feat/c1/demo'], { cwd: root });
    await mkdir(join(activeRoot, '.ai-conductor'), { recursive: true });
  }
  await writeFile(join(root, '.ai-conductor', 'config.yml'), 'llm_provider: codex\n');
  if (activeRoot !== root) {
    await writeFile(join(activeRoot, '.ai-conductor', 'config.yml'), 'llm_provider: codex\n');
  }
  if (resume) {
    await writeFile(
      selectedPipelineExists ? statePath : join(activeRoot, 'conduct-state.json'),
      '{"feature_desc":"Demo"}\n',
    );
  }

  if (parkAsFifo) {
    // An interactive run must not open this FIFO. If it reintroduces the
    // daemon-only park read, it cannot reach the controlled provider boundary.
    await execa('mkfifo', [parkMarker]);
  } else {
    await writeFile(parkMarker, 'parked by operator\n');
  }

  const codex = join(bin, 'codex');
  await writeFile(codex, `#!/bin/sh
if [ "$1" = "doctor" ]; then
  printf '{"status":"ok"}\\n'
  exit 0
fi
if [ "$1" = "--version" ]; then
  printf 'codex-test 1.0\\n'
  exit 0
fi
: > "$FAKE_PROVIDER_DISPATCHED"
count=0
if [ -f "$FAKE_PROVIDER_COUNT" ]; then count=$(cat "$FAKE_PROVIDER_COUNT"); fi
count=$((count + 1))
printf '%s' "$count" > "$FAKE_PROVIDER_COUNT"
if [ "$count" -ge "$FAKE_PROVIDER_READY_AFTER" ]; then
  cat "$LEASE_OWNER_PATH" > "$FAKE_OWNER_SNAPSHOT"
  cat "$STATE_PATH" > "$FAKE_STATE_SNAPSHOT"
  printf '%s\\n' "$CONDUCT_MANAGED_SESSION_CONTEXT" > "$FAKE_CONTEXT_SNAPSHOT"
  : > "$FAKE_PROVIDER_READY"
  while [ ! -f "$FAKE_PROVIDER_RELEASE" ]; do sleep 0.01; done
fi
printf 'codex-test 1.0\\n'
`, 'utf8');
  await chmod(codex, 0o755);

  return {
    root,
    activeRoot,
    bin,
    home,
    parkMarker,
    providerDispatched,
    providerReady,
    providerReadyAfter,
    providerRelease,
    ownerSnapshot,
    stateSnapshot,
    contextSnapshot,
    statePath,
  };
}

function startInteractiveEntry(fixture: InteractiveFixture, args: readonly string[]): StartedCli {
  const child = spawn(process.execPath, ['--import', TSX_LOADER, CONDUCT_ENTRY_POINT, 'inline', ...args], {
    cwd: fixture.root,
    env: {
      ...process.env,
      HOME: fixture.home,
      PATH: `${fixture.bin}${delimiter}${process.env.PATH ?? ''}`,
      AI_CONDUCTOR_NO_REAL_EXEC: undefined,
      CONDUCT_DAEMON_SESSION: undefined,
      FAKE_PROVIDER_DISPATCHED: fixture.providerDispatched,
      FAKE_PROVIDER_COUNT: join(fixture.root, 'provider-count'),
      FAKE_PROVIDER_READY: fixture.providerReady,
      FAKE_PROVIDER_READY_AFTER: String(fixture.providerReadyAfter),
      FAKE_PROVIDER_RELEASE: fixture.providerRelease,
      LEASE_OWNER_PATH: join(fixture.root, '.daemon', 'leases', 'demo', 'owner.json'),
      FAKE_OWNER_SNAPSHOT: fixture.ownerSnapshot,
      STATE_PATH: fixture.statePath,
      FAKE_STATE_SNAPSHOT: fixture.stateSnapshot,
      FAKE_CONTEXT_SNAPSHOT: fixture.contextSnapshot,
    },
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let stdout = '';
  let stderr = '';
  child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
  child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });
  const completed = new Promise<{ readonly exitCode: number | null; readonly stdout: string; readonly stderr: string }>((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (exitCode) => resolve({ exitCode, stdout, stderr }));
  });
  return { child, completed };
}

async function releaseInteractiveEntry(run: StartedCli, fixture: InteractiveFixture) {
  if (!existsSync(fixture.providerRelease)) await writeFile(fixture.providerRelease, 'release\n');
  run.child.stdin?.end('q\n');
  return run.completed;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

describe('interactive conductor run lease', () => {
  it('takes the stacked-feature lease before the first conductor mutation despite an operator park marker', async () => {
    const calls: string[] = [];
    const release = vi.fn(async () => {
      calls.push('lease release');
      return { ok: true } as const;
    });
    const acquire = vi.fn(async () => {
      calls.push('lease acquire');
      return { kind: 'acquired' as const, lease: { release } satisfies FeatureDispatchLease };
    });
    const prepare = vi.fn(async () => {
      calls.push('worktree preparation');
      calls.push('conduct-state write');
    });

    const result = await prepareInteractiveConductorRunWithLease({
      projectRoot: '/main/.worktrees/demo',
      featureDesc: 'Demo',
      prepare,
      dependencies: {
        slugify: () => 'demo',
        hasDurableChildState: async () => true,
        resolveMainRepoRoot: async () => ({ root: '/main' }),
        acquire,
      },
    });

    expect(result).toMatchObject({ kind: 'acquired' });
    expect(calls).toEqual([
      'lease acquire',
      'worktree preparation',
      'conduct-state write',
    ]);
    expect(acquire).toHaveBeenCalledWith('/main', 'demo', 'interactive conductor run');
    // The interactive entry has no park predicate/dependency: a present marker
    // cannot be consulted or stop its first dispatched step.
    expect(prepare).toHaveBeenCalledOnce();
    expect(release).not.toHaveBeenCalled();
  });

  it.each([
    { name: 'a feature argument', args: ['Demo', '--interactive'], resume: false },
    { name: 'a selected --resume feature', args: ['--resume', '--interactive'], resume: true },
  ])('holds the lease through index.ts session-state and managed-context setup for %s', async ({ args, resume }) => {
    const fixture = await createInteractiveFixture(resume);
    const run = startInteractiveEntry(fixture, args);
    try {
      await waitForPath(fixture.providerReady, 'the provider boundary after managed-context preparation', run);
      expect(run.child.pid).toBeTypeOf('number');
      expect((await stat(fixture.parkMarker)).isFIFO()).toBe(true);
      expect(JSON.parse(await readFile(fixture.ownerSnapshot, 'utf8'))).toMatchObject({
        pid: run.child.pid,
        purpose: 'interactive conductor run',
      });
      expect(JSON.parse(await readFile(fixture.stateSnapshot, 'utf8'))).toMatchObject({
        feature_desc: 'Demo',
      });
      expect(JSON.parse(await readFile(fixture.contextSnapshot, 'utf8'))).toMatchObject({
        projectRoot: fixture.activeRoot,
        worktreeRoot: fixture.activeRoot,
        scope: { kind: 'project' },
        provider: 'codex',
      });
    } finally {
      await releaseInteractiveEntry(run, fixture);
    }
  });

  it('refuses a live owner at index.ts before any state write or provider dispatch', async () => {
    const fixture = await createInteractiveFixture(false, false);
    const acquired = await acquireFeatureDispatchLease(fixture.root, 'demo', 'operator stack land');
    expect(acquired.kind).toBe('acquired');
    if (acquired.kind !== 'acquired') return;

    try {
      const run = startInteractiveEntry(fixture, ['Demo', '--interactive']);
      const result = await run.completed;

      expect(result.exitCode).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain(`operator stack land (pid ${process.pid})`);
      expect(existsSync(fixture.providerDispatched)).toBe(false);
      expect(existsSync(fixture.statePath)).toBe(false);
      expect(existsSync(join(fixture.activeRoot, '.pipeline', 'session-events'))).toBe(false);
    } finally {
      await acquired.lease.release();
    }
  });

  it('bare --resume refuses a live owner without creating the selected worktree pipeline', async () => {
    const fixture = await createInteractiveFixture(true, false, false);
    const acquired = await acquireFeatureDispatchLease(fixture.root, 'demo', 'operator stack land');
    expect(acquired.kind).toBe('acquired');
    if (acquired.kind !== 'acquired') return;

    try {
      const run = startInteractiveEntry(fixture, ['--resume', '--interactive']);
      const result = await run.completed;

      expect(result.exitCode).toBe(1);
      expect(`${result.stdout}${result.stderr}`).toContain(`operator stack land (pid ${process.pid})`);
      expect(existsSync(join(fixture.activeRoot, '.pipeline'))).toBe(false);
      expect(existsSync(fixture.providerDispatched)).toBe(false);
    } finally {
      await acquired.lease.release();
    }
  });

  it('refuses a live lease owner before dispatching any conductor step', async () => {
    const prepare = vi.fn(async () => undefined);

    const result = await prepareInteractiveConductorRunWithLease({
      projectRoot: '/main/.worktrees/demo',
      featureDesc: 'Demo',
      prepare,
      dependencies: {
        slugify: () => 'demo',
        hasDurableChildState: async () => true,
        resolveMainRepoRoot: async () => ({ root: '/main' }),
        acquire: async () => ({
          kind: 'live-owner',
          owner: {
            host: 'local-host',
            pid: 4321,
            processStartTime: 'current-start',
            token: 'owner-token',
            purpose: 'operator stack land',
          },
        }),
      },
    });

    expect(result).toEqual({
      kind: 'refused',
      message: 'interactive conductor run refused: feature dispatch lease is held by operator stack land (pid 4321)',
    });
    expect(prepare).not.toHaveBeenCalled();
  });
});
