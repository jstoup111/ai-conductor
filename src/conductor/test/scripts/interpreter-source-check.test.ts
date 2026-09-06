import { describe, expect, it } from 'vitest';
import { checkInterpreterSource } from '../../scripts/interpreter-source-check.js';

describe('checkInterpreterSource', () => {
  it.each([
    'node -e "console.log($VALUE)"',
    'python3 -c "print($(date))"',
    'node --eval "console.log(`id`)"',
    'python3 <<PY\nprint(${VALUE})\nPY',
  ])('rejects expanded interpreter source without executing it: %s', (text) => {
    expect(checkInterpreterSource('fixture.sh', text)).toEqual([
      expect.objectContaining({ sourceName: 'fixture.sh' }),
    ]);
  });

  it('accepts fixed source with argv and a quoted heredoc', () => {
    expect(checkInterpreterSource('safe.sh', "node -e 'console.log(process.argv[1])' -- \"$VALUE\"\npython3 - \"$VALUE\" <<'PY'\nprint('$')\nPY")).toEqual([]);
  });
});
