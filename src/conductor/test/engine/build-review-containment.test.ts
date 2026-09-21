// Covers: task:13
import { describe, expect, it, vi } from 'vitest';
import { join } from 'node:path';

import {
  composeReviewLaunchMounts,
  deriveExecutableRuntimeRoots,
  prepareBuildReviewContainment,
  type BuildReviewRuntimeHost,
} from '../../src/engine/build-review-containment.js';
import {
  acquireReviewScratchHome,
  resolveReviewScratchHome,
  resolveScratchHome,
  type ReviewScratchFs,
} from '../../src/engine/self-host/provider-scratch.js';
import { copySelectedCodexLogin } from '../../src/execution/codex-self-host-auth.js';

const PATHS = {
  frozenSource: '/review/frozen-source', policyMaterial: '/review/policy',
  originalCheckout: '/review/original', originalInstallation: '/review/installed-policy',
  engineEvidence: '/review/engine-evidence', siblingEvidence: '/review/sibling-evidence',
  scratch: '/review/private-scratch', sourceWriteProbe: '/review/frozen-source/sentinel',
  installationWriteProbe: '/review/installed-policy/sentinel',
  engineStateWriteProbe: '/review/engine-evidence/sentinel',
  scratchWriteProbe: '/review/private-scratch/sentinel',
  siblingEvidenceProbe: '/review/sibling-evidence/result.json',
  hostStateProbe: '/review/private-scratch.host-state-probe',
};

/** A fixed host: nvm-style node, a native claude symlink, an npm-installed codex. No real filesystem is read. */
const HOST_LINKS: Record<string, string> = {
  '/home/op/.nvm/versions/node/v22/bin/node': '/home/op/.nvm/versions/node/v22/bin/node',
  '/home/op/.local/bin/claude': '/home/op/.local/share/claude/versions/2.1.0',
  '/home/op/.nvm/versions/node/v22/bin/codex': '/home/op/.nvm/versions/node/v22/lib/node_modules/@openai/codex/bin/codex.js',
  '/usr/bin/git': '/usr/bin/git',
};
const runtimeHost: BuildReviewRuntimeHost = {
  execPath: '/home/op/.nvm/versions/node/v22/bin/node',
  pathEnv: '/home/op/.local/bin:/home/op/.nvm/versions/node/v22/bin:/usr/bin',
  home: '/home/op',
  realpath: (path) => {
    const real = HOST_LINKS[path];
    if (real === undefined) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    return real;
  },
};
const HEALTHY_PROBE = [
  'source-write-refused', 'installation-write-refused', 'engine-state-write-refused',
  'scratch-write-succeeded', 'sibling-evidence-withheld', 'nested-sandbox-available', 'host-state-withheld',
];

function bindTriples(args: readonly string[]): Array<readonly [string, string, string]> {
  const triples: Array<readonly [string, string, string]> = [];
  args.forEach((flag, index) => {
    if (/^--(ro-|dev-)?bind(-try)?$/.test(flag)) triples.push([flag, args[index + 1]!, args[index + 2]!]);
  });
  return triples;
}

function secureReviewScratchFs(overrides: Partial<ReviewScratchFs> = {}): ReviewScratchFs {
  return {
    mkdir: async () => {},
    lstat: async () => ({ uid: process.getuid?.() ?? 0, mode: 0o700, isSymbolicLink: () => false, isDirectory: () => true }),
    mkdtemp: async (prefix) => `${prefix}unique`,
    chmod: async () => {},
    rm: async () => {},
    ...overrides,
  };
}

