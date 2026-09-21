// Covers: task:24
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import {
  detectGithubBoundaryAuditCommand,
  dispatchGithubBoundaryAudit,
} from '../../../src/engine/github-invocation-audit-cli.js';

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true }))); });

async function fixtureRoot(source: string): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'github-boundary-audit-cli-'));
  directories.push(root);
  await mkdir(join(root, 'src', 'engine'), { recursive: true });
  await writeFile(join(root, 'src', 'engine', 'site.ts'), source);
  return root;
}

describe('github-boundary-audit command', () => {
  it('detects only its exact argv shapes', () => {
    expect(detectGithubBoundaryAuditCommand(['node', 'conduct', 'github-boundary-audit'])).toEqual({});
    expect(detectGithubBoundaryAuditCommand(['node', 'conduct', 'github-boundary-audit', '--root', '/x'])).toEqual({ root: '/x' });
    expect(detectGithubBoundaryAuditCommand(['node', 'conduct', 'github-boundary-audit', '--root'])).toBeNull();
    expect(detectGithubBoundaryAuditCommand(['node', 'conduct', 'github-operation'])).toBeNull();
  });

  it('exits non-zero and prints a file/site diagnostic when a bypass exists', async () => {
    const root = await fixtureRoot("import { execFile } from 'node:child_process'; await execFile('git', ['push', 'origin', 'main']);");
    const errors: string[] = [];
    const code = dispatchGithubBoundaryAudit({ root }, { stdout: () => {}, stderr: (line) => errors.push(line) });
    expect(code).toBe(1);
    expect(errors.join('\n')).toContain('engine/site.ts:1:');
    expect(errors.join('\n')).toContain('direct remote Git mutation outside executeRemoteGit');
  });

  it('refuses a direct injected read: no site-level read exemption exists', async () => {
    const root = await fixtureRoot("import type { GhRunner } from './tracker-client.js';\nexport async function f(gh: GhRunner) { await gh(['pr', 'view', 'x', '--json', 'body'], { cwd: '.' }); }\n");
    const errors: string[] = [];
    expect(dispatchGithubBoundaryAudit({ root }, { stdout: () => {}, stderr: (line) => errors.push(line) })).toBe(1);
    expect(errors.join('\n')).toContain('direct injected GitHub read outside guarded adapter');
  });

  it('exits zero and reports the audited file count for a clean runtime', async () => {
    const root = await fixtureRoot('export const value = 1;\n');
    const lines: string[] = [];
    expect(dispatchGithubBoundaryAudit({ root }, { stdout: (line) => lines.push(line), stderr: () => {} })).toBe(0);
    expect(lines.join('\n')).toContain('1 runtime file');
  });
});
