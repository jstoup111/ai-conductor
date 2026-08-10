import { describe, expect, it } from 'vitest';
import { resolvePlanPatternSource } from '../../src/engine/plan-pattern-source.js';

describe('resolvePlanPatternSource', () => {
  it('resolves a Pattern-source header', () => {
    const result = resolvePlanPatternSource(
      '**Pattern-source:** src/conductor/src/engine/wired-into.ts',
    );

    expect(result).toEqual({
      kind: 'resolved',
      sourcePath: 'src/conductor/src/engine/wired-into.ts',
      renameMap: [],
    });
  });

  it('preserves source path casing', () => {
    const result = resolvePlanPatternSource(
      '**Pattern-source:** src/conductor/src/engine/Wired-Into.ts',
    );

    expect(result).toEqual({
      kind: 'resolved',
      sourcePath: 'src/conductor/src/engine/Wired-Into.ts',
      renameMap: [],
    });
  });

  it.each([
    ['an inline-code path', '`src/conductor/src/engine/wired-into.ts`'],
    [
      'a Markdown link',
      '[wired-into source](src/conductor/src/engine/wired-into.ts)',
    ],
  ])('resolves %s identically to a bare path', (_form, reference) => {
    const result = resolvePlanPatternSource(`**Pattern-source:** ${reference}`);

    expect(result).toEqual({
      kind: 'resolved',
      sourcePath: 'src/conductor/src/engine/wired-into.ts',
      renameMap: [],
    });
  });

  it('resolves Rename-map pairs in declaration order with casing preserved', () => {
    const result = resolvePlanPatternSource(
      [
        '**Pattern-source:** src/conductor/src/engine/wired-into.ts',
        '**Rename-map:** wired-into+legacy -> pattern-source+legacy, WiredInto -> PatternSource',
      ].join('\n'),
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
});
