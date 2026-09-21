// Covers: task:24
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  auditGithubInvocationSource,
  auditShippedGithubInvocationBoundary,
  findGithubInvocationSites,
  SHIPPED_MUTATION_OPERATION_CALLER_PROOFS,
} from '../../../src/engine/github-invocation-audit.js';
import { GITHUB_OPERATION_REGISTRY } from '../../../src/engine/github-operations.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

describe('GitHub invocation audit', () => {
  it('uses TypeScript syntax rather than comments or documentation-like strings', () => {
    expect(auditGithubInvocationSource('example.ts', "// import { execFile } from 'node:child_process';\nconst guide = 'gh pr create';")).toEqual([]);
    expect(auditGithubInvocationSource('example.ts', "import { execFile } from 'node:child_process';\nexecFile('gh', ['pr', 'create']);")).not.toEqual([]);
  });

  it('follows aliased process factories and reports a source location for bypasses', () => {
    const source = [
      "import { execFile as childProcessExec } from 'node:child_process';",
      "import { promisify } from 'node:util';",
      'const run = promisify(childProcessExec);',
      "await run('gh', ['pr', 'create']);",
    ].join('\n');
    expect(auditGithubInvocationSource('engine/bypass.ts', source)).toEqual([
      expect.objectContaining({ file: 'engine/bypass.ts', line: 4, message: 'direct GitHub mutation outside guarded adapter' }),
    ]);
  });

  it('rejects injected GhRunner writes and mutable command forwarding outside guarded adapters', () => {
    const direct = [
      "import type { GhRunner } from './tracker-client.js';",
      'async function write(gh: GhRunner) { await gh([\'pr\', \'edit\', \'https://github.com/acme/app/pull/1\']); }',
    ].join('\n');
    const forwarding = [
      "import type { GhRunner } from './tracker-client.js';",
      'async function write(gh: GhRunner, argv: string[]) { await gh(argv, { cwd: \'/tmp\' }); }',
    ].join('\n');
    const destructured = [
      "import type { GhRunner } from './tracker-client.js';",
      'async function write(deps: { gh: GhRunner }) {',
      "  const { gh: run } = deps; await run(['pr', 'edit', 'https://github.com/acme/app/pull/1']);",
      '}',
    ].join('\n');
    const propertyAlias = [
      "import type { GhRunner } from './tracker-client.js';",
      'interface Dependencies { gh: GhRunner }',
      'async function write(deps: Dependencies) {',
      "  const run = deps.gh; await run(['pr', 'edit', 'https://github.com/acme/app/pull/1']);",
      '}',
    ].join('\n');
    const propertyCall = [
      "import type { GhRunner } from './tracker-client.js';",
      'interface Dependencies { gh: GhRunner }',
      'async function write(deps: Dependencies) {',
      "  await deps.gh(['pr', 'edit', 'https://github.com/acme/app/pull/1']);",
      '}',
    ].join('\n');
    const readOnlyForwarding = [
      "import { createBlockerResolver } from './blocker-resolver.js';",
      "import type { GhRunner } from './tracker-client.js';",
      'function read(deps: { gh: GhRunner }) {',
      "  const { gh: run } = deps; return createBlockerResolver({ run: (args) => run(args, { cwd: '/tmp' }) });",
      '}',
    ].join('\n');
    expect(auditGithubInvocationSource('engine/bypass.ts', direct)[0]).toMatchObject({ message: 'direct injected GitHub mutation outside guarded adapter' });
    expect(auditGithubInvocationSource('engine/bypass.ts', forwarding)[0]).toMatchObject({ message: 'unresolvable mutable GitHub command forwarding outside guarded adapter' });
    expect(auditGithubInvocationSource('engine/bypass.ts', destructured)[0]).toMatchObject({ line: 3, message: 'direct injected GitHub mutation outside guarded adapter' });
    expect(auditGithubInvocationSource('engine/bypass.ts', propertyAlias)[0]).toMatchObject({ line: 4, message: 'direct injected GitHub mutation outside guarded adapter' });
    expect(auditGithubInvocationSource('engine/bypass.ts', propertyCall)[0]).toMatchObject({ line: 4, message: 'direct injected GitHub mutation outside guarded adapter' });
    expect(auditGithubInvocationSource('engine/bypass.ts', readOnlyForwarding)).toEqual([]);
    expect(auditGithubInvocationSource('engine/tracker-client.ts', direct)[0]).toMatchObject({ message: 'direct injected GitHub mutation outside guarded adapter' });
  });

  it('does not exempt a daemon composition file from injected runner mutations', () => {
    const source = [
      "import type { GhRunner } from './engine/tracker-client.js';",
      'interface Dependencies { gh: GhRunner }',
      'async function write(deps: Dependencies) {',
      "  await deps.gh(['issue', 'close', 'https://github.com/acme/app/issues/1']);",
      '}',
    ].join('\n');
    expect(auditGithubInvocationSource('daemon-cli.ts', source)).toEqual([
      expect.objectContaining({ line: 4, message: 'direct injected GitHub mutation outside guarded adapter' }),
    ]);
  });

  it('permits only the exact canonical adapter transport call', () => {
    const canonical = [
      "import type { GhRunner } from './tracker-client.js';",
      'interface Options { cwd: string }',
      'function createGuardedGithubOperationRunner(transport: GhRunner, options: Options) {',
      '  return { async run(request: unknown) {',
      '    await transport(ghArgsFor(request), { cwd: options.cwd });',
      '  } };',
      '}',
    ].join('\n');
    const nameOnlyBypass = [
      "import type { GhRunner } from './tracker-client.js';",
      'function createGuardedGithubOperationRunner(transport: GhRunner) {',
      "  return transport(['pr', 'create'], { cwd: '/tmp' });",
      '}',
    ].join('\n');
    const trackerBypass = [
      "import type { GhRunner } from './tracker-client.js';",
      'interface Options { cwd: string }',
      'function createGuardedGithubOperationRunner(transport: GhRunner, options: Options) {',
      "  return transport(['pr', 'create'], { cwd: options.cwd });",
      '}',
    ].join('\n');
    expect(auditGithubInvocationSource('engine/tracker-client.ts', canonical)).toEqual([]);
    expect(auditGithubInvocationSource('engine/adapter.ts', nameOnlyBypass)).toEqual([
      expect.objectContaining({ line: 3, message: 'direct injected GitHub mutation outside guarded adapter' }),
    ]);
    expect(auditGithubInvocationSource('engine/tracker-client.ts', trackerBypass)).toEqual([
      expect.objectContaining({ line: 4, message: 'direct injected GitHub mutation outside guarded adapter' }),
    ]);
  });

  it('detects execa, default child-process, and global fetch GitHub writes', () => {
    const execaWrite = "import { execa } from 'execa'; await execa('gh', ['pr', 'create']);";
    const defaultChildProcessWrite = [
      "import childProcess from 'node:child_process';",
      "await childProcess.execFile('gh', ['issue', 'close', 'https://github.com/acme/app/issues/1']);",
    ].join('\n');
    const globalFetchWrite = "await fetch('https://api.github.com/repos/acme/app/issues/1', { method: 'PATCH' });";
    const globalThisFetchWrite = "await globalThis.fetch('https://api.github.com/repos/acme/app/issues/1', { method: 'PATCH' });";

    expect(auditGithubInvocationSource('engine/bypass.ts', execaWrite)).toEqual([
      expect.objectContaining({ line: 1, message: 'direct GitHub mutation outside guarded adapter' }),
    ]);
    expect(auditGithubInvocationSource('engine/bypass.ts', defaultChildProcessWrite)).toEqual([
      expect.objectContaining({ line: 2, message: 'direct GitHub mutation outside guarded adapter' }),
    ]);
    expect(auditGithubInvocationSource('engine/bypass.ts', globalFetchWrite)).toEqual([
      expect.objectContaining({ line: 1, message: 'unapproved raw GitHub HTTP client invocation outside guarded adapter' }),
    ]);
    expect(auditGithubInvocationSource('engine/bypass.ts', globalThisFetchWrite)).toEqual([
      expect.objectContaining({ line: 1, message: 'unapproved raw GitHub HTTP client invocation outside guarded adapter' }),
    ]);
  });

  it('does not exempt pr-labels: mutable aliases and unclassified literal reads fail', () => {
    const mutableAlias = [
      "import type { GhRunner } from './tracker-client.js';",
      'async function write(runGh: GhRunner) {',
      '  const gh = runGh;',
      "  await gh(['issue', 'comment', 'https://github.com/acme/app/issues/1'], { cwd: '/tmp' });",
      '}',
    ].join('\n');
    const literalRead = [
      "import type { GhRunner } from './tracker-client.js';",
      'async function read(runGh: GhRunner) {',
      "  await runGh(['issue', 'view', 'https://github.com/acme/app/issues/1', '--json', 'comments'], { cwd: '/tmp' });",
      '}',
    ].join('\n');

    expect(auditGithubInvocationSource('engine/pr-labels.ts', mutableAlias)).toEqual([
      expect.objectContaining({
        line: 4,
        message: 'direct injected GitHub mutation outside guarded adapter',
      }),
    ]);
    expect(auditGithubInvocationSource('engine/pr-labels.ts', literalRead)).toEqual([
      expect.objectContaining({ line: 3, message: 'direct injected GitHub read outside guarded adapter' }),
    ]);
  });

  it('does not let the intake-label workflow script inherit a whole-file read exception', () => {
    const source = [
      "import type { GhRunner } from '../src/engine/tracker-client.js';",
      'async function bypass(gh: GhRunner) {',
      "  await gh(['issue', 'view', '7', '-R', 'acme/app'], { cwd: '/tmp' });",
      '}',
    ].join('\n');
    expect(auditGithubInvocationSource('scripts/intake-label-sync-apply.mts', source)).toEqual([
      expect.objectContaining({ line: 3, message: 'direct injected GitHub read outside guarded adapter' }),
    ]);
  });

  it('does not let migration or repair-publisher function names suppress raw writes', () => {
    const dependencyMigration = [
      "import type { GhRunner } from './tracker-client.js';",
      'async function createDependencyLinks(gh: GhRunner) {',
      "  await gh(['api', '--method', 'POST', 'repos/acme/app/issues/1/dependencies/blocked_by']);",
      '}',
    ].join('\n');
    const repairPublisher = [
      "import type { GhRunner } from './tracker-client.js';",
      'function makeProductionRepairPublisher(runGh: GhRunner) {',
      '  return {',
      "    async findOrCreateRepairPullRequest() { await runGh(['pr', 'create']); },",
      "    async postStatus() { await runGh(['api', '--method', 'POST', 'repos/acme/app/statuses/abc']); },",
      '  };',
      '}',
    ].join('\n');

    expect(auditGithubInvocationSource('engine/engineer/issue-dep-migration.ts', dependencyMigration)).toEqual([
      expect.objectContaining({ line: 3, message: 'direct injected GitHub mutation outside guarded adapter' }),
    ]);
    expect(auditGithubInvocationSource('engine/shipment-evidence-cli.ts', repairPublisher)).toEqual([
      expect.objectContaining({ line: 4, message: 'direct injected GitHub mutation outside guarded adapter' }),
      expect.objectContaining({ line: 5, message: 'direct injected GitHub mutation outside guarded adapter' }),
    ]);
  });

  it('preserves local Git but rejects remote mutation and mutable forwarding', () => {
    const local = "import { execFile } from 'node:child_process'; await execFile('git', ['status']);";
    const remote = "import { execFile } from 'node:child_process'; await execFile('git', ['push', 'origin', 'main']);";
    const forwarded = "import { execFile } from 'node:child_process'; await execFile('gh', argv);";
    expect(auditGithubInvocationSource('engine/local.ts', local)).toEqual([]);
    expect(auditGithubInvocationSource('engine/bypass.ts', remote)[0]).toMatchObject({ message: 'direct remote Git mutation outside executeRemoteGit' });
    expect(auditGithubInvocationSource('engine/bypass.ts', forwarded)[0]).toMatchObject({ message: 'unresolvable executable command construction for gh' });
  });

  it('allows the guarded adapter but rejects raw GitHub HTTP clients elsewhere', () => {
    const source = "import { Octokit } from '@octokit/rest'; new Octokit();";
    expect(auditGithubInvocationSource('engine/tracker-client.ts', source)[0]).toMatchObject({ message: 'unapproved raw GitHub HTTP client invocation outside guarded adapter' });
    expect(auditGithubInvocationSource('engine/bypass.ts', source)[0]).toMatchObject({ message: 'unapproved raw GitHub HTTP client invocation outside guarded adapter' });
  });

  it('permits only the actual production gh transport call, not its whole adapter file', () => {
    const productionTransport = [
      "import { execFile as execFileCb } from 'node:child_process';",
      "import { promisify } from 'node:util';",
      'const execFileP = promisify(execFileCb);',
      'function makeProductionGh(args: string[]) { return execFileP(\'gh\', args); }',
    ].join('\n');
    const trackerBypass = [
      "import { execFile } from 'node:child_process';",
      "await execFile('gh', ['pr', 'create']);",
    ].join('\n');
    const remoteBypass = [
      "import { execFile } from 'node:child_process';",
      "await execFile('git', ['push', 'origin', 'main']);",
    ].join('\n');
    const guardedRemoteTransport = [
      'async function executeRemoteGit(args: string[], dependencies: any) {',
      '  await dependencies.runRemoteGit([...args], { cwd: dependencies.cwd });',
      '}',
    ].join('\n');
    const remoteRunnerBypass = [
      'async function unrelated(dependencies: any) {',
      "  await dependencies.runRemoteGit(['push', 'origin', 'main'], { cwd: dependencies.cwd });",
      '}',
    ].join('\n');

    expect(auditGithubInvocationSource('engine/tracker-client.ts', productionTransport)).toEqual([]);
    expect(auditGithubInvocationSource('engine/tracker-client.ts', trackerBypass)).toEqual([
      expect.objectContaining({ line: 2, message: 'direct GitHub mutation outside guarded adapter' }),
    ]);
    expect(auditGithubInvocationSource('engine/remote-git-operations.ts', remoteBypass)).toEqual([
      expect.objectContaining({ line: 2, message: 'direct remote Git mutation outside executeRemoteGit' }),
    ]);
    expect(auditGithubInvocationSource('engine/remote-git-operations.ts', guardedRemoteTransport)).toEqual([]);
    expect(auditGithubInvocationSource('engine/remote-git-operations.ts', remoteRunnerBypass)).toEqual([
      expect.objectContaining({ line: 2, message: 'direct remote Git mutation outside executeRemoteGit' }),
    ]);
  });

  it('scans runtime only and emits a diagnostic for its actual executable site', async () => {
    const root = await mkdtemp(join(tmpdir(), 'github-invocation-audit-'));
    directories.push(root);
    await mkdir(join(root, 'src', 'engine'), { recursive: true });
    await mkdir(join(root, 'test'), { recursive: true });
    await mkdir(join(root, 'skills', 'bootstrap'), { recursive: true });
    await writeFile(join(root, 'src', 'engine', 'bypass.ts'), "import { execFile } from 'node:child_process'; await execFile('git', ['push', 'origin', 'main']);");
    await writeFile(join(root, 'test', 'historical.ts'), "import { execFile } from 'node:child_process'; await execFile('git', ['push', 'origin', 'main']);");
    await writeFile(join(root, 'skills', 'bootstrap', 'SKILL.md'), '```bash\ngh pr edit 1 --body repaired\n```\n');
    expect(auditShippedGithubInvocationBoundary(root)).toContainEqual(expect.objectContaining({ file: 'engine/bypass.ts', message: 'direct remote Git mutation outside executeRemoteGit' }));
    expect(auditShippedGithubInvocationBoundary(root)).toContainEqual(expect.objectContaining({ file: 'skills/bootstrap/SKILL.md', message: expect.stringContaining('raw GitHub') }));
    expect(findGithubInvocationSites('engine/bypass.ts', await readFile(join(root, 'src', 'engine', 'bypass.ts'), 'utf8'))).toEqual([
      expect.objectContaining({ command: 'git', classification: 'remote-write' }),
    ]);
  });

  it('requires an explicit caller proof for every registered mutation', () => {
    const writes = Object.entries(GITHUB_OPERATION_REGISTRY).filter(([, definition]) => definition.access !== 'read').map(([operation]) => operation).sort();
    expect(Object.keys(SHIPPED_MUTATION_OPERATION_CALLER_PROOFS).sort()).toEqual(writes);
  });

  it('accepts only the classified shipped invocation inventory', () => {
    expect(auditShippedGithubInvocationBoundary(resolve(__dirname, '../../..'))).toEqual([]);
  });
});
