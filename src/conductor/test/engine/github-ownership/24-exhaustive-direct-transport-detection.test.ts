// Covers: task:24
// Every direct GitHub transport use in shipped runtime source is a finding,
// read or write, whatever alias reaches the process or HTTP boundary.
import { describe, expect, it } from 'vitest';
import { auditGithubInvocationSource, findGithubInvocationSites } from '../../../src/engine/github-invocation-audit.js';

const READ = 'direct GitHub read outside guarded adapter';
const MUTATION = 'direct GitHub mutation outside guarded adapter';
const INJECTED_READ = 'direct injected GitHub read outside guarded adapter';
const INJECTED_MUTATION = 'direct injected GitHub mutation outside guarded adapter';
const UNRESOLVABLE = 'unresolvable executable command construction for gh';
const SHELL = 'unapproved executable GitHub or remote-Git shell block';
const HTTP = 'unapproved raw GitHub HTTP client invocation outside guarded adapter';

const messages = (file: string, source: string): string[] => auditGithubInvocationSource(file, source).map((finding) => finding.message);

describe('exhaustive direct GitHub transport detection', () => {
  it('reports a literal gh read through a promisified child-process alias', () => {
    const source = [
      "import { execFile as execFileCb } from 'child_process';",
      "import { promisify } from 'util';",
      'const execFile = promisify(execFileCb);',
      "async function merged(prUrl: string) { const { stdout } = await execFile('gh', ['pr', 'view', prUrl, '--json', 'state']); return stdout; }",
    ].join('\n');
    expect(auditGithubInvocationSource('engine/worktree.ts', source)).toEqual([
      expect.objectContaining({ line: 4, message: READ }),
    ]);
    expect(findGithubInvocationSites('engine/worktree.ts', source)).toEqual([
      expect.objectContaining({ command: 'gh', classification: 'github-read' }),
    ]);
  });

  it('reports every literal gh invocation, including local probes such as --version', () => {
    const source = [
      "import { execFile as execFileCb } from 'node:child_process';",
      "import { promisify } from 'node:util';",
      'const execFile = promisify(execFileCb);',
      "const probe = async () => execFile('gh', ['--version']);",
    ].join('\n');
    expect(messages('engine/gh-version-floor.ts', source)).toEqual([READ]);
  });

  it('reports a literal gh read via execFileSync, spawn, and spawnSync', () => {
    for (const factory of ['execFileSync', 'spawn', 'spawnSync']) {
      const source = `import { ${factory} } from 'node:child_process'; ${factory}('gh', ['api', 'user']);`;
      expect(messages('engine/bypass.ts', source)).toEqual([READ]);
    }
  });

  it('reports shell strings that run gh through exec, execSync, sh -c, bash -c, or shell: true', () => {
    const cases = [
      "import { exec } from 'node:child_process'; exec('gh pr view 1 --json state');",
      "import { execSync } from 'node:child_process'; execSync(`gh pr view ${url} --json headRefName`);",
      "import { execFile } from 'node:child_process'; execFile('sh', ['-c', `gh pr view \"${url}\" --json headRefName --jq '.headRefName'`]);",
      "import { execFile } from 'node:child_process'; execFile('bash', ['-lc', 'gh issue view 7 --json state']);",
      "import { spawn } from 'node:child_process'; spawn('gh api user', [], { shell: true });",
      "import { execa } from 'execa'; execa('gh auth status', { shell: true });",
    ];
    for (const source of cases) expect(messages('engine/bypass.ts', source), source).toEqual([SHELL]);
  });

  it('reports a gh executable resolved from an in-file constant or forwarded through an in-file wrapper', () => {
    const constant = [
      "import { execFile } from 'node:child_process';",
      "const GH = 'gh';",
      "await execFile(GH, ['repo', 'view', '--json', 'nameWithOwner']);",
    ].join('\n');
    const wrapper = [
      "import { execFile } from 'node:child_process';",
      'function run(bin: string, args: string[]) { return execFile(bin, args, { cwd: process.cwd() }); }',
      "await run('gh', ['pr', 'list', '--state', 'open']);",
      "await run(binary, ['pr', 'list', '--state', 'open']);",
    ].join('\n');
    expect(auditGithubInvocationSource('engine/bypass.ts', constant)).toEqual([expect.objectContaining({ line: 3, message: READ })]);
    expect(auditGithubInvocationSource('engine/bypass.ts', wrapper)).toEqual([
      expect.objectContaining({ line: 3, message: READ }),
      expect.objectContaining({ line: 4, message: UNRESOLVABLE }),
    ]);
  });

  it('reports gh reached through a dynamic child_process import or require', () => {
    const dynamic = [
      'const run = () => new Promise((resolve) => {',
      "  void import('node:child_process').then(({ spawn }) => { spawn('gh', ['pr', 'view', '1']); resolve(undefined); });",
      '});',
    ].join('\n');
    const required = "const { execFileSync } = require('node:child_process'); execFileSync('gh', ['api', 'user']);";
    expect(messages('engine/bypass.ts', dynamic)).toEqual([READ]);
    expect(messages('engine/bypass.ts', required)).toEqual([READ]);
  });

  it('reports nullish-coalesced, conditional, and parenthesized runner aliases built from makeProductionGh', () => {
    const coalesced = [
      "import { makeProductionGh } from './tracker-client.js';",
      'export async function dispatch(opts: DispatchOpts) {',
      '  const gh = opts.gh ?? makeProductionGh();',
      "  const { stdout } = await gh(['repo', 'view', '--json', 'nameWithOwner'], { cwd: process.cwd() });",
      "  await gh(['issue', 'list', '--state', 'open', '--json', 'number,body', '--limit', '500'], { cwd: process.cwd() });",
      '  return stdout;',
      '}',
    ].join('\n');
    const parenthesized = [
      "import { makeProductionGh } from './tracker-client.js';",
      'async function shipped(opts: { runGh?: unknown; projectRoot: string }, head: string) {',
      "  const { stdout } = await (opts.runGh ?? makeProductionGh())(['pr', 'list', '--state', 'merged', '--head', head, '--json', 'url', '--limit', '1'], { cwd: opts.projectRoot });",
      '  return stdout;',
      '}',
    ].join('\n');
    const conditional = [
      "import { makeProductionGh as productionGh } from './tracker-client.js';",
      'async function run(fake: unknown, useFake: boolean) {',
      '  const runner = useFake ? fake : productionGh();',
      "  await runner(['pr', 'edit', 'https://github.com/acme/app/pull/1', '--add-label', 'x'], { cwd: '/tmp' });",
      '}',
    ].join('\n');
    expect(auditGithubInvocationSource('engine/engineer-cli.ts', coalesced)).toEqual([
      expect.objectContaining({ line: 4, message: INJECTED_READ }),
      expect.objectContaining({ line: 5, message: INJECTED_READ }),
    ]);
    expect(auditGithubInvocationSource('engine/park-reconciliation.ts', parenthesized)).toEqual([
      expect.objectContaining({ line: 3, message: INJECTED_READ }),
    ]);
    expect(auditGithubInvocationSource('engine/bypass.ts', conditional)).toEqual([
      expect.objectContaining({ line: 4, message: INJECTED_MUTATION }),
    ]);
  });

  it('reports runners typed structurally or through an imported options type under a conventional name', () => {
    const structural = [
      'interface Opts { gh?: (args: string[], opts: { cwd: string }) => Promise<{ stdout: string }> }',
      "async function poll(opts: Opts) { const gh = opts.gh!; await gh(['issue', 'view', '7', '--repo', 'acme/app', '--json', 'state'], { cwd: '/x' }); }",
    ].join('\n');
    const imported = [
      "import type { ReconcileOpts } from './types.js';",
      "export async function reconcile({ runGh, projectRoot }: ReconcileOpts) { await runGh(['pr', 'list', '--json', 'number'], { cwd: projectRoot }); }",
    ].join('\n');
    const property = [
      'export async function finish(ctx: { ghRunner?: unknown; dir: string }) {',
      "  const { stdout } = await ctx.ghRunner(['pr', 'view', 'x', '--json', 'isDraft'], { cwd: ctx.dir });",
      '  return stdout;',
      '}',
    ].join('\n');
    expect(messages('engine/intake-loop-cli.ts', structural)).toEqual([INJECTED_READ]);
    expect(messages('engine/halt-pr-reconciliation.ts', imported)).toEqual([INJECTED_READ]);
    expect(messages('engine/artifacts.ts', property)).toEqual([INJECTED_READ]);
  });

  it('reports raw GitHub HTTP transports at import and at call, including https and URL-object requests', () => {
    const octokitImport = "import { Octokit } from 'octokit';\nexport const client = { Octokit };";
    const httpsRequest = "import https from 'node:https'; https.request('https://api.github.com/user', () => {});";
    const httpsGet = "import { get } from 'node:https'; get(new URL('https://api.github.com/repos/acme/app'));";
    const fetchTemplate = 'await fetch(`https://api.github.com/repos/${repo}/pulls`);';
    const fetchUrl = "await fetch(new URL('/repos/acme/app', 'https://api.github.com'));";
    expect(messages('engine/bypass.ts', octokitImport)).toEqual([HTTP]);
    expect(messages('engine/bypass.ts', httpsRequest)).toEqual([HTTP]);
    expect(messages('engine/bypass.ts', httpsGet)).toEqual([HTTP]);
    expect(messages('engine/bypass.ts', fetchTemplate)).toEqual([HTTP]);
    expect(messages('engine/bypass.ts', fetchUrl)).toEqual([HTTP]);
  });

  it('still treats local Git, unrelated executables, and non-GitHub shell strings as clean', () => {
    const cases = [
      "import { execFile } from 'node:child_process'; await execFile('git', ['status']);",
      "import { execa } from 'execa'; import { join } from 'node:path'; await execa(join(root, 'setup.sh'), []);",
      "import { execFile } from 'node:child_process'; await execFile('sh', ['-c', 'npm test']);",
      "import { spawn } from 'node:child_process'; spawn('tmux', ['ls']);",
      "const ghost = 'ghost'; import { execFile } from 'node:child_process'; await execFile(ghost, ['--version']);",
      "await fetch('https://example.com/health');",
    ];
    for (const source of cases) expect(messages('engine/clean.ts', source), source).toEqual([]);
  });

  it('still admits only the production transport call inside tracker-client.ts', () => {
    const transport = [
      "import { execFile as execFileCb } from 'node:child_process';",
      "import { promisify } from 'node:util';",
      'const execFileP = promisify(execFileCb);',
      "export function makeProductionGh() { return async (args: string[], opts: { cwd: string }) => execFileP('gh', args, { cwd: opts.cwd }); }",
    ].join('\n');
    const extraRead = `${transport}\nexport async function peek() { return execFileP('gh', ['api', 'user']); }`;
    expect(messages('engine/tracker-client.ts', transport)).toEqual([]);
    expect(messages('engine/tracker-client.ts', extraRead)).toEqual([READ]);
    expect(messages('engine/other.ts', transport)).toEqual([UNRESOLVABLE]);
  });
});
