import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtemp, rm, mkdir, writeFile, chmod, readFile, stat, access, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import {
  prepareWorktree,
  ensureSessionHooks,
  sanitizeNamespace,
  SETUP_SCRIPT,
  TEARDOWN_SCRIPT,
  DISPATCH_START_SCRIPT,
  NAMESPACE_VAR,
  SetupFailureError,
  OPERATOR_ONLY_SKILLS,
  runProjectTeardown,
  hashSetupScript,
  readSetupMarker,
  writeSetupMarker,
  runDispatchStart,
} from '../../src/engine/worktree-prepare.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';
import type { ConductorEvent } from '../../src/types/events.js';
import {
  PRE_DISPATCH_HOOK,
  DOCS_GUARD_HOOK,
} from '../../src/engine/session-hook-assets.js';
import { PREPARE_COMMIT_MSG_HOOK, COMMIT_MSG_HOOK } from '../../src/engine/git-hook-assets.js';

const execFileAsync = promisify(execFile);

describe('engine/worktree-prepare', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'wt-prepare-'));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  async function writeSetup(body: string, mode = 0o755): Promise<void> {
    await mkdir(join(dir, 'bin'), { recursive: true });
    const path = join(dir, SETUP_SCRIPT);
    await writeFile(path, body, 'utf-8');
    await chmod(path, mode);
  }

  async function writeTeardown(body: string, mode = 0o755): Promise<void> {
    await mkdir(join(dir, 'bin'), { recursive: true });
    const path = join(dir, TEARDOWN_SCRIPT);
    await writeFile(path, body, 'utf-8');
    await chmod(path, mode);
  }

  /**
   * A real local Git repository in the temp worktree. The marker's
   * `preparedAtCommit` is resolved from the worktree's own HEAD, so Git is the
   * boundary under test for every spec that expects a marker write.
   */
  async function initGitRepo(): Promise<string> {
    await execFileAsync('git', ['init', '-b', 'main', dir]);
    await execFileAsync('git', ['-C', dir, 'config', 'user.email', 'test@example.com']);
    await execFileAsync('git', ['-C', dir, 'config', 'user.name', 'Test']);
    await execFileAsync('git', ['-C', dir, 'config', 'commit.gpgsign', 'false']);
    return commitEmpty('base');
  }

  async function commitEmpty(message: string): Promise<string> {
    await execFileAsync('git', ['-C', dir, 'commit', '--allow-empty', '-q', '-m', message]);
    const { stdout } = await execFileAsync('git', ['-C', dir, 'rev-parse', 'HEAD']);
    return stdout.trim();
  }

  async function writeDispatchStart(body: string, mode = 0o755): Promise<void> {
    await mkdir(join(dir, 'bin'), { recursive: true });
    const path = join(dir, DISPATCH_START_SCRIPT);
    await writeFile(path, body, 'utf-8');
    await chmod(path, mode);
  }

  describe('setup success marker', () => {
    it('writes and reads a versioned marker atomically', async () => {
      const marker = {
        version: 1 as const,
        setupScriptHash: 'hash',
        baseSha: 'base-sha',
        preparedAtCommit: 'prepared-sha',
      };

      await writeSetupMarker(dir, marker);

      expect(await readSetupMarker(dir)).toEqual(marker);
      await expect(access(join(dir, '.daemon', 'setup-ok.json'))).resolves.toBeUndefined();
    });

    it.each([
      ['missing', undefined],
      ['corrupt', '{not json'],
      ['unknown version', JSON.stringify({ version: 2 })],
    ])('returns null for a %s marker', async (_label, contents) => {
      if (contents !== undefined) {
        await mkdir(join(dir, '.daemon'), { recursive: true });
        await writeFile(join(dir, '.daemon', 'setup-ok.json'), contents, 'utf-8');
      }

      await expect(readSetupMarker(dir)).resolves.toBeNull();
    });

    it('fingerprints setup content and mode, and returns null when absent', async () => {
      await expect(hashSetupScript(dir)).resolves.toBeNull();

      await writeSetup('#!/usr/bin/env bash\necho first\n', 0o755);
      const first = await hashSetupScript(dir);
      await writeFile(join(dir, SETUP_SCRIPT), '#!/usr/bin/env bash\necho second\n', 'utf-8');
      const changedBytes = await hashSetupScript(dir);
      await chmod(join(dir, SETUP_SCRIPT), 0o744);
      const changedMode = await hashSetupScript(dir);

      expect(first).not.toBeNull();
      expect(changedBytes).not.toBe(first);
      expect(changedMode).not.toBe(changedBytes);
    });

    it('skips setup only for a marker matching the script and resolved base', async () => {
      await writeSetup('#!/usr/bin/env bash\necho ran >> setup-count\n');
      const scriptHash = await hashSetupScript(dir);
      await writeSetupMarker(dir, {
        version: 1,
        setupScriptHash: scriptHash!,
        baseSha: 'base-a',
        preparedAtCommit: 'provenance-only',
      });

      await prepareWorktree(dir, undefined, { baseSha: 'base-a' });

      await expect(access(join(dir, 'setup-count'))).rejects.toMatchObject({ code: 'ENOENT' });
    });

    it.each([
      ['no marker', undefined, 'base-a'],
      ['corrupt marker', '{nope', 'base-a'],
      ['unknown marker version', JSON.stringify({ version: 2 }), 'base-a'],
      ['missing base SHA', undefined, undefined],
    ])('runs setup fail-closed with %s', async (_label, markerContents, baseSha) => {
      await writeSetup('#!/usr/bin/env bash\necho ran >> setup-count\n');
      const scriptHash = await hashSetupScript(dir);
      if (markerContents === undefined && baseSha === undefined) {
        await writeSetupMarker(dir, {
          version: 1,
          setupScriptHash: scriptHash!,
          baseSha: 'base-a',
          preparedAtCommit: 'provenance-only',
        });
      } else if (markerContents !== undefined) {
        await mkdir(join(dir, '.daemon'), { recursive: true });
        await writeFile(join(dir, '.daemon', 'setup-ok.json'), markerContents, 'utf-8');
      }

      await prepareWorktree(dir, undefined, { baseSha });

      expect(await readFile(join(dir, 'setup-count'), 'utf-8')).toContain('ran');
    });

    it('writes a marker only after successful setup and clears a stale marker before a forced failure', async () => {
      const baseSha = await initGitRepo();
      await writeSetup('#!/usr/bin/env bash\necho ran >> setup-count\n');

      await prepareWorktree(dir, undefined, { baseSha });

      const marker = await readSetupMarker(dir);
      expect(marker).toMatchObject({ baseSha, setupScriptHash: await hashSetupScript(dir) });

      await writeSetup('#!/usr/bin/env bash\necho broken >&2\nexit 1\n');
      await expect(prepareWorktree(dir, undefined, { baseSha, force: true }))
        .rejects.toBeInstanceOf(SetupFailureError);
      await expect(readSetupMarker(dir)).resolves.toBeNull();

      await writeSetup('#!/usr/bin/env bash\necho reran >> setup-count\n');
      await prepareWorktree(dir, undefined, { baseSha });
      expect(await readFile(join(dir, 'setup-count'), 'utf-8')).toContain('reran');
    });

    it('stamps the marker with the worktree HEAD as provenance, never a copy of the base', async () => {
      // Decision 1: `baseSha` is the identity the gate compares; the prepared
      // commit is the separate fact of WHERE setup ran — which, once a build
      // has made task commits, is ahead of the base it was cut from.
      const baseSha = await initGitRepo();
      await writeSetup('#!/usr/bin/env bash\ntrue\n');
      const headSha = await commitEmpty('task: build progress past the base');

      await prepareWorktree(dir, undefined, { baseSha });

      expect(headSha).not.toBe(baseSha);
      expect(await readSetupMarker(dir)).toMatchObject({ baseSha, preparedAtCommit: headSha });
    });

    it('writes no marker when the prepared commit cannot be resolved', async () => {
      // Fail closed: without provenance the marker would assert a code state it
      // cannot name, so setup simply re-runs on the next dispatch.
      await writeSetup('#!/usr/bin/env bash\necho ran >> setup-count\n');
      const log: string[] = [];

      await prepareWorktree(dir, (message) => log.push(message), { baseSha: 'base-a' });

      expect(await readFile(join(dir, 'setup-count'), 'utf-8')).toContain('ran');
      await expect(readSetupMarker(dir)).resolves.toBeNull();
      expect(log).toContainEqual(expect.stringContaining('setup marker not written'));
    });

    it.each([
      ['no marker', async () => {}, 'no-marker'],
      ['corrupt marker', async () => {
        await mkdir(join(dir, '.daemon'), { recursive: true });
        await writeFile(join(dir, '.daemon', 'setup-ok.json'), '{bad json', 'utf-8');
      }, 'marker-invalid'],
      ['changed script', async () => {
        await writeSetupMarker(dir, { version: 1, setupScriptHash: 'stale', baseSha: 'base-a', preparedAtCommit: 'old' });
      }, 'script-changed'],
      ['moved base', async () => {
        await writeSetupMarker(dir, { version: 1, setupScriptHash: (await hashSetupScript(dir))!, baseSha: 'base-old', preparedAtCommit: 'old' });
      }, 'base-moved'],
    ])('emits evidence-derived %s setup invalidation reason', async (_name, arrange, reason) => {
      await writeSetup('#!/usr/bin/env bash\necho ran >> setup-count\n');
      await arrange();
      const events = new ConductorEventEmitter();
      const seen: ConductorEvent[] = [];
      events.on('project_setup', (event) => {
        seen.push(event);
      });

      await prepareWorktree(dir, undefined, { baseSha: 'base-a', events });

      expect(await readFile(join(dir, 'setup-count'), 'utf-8')).toContain('ran');
      expect(seen).toEqual([{ type: 'project_setup', ran: true, reason }]);
    });

    it('forces setup despite a valid marker and emits forced', async () => {
      await writeSetup('#!/usr/bin/env bash\necho ran >> setup-count\n');
      await prepareWorktree(dir, undefined, { baseSha: 'base-a' });
      const events = new ConductorEventEmitter();
      const seen: ConductorEvent[] = [];
      events.on('project_setup', (event) => {
        seen.push(event);
      });

      await prepareWorktree(dir, undefined, { baseSha: 'base-a', force: true, events });

      expect((await readFile(join(dir, 'setup-count'), 'utf-8')).trim().split('\n')).toHaveLength(2);
      expect(seen).toEqual([{ type: 'project_setup', ran: true, reason: 'forced' }]);
    });

    it.each([
      ['without a marker or base SHA', {}],
      ['without a marker with a base SHA', { baseSha: 'base-a' }],
      ['when forced', { baseSha: 'base-a', force: true }],
    ])('reports no-script %s', async (_shape, setupOpts) => {
      const events = new ConductorEventEmitter();
      const seen: ConductorEvent[] = [];
      const log: string[] = [];
      events.on('project_setup', (event) => { seen.push(event); });

      await prepareWorktree(dir, (message) => log.push(message), { ...setupOpts, events });

      expect(seen).toEqual([{ type: 'project_setup', ran: false, reason: 'no-script' }]);
      // adr-2026-08-26 decision 3: the reason rides the spine and nothing else
      // reports it. A raw log write alongside the event is a second channel the
      // ledger cannot see, so assert its absence rather than its content.
      expect(log).not.toContain('no bin/setup — skipping project setup');
      await expect(readSetupMarker(dir)).resolves.toBeNull();
    });

    it('keeps an unreadable-but-present setup script distinct from no-script', async () => {
      await mkdir(join(dir, SETUP_SCRIPT), { recursive: true });
      await writeSetupMarker(dir, {
        version: 1,
        setupScriptHash: 'old-hash',
        baseSha: 'base-a',
        preparedAtCommit: 'old',
      });
      const events = new ConductorEventEmitter();
      const seen: ConductorEvent[] = [];
      events.on('project_setup', (event) => { seen.push(event); });

      await expect(prepareWorktree(dir, undefined, { baseSha: 'base-a', events }))
        .rejects.toBeInstanceOf(SetupFailureError);

      expect(seen).toEqual([{ type: 'project_setup', ran: true, reason: 'script-changed' }]);
    });
  });

  describe('runDispatchStart', () => {
    it('is silent when absent, receives the dispatch environment, and contains failure', async () => {
      const log = vi.fn();
      await expect(runDispatchStart(dir, log)).resolves.toBeUndefined();
      expect(log).not.toHaveBeenCalled();

      await writeDispatchStart(`#!/usr/bin/env node
require('node:fs').writeFileSync('dispatch-start.json', JSON.stringify({ ci: process.env.CI, namespace: process.env.WORKTREE_NAMESPACE, cwd: process.cwd() }));
`);
      await expect(runDispatchStart(dir)).resolves.toBeUndefined();
      expect(JSON.parse(await readFile(join(dir, 'dispatch-start.json'), 'utf-8'))).toEqual({
        ci: 'true', namespace: sanitizeNamespace(basename(dir)), cwd: dir,
      });

      await writeDispatchStart('#!/usr/bin/env bash\necho hook-failed >&2\nexit 2\n');
      await expect(runDispatchStart(dir, log)).resolves.toBeUndefined();
      expect(log).toHaveBeenLastCalledWith(expect.stringContaining('dispatch-start: failed'));
    });

    it('runs on every prepare, including marker-valid setup skips', async () => {
      const baseSha = await initGitRepo();
      await writeSetup('#!/usr/bin/env bash\ntrue\n');
      await writeDispatchStart('#!/usr/bin/env bash\necho dispatch >> dispatch-count\n');

      await prepareWorktree(dir, undefined, { baseSha });
      await prepareWorktree(dir, undefined, { baseSha });

      expect((await readFile(join(dir, 'dispatch-count'), 'utf-8')).trim().split('\n')).toHaveLength(2);
    });
  });

  describe('runProjectTeardown', () => {
    it.each([undefined, { verbose: true }] as const)(
      'is completely silent when bin/teardown is absent (%o)',
      async (opts) => {
        const log = vi.fn();

        await expect(runProjectTeardown(dir, log, opts)).resolves.toBeUndefined();

        expect(log).not.toHaveBeenCalled();
      },
    );

    it('runs bin/teardown in the worktree with its CI namespace environment', async () => {
      const teardownPath = join(dir, TEARDOWN_SCRIPT);
      const observationDir = await mkdtemp(join(tmpdir(), 'teardown-observation-'));
      const observationPath = join(observationDir, 'teardown-saw.json');
      await mkdir(join(dir, 'bin'), { recursive: true });
      await writeFile(
        teardownPath,
        `#!/usr/bin/env node
const fs = require('node:fs');
fs.writeFileSync(${JSON.stringify(observationPath)}, JSON.stringify({
  ci: process.env.CI,
  namespace: process.env.WORKTREE_NAMESPACE,
  cwd: process.cwd(),
}));
`,
        'utf-8',
      );
      await chmod(teardownPath, 0o755);

      try {
        await runProjectTeardown(dir);

        expect(JSON.parse(await readFile(observationPath, 'utf-8'))).toEqual({
          ci: 'true',
          namespace: expect.stringMatching(/\S/),
          cwd: dir,
        });
      } finally {
        await rm(observationDir, { recursive: true, force: true });
      }
    });

    it('derives its namespace from a sanitized worktree basename without persisted state', async () => {
      const worktreePath = await mkdtemp(join(tmpdir(), 'teardown namespace.v1-'));
      const observationDir = await mkdtemp(join(tmpdir(), 'teardown-observation-'));
      const observationPath = join(observationDir, 'teardown-namespace.txt');
      const teardownPath = join(worktreePath, TEARDOWN_SCRIPT);
      await mkdir(join(worktreePath, 'bin'), { recursive: true });
      await mkdir(join(worktreePath, '.pipeline'), { recursive: true });
      await writeFile(join(worktreePath, '.env'), `${NAMESPACE_VAR}=persisted-state\n`, 'utf-8');
      await writeFile(
        teardownPath,
        `#!/usr/bin/env node
require('node:fs').writeFileSync(${JSON.stringify(observationPath)}, process.env.WORKTREE_NAMESPACE);
`,
        'utf-8',
      );
      await chmod(teardownPath, 0o755);

      try {
        await rm(join(worktreePath, '.pipeline'), { recursive: true });
        await rm(join(worktreePath, '.env'));

        await runProjectTeardown(worktreePath);

        expect(await readFile(observationPath, 'utf-8')).toBe(
          sanitizeNamespace(basename(worktreePath)),
        );
      } finally {
        await rm(worktreePath, { recursive: true, force: true });
        await rm(observationDir, { recursive: true, force: true });
      }
    });

    describe('successful output logging', () => {
      const CHATTY_TEARDOWN =
        '#!/usr/bin/env bash\n' +
        'echo "removed 402 packages"\n' +
        'echo ""\n' +
        'echo "{\\"cleanupId\\":\\"20260807T113046Z-abc\\",\\"dir\\":\\"/x/y\\"}"\n' +
        'echo "Teardown complete."\n';

      it('summarizes successful output instead of echoing it by default', async () => {
        await writeTeardown(CHATTY_TEARDOWN);
        const lines: string[] = [];

        await runProjectTeardown(dir, (message) => lines.push(message));

        expect(lines).toEqual([
          'teardown: 3 line(s) of output suppressed (set daemon_verbose: true to echo them)',
        ]);
      });

      it('echoes each non-blank successful output line when verbose', async () => {
        await writeTeardown(CHATTY_TEARDOWN);
        const lines: string[] = [];

        await runProjectTeardown(dir, (message) => lines.push(message), { verbose: true });

        expect(lines).toEqual([
          'teardown: removed 402 packages',
          'teardown: {"cleanupId":"20260807T113046Z-abc","dir":"/x/y"}',
          'teardown: Teardown complete.',
        ]);
      });

      it.each([
        ['no output', '#!/usr/bin/env bash\n'],
        ['blank-only output', '#!/usr/bin/env bash\necho ""\necho "   "\n'],
      ])('does not summarize %s', async (_description, script) => {
        await writeTeardown(script);
        const log = vi.fn();

        await runProjectTeardown(dir, log);

        expect(log).not.toHaveBeenCalled();
      });
    });

    describe('failure containment', () => {
      it('contains a non-zero exit and logs the worktree with a bounded output tail', async () => {
        const output = Array.from({ length: 55 }, (_, index) => `tail-line-${index + 1}`).join('\n');
        await writeTeardown(`#!/usr/bin/env bash\nprintf '%s\\n' ${output.split('\n').map((line) => JSON.stringify(line)).join(' ')}\nexit 3\n`);
        const lines: string[] = [];

        await expect(runProjectTeardown(dir, (message) => lines.push(message))).resolves.toBeUndefined();

        expect(lines).toEqual([
          expect.stringContaining(`teardown: failed in ${dir}: tail-line-6`),
        ]);
        expect(lines[0]).toContain('tail-line-55');
        expect(lines[0]).not.toContain('tail-line-1\n');
      });

      it('logs an identifying failure when a non-zero exit has no output', async () => {
        await writeTeardown('#!/usr/bin/env bash\nexit 3\n');
        const lines: string[] = [];

        await expect(runProjectTeardown(dir, (message) => lines.push(message))).resolves.toBeUndefined();

        expect(lines).toEqual([expect.stringContaining(`teardown: failed in ${dir}:`)]);
      });

      it.each([
        ['is not executable', async () => writeTeardown('#!/usr/bin/env bash\nexit 0\n', 0o644)],
        ['has a missing interpreter', async () => writeTeardown('#!/definitely/missing/interpreter\n', 0o755)],
        ['is a directory', async () => mkdir(join(dir, TEARDOWN_SCRIPT), { recursive: true })],
      ])('contains a teardown that %s instead of treating it as absent', async (_description, create) => {
        await create();
        const lines: string[] = [];

        await expect(runProjectTeardown(dir, (message) => lines.push(message))).resolves.toBeUndefined();

        expect(lines).toEqual([expect.stringContaining(`teardown: failed in ${dir}:`)]);
      });

      it('abandons a non-terminating teardown at its configured bound and reports a timeout', async () => {
        const output = Array.from({ length: 55 }, (_, index) => `timeout-line-${index + 1}`).join('\n');
        await writeTeardown(`#!/usr/bin/env bash\nprintf '%s\\n' ${output.split('\n').map((line) => JSON.stringify(line)).join(' ')}\nwhile true; do :; done\n`);
        const lines: string[] = [];

        await expect(
          runProjectTeardown(dir, (message) => lines.push(message), { timeoutSeconds: 0.05 }),
        ).resolves.toBeUndefined();

        expect(lines).toEqual([
          expect.stringContaining(`teardown: timed out in ${dir} after 0.05 second(s)`),
        ]);
        expect(lines[0]).toContain(output.split('\n').slice(-50).join('\n'));
        expect(lines[0]).not.toContain('timeout-line-1\n');
      });
    });
  });

  describe('sanitizeNamespace', () => {
    it('reduces a worktree dir name to a DB-safe token', () => {
      expect(sanitizeNamespace('2026-06-27-add-foo')).toBe('2026_06_27_add_foo');
      expect(sanitizeNamespace('plain_slug')).toBe('plain_slug');
    });
  });

  describe('ensureSessionHooks', () => {
    const hookAssets = [
      ['pre-dispatch.sh', PRE_DISPATCH_HOOK],
      ['docs-guard.sh', DOCS_GUARD_HOOK],
    ] as const;

    it('creates all session-hook scripts executable with their canonical contents', async () => {
      const outcome = await ensureSessionHooks(dir);

      expect(outcome.failed).toEqual([]);
      for (const [name, content] of hookAssets) {
        const path = join(dir, '.pipeline', 'session-hooks', name);
        expect(await readFile(path, 'utf-8')).toBe(content);
        expect((await stat(path)).mode & 0o777).toBe(0o755);
      }
    });

    it('reports exactly a deleted hook as repaired', async () => {
      await ensureSessionHooks(dir);
      await rm(join(dir, '.pipeline', 'session-hooks', 'pre-dispatch.sh'));

      const outcome = await ensureSessionHooks(dir);

      expect(outcome.repaired).toEqual(['pre-dispatch.sh']);
      expect(outcome.failed).toEqual([]);
      expect(await readFile(join(dir, '.pipeline', 'session-hooks', 'pre-dispatch.sh'), 'utf-8'))
        .toBe(PRE_DISPATCH_HOOK);
    });

    it('is idempotent when scripts and settings are already current', async () => {
      await ensureSessionHooks(dir);
      const hooksDir = join(dir, '.pipeline', 'session-hooks');
      const before = await Promise.all(
        hookAssets.map(async ([name]) => readFile(join(hooksDir, name), 'utf-8')),
      );

      const outcome = await ensureSessionHooks(dir);

      expect(outcome.repaired).toEqual([]);
      expect(outcome.failed).toEqual([]);
      await expect(Promise.all(hookAssets.map(async ([name]) => readFile(join(hooksDir, name), 'utf-8'))))
        .resolves.toEqual(before);
    });

    it('does not throw and reports each hook when its directory is unwritable', async () => {
      const hooksDir = join(dir, '.pipeline', 'session-hooks');
      await mkdir(hooksDir, { recursive: true });
      await chmod(hooksDir, 0o500);

      try {
        const outcome = await ensureSessionHooks(dir);
        expect(outcome.repaired).toEqual([]);
        expect(outcome.failed.map(({ file }) => file)).toEqual(hookAssets.map(([name]) => name));
        expect(outcome.failed.every(({ error }) => error.length > 0)).toBe(true);
      } finally {
        await chmod(hooksDir, 0o700);
      }
    });

    it('reports script and settings failures as distinct files', async () => {
      const hooksDir = join(dir, '.pipeline', 'session-hooks');
      await mkdir(hooksDir, { recursive: true });
      await chmod(hooksDir, 0o500);
      await writeFile(join(dir, '.claude'), 'not a directory', 'utf-8');

      try {
        const outcome = await ensureSessionHooks(dir);

        expect(outcome.failed.map(({ file }) => file)).toEqual([
          ...hookAssets.map(([name]) => name),
          '.claude/settings.local.json',
        ]);
      } finally {
        await chmod(hooksDir, 0o700);
      }
    });
  });

  it('writes WORKTREE_NAMESPACE into the worktree .env (derived from the dir name)', async () => {
    await prepareWorktree(dir);
    const env = await readFile(join(dir, '.env'), 'utf-8');
    expect(env).toContain(`${NAMESPACE_VAR}=${sanitizeNamespace(dir.split('/').pop()!)}`);
  });

  it('preserves existing .env entries and replaces (not duplicates) the namespace line', async () => {
    await writeFile(
      join(dir, '.env'),
      `SECRET=keep-me\n${NAMESPACE_VAR}=stale\nOTHER=x\n`,
      'utf-8',
    );
    await prepareWorktree(dir);

    const env = await readFile(join(dir, '.env'), 'utf-8');
    expect(env).toContain('SECRET=keep-me');
    expect(env).toContain('OTHER=x');
    // exactly one namespace line, and not the stale value
    const nsLines = env.split('\n').filter((l) => l.startsWith(`${NAMESPACE_VAR}=`));
    expect(nsLines).toHaveLength(1);
    expect(nsLines[0]).not.toContain('stale');
  });

  it('no-ops the setup step when the project ships no bin/setup (still writes the namespace)', async () => {
    // No bin/setup → must resolve without throwing, and .env is still written.
    await expect(prepareWorktree(dir)).resolves.toBeUndefined();
    await readFile(join(dir, '.env'), 'utf-8'); // exists
  });

  it('runs bin/setup in the worktree with CI=true and WORKTREE_NAMESPACE exported', async () => {
    // The script records the env it saw + proves cwd is the worktree.
    await writeSetup(
      `#!/usr/bin/env bash\necho "CI=$CI ${NAMESPACE_VAR}=$${NAMESPACE_VAR}" > setup-saw.txt\ntouch ran.marker\n`,
    );

    await prepareWorktree(dir);

    const saw = await readFile(join(dir, 'setup-saw.txt'), 'utf-8');
    expect(saw).toContain('CI=true');
    expect(saw).toContain(`${NAMESPACE_VAR}=${sanitizeNamespace(dir.split('/').pop()!)}`);
    await readFile(join(dir, 'ran.marker'), 'utf-8'); // ran in the worktree cwd
  });

  it('continues to bin/setup when session-hook provisioning cannot write', async () => {
    await writeSetup('#!/usr/bin/env bash\ntouch setup-ran-despite-hooks.marker\n');
    const hooksDir = join(dir, '.pipeline', 'session-hooks');
    await mkdir(hooksDir, { recursive: true });
    await chmod(hooksDir, 0o500);

    try {
      await expect(prepareWorktree(dir)).resolves.toBeUndefined();
      await access(join(dir, 'setup-ran-despite-hooks.marker'));
    } finally {
      await chmod(hooksDir, 0o700);
    }
  });

  describe('setup output logging (daemon log noise)', () => {
    // A successful bin/setup emitting install/build chatter — including a
    // blank spacer line and publish-engine's machine-readable JSON, the two
    // shapes that dominated the daemon log.
    const CHATTY_SETUP =
      '#!/usr/bin/env bash\n' +
      'echo "added 402 packages"\n' +
      'echo ""\n' +
      'echo "{\\"versionId\\":\\"20260723T113046Z-abc\\",\\"dir\\":\\"/x/y\\"}"\n' +
      'echo "Setup complete."\n';

    it('summarizes bin/setup output instead of echoing it, by default', async () => {
      await writeSetup(CHATTY_SETUP);
      const lines: string[] = [];

      await prepareWorktree(dir, (m) => lines.push(m));

      const setupLines = lines.filter((l) => l.startsWith('setup: '));
      // No raw passthrough: neither the JSON blob nor the chatter is echoed.
      expect(setupLines.some((l) => l.includes('versionId'))).toBe(false);
      expect(setupLines.some((l) => l.includes('added 402 packages'))).toBe(false);
      // A single summary line reports how much was suppressed (blank dropped).
      expect(setupLines).toContainEqual(
        expect.stringContaining('3 line(s) of output suppressed'),
      );
      expect(setupLines).toContain('setup: ok');
    });

    it('echoes full output when verbose is set, still dropping blank lines', async () => {
      await writeSetup(CHATTY_SETUP);
      const lines: string[] = [];

      await prepareWorktree(dir, (m) => lines.push(m), { verbose: true });

      const setupLines = lines.filter((l) => l.startsWith('setup: '));
      expect(setupLines.some((l) => l.includes('versionId'))).toBe(true);
      expect(setupLines).toContain('setup: added 402 packages');
      // Blank spacer lines are never echoed, even verbose.
      expect(setupLines).not.toContain('setup: ');
      expect(setupLines.some((l) => l.includes('suppressed'))).toBe(false);
    });

    it('still carries setup output on failure, regardless of verbosity', async () => {
      await writeSetup('#!/usr/bin/env bash\necho "DIAGNOSTIC_LINE"\nexit 3\n');
      await expect(prepareWorktree(dir, () => {})).rejects.toMatchObject({
        outputTail: expect.stringContaining('DIAGNOSTIC_LINE'),
      });
    });
  });

  it('rejects with SetupFailureError carrying outputTail when bin/setup exits non-zero', async () => {
    await writeSetup('#!/usr/bin/env bash\necho "line 1"\necho "FAILURE_MARKER" >&2\nexit 3\n');
    try {
      await prepareWorktree(dir);
      throw new Error('should have rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(SetupFailureError);
      expect((err as SetupFailureError).outputTail).toContain('FAILURE_MARKER');
    }
  });

  it('rejects with SetupFailureError when spawn fails (non-executable or missing interpreter)', async () => {
    await writeSetup('#!/usr/bin/env bash\nexit 0\n', 0o644); // not executable
    try {
      await prepareWorktree(dir);
      throw new Error('should have rejected');
    } catch (err) {
      expect(err).toBeInstanceOf(SetupFailureError);
      expect((err as SetupFailureError).outputTail).toBeTruthy();
    }
  });

  it('forwards setup output to the log sink under verbose', async () => {
    // Was unconditional; success output is now summarized by default (see
    // "setup output logging") and echoed only when verbose is requested.
    await writeSetup('#!/usr/bin/env bash\necho "== Preparing database =="\n');
    const lines: string[] = [];
    await prepareWorktree(dir, (m) => lines.push(m), { verbose: true });
    expect(lines.some((l) => l.includes('Preparing database'))).toBe(true);
    expect(lines.some((l) => l.includes('ok'))).toBe(true);
  });

  it('rejects with plain Error (not SetupFailureError) when .env write fails (unwritable worktree)', async () => {
    // Make the directory read-only so writeFile will fail.
    await chmod(dir, 0o555);
    try {
      await prepareWorktree(dir);
      throw new Error('should have rejected');
    } catch (err) {
      // Namespace write failures must NOT be classified as SetupFailureError.
      expect(err).not.toBeInstanceOf(SetupFailureError);
      expect(err).toBeInstanceOf(Error);
    } finally {
      // Restore permissions for cleanup.
      await chmod(dir, 0o755);
    }
  });

  it('no-ops and does not produce triage-observable effects when bin/setup is absent', async () => {
    // No bin/setup must resolve cleanly without any special markers.
    const log: string[] = [];
    await expect(prepareWorktree(dir, (m) => log.push(m))).resolves.toBeUndefined();
    // adr-2026-08-26 decision 3: the setup decision is reported only as a
    // rendered `project_setup` event. With no emitter supplied there is no
    // second channel to fall back to, so the absent script is silent here —
    // the emitted-reason path is covered where an emitter is injected.
    expect(log.some((l) => l.includes('skipping project setup'))).toBe(false);
    expect(log.some((l) => l.includes(`running ${SETUP_SCRIPT}`))).toBe(false);
    // .env should exist with the namespace.
    const env = await readFile(join(dir, '.env'), 'utf-8');
    expect(env).toContain(NAMESPACE_VAR);
  });

  // Story 6 (#433): prepareWorktree wires the attribution git hooks
  // per-worktree, isolated from the primary checkout, fail-open. Unlike the
  // suite above, these tests need a REAL git repo (worktree-scoped
  // `core.hooksPath` is meaningless outside one). None of `git-hook-assets.ts`
  // exists yet, so these fail on the missing hook files/config until Tasks 1,
  // 9, 10, 11 land — acceptable pre-implementation RED.
  describe('git hook wiring (Story 6)', () => {
    let repoRoot: string;
    let worktreeDir: string;

    async function git(cwd: string, ...args: string[]): Promise<{ stdout: string; code: number }> {
      try {
        const { stdout } = await execFileAsync('git', ['-C', cwd, ...args]);
        return { stdout: stdout.trim(), code: 0 };
      } catch (err) {
        const e = err as { code?: number; stdout?: string };
        return { stdout: (e.stdout ?? '').trim(), code: e.code ?? 1 };
      }
    }

    beforeEach(async () => {
      repoRoot = await mkdtemp(join(tmpdir(), 'wt-prepare-repo-'));
      await git(repoRoot, 'init', '-b', 'main');
      await git(repoRoot, 'config', 'user.email', 'test@example.com');
      await git(repoRoot, 'config', 'user.name', 'Test');
      await writeFile(join(repoRoot, 'README.md'), '# scratch\n', 'utf-8');
      await git(repoRoot, 'add', '.');
      await git(repoRoot, 'commit', '-m', 'chore: initial commit');

      worktreeDir = join(tmpdir(), `wt-prepare-wt-${Math.random().toString(36).slice(2)}`);
      await git(repoRoot, 'worktree', 'add', worktreeDir, '-b', 'feature');
    });

    afterEach(async () => {
      await git(repoRoot, 'worktree', 'remove', '--force', worktreeDir).catch(() => undefined);
      await rm(worktreeDir, { recursive: true, force: true });
      await rm(repoRoot, { recursive: true, force: true });
    });

    it('fails closed when present .git metadata is inaccessible, while a plain setup directory still no-ops', async () => {
      const plainDir = await mkdtemp(join(tmpdir(), 'wt-prepare-plain-'));
      try {
        await expect(prepareWorktree(plainDir)).resolves.toBeUndefined();
        await symlink(join(plainDir, 'missing-git-metadata'), join(plainDir, '.git'));
        await expect(prepareWorktree(plainDir)).rejects.toThrow(/preventive git hook installation failed: unable to access .git metadata/i);
      } finally {
        await rm(plainDir, { recursive: true, force: true });
      }
    });

    it('writes the two attribution hooks executable under .pipeline/git-hooks/', async () => {
      await prepareWorktree(worktreeDir);

      const prepareCommitMsg = join(worktreeDir, '.pipeline', 'git-hooks', 'prepare-commit-msg');
      const commitMsg = join(worktreeDir, '.pipeline', 'git-hooks', 'commit-msg');

      const s1 = await stat(prepareCommitMsg);
      expect(s1.mode & 0o111).not.toBe(0);
      const s2 = await stat(commitMsg);
      expect(s2.mode & 0o111).not.toBe(0);
    });

    it('sets worktree-scoped extensions.worktreeConfig and core.hooksPath to an absolute path', async () => {
      await prepareWorktree(worktreeDir);

      const worktreeConfig = await git(worktreeDir, 'config', 'extensions.worktreeConfig');
      expect(worktreeConfig.stdout).toBe('true');

      const hooksPath = await git(worktreeDir, 'config', 'core.hooksPath');
      expect(hooksPath.code).toBe(0);
      expect(hooksPath.stdout).toBe(join(worktreeDir, '.pipeline', 'git-hooks'));
    });

    it('leaves core.hooksPath unset in the primary checkout', async () => {
      await prepareWorktree(worktreeDir);

      const primaryHooksPath = await git(repoRoot, 'config', 'core.hooksPath');
      expect(primaryHooksPath.code).not.toBe(0);
    });

    it('fails closed when git config --worktree fails to wire the preventive hook', async () => {
      // Simulate an unsupported/old git by pointing HOME at a location where
      // git's config write cannot succeed: make .git read-only so any
      // `git config --worktree` write fails, without touching the hook-file
      // write path itself.
      const dotGit = join(worktreeDir, '.git');
      await chmod(dotGit, 0o500).catch(() => undefined);

      await expect(prepareWorktree(worktreeDir)).rejects.toThrow(/preventive git hook installation failed/i);

      await chmod(dotGit, 0o700).catch(() => undefined);

    });

    it('fails closed when the preventive hook asset cannot be written', async () => {
      // Make the destination directory uncreatable/unwritable to force the
      // hook-file write to fail.
      const pipelineDir = join(worktreeDir, '.pipeline');
      await mkdir(pipelineDir, { recursive: true });
      await chmod(pipelineDir, 0o500);

      await expect(prepareWorktree(worktreeDir)).rejects.toThrow(/preventive git hook installation failed/i);

      await chmod(pipelineDir, 0o700).catch(() => undefined);

    });

    it('leaves the existing bin/setup + namespace contract unchanged when hooks are wired', async () => {
      await mkdir(join(worktreeDir, 'bin'), { recursive: true });
      const script = join(worktreeDir, SETUP_SCRIPT);
      await writeFile(script, '#!/usr/bin/env bash\ntouch ran.marker\n', 'utf-8');
      await chmod(script, 0o755);

      await prepareWorktree(worktreeDir);

      await access(join(worktreeDir, 'ran.marker'));
      const env = await readFile(join(worktreeDir, '.env'), 'utf-8');
      expect(env).toContain(NAMESPACE_VAR);
    });
  });

  // Task 12: prepareWorktree installs session-hook scripts to
  // .pipeline/session-hooks/, executable, overwriting any stale file.
  describe('settings wiring negatives (Task 14)', () => {
    const settingsPath = (worktreeDir: string) =>
      join(worktreeDir, '.claude', 'settings.local.json');
    const committedSettingsPath = (worktreeDir: string) =>
      join(worktreeDir, '.claude', 'settings.json');

    it('backs up corrupt settings.local.json, warns, and writes a fresh valid file', async () => {
      const claudeDir = join(dir, '.claude');
      await mkdir(claudeDir, { recursive: true });
      await writeFile(settingsPath(dir), '{invalid', 'utf-8');

      const logs: string[] = [];
      await prepareWorktree(dir, (msg) => logs.push(msg));

      // Fresh file is valid JSON with the expected hook entries.
      const raw = await readFile(settingsPath(dir), 'utf-8');
      const settings = JSON.parse(raw);
      expect(settings.hooks.PreToolUse).toBeDefined();
      expect(settings.hooks.PostToolUse).toBeDefined();

      // Original corrupt file was renamed aside with a .bak-<ts> suffix.
      const entries = await import('node:fs/promises').then((m) => m.readdir(claudeDir));
      const backups = entries.filter((e) => /^settings\.local\.json\.bak-/.test(e));
      expect(backups.length).toBe(1);
      const backupContent = await readFile(join(claudeDir, backups[0]), 'utf-8');
      expect(backupContent).toBe('{invalid');

      // A warning was logged.
      expect(logs.some((l) => /corrupt|invalid|malformed/i.test(l))).toBe(true);
    });

    it('never modifies the committed .claude/settings.json bytes, and settings.local.json is not tracked-modified', async () => {
      await execFileAsync('git', ['init'], { cwd: dir });
      await execFileAsync('git', ['config', 'user.email', 'test@example.com'], { cwd: dir });
      await execFileAsync('git', ['config', 'user.name', 'Test'], { cwd: dir });

      const claudeDir = join(dir, '.claude');
      await mkdir(claudeDir, { recursive: true });
      const committedBytes = JSON.stringify({ permissions: { allow: ['Bash(ls:*)'] } }, null, 2);
      await writeFile(committedSettingsPath(dir), committedBytes, 'utf-8');

      // .claude/settings.local.json is gitignored in real projects; mirror that.
      await writeFile(join(dir, '.gitignore'), '.claude/settings.local.json\n', 'utf-8');

      await execFileAsync('git', ['add', '-A'], { cwd: dir });
      await execFileAsync('git', ['commit', '-m', 'init'], { cwd: dir });

      await prepareWorktree(dir);

      const afterBytes = await readFile(committedSettingsPath(dir), 'utf-8');
      expect(afterBytes).toBe(committedBytes);

      const { stdout } = await execFileAsync('git', ['status', '--porcelain'], { cwd: dir });
      const trackedModifiedLocalSettings = stdout
        .split('\n')
        .some((line) => / M .*settings\.local\.json/.test(line));
      expect(trackedModifiedLocalSettings).toBe(false);
    });
  });

  // Task 11: Re-provisioning replaces stale hook copies with hardened versions
  // and preserves settings merge invariant.
  describe('re-provisioning stale hooks (Task 11)', () => {
    let repoRoot: string;
    let worktreeDir: string;

    async function git(cwd: string, ...args: string[]): Promise<{ stdout: string; code: number }> {
      try {
        const { stdout } = await execFileAsync('git', ['-C', cwd, ...args]);
        return { stdout: stdout.trim(), code: 0 };
      } catch (err) {
        const e = err as { code?: number; stdout?: string };
        return { stdout: (e.stdout ?? '').trim(), code: e.code ?? 1 };
      }
    }

    beforeEach(async () => {
      repoRoot = await mkdtemp(join(tmpdir(), 'wt-reprov-repo-'));
      await git(repoRoot, 'init', '-b', 'main');
      await git(repoRoot, 'config', 'user.email', 'test@example.com');
      await git(repoRoot, 'config', 'user.name', 'Test');
      await writeFile(join(repoRoot, 'README.md'), '# scratch\n', 'utf-8');
      await git(repoRoot, 'add', '.');
      await git(repoRoot, 'commit', '-m', 'chore: initial commit');

      worktreeDir = join(tmpdir(), `wt-reprov-wt-${Math.random().toString(36).slice(2)}`);
      await git(repoRoot, 'worktree', 'add', worktreeDir, '-b', 'feature');
    });

    afterEach(async () => {
      await git(repoRoot, 'worktree', 'remove', '--force', worktreeDir).catch(() => undefined);
      await rm(worktreeDir, { recursive: true, force: true });
      await rm(repoRoot, { recursive: true, force: true });
    });

    it('overwrites stale pre-dispatch.sh with hardened version containing abstain prefix', async () => {
      const hooksDir = join(worktreeDir, '.pipeline', 'session-hooks');
      await mkdir(hooksDir, { recursive: true });

      // Write stale pre-dispatch without abstain hardening
      const stalePreDispatch = '#!/bin/bash\necho "old version"\nexit 0\n';
      await writeFile(join(hooksDir, 'pre-dispatch.sh'), stalePreDispatch, 'utf-8');

      await prepareWorktree(worktreeDir);

      const content = await readFile(join(hooksDir, 'pre-dispatch.sh'), 'utf-8');
      expect(content).not.toBe(stalePreDispatch);
      expect(content).toBe(PRE_DISPATCH_HOOK);
      // Assert hardened marker is present: abstain diagnostic prefix
      expect(content).toContain('pre-dispatch-hook: abstain');
    });

    it('overwrites stale prepare-commit-msg without fallback scan, preserving stamp-first path', async () => {
      const hooksDir = join(worktreeDir, '.pipeline', 'git-hooks');
      await mkdir(hooksDir, { recursive: true });

      // Write stale prepare-commit-msg with fallback in_progress scan
      const stalePrepareCommitMsg = [
        '#!/bin/bash',
        'set -e',
        '# Old version with fallback scan',
        'if [[ -f "$TASK_STATUS_FILE" ]]; then',
        '  node -e \'',
        '    const inProgressRows = data.tasks.filter(t => t.status === "in_progress");',
        '  \'',
        'fi',
        'exit 0'
      ].join('\n');
      await writeFile(join(hooksDir, 'prepare-commit-msg'), stalePrepareCommitMsg, 'utf-8');

      await prepareWorktree(worktreeDir);

      const content = await readFile(join(hooksDir, 'prepare-commit-msg'), 'utf-8');
      expect(content).not.toBe(stalePrepareCommitMsg);
      expect(content).toBe(PREPARE_COMMIT_MSG_HOOK);
      // Assert hardened version: NO in_progress fallback scan
      expect(content).not.toContain('in_progress');
    });

    it('overwrites stale commit-msg using real id extraction instead of Object.keys', async () => {
      const hooksDir = join(worktreeDir, '.pipeline', 'git-hooks');
      await mkdir(hooksDir, { recursive: true });

      // Write stale commit-msg using Object.keys over tasks
      const staleCommitMsg = [
        '#!/bin/bash',
        'set -e',
        'ID_EXISTS=$(node -e \'',
        '  const data = JSON.parse(fs.readFileSync("$TASK_STATUS_FILE", "utf-8"));',
        '  const ids = Object.keys(data.tasks || {});',
        '  console.log(ids.includes("$TASK_TRAILER") ? "yes" : "no");',
        '\' 2>/dev/null || echo "no")',
        'exit 0'
      ].join('\n');
      await writeFile(join(hooksDir, 'commit-msg'), staleCommitMsg, 'utf-8');

      await prepareWorktree(worktreeDir);

      const content = await readFile(join(hooksDir, 'commit-msg'), 'utf-8');
      expect(content).not.toBe(staleCommitMsg);
      expect(content).toBe(COMMIT_MSG_HOOK);
      // Assert hardened version: real id extraction via .map() not Object.keys
      expect(content).toContain('.map(t => String(t && t.id))');
      expect(content).not.toContain('Object.keys');
    });

    it('preserves exactly one entry per hook in settings after re-provisioning (no duplicates)', async () => {
      const settingsPath = join(worktreeDir, '.claude', 'settings.local.json');

      // Provision once
      await prepareWorktree(worktreeDir);
      const first = await readFile(settingsPath, 'utf-8');
      const firstSettings = JSON.parse(first);

      // Count pre-dispatch entries
      const preDispatchCount1 = (firstSettings.hooks.PreToolUse as Record<string, unknown>[]).filter(
        (e) => {
          const hooks = (e as { hooks?: Array<{ command?: string }> }).hooks;
          return hooks?.some((h) => typeof h.command === 'string' && h.command.includes('pre-dispatch.sh'));
        }
      ).length;

      // Provision again (re-provision stale hooks)
      await prepareWorktree(worktreeDir);
      const second = await readFile(settingsPath, 'utf-8');
      const secondSettings = JSON.parse(second);

      // Count should still be exactly 1, not duplicated
      const preDispatchCount2 = (secondSettings.hooks.PreToolUse as Record<string, unknown>[]).filter(
        (e) => {
          const hooks = (e as { hooks?: Array<{ command?: string }> }).hooks;
          return hooks?.some((h) => typeof h.command === 'string' && h.command.includes('pre-dispatch.sh'));
        }
      ).length;

      expect(preDispatchCount1).toBe(1);
      expect(preDispatchCount2).toBe(1);
      // Settings should be unchanged (idempotent)
      expect(second).toBe(first);
    });

    it('preserves unrelated user entries in .claude/settings.local.json across re-provisioning', async () => {
      const claudeDir = join(worktreeDir, '.claude');
      await mkdir(claudeDir, { recursive: true });
      const settingsPath = join(claudeDir, 'settings.local.json');

      const userSettings = {
        permissions: { allow: ['Bash(ls:*)', 'Bash(grep:*)'] },
        customKey: 'should-survive',
        nested: { data: 'preserve-me' }
      };
      await writeFile(settingsPath, JSON.stringify(userSettings), 'utf-8');

      // Provision (adds hook entries)
      await prepareWorktree(worktreeDir);

      const content = await readFile(settingsPath, 'utf-8');
      const settings = JSON.parse(content);

      // User-provided keys survive
      expect(settings.permissions).toEqual({ allow: ['Bash(ls:*)', 'Bash(grep:*)'] });
      expect(settings.customKey).toBe('should-survive');
      expect(settings.nested).toEqual({ data: 'preserve-me' });

      // Re-provision: user keys still survive
      await prepareWorktree(worktreeDir);
      const content2 = await readFile(settingsPath, 'utf-8');
      const settings2 = JSON.parse(content2);

      expect(settings2.permissions).toEqual({ allow: ['Bash(ls:*)', 'Bash(grep:*)'] });
      expect(settings2.customKey).toBe('should-survive');
      expect(settings2.nested).toEqual({ data: 'preserve-me' });
    });

    it('stays fail-open when session hook asset write fails: logs skip, provisioning succeeds', async () => {
      const hooksDir = join(worktreeDir, '.pipeline', 'session-hooks');
      await mkdir(hooksDir, { recursive: true });

      // Write old stale hooks that should be replaced
      await writeFile(join(hooksDir, 'pre-dispatch.sh'), 'stale', 'utf-8');

      // Make directory read-only to force write failure
      await chmod(hooksDir, 0o500);

      const lines: string[] = [];
      await expect(prepareWorktree(worktreeDir, (m) => lines.push(m))).resolves.toBeUndefined();

      await chmod(hooksDir, 0o700).catch(() => undefined);

      // Should have logged the skip, not thrown
      expect(lines.some((l) => /session hooks/i.test(l) && /skip/i.test(l))).toBe(true);
      // Provisioning should still succeed
      const env = await readFile(join(worktreeDir, '.env'), 'utf-8');
      expect(env).toContain(NAMESPACE_VAR);
    });

    it('overwrites both git hooks with hardened versions on re-provisioning', async () => {
      const hooksDir = join(worktreeDir, '.pipeline', 'git-hooks');
      await mkdir(hooksDir, { recursive: true });

      // Write stale versions of both git hooks
      const stalePrepareCommitMsg = '#!/bin/bash\necho "stale prepare-commit-msg"\nexit 0\n';
      const staleCommitMsg = '#!/bin/bash\necho "stale commit-msg"\nexit 0\n';
      await writeFile(join(hooksDir, 'prepare-commit-msg'), stalePrepareCommitMsg, 'utf-8');
      await writeFile(join(hooksDir, 'commit-msg'), staleCommitMsg, 'utf-8');

      // Provision
      await prepareWorktree(worktreeDir);

      // Both hooks are overwritten
      const prepareContent = await readFile(join(hooksDir, 'prepare-commit-msg'), 'utf-8');
      const commitContent = await readFile(join(hooksDir, 'commit-msg'), 'utf-8');

      expect(prepareContent).not.toBe(stalePrepareCommitMsg);
      expect(commitContent).not.toBe(staleCommitMsg);
      expect(prepareContent).toBe(PREPARE_COMMIT_MSG_HOOK);
      expect(commitContent).toBe(COMMIT_MSG_HOOK);
    });
  });

  // Task 14 (#505 Surface B): the mutation-gate hook asset is wired at
  // worktree provisioning alongside the pre/post-dispatch hooks.
  // Task 9 (#788): the docs-guard hook asset is wired at worktree provisioning
  // as its own, independent PreToolUse entry — not chained onto mutation-gate.
  describe('docs-guard hook wiring (Task 9)', () => {
    const settingsPath = (worktreeDir: string) =>
      join(worktreeDir, '.claude', 'settings.local.json');

    function findEntry(
      arr: unknown[] | undefined,
      matcher: string,
      substr: string,
    ): Record<string, unknown> | undefined {
      return (arr as Record<string, unknown>[] | undefined)?.find((e) => {
        const hooks = (e as { hooks?: Array<{ command?: string }> }).hooks;
        return (
          (e as { matcher?: string }).matcher === matcher &&
          hooks?.some((h) => typeof h.command === 'string' && h.command.includes(substr))
        );
      });
    }

    it('writes docs-guard.sh executable with the exported asset content', async () => {
      await prepareWorktree(dir);

      const docsGuardPath = join(dir, '.pipeline', 'session-hooks', 'docs-guard.sh');
      const content = await readFile(docsGuardPath, 'utf-8');
      expect(content).toBe(DOCS_GUARD_HOOK);
      const s = await stat(docsGuardPath);
      expect(s.mode & 0o777).toBe(0o755);
    });

    it('adds an Edit|Write|NotebookEdit PreToolUse entry and removes the retired mutation gate', async () => {
      await prepareWorktree(dir);

      const raw = await readFile(settingsPath(dir), 'utf-8');
      const settings = JSON.parse(raw);

      const docsGuardEntry = findEntry(settings.hooks.PreToolUse, 'Edit|Write|NotebookEdit', 'docs-guard.sh');
      expect(docsGuardEntry).toBeDefined();
      const cmd = (docsGuardEntry?.hooks as Array<{ command: string }>)[0].command;
      expect(cmd).toBe(join(dir, '.pipeline', 'session-hooks', 'docs-guard.sh'));

      const mutationGateEntry = findEntry(settings.hooks.PreToolUse, 'Edit|Write|NotebookEdit', 'mutation-gate.sh');
      expect(mutationGateEntry).toBeUndefined();
    });

    it('is idempotent across repeated provisioning runs: no duplicate docs-guard entries', async () => {
      await prepareWorktree(dir);
      await prepareWorktree(dir);

      const raw = await readFile(settingsPath(dir), 'utf-8');
      const settings = JSON.parse(raw);
      const preToolUse = settings.hooks.PreToolUse as Record<string, unknown>[];
      const docsGuardMatches = preToolUse.filter(
        (e) =>
          (e as { matcher?: string }).matcher === 'Edit|Write|NotebookEdit' &&
          (e as { hooks?: Array<{ command?: string }> }).hooks?.some((h) =>
            typeof h.command === 'string' && h.command.includes('docs-guard.sh'),
          ),
      );
      expect(docsGuardMatches).toHaveLength(1);
    });

    it('is fail-open when the docs-guard hook-file write fails: logs a skip, provisioning still succeeds', async () => {
      const hooksDir = join(dir, '.pipeline', 'session-hooks');
      await mkdir(hooksDir, { recursive: true });
      await chmod(hooksDir, 0o500);

      const lines: string[] = [];
      await expect(prepareWorktree(dir, (m) => lines.push(m))).resolves.toBeUndefined();

      await chmod(hooksDir, 0o700).catch(() => undefined);

      expect(lines.some((l) => /session hooks/i.test(l) && /skip/i.test(l))).toBe(true);
    });

    it('wires the docs-guard entry independently of mutation-gate presence', async () => {
      await prepareWorktree(dir);

      const raw = await readFile(settingsPath(dir), 'utf-8');
      const settings = JSON.parse(raw);
      // Manually strip the mutation-gate entry to simulate its absence, then
      // re-run provisioning: docs-guard wiring must not depend on it.
      settings.hooks.PreToolUse = (settings.hooks.PreToolUse as Record<string, unknown>[]).filter(
        (e) =>
          !(e as { hooks?: Array<{ command?: string }> }).hooks?.some((h) =>
            typeof h.command === 'string' && h.command.includes('mutation-gate.sh'),
          ),
      );
      await writeFile(settingsPath(dir), JSON.stringify(settings, null, 2), 'utf-8');

      await prepareWorktree(dir);

      const raw2 = await readFile(settingsPath(dir), 'utf-8');
      const settings2 = JSON.parse(raw2);
      expect(findEntry(settings2.hooks.PreToolUse, 'Edit|Write|NotebookEdit', 'docs-guard.sh')).toBeDefined();
    });
  });
});
