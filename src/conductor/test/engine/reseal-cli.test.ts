import { describe, expect, it } from 'vitest';
import { detectResealCommand } from '../../src/engine/reseal-cli.js';

// argv is process.argv: [node, entry, subcommand, ...arguments].
const argv = (...arguments_: string[]) => ['node', 'conduct', 'reseal', ...arguments_];

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
