import { describe, expect, it, vi } from 'vitest';
import { readFile } from 'node:fs/promises';
import { createProgram } from '../../src/cli.js';
import { detectResealCommand, dispatchResealCommand } from '../../src/engine/reseal-cli.js';

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
    const reseal = vi.fn().mockResolvedValue(undefined);

    await expect(
      dispatchResealCommand(command, {
        cwd: '/project',
        out,
        access: vi.fn().mockResolvedValue(undefined),
        isInteractive: true,
        readFile: vi.fn().mockResolvedValue(JSON.stringify({ baselineCommit: 'base' })),
        resolveHead: vi.fn().mockResolvedValue('target'),
        reseal,
      }),
    ).resolves.toBe(0);

    expect({
      reseal: reseal.mock.calls,
      out: out.mock.calls,
    }).toEqual({
      reseal: [[{
        projectRoot: '/project/.worktrees/repair',
        seal: { baselineCommit: 'base' },
        toCommit: 'target',
        trigger: 'operator-reseal',
        paths: ['.docs/plans/repair.md'],
      }]],
      out: [['Resealed protected artifacts: .docs/plans/repair.md']],
    });
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
