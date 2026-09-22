// Covers: task:13
import { describe, expect, it, vi } from 'vitest';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  composeReviewLaunchMounts,
  deriveExecutableRuntimeRoots,
  prepareBuildReviewContainment,
  resolveReviewHostStateRoot,
  writeReviewHostStateSentinel,
  type BuildReviewRuntimeHost,
} from '../../src/engine/build-review-containment.js';
import {
  acquireReviewScratchHome,
  resolveScratchHome,
  type ReviewScratchFs,
} from '../../src/engine/self-host/provider-scratch.js';
import { copySelectedCodexLogin } from '../../src/execution/codex-self-host-auth.js';

const PATHS = {
  reviewEvidenceRoot: '/review/original/.pipeline/build-review', frozenSource: '/review/frozen-source', frozenBaseline: '/review/frozen-baseline', baselineWriteProbe: '/review/frozen-baseline/sentinel', policyMaterial: '/review/policy',
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
  'source-write-refused', 'baseline-write-refused', 'installation-write-refused', 'engine-state-write-refused',
  'scratch-write-succeeded', 'sibling-evidence-withheld', 'nested-sandbox-available', 'host-state-withheld', 'checkout-state-withheld',
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
  it('acquires review bookkeeping outside the protected candidate checkout', async () => {
    const mkdtemp = vi.fn(async (prefix: string) => `${prefix}leaf`);
    const lease = await acquireReviewScratchHome({
      worktreeRoot: '/worktree', runId: 'run-7', attempt: 2, provider: 'codex',
      fs: secureReviewScratchFs({ mkdtemp }),
    });

    expect(lease.home).toBe(join(
      tmpdir(), `ai-conductor-build-review-${process.getuid?.() ?? 'nouid'}`, 'run-7', '2-codex', 'review', 'review-leaf',
    ));
    expect(lease.home.startsWith('/worktree/')).toBe(false);
  });

  it('keeps review members private without nesting in the provider lease', async () => {
    const options = {
      worktreeRoot: '/review/candidate/../candidate/', runId: 'run-7', attempt: 2, provider: 'codex' as const,
    };
    const fs = secureReviewScratchFs({ mkdtemp: async (prefix) => `${prefix}leaf` });

    const member = await acquireReviewScratchHome({ ...options, memberId: 'security', fs });
    const plain = await acquireReviewScratchHome({ ...options, fs });

    expect(member.home).toContain('/review-security/');
    expect(member.home).not.toEqual(plain.home);
    expect(plain.home.startsWith(resolveScratchHome(options))).toBe(false);
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
    const rootModes: number[] = [];
    const leafModes: Array<readonly [string, number]> = [];
    const authModes: Array<readonly [string, number]> = [];
    const removed: string[] = [];
    const fs = secureReviewScratchFs({
      mkdir: async (_path, options) => { rootModes.push(options.mode!); },
      mkdtemp: async (prefix) => `${prefix}${++sequence}`,
      chmod: async (path, mode) => { leafModes.push([path, mode]); },
      rm: async (path) => { removed.push(path); },
    });
    const seed = async (home: string): Promise<void> => { await copySelectedCodexLogin({
      source: '/prepared/auth.json', homeDir: join(home, 'codex-home'),
      fs: {
        mkdir: async () => {}, copyFile: async () => {},
        chmod: async (path, mode) => { authModes.push([path, mode]); },
      },
    }); };
    const options = { worktreeRoot: '/worktree', runId: 'run-7', attempt: 2, provider: 'codex' as const, fs, seed };
    const first = await acquireReviewScratchHome(options);
    const second = await acquireReviewScratchHome(options);

    expect(first.home).not.toBe(second.home);
    expect(rootModes).toEqual(Array(8).fill(0o700));
    expect(leafModes).toEqual([[first.home, 0o700], [second.home, 0o700]]);
    expect(authModes).toEqual([[join(first.home, 'codex-home', 'auth.json'), 0o600], [join(second.home, 'codex-home', 'auth.json'), 0o600]]);
    await first.release();
    await second.release();
    expect(removed).toEqual([first.home, second.home]);
  });

  describe('review scratch ancestor chain', () => {
    const uid = process.getuid?.() ?? 0;
    const top = join(tmpdir(), `ai-conductor-build-review-${uid}`);
    const chain = [top, join(top, 'run-7'), join(top, 'run-7', '2-codex'), join(top, 'run-7', '2-codex', 'review')];
    const good = { uid, mode: 0o700, isSymbolicLink: () => false, isDirectory: () => true };
    const acquireWith = async (bad: Record<string, typeof good>) => {
      const mkdtemp = vi.fn(async (prefix: string) => `${prefix}unexpected`);
      const seed = vi.fn(async () => {});
      const promise = acquireReviewScratchHome({
        worktreeRoot: '/worktree', runId: 'run-7', attempt: 2, provider: 'codex', seed,
        fs: secureReviewScratchFs({
          mkdir: async (path) => { if (path in bad) throw Object.assign(new Error('exists'), { code: 'EEXIST' }); },
          lstat: async (path) => bad[path] ?? good,
          mkdtemp,
        }),
      });
      return { promise, mkdtemp, seed };
    };

    it.each([
      ['a foreign-owned top-level ancestor', 0, { ...good, uid: uid + 1 }, 'not owned by the current uid'],
      ['a symlinked intermediate ancestor', 1, { ...good, isSymbolicLink: () => true, isDirectory: () => false }, 'is a symlink'],
      ['a group-writable intermediate ancestor', 2, { ...good, mode: 0o770 }, 'group/world-accessible'],
    ])('refuses %s before creating or seeding a leaf', async (_label, index, entry, message) => {
      const { promise, mkdtemp, seed } = await acquireWith({ [chain[index]!]: entry });
      await expect(promise).rejects.toThrow(message);
      await expect(promise).rejects.toThrow(chain[index]!);
      expect(mkdtemp).not.toHaveBeenCalled();
      expect(seed).not.toHaveBeenCalled();
    });

    it('creates every level below tmpdir non-recursively with mode 0700, top-down', async () => {
      const made: Array<readonly [string, boolean, number | undefined]> = [];
      const lease = await acquireReviewScratchHome({
        worktreeRoot: '/worktree', runId: 'run-7', attempt: 2, provider: 'codex',
        fs: secureReviewScratchFs({ mkdir: async (path, options) => { made.push([path, options.recursive, options.mode]); } }),
      });
      expect(made).toEqual(chain.map((path) => [path, false, 0o700]));
      await lease.release();
    });

    it('refuses a run id that would add path components', async () => {
      await expect(acquireReviewScratchHome({
        worktreeRoot: '/worktree', runId: '../escape', attempt: 2, provider: 'codex', fs: secureReviewScratchFs(),
      })).rejects.toThrow('unsafe review scratch path component');
    });
  });

  it('proves read-only review access through the production process boundary', async () => {
    const processCalls: Array<{ readonly executable: string; readonly args: readonly string[] }> = [];
    const result = await prepareBuildReviewContainment({
      provider: 'codex',
      paths: {
        reviewEvidenceRoot: '/review/original/.pipeline/build-review', frozenSource: '/review/frozen-source', frozenBaseline: '/review/frozen-baseline', baselineWriteProbe: '/review/frozen-baseline/sentinel', policyMaterial: '/review/policy',
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
            'source-write-refused', 'baseline-write-refused', 'installation-write-refused', engineEvidenceIsReadOnly ? 'engine-state-write-refused' : 'engine-state-write-succeeded',
            'scratch-write-succeeded', 'sibling-evidence-withheld', 'nested-sandbox-available', 'host-state-withheld', 'checkout-state-withheld',
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
        '--ro-bind', '/review/frozen-baseline', '/review/frozen-baseline',
        '--ro-bind', '/review/policy', '/review/policy',
        '--ro-bind', '/review/original', '/review/original',
        '--ro-bind', '/review/installed-policy', '/review/installed-policy',
        '--ro-bind', '/review/engine-evidence', '/review/engine-evidence',
        '--tmpfs', '/review/sibling-evidence',
        '--bind', '/review/private-scratch', '/review/private-scratch',
      ]),
    })]);
    // The host sentinel is the probe's sixth operand, after the sibling probe;
    // the baseline write sentinel is the seventh.
    expect(processCalls[0]!.args.slice(-3)).toEqual([
      '/review/sibling-evidence/result.json', '/review/private-scratch.host-state-probe', '/review/frozen-baseline/sentinel',
    ]);
  });

  it('masks the whole build-review evidence root so sibling lap artifacts and the cache are withheld', async () => {
    const paths = {
      ...PATHS,
      policyMaterial: '/review/original/.pipeline/build-review/policy-material/p1',
      engineEvidence: '/review/original/.pipeline/build-review/engine-evidence',
      engineStateWriteProbe: '/review/original/.pipeline/build-review/engine-evidence/sentinel',
      siblingEvidence: '/review/original/.pipeline/build-review/sibling-evidence',
      siblingEvidenceProbe: '/review/original/.pipeline/build-review/.sibling-evidence-probe',
    };
    const result = await prepareBuildReviewContainment({
      provider: 'claude', paths, runtimeHost,
      runProcess: async () => ({ exitCode: 0, stderr: '', stdout: HEALTHY_PROBE.join('\n') }),
    });
    if (result.kind !== 'ready') throw new Error(`expected ready containment: ${result.reason}`);
    const review = result.profile.reviewMountArgs!;
    const at = (...needle: string[]) => review.findIndex((_, index) => needle.every((part, offset) => review[index + offset] === part));
    const checkout = at('--ro-bind', '/review/original', '/review/original');
    const mask = at('--tmpfs', '/review/original/.pipeline/build-review');
    const policy = at('--ro-bind', paths.policyMaterial, paths.policyMaterial);
    const evidence = at('--ro-bind', paths.engineEvidence, paths.engineEvidence);
    // The mask must follow the checkout bind it hides, and precede what is re-exposed beneath it.
    expect(checkout).toBeGreaterThanOrEqual(0);
    expect(mask).toBeGreaterThan(checkout);
    expect(policy).toBeGreaterThan(mask);
    expect(evidence).toBeGreaterThan(mask);
  });

  it('refuses a sibling probe that lies outside the masked evidence root', async () => {
    const runProcess = vi.fn();
    const result = await prepareBuildReviewContainment({
      provider: 'claude', runtimeHost, runProcess,
      paths: { ...PATHS, siblingEvidenceProbe: '/review/elsewhere/result.json' },
    });
    expect(result.kind).toBe('unsupported');
    expect(runProcess).not.toHaveBeenCalled();
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

  const SELF_HOST_WRAP = {
    executable: 'bwrap',
    args: ['--dev-bind', '/', '/', '--ro-bind', '/live', '/live', '--bind', '/live/.worktrees/f', '/live/.worktrees/f', '--bind', '/live/.daemon', '/live/.daemon', '--bind', '/review/original', '/review/original', '--', '/isolated/codex', 'exec'],
  };

  it('gives a self-host wrap empty placeholders, never the live checkout, sibling worktrees or daemon state', async () => {
    const runProcess = vi.fn(async () => ({ exitCode: 0, stderr: '', stdout: HEALTHY_PROBE.join('\n') }));
    const result = await prepareBuildReviewContainment({ provider: 'codex', paths: PATHS, runtimeHost, runProcess, launch: SELF_HOST_WRAP });
    if (result.kind !== 'ready') throw new Error(`expected ready containment: ${result.reason}`);

    const composed = composeReviewLaunchMounts(result.profile, { ...SELF_HOST_WRAP, args: [...SELF_HOST_WRAP.args, '--json'] }, runtimeHost);

    const runtimeLength = result.profile.runtimeMountArgs!.length;
    expect(composed.slice(runtimeLength, composed.length - result.profile.reviewMountArgs!.length)).toEqual([
      '--dir', '/live',
      '--dir', '/live/.worktrees/f',
      '--dir', '/live/.daemon',
      '--ro-bind-try', '/isolated/codex', '/isolated/codex',
    ]);
    const sources = bindTriples(composed).map(([, source]) => source);
    expect(sources.filter((source) => source === '/' || source.startsWith('/live'))).toEqual([]);
    // The profile that was probed is exactly the profile that launches.
    const probed = (runProcess.mock.calls[0] as unknown as [string, string[]])[1];
    expect(probed.slice(0, probed.indexOf('--'))).toEqual([...composed]);
    expect(result.profile.mountArgs).toEqual([...composed]);
  });

  it('refuses to launch a command whose mounts were not the ones proved', async () => {
    const result = await prepareBuildReviewContainment({
      provider: 'codex', paths: PATHS, runtimeHost,
      runProcess: async () => ({ exitCode: 0, stderr: '', stdout: HEALTHY_PROBE.join('\n') }),
    });
    if (result.kind !== 'ready') throw new Error(`expected ready containment: ${result.reason}`);

    expect(composeReviewLaunchMounts(result.profile, { executable: 'codex', args: ['exec'] }, runtimeHost)).toEqual(result.profile.mountArgs);
    expect(() => composeReviewLaunchMounts(result.profile, SELF_HOST_WRAP, runtimeHost)).toThrow(/proved/);
  });

  it.each([
    ['the operator home', '/home/op'],
    ['a directory holding the operator home', '/home'],
    ['a provider config directory directly under home', '/home/op/.claude'],
    ['the filesystem root', '/'],
  ])('refuses an installed policy package rooted at %s', async (_name, originalInstallation) => {
    const runProcess = vi.fn(async () => ({ exitCode: 0, stderr: '', stdout: HEALTHY_PROBE.join('\n') }));
    const result = await prepareBuildReviewContainment({
      provider: 'claude', runtimeHost, runProcess,
      paths: { ...PATHS, originalInstallation, installationWriteProbe: join(originalInstallation, 'sentinel') },
    });

    expect(result).toMatchObject({ kind: 'unsupported', reason: expect.stringMatching(/too broad/) });
    expect(runProcess).not.toHaveBeenCalled();
  });

  it('refuses a checkout that would bind the operator home', async () => {
    const runProcess = vi.fn(async () => ({ exitCode: 0, stderr: '', stdout: HEALTHY_PROBE.join('\n') }));
    const result = await prepareBuildReviewContainment({
      provider: 'claude', runtimeHost, runProcess,
      paths: { ...PATHS, originalCheckout: '/home/op' },
    });

    expect(result).toMatchObject({ kind: 'unsupported', reason: expect.stringMatching(/too broad/) });
    expect(runProcess).not.toHaveBeenCalled();
  });

  it('treats a dot-dot-prefixed child name as inside its root', async () => {
    const runProcess = vi.fn(async () => ({ exitCode: 0, stderr: '', stdout: HEALTHY_PROBE.join('\n') }));
    const result = await prepareBuildReviewContainment({
      provider: 'claude', runtimeHost, runProcess,
      paths: { ...PATHS, hostStateProbe: '/review/original/..sentinel' },
    });

    expect(result).toMatchObject({ kind: 'unsupported' });
    expect(runProcess).not.toHaveBeenCalled();
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
      stdout: 'source-write-succeeded\ninstallation-write-refused\nengine-state-write-refused\nscratch-write-succeeded\nsibling-evidence-withheld\nnested-sandbox-available\nhost-state-withheld\ncheckout-state-withheld',
    })],
    ['a failed scratch write', async () => ({
      exitCode: 0, stderr: '',
      stdout: 'source-write-refused\nbaseline-write-refused\ninstallation-write-refused\nengine-state-write-refused\nscratch-write-refused\nsibling-evidence-withheld\nnested-sandbox-available\nhost-state-withheld\ncheckout-state-withheld',
    })],
    ['no proof that host state is withheld', async () => ({
      exitCode: 0, stderr: '',
      stdout: 'source-write-refused\nbaseline-write-refused\ninstallation-write-refused\nengine-state-write-refused\nscratch-write-succeeded\nsibling-evidence-withheld\nnested-sandbox-available\ncheckout-state-withheld',
    })],
    ['readable host state', async () => ({
      exitCode: 0, stderr: '',
      stdout: 'source-write-refused\nbaseline-write-refused\ninstallation-write-refused\nengine-state-write-refused\nscratch-write-succeeded\nsibling-evidence-withheld\nnested-sandbox-available\nhost-state-readable\ncheckout-state-withheld',
    })],
    ['an unsupported nested sandbox', async () => ({
      exitCode: 0, stderr: '',
      stdout: 'source-write-refused\nbaseline-write-refused\ninstallation-write-refused\nengine-state-write-refused\nscratch-write-succeeded\nsibling-evidence-withheld\nnested-sandbox-denied\nhost-state-withheld\ncheckout-state-withheld',
    })],
  ])('refuses review preparation when containment has %s', async (_reason, runProcess) => {
    const result = await prepareBuildReviewContainment({
      provider: 'claude',
      paths: {
        reviewEvidenceRoot: '/review/original/.pipeline/build-review', frozenSource: '/review/frozen-source', frozenBaseline: '/review/frozen-baseline', baselineWriteProbe: '/review/frozen-baseline/sentinel', policyMaterial: '/review/policy',
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
  describe('checkout state that is not review input', () => {
    const CHECKOUT_ENTRIES: Record<string, ReadonlyArray<{ readonly name: string; readonly kind: 'directory' | 'file' | 'other' }>> = {
      '/review/original': [
        { name: '.daemon', kind: 'directory' }, { name: '.worktrees', kind: 'directory' }, { name: '.pipeline', kind: 'directory' },
        { name: '.git', kind: 'directory' }, { name: '.claude', kind: 'directory' },
        { name: '.env', kind: 'file' }, { name: '.env.local', kind: 'file' }, { name: '.envrc-link', kind: 'other' },
        { name: 'src', kind: 'directory' }, { name: '.github', kind: 'directory' },
      ],
      '/review/original/.git': [{ name: 'config', kind: 'file' }, { name: 'objects', kind: 'directory' }],
      '/review/original/.claude': [{ name: 'settings.json', kind: 'file' }, { name: 'settings.local.json', kind: 'file' }, { name: 'worktrees', kind: 'directory' }],
    };
    const host: BuildReviewRuntimeHost = { ...runtimeHost, checkoutEntries: (directory) => CHECKOUT_ENTRIES[directory] ?? [] };
    const MASKED = [
      '/review/original/.daemon', '/review/original/.worktrees', '/review/original/.pipeline',
      '/review/original/.claude/worktrees', '/review/original/.env', '/review/original/.env.local',
      '/review/original/.claude/settings.local.json', '/review/original/.git/config',
    ];

    it('masks provider homes, sibling worktrees, pipeline state and operator credentials under the bound checkout', async () => {
      const runProcess = vi.fn(async () => ({ exitCode: 0, stderr: '', stdout: HEALTHY_PROBE.join('\n') }));
      const result = await prepareBuildReviewContainment({ provider: 'codex', paths: PATHS, runtimeHost: host, runProcess });
      if (result.kind !== 'ready') throw new Error(`expected ready containment: ${result.reason}`);
      const review = result.profile.reviewMountArgs!;
      const at = (...needle: string[]) => review.findIndex((_, index) => needle.every((part, offset) => review[index + offset] === part));
      const checkout = at('--ro-bind', '/review/original', '/review/original');
      const evidenceMask = at('--tmpfs', PATHS.reviewEvidenceRoot);
      for (const directory of MASKED.slice(0, 4)) {
        expect(at('--tmpfs', directory), directory).toBeGreaterThan(checkout);
        expect(at('--tmpfs', directory), directory).toBeLessThan(evidenceMask);
      }
      for (const file of MASKED.slice(4)) expect(at('--ro-bind', '/review/engine-evidence/.build-review-empty-mask', file), file).toBeGreaterThan(checkout);
      // Reviewed source and tracked project configuration stay visible.
      expect(review.join(' ')).not.toMatch(/original\/(src|\.github|\.envrc-link|\.claude\/settings\.json|\.git\/objects)/);
      // The probe is handed every mask so the proved profile covers them.
      const probed = (runProcess.mock.calls[0] as unknown as [string, string[]])[1];
      expect(probed.slice(-MASKED.length).sort()).toEqual([...MASKED].sort());
    });

    it.each([
      ['no proof that checkout state is withheld', HEALTHY_PROBE.filter((line) => line !== 'checkout-state-withheld')],
      ['readable checkout state', HEALTHY_PROBE.map((line) => line === 'checkout-state-withheld' ? 'checkout-state-readable' : line)],
    ])('refuses review preparation when containment has %s', async (_reason, lines) => {
      const result = await prepareBuildReviewContainment({
        provider: 'codex', paths: PATHS, runtimeHost: host,
        runProcess: async () => ({ exitCode: 0, stderr: '', stdout: lines.join('\n') }),
      });
      expect(result).toMatchObject({ kind: 'unsupported', reason: expect.stringMatching(/checkout-state/) });
    });
  });

  describe('host-state sentinel', () => {
    it('refuses a sentinel under the masked /tmp, where the probe could never find it readable', async () => {
      const runProcess = vi.fn(async () => ({ exitCode: 0, stderr: '', stdout: HEALTHY_PROBE.join('\n') }));
      const result = await prepareBuildReviewContainment({
        provider: 'claude', runtimeHost, runProcess,
        paths: { ...PATHS, hostStateProbe: '/tmp/ai-conductor-1000/review/run.host-state-probe' },
      });
      expect(result).toMatchObject({ kind: 'unsupported' });
      expect(runProcess).not.toHaveBeenCalled();
    });

    it('resolves the operator state directory, never the temp directory', () => {
      expect(resolveReviewHostStateRoot({ XDG_STATE_HOME: '/state' }, '/home/op')).toBe('/state/ai-conductor/review-host-state');
      expect(resolveReviewHostStateRoot({ XDG_STATE_HOME: 'relative' }, '/home/op')).toBe('/home/op/.local/state/ai-conductor/review-host-state');
      expect(resolveReviewHostStateRoot({}, '/home/op')).toBe('/home/op/.local/state/ai-conductor/review-host-state');
    });

    it('writes a unique 0600 sentinel under the given state root', async () => {
      const stateRoot = await mkdtemp(join(tmpdir(), 'review-host-state-'));
      try {
        const first = await writeReviewHostStateSentinel({ stateRoot });
        const second = await writeReviewHostStateSentinel({ stateRoot });
        expect(first).not.toBe(second);
        expect(first.startsWith(`${stateRoot}/`)).toBe(true);
        expect((await stat(first)).mode & 0o777).toBe(0o600);
        expect((await stat(stateRoot)).mode & 0o077).toBe(0);
        expect(await readFile(first, 'utf8')).toMatch(/withhold/);
      } finally {
        await rm(stateRoot, { recursive: true, force: true });
      }
    });
  });
});
