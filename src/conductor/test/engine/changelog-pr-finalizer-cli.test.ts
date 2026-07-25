import { describe, expect, it, vi } from 'vitest';
import {
  detectFinalizeChangelogPrCommand,
  dispatchFinalizeChangelogPr,
  FINALIZE_CHANGELOG_PR_USAGE,
  finalizeChangelogPr,
  type ChangelogPrFinalizerRunners,
} from '../../src/engine/changelog-pr-finalizer-cli.js';

describe('detectFinalizeChangelogPrCommand', () => {
  const argv = (...rest: string[]) => ['node', 'conduct-ts', ...rest];

  it('parses the exact implementation PR URL option', () => {
    expect(
      detectFinalizeChangelogPrCommand(
        argv(
          'finalize-changelog-pr',
          '--pr-url',
          'https://github.com/octo/widgets/pull/456',
        ),
      ),
    ).toEqual({
      kind: 'finalize',
      prUrl: 'https://github.com/octo/widgets/pull/456',
    });
  });

  it('recognizes malformed use as a guide command instead of pipeline input', () => {
    expect(detectFinalizeChangelogPrCommand(argv('finalize-changelog-pr'))).toEqual({
      kind: 'guide',
    });
  });
});

describe('dispatchFinalizeChangelogPr', () => {
  it('prints usage and refuses malformed command input without touching the filesystem', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const runners: ChangelogPrFinalizerRunners = {
      readFile: vi.fn(),
      writeFile: vi.fn(),
      rename: vi.fn(),
      rm: vi.fn(),
    };

    const code = await dispatchFinalizeChangelogPr({ kind: 'guide' }, '/repo', runners);

    expect({
      code,
      diagnostics: errorSpy.mock.calls,
      filesystemCalls: Object.values(runners).flatMap((runner) =>
        (runner as ReturnType<typeof vi.fn>).mock.calls.map((call) => call),
      ),
    }).toEqual({
      code: 1,
      diagnostics: [[FINALIZE_CHANGELOG_PR_USAGE]],
      filesystemCalls: [],
    });
    errorSpy.mockRestore();
  });
});

