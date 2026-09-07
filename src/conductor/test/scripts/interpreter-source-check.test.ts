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

  it('accepts a multiline single-quoted interpreter source', () => {
    expect(checkInterpreterSource('multiline.sh', "node -e '\nconsole.log(process.argv[1])\n' -- \"$VALUE\"")).toEqual([]);
  });

  it('does not treat source after a quoted heredoc body as a shell command', () => {
    expect(checkInterpreterSource('heredoc.sh', "python3 - <<'PY'\nnode -e \"$NOT_A_SHELL_COMMAND\"\nPY\nnode --eval='console.log(process.argv[1])' -- \"$VALUE\"")).toEqual([]);
  });

  it('continues after shell command boundaries and detects special parameters', () => {
    expect(checkInterpreterSource('compound.sh', 'true; node -e "console.log($?)" | python3 -c "print($0)"')).toEqual([
      expect.objectContaining({ line: 1, message: 'shell expansion in interpreter command source' }),
      expect.objectContaining({ line: 1, message: 'shell expansion in interpreter command source' }),
    ]);
  });

  it('tracks every queued heredoc and never scans a non-interpreter body as shell', () => {
    expect(checkInterpreterSource('queued.sh', "python3 - <<FIRST <<SECOND\nconstant\nFIRST\nprint($VALUE)\nSECOND\ncat <<'TEXT'\nnode -e \"$PHANTOM\"\nTEXT")).toEqual([
      expect.objectContaining({ line: 4, message: 'shell expansion in interpreter heredoc source' }),
    ]);
  });

  it.each([
    ['nested node -e', 'x=$(node -e "console.log($VALUE)")'],
    ['nested python -c', 'x=$(python3 -c "print($VALUE)")'],
    ['doubly nested node -e', 'x=$(printf %s "$(node -e "console.log($VALUE)")")'],
  ])('rejects expanded interpreter source inside a command substitution: %s', (_name, text) => {
    expect(checkInterpreterSource('nested.sh', text)).toEqual([
      expect.objectContaining({ sourceName: 'nested.sh', line: 1, message: 'shell expansion in interpreter command source' }),
    ]);
  });

  it('rejects an expanding interpreter heredoc opened inside a command substitution', () => {
    expect(checkInterpreterSource('nested-heredoc.sh', 'x=$(python3 <<PY\nprint($VALUE)\nPY\n)')).toEqual([
      expect.objectContaining({ sourceName: 'nested-heredoc.sh', line: 2, message: 'shell expansion in interpreter heredoc source' }),
    ]);
  });

  it('accepts fixed interpreter source inside a command substitution', () => {
    expect(checkInterpreterSource('nested-safe.sh', "x=$(node -e 'console.log(process.argv[1])' -- \"$VALUE\")\ny=$(python3 - \"$VALUE\" <<'PY'\nprint('$')\nPY\n)")).toEqual([]);
  });

  it('terminates after case-pattern separators at end of line', () => {
    expect(checkInterpreterSource('case.sh', 'case "$name" in\n  conduct-ts)\n    true\n    ;;\nesac')).toEqual([]);
  });
});
