import { describe, expect, it, vi } from 'vitest';
import { resolvePlanPatternSource } from '../../src/engine/plan-pattern-source.js';

const planPath = '.docs/plans/feature.md';
const sourcePath = 'src/conductor/src/engine/wired-into.ts';

function fileExists(paths: string[] = [sourcePath]) {
  return async (path: string) => paths.includes(path);
}

describe('resolvePlanPatternSource', () => {
  it('resolves a Pattern-source header', async () => {
    const result = await resolvePlanPatternSource(
      planPath,
      [
        '**Pattern-source:** src/conductor/src/engine/wired-into.ts',
        '**Rename-map:** source -> target',
      ].join('\n'),
      fileExists(),
    );

    expect(result).toEqual({
      kind: 'resolved',
      sourcePath: 'src/conductor/src/engine/wired-into.ts',
      renameMap: [{ source: 'source', target: 'target' }],
    });
  });

  it('preserves source path casing', async () => {
    const result = await resolvePlanPatternSource(
      planPath,
      [
        '**Pattern-source:** src/conductor/src/engine/Wired-Into.ts',
        '**Rename-map:** source -> target',
      ].join('\n'),
      fileExists(['src/conductor/src/engine/Wired-Into.ts']),
    );

    expect(result).toEqual({
      kind: 'resolved',
      sourcePath: 'src/conductor/src/engine/Wired-Into.ts',
      renameMap: [{ source: 'source', target: 'target' }],
    });
  });

  it.each([
    ['an inline-code path', '`src/conductor/src/engine/wired-into.ts`'],
    [
      'a Markdown link',
      '[wired-into source](src/conductor/src/engine/wired-into.ts)',
    ],
  ])('resolves %s identically to a bare path', async (_form, reference) => {
    const result = await resolvePlanPatternSource(
      planPath,
      `**Pattern-source:** ${reference}\n**Rename-map:** source -> target`,
      fileExists(),
    );

    expect(result).toEqual({
      kind: 'resolved',
      sourcePath: 'src/conductor/src/engine/wired-into.ts',
      renameMap: [{ source: 'source', target: 'target' }],
    });
  });

  it('resolves Rename-map pairs in declaration order with casing preserved', async () => {
    const result = await resolvePlanPatternSource(
      planPath,
      [
        '**Pattern-source:** src/conductor/src/engine/wired-into.ts',
        '**Rename-map:** wired-into+legacy -> pattern-source+legacy, WiredInto -> PatternSource',
      ].join('\n'),
      fileExists(),
    );

    expect(result).toEqual({
      kind: 'resolved',
      sourcePath: 'src/conductor/src/engine/wired-into.ts',
      renameMap: [
        { source: 'wired-into+legacy', target: 'pattern-source+legacy' },
        { source: 'WiredInto', target: 'PatternSource' },
      ],
    });
  });

  it('returns malformed when the declared source path does not exist', async () => {
    const result = await resolvePlanPatternSource(
      planPath,
      '**Pattern-source:** src/missing.ts\n**Rename-map:** source -> target',
      fileExists(),
    );

    expect(result).toMatchObject({ kind: 'malformed', message: expect.stringContaining('src/missing.ts') });
  });

  it('refuses traversal without reading the declared source', async () => {
    const read = vi.fn(async () => true);
    const result = await resolvePlanPatternSource(
      planPath,
      '**Pattern-source:** ../outside.ts\n**Rename-map:** source -> target',
      read,
    );

    expect(result).toMatchObject({ kind: 'malformed', message: expect.stringMatching(/traversal/i) });
    expect(read).not.toHaveBeenCalled();
  });

  it('returns malformed with accepted forms for an invalid Rename-map', async () => {
    const result = await resolvePlanPatternSource(
      planPath,
      `**Pattern-source:** ${sourcePath}\n**Rename-map:** source => target`,
      fileExists(),
    );

    expect(result).toMatchObject({ kind: 'malformed', message: expect.stringMatching(/accepted forms.*source\s*->\s*target/i) });
  });

  it('returns malformed naming a Rename-map pair with an empty left side', async () => {
    const result = await resolvePlanPatternSource(
      planPath,
      `**Pattern-source:** ${sourcePath}\n**Rename-map:**  -> target`,
      fileExists(),
    );

    expect(result).toMatchObject({ kind: 'malformed', message: expect.stringContaining('-> target') });
  });

  it('returns absent without a diagnostic when neither declaration is present', async () => {
    const result = await resolvePlanPatternSource(planPath, '# Implementation Plan', fileExists());

    expect(result).toEqual({ kind: 'absent' });
  });

  it('returns malformed when Pattern-source has no Rename-map', async () => {
    const result = await resolvePlanPatternSource(
      planPath,
      `**Pattern-source:** ${sourcePath}`,
      fileExists(),
    );

    expect(result).toMatchObject({ kind: 'malformed', message: expect.stringContaining('**Rename-map:**') });
  });
});
