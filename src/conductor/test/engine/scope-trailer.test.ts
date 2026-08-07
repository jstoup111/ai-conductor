import { describe, expect, it } from 'vitest';
import { parseScopeTrailers } from '../../src/engine/scope-trailer.js';

describe('parseScopeTrailers', () => {
  it('parses a Scope trailer path and rationale from a commit message', () => {
    expect(
      parseScopeTrailers(
        'feat(engine): add command\n\nTask: 6\nScope: src/conductor/src/index.ts — registers the command',
      ),
    ).toEqual([
      {
        path: 'src/conductor/src/index.ts',
        rationale: 'registers the command',
      },
    ]);
  });

  it('parses repeated Scope trailers independently', () => {
    expect(
      parseScopeTrailers(
        [
          'feat(engine): add command',
          '',
          'Scope: src/conductor/src/index.ts — registers the command',
          'Scope: src/conductor/test/engine/index.test.ts — proves registration',
        ].join('\n'),
      ),
    ).toEqual([
      {
        path: 'src/conductor/src/index.ts',
        rationale: 'registers the command',
      },
      {
        path: 'src/conductor/test/engine/index.test.ts',
        rationale: 'proves registration',
      },
    ]);
  });

  it('accepts a hyphen as the Scope trailer separator', () => {
    expect(
      parseScopeTrailers('feat(engine): add command\n\nScope: src/conductor/src/index.ts - registers the command'),
    ).toEqual([
      {
        path: 'src/conductor/src/index.ts',
        rationale: 'registers the command',
      },
    ]);
  });

  it.each([
    ['a path outside the staged set', 'Scope: src/conductor/src/index.ts — registers the command'],
    ['a missing rationale', 'Scope: src/conductor/src/index.ts —'],
    ['an empty rationale', 'Scope: src/conductor/src/index.ts —    '],
    ['a bare Scope trailer', 'Scope:'],
  ])('treats %s as absent', (_name, trailer) => {
    expect(
      parseScopeTrailers(
        `feat(engine): add command\n\n${trailer}`,
        ['src/conductor/src/engine/scope-trailer.ts'],
      ),
    ).toEqual([]);
  });

  it('does not retain a prior commit widening', () => {
    expect(
      parseScopeTrailers(
        'feat(engine): add command\n\nScope: src/conductor/src/index.ts — registers the command',
        ['src/conductor/src/index.ts'],
      ),
    ).toEqual([
      {
        path: 'src/conductor/src/index.ts',
        rationale: 'registers the command',
      },
    ]);

    expect(
      parseScopeTrailers('feat(engine): follow-up', ['src/conductor/src/index.ts']),
    ).toEqual([]);
  });
});
