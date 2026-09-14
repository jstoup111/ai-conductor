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
    expect(auditGithubInvocationSource('engine/bypass.ts', direct)[0]).toMatchObject({ message: 'direct injected GitHub mutation outside guarded adapter' });
    expect(auditGithubInvocationSource('engine/bypass.ts', forwarding)[0]).toMatchObject({ message: 'unresolvable mutable GitHub command forwarding outside guarded adapter' });
    expect(auditGithubInvocationSource('engine/tracker-client.ts', direct)).toEqual([]);
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
    expect(auditGithubInvocationSource('engine/tracker-client.ts', source)).toEqual([]);
    expect(auditGithubInvocationSource('engine/bypass.ts', source)[0]).toMatchObject({ message: 'unapproved raw GitHub HTTP client invocation outside guarded adapter' });
  });

  it('scans runtime only and emits a diagnostic for its actual executable site', async () => {
    const root = await mkdtemp(join(tmpdir(), 'github-invocation-audit-'));
    directories.push(root);
    await mkdir(join(root, 'src', 'engine'), { recursive: true });
    await mkdir(join(root, 'test'), { recursive: true });
    await writeFile(join(root, 'src', 'engine', 'bypass.ts'), "import { execFile } from 'node:child_process'; await execFile('git', ['push', 'origin', 'main']);");
    await writeFile(join(root, 'test', 'historical.ts'), "import { execFile } from 'node:child_process'; await execFile('git', ['push', 'origin', 'main']);");
    expect(auditShippedGithubInvocationBoundary(root)).toContainEqual(expect.objectContaining({ file: 'engine/bypass.ts', message: 'direct remote Git mutation outside executeRemoteGit' }));
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
