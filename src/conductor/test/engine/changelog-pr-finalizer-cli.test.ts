import { describe, expect, it, vi } from 'vitest';
import {
  finalizeChangelogPr,
  type ChangelogPrFinalizerRunners,
} from '../../src/engine/changelog-pr-finalizer-cli.js';

describe('finalizeChangelogPr', () => {
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
