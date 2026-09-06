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

  it('keeps literal dollars in single-quoted source and reports physical multiline locations', () => {
    expect(checkInterpreterSource('literal.sh', "node -e 'console.log($VALUE)'\npython3 -c \"print(\\\n${VALUE})\"")).toEqual([
      expect.objectContaining({ sourceName: 'literal.sh', line: 2, message: 'shell expansion in interpreter command source' }),
    ]);
  });

  it('does not treat source after a quoted heredoc body as a shell command', () => {
    expect(checkInterpreterSource('heredoc.sh', "python3 - <<'PY'\nnode -e \"$NOT_A_SHELL_COMMAND\"\nPY\nnode --eval='console.log(process.argv[1])' -- \"$VALUE\"")).toEqual([]);
  });
});