describe('engine/build-review-containment', () => {
  it('derives review bookkeeping outside the protected candidate checkout', () => {
    const options: {
      readonly worktreeRoot: string;
      readonly runId: string;
      readonly attempt: number;
      readonly provider: 'codex';
    } = {
      worktreeRoot: '/worktree', runId: 'run-7', attempt: 2, provider: 'codex',
    };

    expect(resolveReviewScratchHome(options)).toContain('/ai-conductor-build-review/run-7/2-codex/review');
    expect(resolveReviewScratchHome(options)).not.toContain('/worktree/');
  });

  it('keeps review members private without nesting in the provider lease', () => {
    const options = {
      worktreeRoot: '/review/candidate/../candidate/', runId: 'run-7', attempt: 2, provider: 'codex' as const,
    };

    expect(resolveReviewScratchHome({ ...options, memberId: 'security' })).toContain('/review-security');
    expect(resolveReviewScratchHome(options)).not.toEqual(resolveScratchHome(options));
  });

  it('refuses a pre-created review scratch root that is group-accessible before creating a leaf', async () => {
    const mkdtemp = vi.fn(async (prefix: string) => `${prefix}unexpected`);
    await expect(acquireReviewScratchHome({
      worktreeRoot: '/worktree', runId: 'run-7', attempt: 2, provider: 'codex',
      fs: secureReviewScratchFs({
        lstat: async () => ({ uid: process.getuid?.() ?? 0, mode: 0o750, isSymbolicLink: () => false, isDirectory: () => true }),
        mkdtemp,
      }),
    })).rejects.toThrow('group/world-accessible');
    expect(mkdtemp).not.toHaveBeenCalled();
  });

  it('refuses a symlinked review scratch root before creating a leaf', async () => {
    const mkdtemp = vi.fn(async (prefix: string) => `${prefix}unexpected`);
    await expect(acquireReviewScratchHome({
      worktreeRoot: '/worktree', runId: 'run-7', attempt: 2, provider: 'codex',
      fs: secureReviewScratchFs({
        lstat: async () => ({ uid: process.getuid?.() ?? 0, mode: 0o700, isSymbolicLink: () => true, isDirectory: () => false }),
        mkdtemp,
      }),
    })).rejects.toThrow('is a symlink');
    expect(mkdtemp).not.toHaveBeenCalled();
  });

  it('creates unique 0700 review leaves and seeds auth.json with mode 0600', async () => {
    let sequence = 0;
    let lstatCalls = 0;
    const rootModes: number[] = [];
    const leafModes: Array<readonly [string, number]> = [];
    const authModes: Array<readonly [string, number]> = [];
    const removed: string[] = [];
    const fs = secureReviewScratchFs({
      mkdir: async (_path, options) => { rootModes.push(options.mode!); },
      lstat: async () => {
        if (++lstatCalls === 1) throw Object.assign(new Error('missing'), { code: 'ENOENT' });
        return { uid: process.getuid?.() ?? 0, mode: 0o700, isSymbolicLink: () => false, isDirectory: () => true };
      },
      mkdtemp: async (prefix) => `${prefix}${++sequence}`,
      chmod: async (path, mode) => { leafModes.push([path, mode]); },
      rm: async (path) => { removed.push(path); },
    });
    const seed = async (home: string) => copySelectedCodexLogin({
      source: '/prepared/auth.json', homeDir: join(home, 'codex-home'),
      fs: {
        mkdir: async () => {}, copyFile: async () => {},
        chmod: async (path, mode) => { authModes.push([path, mode]); },
      },
    });
    const options = { worktreeRoot: '/worktree', runId: 'run-7', attempt: 2, provider: 'codex' as const, fs, seed };
    const first = await acquireReviewScratchHome(options);
    const second = await acquireReviewScratchHome(options);

    expect(first.home).not.toBe(second.home);
    expect(rootModes).toEqual([0o700]);
    expect(leafModes).toEqual([[first.home, 0o700], [second.home, 0o700]]);
    expect(authModes).toEqual([[join(first.home, 'codex-home', 'auth.json'), 0o600], [join(second.home, 'codex-home', 'auth.json'), 0o600]]);
    await first.release();
    await second.release();
    expect(removed).toEqual([first.home, second.home]);
  });

  it('proves read-only review access through the production process boundary', async () => {
    const processCalls: Array<{ readonly executable: string; readonly args: readonly string[] }> = [];
    const result = await prepareBuildReviewContainment({
      provider: 'codex',
      paths: {
        frozenSource: '/review/frozen-source', policyMaterial: '/review/policy',
        originalCheckout: '/review/original', originalInstallation: '/review/installed-policy',
        engineEvidence: '/review/engine-evidence', siblingEvidence: '/review/sibling-evidence',
        scratch: '/review/private-scratch', sourceWriteProbe: '/review/frozen-source/sentinel',
        installationWriteProbe: '/review/installed-policy/sentinel',
        engineStateWriteProbe: '/review/engine-evidence/sentinel',
        scratchWriteProbe: '/review/private-scratch/sentinel',
        siblingEvidenceProbe: '/review/sibling-evidence/result.json',
        hostStateProbe: '/review/private-scratch.host-state-probe',
      },
      runtimeHost,
      runProcess: async (executable, args) => {
        processCalls.push({ executable, args });
        const engineEvidenceIsReadOnly = args.some((value, index) =>
          value === '--ro-bind' && args[index + 1] === '/review/engine-evidence' && args[index + 2] === '/review/engine-evidence',
        );
        return {
          exitCode: 0,
          stderr: '',
          stdout: [
            'source-write-refused', 'installation-write-refused', engineEvidenceIsReadOnly ? 'engine-state-write-refused' : 'engine-state-write-succeeded',
            'scratch-write-succeeded', 'sibling-evidence-withheld', 'nested-sandbox-available', 'host-state-withheld',
          ].join('\n'),
        };
      },
    });

    expect(result).toMatchObject({ kind: 'ready', provider: 'codex' });
    if (result.kind !== 'ready') throw new Error('expected the injected probe to prepare containment');
    expect(result.profile.scratch).toBe('/review/private-scratch');
    expect(result.profile.mountArgs).not.toContain('/bin/sh');
    expect(processCalls).toEqual([expect.objectContaining({
      executable: 'bwrap',
      args: expect.arrayContaining([
        '--ro-bind', '/review/frozen-source', '/review/frozen-source',
        '--ro-bind', '/review/policy', '/review/policy',
        '--ro-bind', '/review/original', '/review/original',
        '--ro-bind', '/review/installed-policy', '/review/installed-policy',
        '--ro-bind', '/review/engine-evidence', '/review/engine-evidence',
        '--tmpfs', '/review/sibling-evidence',
        '--bind', '/review/private-scratch', '/review/private-scratch',
      ]),
    })]);
    // The host sentinel is the probe's sixth operand, after the sibling probe.
    expect(processCalls[0]!.args.slice(-2)).toEqual([
      '/review/sibling-evidence/result.json', '/review/private-scratch.host-state-probe',
    ]);
  });

  it('enumerates runtime roots instead of binding the host root, HOME, or a host config directory', async () => {
    const result = await prepareBuildReviewContainment({
      provider: 'claude', paths: PATHS, runtimeHost,
      runProcess: async () => ({ exitCode: 0, stderr: '', stdout: HEALTHY_PROBE.join('\n') }),
    });
    if (result.kind !== 'ready') throw new Error(`expected ready containment: ${result.reason}`);
    const binds = bindTriples(result.profile.mountArgs);
    const sources = binds.map(([, source]) => source);

    expect(sources).not.toContain('/');
    expect(sources).not.toContain('/home/op');
    expect(sources).not.toContain('/home');
    expect(sources).not.toContain('/etc');
    expect(sources).not.toContain('/home/op/.local');
    expect(sources).not.toContain('/home/op/.local/bin');
    expect(binds).toEqual(expect.arrayContaining([
      ['--ro-bind-try', '/usr', '/usr'],
      ['--ro-bind-try', '/etc/resolv.conf', '/etc/resolv.conf'],
      ['--ro-bind-try', '/etc/ssl', '/etc/ssl'],
      ['--ro-bind-try', '/etc/passwd', '/etc/passwd'],
      // node under nvm: its install prefix, not HOME
      ['--ro-bind-try', '/home/op/.nvm/versions/node/v22', '/home/op/.nvm/versions/node/v22'],
      // native claude: the PATH symlink and the single resolved binary
      ['--ro-bind-try', '/home/op/.local/bin/claude', '/home/op/.local/bin/claude'],
      ['--ro-bind-try', '/home/op/.local/share/claude/versions/2.1.0', '/home/op/.local/share/claude/versions/2.1.0'],
    ]));
    // Every runtime root is read-only; scratch is the only writable bind.
    expect(binds.filter(([flag]) => flag === '--bind' || flag.startsWith('--dev-bind'))).toEqual([
      ['--bind', '/review/private-scratch', '/review/private-scratch'],
    ]);
    expect(result.profile.mountArgs).toEqual([...result.profile.runtimeMountArgs!, ...result.profile.reviewMountArgs!]);
  });

  it('binds an npm-installed provider by its package root and leaves system executables to /usr', () => {
    expect(deriveExecutableRuntimeRoots('codex', runtimeHost)).toEqual([
      '/home/op/.nvm/versions/node/v22/bin/codex',
      '/home/op/.nvm/versions/node/v22/lib/node_modules/@openai/codex',
    ]);
    expect(deriveExecutableRuntimeRoots('git', runtimeHost)).toEqual([]);
    expect(deriveExecutableRuntimeRoots('absent-provider', runtimeHost)).toEqual([]);
  });

  it('exposes a self-host prepared wrap read-only between the runtime roots and the review binds', async () => {
    const result = await prepareBuildReviewContainment({
      provider: 'codex', paths: PATHS, runtimeHost,
      runProcess: async () => ({ exitCode: 0, stderr: '', stdout: HEALTHY_PROBE.join('\n') }),
    });
    if (result.kind !== 'ready') throw new Error(`expected ready containment: ${result.reason}`);

    const composed = composeReviewLaunchMounts(result.profile, {
      executable: 'bwrap',
      args: ['--dev-bind', '/', '/', '--ro-bind', '/live', '/live', '--bind', '/live/.worktrees/f', '/live/.worktrees/f', '--', '/isolated/codex', 'exec'],
    }, runtimeHost);

    const runtimeLength = result.profile.runtimeMountArgs!.length;
    expect(composed.slice(0, runtimeLength)).toEqual(result.profile.runtimeMountArgs);
    expect(composed.slice(runtimeLength, composed.length - result.profile.reviewMountArgs!.length)).toEqual([
      '--ro-bind-try', '/live', '/live',
      '--ro-bind-try', '/live/.worktrees/f', '/live/.worktrees/f',
      '--ro-bind-try', '/isolated/codex', '/isolated/codex',
    ]);
    expect(composed.slice(-result.profile.reviewMountArgs!.length)).toEqual(result.profile.reviewMountArgs);
    expect(bindTriples(composed).map(([, source]) => source)).not.toContain('/');
  });

  it('refuses a host sentinel that an allowlisted root would expose', async () => {
    const runProcess = vi.fn(async () => ({ exitCode: 0, stderr: '', stdout: HEALTHY_PROBE.join('\n') }));
    const result = await prepareBuildReviewContainment({
      provider: 'claude', runtimeHost, runProcess,
      paths: { ...PATHS, hostStateProbe: '/review/original/host-sentinel' },
    });

    expect(result).toMatchObject({ kind: 'unsupported' });
    expect(runProcess).not.toHaveBeenCalled();
  });

  it.each([
    ['missing bubblewrap', async () => { throw Object.assign(new Error('not found'), { code: 'ENOENT' }); }],
    ['a successful protected write', async () => ({
      exitCode: 0, stderr: '',
      stdout: 'source-write-succeeded\ninstallation-write-refused\nengine-state-write-refused\nscratch-write-succeeded\nsibling-evidence-withheld\nnested-sandbox-available\nhost-state-withheld',
    })],
    ['a failed scratch write', async () => ({
      exitCode: 0, stderr: '',
      stdout: 'source-write-refused\ninstallation-write-refused\nengine-state-write-refused\nscratch-write-refused\nsibling-evidence-withheld\nnested-sandbox-available\nhost-state-withheld',
    })],
    ['no proof that host state is withheld', async () => ({
      exitCode: 0, stderr: '',
      stdout: 'source-write-refused\ninstallation-write-refused\nengine-state-write-refused\nscratch-write-succeeded\nsibling-evidence-withheld\nnested-sandbox-available',
    })],
    ['readable host state', async () => ({
      exitCode: 0, stderr: '',
      stdout: 'source-write-refused\ninstallation-write-refused\nengine-state-write-refused\nscratch-write-succeeded\nsibling-evidence-withheld\nnested-sandbox-available\nhost-state-readable',
    })],
    ['an unsupported nested sandbox', async () => ({
      exitCode: 0, stderr: '',
      stdout: 'source-write-refused\ninstallation-write-refused\nengine-state-write-refused\nscratch-write-succeeded\nsibling-evidence-withheld\nnested-sandbox-denied\nhost-state-withheld',
    })],
  ])('refuses review preparation when containment has %s', async (_reason, runProcess) => {
    const result = await prepareBuildReviewContainment({
      provider: 'claude',
      paths: {
        frozenSource: '/review/frozen-source', policyMaterial: '/review/policy',
        originalCheckout: '/review/original', originalInstallation: '/review/installed-policy',
        engineEvidence: '/review/engine-evidence', siblingEvidence: '/review/sibling-evidence',
        scratch: '/review/private-scratch', sourceWriteProbe: '/review/frozen-source/sentinel',
        installationWriteProbe: '/review/installed-policy/sentinel',
        engineStateWriteProbe: '/review/engine-evidence/sentinel',
        scratchWriteProbe: '/review/private-scratch/sentinel',
        siblingEvidenceProbe: '/review/sibling-evidence/result.json',
        hostStateProbe: '/review/private-scratch.host-state-probe',
      },
      runtimeHost,
      runProcess,
    });

    expect(result).toMatchObject({
      kind: 'unsupported', provider: 'claude', capability: 'linux-read-only-review-boundary',
      recovery: 'install-bubblewrap-and-enable-nested-sandboxing',
    });
  });
});
