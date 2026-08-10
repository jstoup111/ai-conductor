import { describe, expect, it, vi } from 'vitest';
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createProgram } from '../../src/cli.js';
import { detectResealCommand, dispatchResealCommand } from '../../src/engine/reseal-cli.js';
import { ConductorEventEmitter } from '../../src/ui/events.js';

// argv is process.argv: [node, entry, subcommand, ...arguments].
const argv = (...arguments_: string[]) => ['node', 'conduct', 'reseal', ...arguments_];

describe('CLI surface — conduct reseal', () => {
  it('exposes the reseal command with its planned flags', () => {
    expect(
      createProgram()
        .commands.find((command) => command.name() === 'reseal')
        ?.options.map((option) => option.long),
    ).toEqual(['--slug', '--path', '--reason', '--clear-halt']);
  });
});

describe('detectResealCommand', () => {
  it('parses a valid reseal invocation for dispatch', () => {
    expect(
      detectResealCommand(
        argv(
          '--slug',
          'repair-protected-plan',
          '--path',
          '.docs/plans/repair.md',
          '--path',
          '.docs/stories/repair.md',
          '--reason',
          'Corrected the accepted plan after review.',
          '--clear-halt',
        ),
      ),
    ).toEqual({
      kind: 'reseal',
      slug: 'repair-protected-plan',
      paths: ['.docs/plans/repair.md', '.docs/stories/repair.md'],
      reason: 'Corrected the accepted plan after review.',
      clearHalt: true,
    });
  });

  it('returns null when --reason is missing', () => {
    expect(detectResealCommand(argv('--slug', 'repair', '--path', '.docs/plans/repair.md'))).toBeNull();
  });

  it('returns null when a flag token is supplied where --reason needs a value', () => {
    expect(
      detectResealCommand(
        argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', '--clear-halt'),
      ),
    ).toBeNull();
  });

  it('defaults clearHalt to false when --clear-halt is absent', () => {
    expect(
      detectResealCommand(
        argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
      ),
    ).toEqual({
      kind: 'reseal',
      slug: 'repair',
      paths: ['.docs/plans/repair.md'],
      reason: 'Corrected after review.',
      clearHalt: false,
    });
  });

  it('returns null when --slug is missing', () => {
    expect(
      detectResealCommand(argv('--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.')),
    ).toBeNull();
  });

  it('returns null when --path is missing', () => {
    expect(detectResealCommand(argv('--slug', 'repair', '--reason', 'Corrected after review.'))).toBeNull();
  });

  it.each(['', '   ', '\t\n'])('returns null when --reason is empty or whitespace-only', (reason) => {
    expect(
      detectResealCommand(argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', reason)),
    ).toBeNull();
  });

  it('returns null when a flag is duplicated with a conflicting value', () => {
    expect(
      detectResealCommand(
        argv(
          '--slug',
          'repair',
          '--slug',
          'different-repair',
          '--path',
          '.docs/plans/repair.md',
          '--reason',
          'Corrected after review.',
        ),
      ),
    ).toBeNull();
  });

  it('returns null when --slug is duplicated with an identical value', () => {
    expect(
      detectResealCommand(
        argv(
          '--slug',
          'repair',
          '--slug',
          'repair',
          '--path',
          '.docs/plans/repair.md',
          '--reason',
          'Corrected after review.',
        ),
      ),
    ).toBeNull();
  });

  it.each(['Corrected after review.', 'A second rationale.'])('returns null when --reason is duplicated: %s', (secondReason) => {
    expect(
      detectResealCommand(
        argv(
          '--slug',
          'repair',
          '--path',
          '.docs/plans/repair.md',
          '--reason',
          'Corrected after review.',
          '--reason',
          secondReason,
        ),
      ),
    ).toBeNull();
  });

  it('returns null when --clear-halt is duplicated', () => {
    expect(
      detectResealCommand(
        argv(
          '--slug',
          'repair',
          '--path',
          '.docs/plans/repair.md',
          '--reason',
          'Corrected after review.',
          '--clear-halt',
          '--clear-halt',
        ),
      ),
    ).toBeNull();
  });

  it('returns null when an unknown flag is supplied', () => {
    expect(
      detectResealCommand(
        argv(
          '--slug',
          'repair',
          '--path',
          '.docs/plans/repair.md',
          '--reason',
          'Corrected after review.',
          '--force',
        ),
      ),
    ).toBeNull();
  });

  it.each(['nested/repair', 'nested\\repair', '.', '..', 'nested/./repair', 'nested/../repair'])(
    'returns null when --slug contains an unsafe segment: %s',
    (slug) => {
      expect(
        detectResealCommand(
          argv('--slug', slug, '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
        ),
      ).toBeNull();
    },
  );
});

describe('dispatchResealCommand', () => {
  it('reseals a known worktree and reports the named paths without starting the pipeline', async () => {
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
    );
    if (!command) throw new Error('expected valid reseal command');
    const out = vi.fn();
    const reseal = vi.fn().mockResolvedValue({
      baselineCommit: 'target',
      protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:after' }],
      rebaselines: [],
      version: 2,
    });

    await expect(
      dispatchResealCommand(command, {
        cwd: '/project',
        out,
        access: vi.fn().mockResolvedValue(undefined),
        isInteractive: true,
        readFile: vi.fn().mockResolvedValue(JSON.stringify({
          baselineCommit: 'base',
          protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
          rebaselines: [],
          version: 2,
        })),
        resolveHead: vi.fn().mockResolvedValue('target'),
        resolveBaseBranch: vi.fn().mockResolvedValue('trunk'),
        reseal,
        events: new ConductorEventEmitter(),
      }),
    ).resolves.toBe(0);

    expect({
      reseal: reseal.mock.calls,
      out: out.mock.calls,
    }).toEqual({
      reseal: [[{
        projectRoot: '/project/.worktrees/repair',
        seal: {
          baselineCommit: 'base',
          protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
          rebaselines: [],
          version: 2,
        },
        toCommit: 'target',
        trigger: 'operator-reseal',
        paths: ['.docs/plans/repair.md'],
        reason: 'Corrected after review.',
        featureDesc: 'repair',
        baseBranch: 'trunk',
      }]],
      out: [['Resealed protected artifacts: .docs/plans/repair.md']],
    });
  });

  it('passes the operator rationale and resolved provenance through the public dispatcher', async () => {
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', ' Keep exact whitespace. '),
    );
    if (!command) throw new Error('expected valid reseal command');
    const reseal = vi.fn().mockResolvedValue({
      baselineCommit: 'target',
      protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:after' }],
      rebaselines: [],
      version: 2,
    });

    await expect(dispatchResealCommand(command, {
      cwd: '/project',
      access: vi.fn().mockResolvedValue(undefined),
      isInteractive: true,
      readFile: vi.fn().mockResolvedValue(JSON.stringify({
        baselineCommit: 'base',
        protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
        rebaselines: [],
        version: 2,
      })),
      resolveHead: vi.fn().mockResolvedValue('target'),
      resolveBaseBranch: vi.fn().mockResolvedValue('main'),
      reseal,
      events: new ConductorEventEmitter(),
    })).resolves.toBe(0);

    expect(reseal).toHaveBeenCalledWith(expect.objectContaining({
      reason: ' Keep exact whitespace. ',
      featureDesc: 'repair',
      baseBranch: 'main',
    }));
  });

  it('preserves and clears a protected-artifact halt after a successful reseal with --clear-halt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-clear-halt-'));
    const worktree = join(root, '.worktrees', 'repair');
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.', '--clear-halt'),
    );
    if (!command) throw new Error('expected valid reseal command');

    try {
      await mkdir(join(worktree, '.pipeline'), { recursive: true });
      await writeFile(join(worktree, '.pipeline', 'protected-artifact-seal.json'), JSON.stringify({
        baselineCommit: 'base',
        protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
        rebaselines: [],
        version: 2,
      }));
      await writeFile(join(worktree, '.pipeline', 'HALT'), 'protected artifact changed\n');
      await writeFile(join(worktree, '.pipeline', 'HALT.class'), 'protected-artifact');

      await expect(dispatchResealCommand(command, {
        cwd: root,
        isInteractive: true,
        resolveHead: vi.fn().mockResolvedValue('target'),
        reseal: vi.fn().mockResolvedValue({
          baselineCommit: 'target',
          protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:after' }],
          rebaselines: [],
          version: 2,
        }),
        events: new ConductorEventEmitter(),
      })).resolves.toBe(0);

      await expect(readFile(join(worktree, '.pipeline', 'HALT.cleared'), 'utf8')).resolves.toBe('protected artifact changed\n');
      await expect(access(join(worktree, '.pipeline', 'HALT'))).rejects.toThrow();
      await expect(access(join(worktree, '.pipeline', 'HALT.class'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('leaves halt markers untouched after a successful reseal without --clear-halt', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-keep-halt-'));
    const worktree = join(root, '.worktrees', 'repair');
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
    );
    if (!command) throw new Error('expected valid reseal command');

    try {
      await mkdir(join(worktree, '.pipeline'), { recursive: true });
      await writeFile(join(worktree, '.pipeline', 'protected-artifact-seal.json'), JSON.stringify({
        baselineCommit: 'base',
        protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
        rebaselines: [],
        version: 2,
      }));
      await writeFile(join(worktree, '.pipeline', 'HALT'), 'protected artifact changed\n');
      await writeFile(join(worktree, '.pipeline', 'HALT.class'), 'protected-artifact');

      await expect(dispatchResealCommand(command, {
        cwd: root,
        isInteractive: true,
        resolveHead: vi.fn().mockResolvedValue('target'),
        reseal: vi.fn().mockResolvedValue({
          baselineCommit: 'target',
          protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:after' }],
          rebaselines: [],
          version: 2,
        }),
        events: new ConductorEventEmitter(),
      })).resolves.toBe(0);

      await expect(readFile(join(worktree, '.pipeline', 'HALT'), 'utf8')).resolves.toBe('protected artifact changed\n');
      await expect(readFile(join(worktree, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('protected-artifact');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('leaves a non-protected halt intact and reports why after a successful --clear-halt reseal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-unrelated-halt-'));
    const worktree = join(root, '.worktrees', 'repair');
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.', '--clear-halt'),
    );
    if (!command) throw new Error('expected valid reseal command');
    const out = vi.fn();

    try {
      await mkdir(join(worktree, '.pipeline'), { recursive: true });
      await writeFile(join(worktree, '.pipeline', 'protected-artifact-seal.json'), JSON.stringify({
        baselineCommit: 'base',
        protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
        rebaselines: [],
        version: 2,
      }));
      await writeFile(join(worktree, '.pipeline', 'HALT'), 'awaiting an operator\n');
      await writeFile(join(worktree, '.pipeline', 'HALT.class'), 'needs-human');

      await expect(dispatchResealCommand(command, {
        cwd: root,
        isInteractive: true,
        out,
        resolveHead: vi.fn().mockResolvedValue('target'),
        reseal: vi.fn().mockResolvedValue({
          baselineCommit: 'target',
          protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:after' }],
          rebaselines: [],
          version: 2,
        }),
        events: new ConductorEventEmitter(),
      })).resolves.toBe(0);

      await expect(readFile(join(worktree, '.pipeline', 'HALT'), 'utf8')).resolves.toBe('awaiting an operator\n');
      await expect(readFile(join(worktree, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('needs-human');
      expect(out).toHaveBeenCalledWith('Halt was not cleared: its class is needs-human.');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports that there is no halt to clear after a successful --clear-halt reseal', async () => {
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.', '--clear-halt'),
    );
    if (!command) throw new Error('expected valid reseal command');
    const out = vi.fn();

    await expect(dispatchResealCommand(command, {
      cwd: '/project',
      isInteractive: true,
      out,
      access: vi.fn().mockImplementation(async (path: string) => {
        if (path.endsWith('/.pipeline/HALT')) throw new Error('missing');
      }),
      readFile: vi.fn().mockResolvedValue(JSON.stringify({
        baselineCommit: 'base',
        protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
        rebaselines: [],
        version: 2,
      })),
      resolveHead: vi.fn().mockResolvedValue('target'),
      reseal: vi.fn().mockResolvedValue({
        baselineCommit: 'target',
        protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:after' }],
        rebaselines: [],
        version: 2,
      }),
      events: new ConductorEventEmitter(),
    })).resolves.toBe(0);

    expect(out).toHaveBeenCalledWith('No halt to clear.');
  });

  it('leaves an unclassified halt intact after a successful --clear-halt reseal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-unclassified-halt-'));
    const worktree = join(root, '.worktrees', 'repair');
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.', '--clear-halt'),
    );
    if (!command) throw new Error('expected valid reseal command');
    const out = vi.fn();

    try {
      await mkdir(join(worktree, '.pipeline'), { recursive: true });
      await writeFile(join(worktree, '.pipeline', 'protected-artifact-seal.json'), JSON.stringify({
        baselineCommit: 'base',
        protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
        rebaselines: [],
        version: 2,
      }));
      await writeFile(join(worktree, '.pipeline', 'HALT'), 'legacy halt\n');

      await expect(dispatchResealCommand(command, {
        cwd: root,
        isInteractive: true,
        out,
        resolveHead: vi.fn().mockResolvedValue('target'),
        reseal: vi.fn().mockResolvedValue({
          baselineCommit: 'target',
          protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:after' }],
          rebaselines: [],
          version: 2,
        }),
        events: new ConductorEventEmitter(),
      })).resolves.toBe(0);

      await expect(readFile(join(worktree, '.pipeline', 'HALT'), 'utf8')).resolves.toBe('legacy halt\n');
      await expect(access(join(worktree, '.pipeline', 'HALT.class'))).rejects.toThrow();
      expect(out).toHaveBeenCalledWith('Halt was not cleared: it is unclassified.');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('leaves halt markers untouched when a --clear-halt reseal is refused', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-refused-halt-'));
    const worktree = join(root, '.worktrees', 'repair');
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.', '--clear-halt'),
    );
    if (!command) throw new Error('expected valid reseal command');

    try {
      await mkdir(join(worktree, '.pipeline'), { recursive: true });
      await writeFile(join(worktree, '.pipeline', 'protected-artifact-seal.json'), JSON.stringify({
        baselineCommit: 'base',
        protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
        rebaselines: [],
        version: 2,
      }));
      await writeFile(join(worktree, '.pipeline', 'HALT'), 'protected artifact changed\n');
      await writeFile(join(worktree, '.pipeline', 'HALT.class'), 'protected-artifact');

      await expect(dispatchResealCommand(command, {
        cwd: root,
        err: vi.fn(),
        isInteractive: true,
        resolveHead: vi.fn().mockResolvedValue('target'),
        reseal: vi.fn().mockRejectedValue(new Error('unlisted protected artifact changed')),
        events: new ConductorEventEmitter(),
      })).resolves.toBe(1);

      await expect(readFile(join(worktree, '.pipeline', 'HALT'), 'utf8')).resolves.toBe('protected artifact changed\n');
      await expect(readFile(join(worktree, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('protected-artifact');
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('reports a partial halt-clear failure after a successful reseal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-partial-clear-'));
    const worktree = join(root, '.worktrees', 'repair');
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.', '--clear-halt'),
    );
    if (!command) throw new Error('expected valid reseal command');
    const out = vi.fn();
    const clearHalt = vi.fn(async (path: string) => {
      await writeFile(join(path, '.pipeline', 'HALT.cleared'), 'protected artifact changed\n');
      throw new Error('HALT.class could not be removed');
    });

    try {
      await mkdir(join(worktree, '.pipeline'), { recursive: true });
      await writeFile(join(worktree, '.pipeline', 'protected-artifact-seal.json'), JSON.stringify({
        baselineCommit: 'base',
        protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
        rebaselines: [],
        version: 2,
      }));
      await writeFile(join(worktree, '.pipeline', 'HALT'), 'protected artifact changed\n');
      await writeFile(join(worktree, '.pipeline', 'HALT.class'), 'protected-artifact');

      await expect(dispatchResealCommand(command, {
        cwd: root,
        isInteractive: true,
        out,
        resolveHead: vi.fn().mockResolvedValue('target'),
        reseal: vi.fn().mockResolvedValue({
          baselineCommit: 'target',
          protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:after' }],
          rebaselines: [],
          version: 2,
        }),
        clearHalt,
        events: new ConductorEventEmitter(),
      })).resolves.toBe(0);

      await expect(readFile(join(worktree, '.pipeline', 'HALT.cleared'), 'utf8')).resolves.toBe('protected artifact changed\n');
      await expect(readFile(join(worktree, '.pipeline', 'HALT'), 'utf8')).resolves.toBe('protected artifact changed\n');
      await expect(readFile(join(worktree, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('protected-artifact');
      expect({ clearHalt: clearHalt.mock.calls, out: out.mock.calls }).toEqual({
        clearHalt: [[worktree]],
        out: [
          ['Resealed protected artifacts: .docs/plans/repair.md'],
          ['Halt was not fully cleared: HALT.class could not be removed.'],
        ],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('constructs the audit sink at the resolved worktree and records the performed reseal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-audit-'));
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
    );
    if (!command) throw new Error('expected valid reseal command');

    try {
      await expect(
        dispatchResealCommand(command, {
          cwd: root,
          isInteractive: true,
          access: vi.fn().mockResolvedValue(undefined),
          readFile: vi.fn().mockResolvedValue(JSON.stringify({
            baselineCommit: 'base',
            protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
            rebaselines: [],
            version: 2,
          })),
          resolveHead: vi.fn().mockResolvedValue('target'),
          reseal: vi.fn().mockResolvedValue({
            baselineCommit: 'target',
            protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:after' }],
            rebaselines: [],
            version: 2,
          }),
        }),
      ).resolves.toBe(0);

      const audit = await readFile(
        join(root, '.worktrees', 'repair', '.pipeline', 'audit-trail', 'events.jsonl'),
        'utf8',
      );
      expect(JSON.parse(audit) as Record<string, unknown>).toMatchObject({
        origin: 'operator',
        event: 'reseal',
        reason: 'Corrected after review.',
        fromCommit: 'base',
        toCommit: 'target',
        paths: [{
          path: '.docs/plans/repair.md',
          priorFingerprint: 'sha256:before',
          newFingerprint: 'sha256:after',
        }],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('surfaces a performed-reseal audit failure without recording a false refusal', async () => {
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
    );
    if (!command) throw new Error('expected valid reseal command');
    const events = new ConductorEventEmitter();
    const refused = vi.fn();
    events.on('protected_artifact_reseal', () => {
      throw new Error('durable audit sink failed');
    });
    events.on('protected_artifact_reseal_refused', refused);

    await expect(dispatchResealCommand(command, {
      cwd: '/project',
      isInteractive: true,
      access: vi.fn().mockResolvedValue(undefined),
      readFile: vi.fn().mockResolvedValue(JSON.stringify({
        baselineCommit: 'base',
        protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
        rebaselines: [],
        version: 2,
      })),
      resolveHead: vi.fn().mockResolvedValue('target'),
      reseal: vi.fn().mockResolvedValue({
        baselineCommit: 'target',
        protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:after' }],
        rebaselines: [],
        version: 2,
      }),
      events,
    })).rejects.toThrow('durable audit sink failed');

    expect(refused).not.toHaveBeenCalled();
  });

  it('refuses to reseal from a non-interactive terminal without changing the seal', async () => {
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
    );
    if (!command) throw new Error('expected valid reseal command');
    const sealJson = JSON.stringify({ baselineCommit: 'base' });
    const err = vi.fn();
    const readFile = vi.fn().mockResolvedValue(sealJson);
    const reseal = vi.fn().mockResolvedValue(undefined);

    await expect(
      dispatchResealCommand(command, {
        cwd: '/project',
        err,
        access: vi.fn().mockResolvedValue(undefined),
        isInteractive: false,
        readFile,
        resolveHead: vi.fn().mockResolvedValue('target'),
        reseal,
        events: new ConductorEventEmitter(),
      }),
    ).resolves.toBe(1);

    expect({
      err: err.mock.calls,
      readFile: readFile.mock.calls,
      reseal: reseal.mock.calls,
      sealJson,
    }).toEqual({
      err: [['reseal: requires an interactive terminal.']],
      readFile: [],
      reseal: [],
      sealJson: JSON.stringify({ baselineCommit: 'base' }),
    });
  });

  it('refuses reseal when an autonomous step subprocess has non-interactive stdin', async () => {
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
    );
    if (!command) throw new Error('expected valid reseal command');
    const err = vi.fn();
    const reseal = vi.fn();

    await expect(
      dispatchResealCommand(command, {
        cwd: '/project',
        // DefaultStepRunner's autonomous provider path supplies ignored or
        // piped stdin, so a nested CLI sees no TTY.
        isInteractive: false,
        err,
        access: vi.fn().mockResolvedValue(undefined),
        reseal,
        events: new ConductorEventEmitter(),
      }),
    ).resolves.toBe(1);

    expect({
      err: err.mock.calls,
      reseal: reseal.mock.calls,
    }).toEqual({
      err: [['reseal: requires an interactive terminal.']],
      reseal: [],
    });
  });

  it('refuses an autonomous-step reseal attempt without clearing its protected-artifact violation', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-in-step-violation-'));
    const worktree = join(root, '.worktrees', 'repair');
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.', '--clear-halt'),
    );
    if (!command) throw new Error('expected valid reseal command');
    const err = vi.fn();
    const reseal = vi.fn();

    try {
      await mkdir(join(worktree, '.pipeline'), { recursive: true });
      await writeFile(join(worktree, '.pipeline', 'HALT'), 'Protected artifact changed: .docs/plans/repair.md\n');
      await writeFile(join(worktree, '.pipeline', 'HALT.class'), 'protected-artifact');

      await expect(dispatchResealCommand(command, {
        cwd: root,
        err,
        isInteractive: false,
        reseal,
      })).resolves.toBe(1);

      await expect(readFile(join(worktree, '.pipeline', 'HALT'), 'utf8')).resolves.toBe(
        'Protected artifact changed: .docs/plans/repair.md\n',
      );
      await expect(readFile(join(worktree, '.pipeline', 'HALT.class'), 'utf8')).resolves.toBe('protected-artifact');
      expect({ err: err.mock.calls, reseal: reseal.mock.calls }).toEqual({
        err: [['reseal: requires an interactive terminal.']],
        reseal: [],
      });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('emits a refusal event for unlisted protected-artifact drift', async () => {
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
    );
    if (!command) throw new Error('expected valid reseal command');
    const events = new ConductorEventEmitter();
    const refused = vi.fn();
    events.on('protected_artifact_reseal_refused', refused);

    await expect(
      dispatchResealCommand(command, {
        cwd: '/project',
        err: vi.fn(),
        isInteractive: true,
        access: vi.fn().mockResolvedValue(undefined),
        readFile: vi.fn().mockResolvedValue(JSON.stringify({
          baselineCommit: 'base',
          protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
          rebaselines: [],
          version: 2,
        })),
        resolveHead: vi.fn().mockResolvedValue('target'),
        reseal: vi.fn().mockRejectedValue(
          new Error('Protected artifact changed: .docs/stories/unlisted.md'),
        ),
        events,
      }),
    ).resolves.toBe(1);

    expect(refused).toHaveBeenCalledWith({
      type: 'protected_artifact_reseal_refused',
      reason: 'Corrected after review.',
      condition: 'Protected artifact changed: .docs/stories/unlisted.md',
      path: '.docs/stories/unlisted.md',
    });
  });

  it('records malformed rationale and non-interactive refusals in the resolved worktree audit trail', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-refusal-audit-'));
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
    );
    if (!command) throw new Error('expected valid reseal command');
    const seal = JSON.stringify({
      baselineCommit: 'base',
      protectedArtifacts: [{ path: '.docs/plans/repair.md', fingerprint: 'sha256:before' }],
      rebaselines: [],
      version: 2,
    });

    try {
      await expect(
        dispatchResealCommand({ ...command, reason: ' ' }, {
          cwd: root,
          err: vi.fn(),
          isInteractive: true,
          access: vi.fn().mockResolvedValue(undefined),
          readFile: vi.fn().mockResolvedValue(seal),
        }),
      ).resolves.toBe(1);
      await expect(
        dispatchResealCommand(command, {
          cwd: root,
          err: vi.fn(),
          isInteractive: false,
          access: vi.fn().mockResolvedValue(undefined),
          readFile: vi.fn().mockResolvedValue(seal),
        }),
      ).resolves.toBe(1);

      const audit = await readFile(
        join(root, '.worktrees', 'repair', '.pipeline', 'audit-trail', 'events.jsonl'),
        'utf8',
      );
      expect(audit.split('\n').filter(Boolean).map((line) => JSON.parse(line))).toMatchObject([
        { origin: 'operator', event: 'reseal_refused', condition: 'missing rationale' },
        { origin: 'operator', event: 'reseal_refused', condition: 'requires an interactive terminal' },
      ]);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses an unknown feature worktree', async () => {
    const command = detectResealCommand(
      argv('--slug', 'missing', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
    );
    if (!command) throw new Error('expected valid reseal command');
    const err = vi.fn();

    await expect(
      dispatchResealCommand(command, {
        cwd: '/project',
        err,
        isInteractive: true,
        access: vi.fn().mockRejectedValue(new Error('missing')),
      }),
    ).resolves.toBe(1);

    expect(err).toHaveBeenCalledWith("reseal: unknown feature worktree 'missing'.");
  });

  it('does not create an audit-trail directory for an unknown feature worktree', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-unknown-worktree-'));
    const command = detectResealCommand(
      argv('--slug', 'missing', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
    );
    if (!command) throw new Error('expected valid reseal command');

    try {
      await expect(dispatchResealCommand(command, {
        cwd: root,
        err: vi.fn(),
        isInteractive: true,
      })).resolves.toBe(1);

      await expect(access(join(root, '.worktrees', 'missing'))).rejects.toThrow();
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('surfaces an audit persistence failure for a known worktree refusal', async () => {
    const root = await mkdtemp(join(tmpdir(), 'reseal-cli-audit-write-failure-'));
    const worktree = join(root, '.worktrees', 'repair');
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
    );
    if (!command) throw new Error('expected valid reseal command');

    try {
      await mkdir(join(worktree, '.pipeline', 'audit-trail', 'events.jsonl'), { recursive: true });

      await expect(dispatchResealCommand(command, {
        cwd: root,
        err: vi.fn(),
        isInteractive: false,
      })).rejects.toThrow(/failed to append audit record/);
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it('refuses a known worktree without a protected artifact seal', async () => {
    const command = detectResealCommand(
      argv('--slug', 'repair', '--path', '.docs/plans/repair.md', '--reason', 'Corrected after review.'),
    );
    if (!command) throw new Error('expected valid reseal command');
    const err = vi.fn();

    await expect(
      dispatchResealCommand(command, {
        cwd: '/project',
        err,
        isInteractive: true,
        access: vi.fn().mockResolvedValue(undefined),
        readFile: vi.fn().mockRejectedValue(new Error('missing')),
        events: new ConductorEventEmitter(),
      }),
    ).resolves.toBe(1);

    expect(err).toHaveBeenCalledWith("reseal: protected artifact seal is missing for 'repair'.");
  });

  it('wires reseal into the pre-boot chain before normal pipeline parsing', async () => {
    const source = await readFile(new URL('../../src/index.ts', import.meta.url), 'utf8');

    expect(source).toMatch(/from ['"]\.\/engine\/reseal-cli\.js['"]/);
    expect(source).toMatch(/detectResealCommand\(process\.argv\)/);
    expect(source.indexOf('detectResealCommand(process.argv)')).toBeLessThan(source.indexOf('opts = parseArgs(rest)'));
  });
});