describe('finalizeChangelogPr', () => {
  it('cleans up the temporary file when the atomic rename fails', async () => {
    const changelogPath = '/repo/CHANGELOG.md';
    const original = '## [Unreleased]\n\n- Add widgets ({{IMPLEMENTATION_PR}}).\n';
    const files = new Map([[changelogPath, original]]);
    const writeFile = vi.fn(async (path: string, contents: string) => {
      files.set(path, contents);
    });
    const rename = vi.fn(async () => {
      throw new Error('EPERM: simulated rename failure');
    });
    const rm = vi.fn(async (path: string) => {
      files.delete(path);
    });
    let error: unknown;

    try {
      await finalizeChangelogPr(changelogPath, 'https://github.com/octo/widgets/pull/456', {
        readFile: vi.fn(async (path: string) => files.get(path) ?? ''),
        writeFile,
        rename,
        rm,
      });
    } catch (caught) {
      error = caught;
    }

    expect({
      error: error instanceof Error ? error.message : undefined,
      changelog: files.get(changelogPath),
      temporaryPaths: [...files.keys()].filter((path) => path !== changelogPath),
      writes: writeFile.mock.calls.length,
      renames: rename.mock.calls.length,
      cleanups: rm.mock.calls.length,
    }).toEqual({
      error: 'EPERM: simulated rename failure',
      changelog: original,
      temporaryPaths: [],
      writes: 1,
      renames: 1,
      cleanups: 1,
    });
  });

  it('cleans up a partial temporary file when the atomic write fails', async () => {
    const changelogPath = '/repo/CHANGELOG.md';
    const original = '## [Unreleased]\n\n- Add widgets ({{IMPLEMENTATION_PR}}).\n';
    const files = new Map([[changelogPath, original]]);
    const rename = vi.fn<ChangelogPrFinalizerRunners['rename']>();
    const rm = vi.fn(async (path: string) => {
      files.delete(path);
    });
    const runners = {
      readFile: vi.fn(async (path: string) => files.get(path) ?? ''),
      writeFile: vi.fn(async (path: string, contents: string) => {
        files.set(path, contents.slice(0, 12));
        throw new Error('ENOSPC: simulated partial write');
      }),
      rename,
      rm,
    };
    let error: unknown;

    try {
      await finalizeChangelogPr(
        changelogPath,
        'https://github.com/octo/widgets/pull/456',
        runners,
      );
    } catch (caught) {
      error = caught;
    }

    expect({
      error: error instanceof Error ? error.message : undefined,
      changelog: files.get(changelogPath),
      temporaryPaths: [...files.keys()].filter((path) => path !== changelogPath),
      renames: rename.mock.calls,
      cleanups: rm.mock.calls.length,
    }).toEqual({
      error: 'ENOSPC: simulated partial write',
      changelog: original,
      temporaryPaths: [],
      renames: [],
      cleanups: 1,
    });
  });

  it('refuses duplicate tokens without changing the changelog', async () => {
    const changelogPath = '/repo/CHANGELOG.md';
    const original =
      '## [Unreleased]\n\n- Add widgets ({{IMPLEMENTATION_PR}}).\n- Add gears ({{IMPLEMENTATION_PR}}).\n';
    const files = new Map([[changelogPath, original]]);
    const writeFile = vi.fn<ChangelogPrFinalizerRunners['writeFile']>(async (path, contents) => {
      files.set(path, contents);
    });
    const rename = vi.fn<ChangelogPrFinalizerRunners['rename']>(async (from, to) => {
      files.set(to, files.get(from) ?? '');
      files.delete(from);
    });
    let error: unknown;

    try {
      await finalizeChangelogPr(changelogPath, 'https://github.com/octo/widgets/pull/456', {
        readFile: vi.fn(async (path: string) => files.get(path) ?? ''),
        writeFile,
        rename,
        rm: vi.fn(),
      });
    } catch (caught) {
      error = caught;
    }

    expect({
      error: error instanceof Error ? error.message : undefined,
      changelog: files.get(changelogPath),
      writes: writeFile.mock.calls,
      renames: rename.mock.calls,
    }).toEqual({
      error: 'multiple implementation PR tokens found',
      changelog: original,
      writes: [],
      renames: [],
    });
  });

  it('refuses an unreadable changelog without attempting a write', async () => {
    const original = '## [Unreleased]\n\n- Add widget support ({{IMPLEMENTATION_PR}}).\n';
    const writeFile = vi.fn<ChangelogPrFinalizerRunners['writeFile']>();
    const rename = vi.fn<ChangelogPrFinalizerRunners['rename']>();
    let error: unknown;

    try {
      await finalizeChangelogPr('/repo/CHANGELOG.md', 'https://github.com/octo/widgets/pull/456', {
        readFile: vi.fn(async () => {
          throw new Error('EACCES: permission denied');
        }),
        writeFile,
        rename,
        rm: vi.fn(),
      });
    } catch (caught) {
      error = caught;
    }

    expect({
      error: error instanceof Error ? error.message : undefined,
      changelog: original,
      writes: writeFile.mock.calls,
      renames: rename.mock.calls,
    }).toEqual({
      error: 'EACCES: permission denied',
      changelog: '## [Unreleased]\n\n- Add widget support ({{IMPLEMENTATION_PR}}).\n',
      writes: [],
      renames: [],
    });
  });

  it('refuses an invalid PR URL without reading or changing the changelog', async () => {
    const changelog = '## [Unreleased]\n\n- Add widget support ({{IMPLEMENTATION_PR}}).\n';
    const readFile = vi.fn<ChangelogPrFinalizerRunners['readFile']>();
    const writeFile = vi.fn<ChangelogPrFinalizerRunners['writeFile']>();
    const rename = vi.fn<ChangelogPrFinalizerRunners['rename']>();
    let error: unknown;

    try {
      await finalizeChangelogPr('/repo/CHANGELOG.md', 'https://example.com/pull/456', {
        readFile,
        writeFile,
        rename,
        rm: vi.fn(),
      });
    } catch (caught) {
      error = caught;
    }

    expect({
      error: error instanceof Error ? error.message : undefined,
      changelog,
      reads: readFile.mock.calls,
      writes: writeFile.mock.calls,
      renames: rename.mock.calls,
    }).toEqual({
      error: 'invalid canonical GitHub pull request URL',
      changelog: '## [Unreleased]\n\n- Add widget support ({{IMPLEMENTATION_PR}}).\n',
      reads: [],
      writes: [],
      renames: [],
    });
  });

  it('returns no-op without writing when the changelog has no token', async () => {
    const changelogPath = '/repo/CHANGELOG.md';
    const changelog = '## [Unreleased]\n\nNo notable changes.\n';
    const writeFile = vi.fn<ChangelogPrFinalizerRunners['writeFile']>();
    const rename = vi.fn<ChangelogPrFinalizerRunners['rename']>();
    const state = await finalizeChangelogPr(
      changelogPath,
      'https://github.com/octo/widgets/pull/456',
      {
        readFile: vi.fn(async () => changelog),
        writeFile,
        rename,
        rm: vi.fn(),
      },
    );

    expect({ state, changelog, writes: writeFile.mock.calls, renames: rename.mock.calls }).toEqual({
      state: 'no-op',
      changelog: '## [Unreleased]\n\nNo notable changes.\n',
      writes: [],
      renames: [],
    });
  });

  it('atomically replaces one token with the canonical implementation PR link', async () => {
    const changelogPath = '/repo/CHANGELOG.md';
    const files = new Map([
      [changelogPath, '## [Unreleased]\n\n- Add widget support ({{IMPLEMENTATION_PR}}).\n'],
    ]);
    const writeTargets: string[] = [];
    const renameTargets: Array<[string, string]> = [];
    const runners: ChangelogPrFinalizerRunners = {
      readFile: vi.fn(async (path: string) => files.get(path) ?? ''),
      writeFile: vi.fn(async (path: string, contents: string) => {
        writeTargets.push(path);
        files.set(path, contents);
      }),
      rename: vi.fn(async (from: string, to: string) => {
        renameTargets.push([from, to]);
        files.set(to, files.get(from) ?? '');
        files.delete(from);
      }),
      rm: vi.fn(async (path: string) => {
        files.delete(path);
      }),
    };

    const state = await finalizeChangelogPr(
      changelogPath,
      'https://github.com/octo/widgets/pull/456',
      runners,
    );

    expect({
      state,
      changelog: files.get(changelogPath),
      wroteTargetDirectly: writeTargets.includes(changelogPath),
      renameTarget: renameTargets[0]?.[1],
    }).toEqual({
      state: 'changed',
      changelog:
        '## [Unreleased]\n\n- Add widget support ([implementation PR #456](https://github.com/octo/widgets/pull/456)).\n',
      wroteTargetDirectly: false,
      renameTarget: changelogPath,
    });
  });
});
