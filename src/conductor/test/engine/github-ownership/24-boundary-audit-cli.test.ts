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

async function fixtureSkill(root: string, source: string): Promise<void> {
  await mkdir(join(root, 'skills', 'example'), { recursive: true });
  await writeFile(join(root, 'skills', 'example', 'SKILL.md'), source);
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

  it('refuses a literal gh read through a promisified child-process alias', async () => {
    const root = await fixtureRoot([
      "import { execFile as execFileCb } from 'child_process';",
      "import { promisify } from 'util';",
      'const execFile = promisify(execFileCb);',
      "export const merged = (url: string) => execFile('gh', ['pr', 'view', url, '--json', 'state']);",
    ].join('\n'));
    const errors: string[] = [];
    expect(dispatchGithubBoundaryAudit({ root }, { stdout: () => {}, stderr: (line) => errors.push(line) })).toBe(1);
    expect(errors.join('\n')).toContain('engine/site.ts:4:');
    expect(errors.join('\n')).toContain('direct GitHub read outside guarded adapter');
  });

  it('exits zero and reports the audited file count for a clean runtime', async () => {
    const root = await fixtureRoot('export const value = 1;\n');
    const lines: string[] = [];
    expect(dispatchGithubBoundaryAudit({ root }, { stdout: (line) => lines.push(line), stderr: () => {} })).toBe(0);
    expect(lines.join('\n')).toContain('1 runtime file');
  });

  it('fails through the production entry point for newly discovered blocked engine and skill instructions', async () => {
    const root = await fixtureRoot("// ai-conductor:session-command-context=managed\nexport const systemPrompt = 'Run ai-conductor daemon park feature';\n// /ai-conductor:session-command-context\n");
    await writeFile(join(root, 'src', 'engine', 'step-runners.ts'), "// ai-conductor:session-command-context=managed\nexport const buildRetryHint = 'Run ai-conductor daemon park feature';\n// /ai-conductor:session-command-context\n");
    await fixtureSkill(root, '```bash\nai-conductor config init\n```\n');
    await mkdir(join(root, 'skills', 'bootstrap'), { recursive: true });
    await writeFile(join(root, 'skills', 'bootstrap', 'SKILL.md'), '```bash\nai-conductor config init\n```\n');
    const errors: string[] = [];

    expect(dispatchGithubBoundaryAudit({ root }, { stdout: () => {}, stderr: (line) => errors.push(line) })).toBe(1);
    expect(errors.join('\n')).toContain('engine/step-runners.ts:2:');
    expect(errors.join('\n')).toMatch(/blocked subcommand: daemon/i);
    expect(errors.join('\n')).toContain('skills/bootstrap/SKILL.md:2:');
    expect(errors.join('\n')).toMatch(/blocked subcommand: config/i);
  });

  it('discovers shipped skills from the repository root above a packaged conductor root', async () => {
    const repository = await mkdtemp(join(tmpdir(), 'github-boundary-audit-repository-'));
    directories.push(repository);
    const conductorRoot = join(repository, 'packages', 'conductor');
    await mkdir(join(conductorRoot, 'src', 'engine'), { recursive: true });
    await writeFile(join(conductorRoot, 'package.json'), '{}\n');
    await writeFile(join(conductorRoot, 'src', 'engine', 'site.ts'), 'export const value = 1;\n');
    await fixtureSkill(repository, '```bash\nai-conductor config init\n```\n');
    const errors: string[] = [];

    expect(dispatchGithubBoundaryAudit({ root: conductorRoot }, { stdout: () => {}, stderr: (line) => errors.push(line) })).toBe(1);
    expect(errors.join('\n')).toContain('skills/example/SKILL.md:2:');
    expect(errors.join('\n')).toMatch(/blocked subcommand: config/i);
  });
});
