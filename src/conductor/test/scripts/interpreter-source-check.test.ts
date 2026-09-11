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

  it('does not mistake interpreter-looking argument data for a command', () => {
    expect(checkInterpreterSource('argument-data.sh', 'printf %s node -e "$VALUE"\nprintf %s python3 <<PY\nprint($VALUE)\nPY')).toEqual([]);
  });

  it('recognizes direct interpreters after shell command prefixes', () => {
    expect(checkInterpreterSource('prefixed.sh', 'VALUE=1 env node -e "console.log($VALUE)"\ncommand python3 -c "print($VALUE)"')).toEqual([
      expect.objectContaining({ line: 1, message: 'shell expansion in interpreter command source' }),
      expect.objectContaining({ line: 2, message: 'shell expansion in interpreter command source' }),
    ]);
  });

  it('keeps literal dollars in single-quoted source and reports physical multiline locations', () => {
    expect(checkInterpreterSource('literal.sh', "node -e 'console.log($VALUE)'\npython3 -c \"print(\\\n${VALUE})\"")).toEqual([
      expect.objectContaining({ sourceName: 'literal.sh', line: 2, message: 'shell expansion in interpreter command source' }),
    ]);
  });

  it.each([
    ['continued unquoted source', 'node -e console.log\\\n($VALUE)', 1],
    ['source after a continued option', 'node -e \\\n"console.log($VALUE)"', 2],
    ['interpreter before a continued option', 'python3 \\\n-c "print($VALUE)"', 2],
  ])('rejects shell expansion in a %s', (_name, text, line) => {
    expect(checkInterpreterSource('continued-unsafe.sh', text)).toEqual([
      expect.objectContaining({ sourceName: 'continued-unsafe.sh', line, message: 'shell expansion in interpreter command source' }),
    ]);
  });

  it.each([
    'node -e console.log\\\n(process.argv[1])',
    'node -e \\\n"console.log(process.argv[1])"',
    'python3 \\\n-c "print(process.argv[1])"',
  ])('accepts static source in an escaped-newline command: %s', (text) => {
    expect(checkInterpreterSource('continued-safe.sh', text)).toEqual([]);
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

  it.each([
    ['positional parameter', 'node --eval="console.log($1)"'],
    ['special parameter', 'node --eval="console.log($-)"'],
    ['command substitution', 'python3 -c "print($(date))"'],
    ['backtick substitution', 'node -e "console.log(`id`)"'],
    ['multiline eval assignment', 'node --eval="\nconsole.log($VALUE)\n"'],
  ])('rejects every expansion form in direct interpreter source: %s', (_name, text) => {
    expect(checkInterpreterSource('forms.sh', text)).toEqual([
      expect.objectContaining({ sourceName: 'forms.sh', line: 1, message: 'shell expansion in interpreter command source' }),
    ]);
  });

  it('accepts safe multiline double and single quoted source without inventing a nested command', () => {
    expect(checkInterpreterSource('safe-multiline.sh', "node -e \"\nconsole.log(process.argv[1])\n\" -- \"$VALUE\"\nnode -e '\n$LITERAL\n'\ncat <<'TEXT'\nnode -e \"$PHANTOM\"\nTEXT")).toEqual([]);
  });

  it('tracks every queued heredoc and never scans a non-interpreter body as shell', () => {
    expect(checkInterpreterSource('queued.sh', "python3 - <<FIRST <<SECOND\nconstant\nFIRST\nprint($VALUE)\nSECOND\ncat <<'TEXT'\nnode -e \"$PHANTOM\"\nTEXT")).toEqual([
      expect.objectContaining({ line: 4, message: 'shell expansion in interpreter heredoc source' }),
    ]);
  });

  it('accepts fully and partially quoted heredoc delimiters while retaining later queued bodies', () => {
    expect(checkInterpreterSource('quoted-queued.sh', "python3 <<'FIRST' <<\"SECOND\"\nprint($LITERAL)\nFIRST\nnode -e \"$PHANTOM\"\nSECOND")).toEqual([]);
  });

  it.each([
    ['fully backslash-quoted delimiter', 'python3 <<\\PY\nprint($LITERAL)\nPY'],
    ['partially backslash-quoted delimiter', 'python3 <<P\\Y\nprint($LITERAL)\nPY'],
    ['backslash after a single-quoted part', "python3 <<'P'\\Y\nprint($LITERAL)\nPY"],
    ['backslash after a double-quoted part', 'python3 <<"PY"\\Z\nprint($LITERAL)\nPYZ'],
  ])('accepts a %s without scanning its literal body', (_name, text) => {
    expect(checkInterpreterSource('backslash-quoted.sh', text)).toEqual([]);
  });

  it.each([
    ['PY', 'PY'],
    ['PYY', 'PYY'],
  ])('rejects the unsafe unquoted heredoc twin: %s', (delimiter, terminator) => {
    expect(checkInterpreterSource('unquoted.sh', `python3 <<${delimiter}\nprint($LITERAL)\n${terminator}`)).toEqual([
      expect.objectContaining({ sourceName: 'unquoted.sh', line: 2, message: 'shell expansion in interpreter heredoc source' }),
    ]);
  });

  it('uses backslash-run parity for expanding heredoc bodies', () => {
    expect(checkInterpreterSource('even-backslashes.sh', 'python3 <<PY\nprint(\\\\$VALUE)\nPY')).toEqual([
      expect.objectContaining({ line: 2, message: 'shell expansion in interpreter heredoc source' }),
    ]);
    expect(checkInterpreterSource('odd-backslashes.sh', 'python3 <<PY\nprint(\\\\\\$VALUE)\nPY')).toEqual([]);
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

  it('preserves physical locations for tab-stripped expanding heredocs in a command substitution', () => {
    expect(checkInterpreterSource('nested-tabbed-heredoc.sh', 'result=$(python3 <<-PY\n\tprint(`id`)\n\tPY\n)')).toEqual([
      expect.objectContaining({ sourceName: 'nested-tabbed-heredoc.sh', line: 2, message: 'shell expansion in interpreter heredoc source' }),
    ]);
  });

  it('accepts fixed interpreter source inside a command substitution', () => {
    expect(checkInterpreterSource('nested-safe.sh', "x=$(node -e 'console.log(process.argv[1])' -- \"$VALUE\")\ny=$(python3 - \"$VALUE\" <<'PY'\nprint('$')\nPY\n)")).toEqual([]);
  });

  it('keeps the physical line for an interpreter nested after an escaped continuation', () => {
    expect(checkInterpreterSource('nested-continuation.sh', 'result=$(true; \\\nnode -e "console.log($VALUE)")')).toEqual([
      expect.objectContaining({ sourceName: 'nested-continuation.sh', line: 2, message: 'shell expansion in interpreter command source' }),
    ]);
    expect(checkInterpreterSource('nested-continuation-safe.sh', 'result=$(true; \\\nnode -e "console.log(process.argv[1])")')).toEqual([]);
  });

  it('associates heredocs that precede their interpreter command word', () => {
    expect(checkInterpreterSource('prefix-heredoc.sh', '<<PY python3\nprint($VALUE)\nPY')).toEqual([
      expect.objectContaining({ sourceName: 'prefix-heredoc.sh', line: 2, message: 'shell expansion in interpreter heredoc source' }),
    ]);
    expect(checkInterpreterSource('prefix-heredoc-safe.sh', "<<'PY' python3\nprint($VALUE)\nPY")).toEqual([]);
  });

  it.each([
    ['input redirection before python', '<input python3 -c "print($VALUE)"'],
    ['numbered output redirection before node', '2>/dev/null node -e "console.log($VALUE)"'],
    ['redirection after python', 'python3 2>/dev/null -c "print($VALUE)"'],
    ['descriptor duplication before node', '>&2 node --eval="console.log($VALUE)"'],
  ])('does not treat %s operands as command words', (_name, text) => {
    expect(checkInterpreterSource('redirection-command.sh', text)).toEqual([
      expect.objectContaining({ line: 1, message: 'shell expansion in interpreter command source' }),
    ]);
  });

  it('associates heredocs with interpreters despite ordinary redirections', () => {
    expect(checkInterpreterSource('redirection-heredoc.sh', '>output <<PY python3\nprint($VALUE)\nPY')).toEqual([
      expect.objectContaining({ line: 2, message: 'shell expansion in interpreter heredoc source' }),
    ]);
    expect(checkInterpreterSource('redirection-heredoc-safe.sh', "2>/dev/null <<'PY' python3\nprint($VALUE)\nPY")).toEqual([]);
  });

  it('terminates after case-pattern separators at end of line', () => {
    expect(checkInterpreterSource('case.sh', 'case "$name" in\n  conduct-ts)\n    true\n    ;;\nesac')).toEqual([]);
  });

  it('continues at the suffix of a closed multiline source word', () => {
    expect(checkInterpreterSource('multiline-suffix.sh', 'node -e "\nconsole.log(process.argv[1])\n"; python3 -c "print($VALUE)"')).toEqual([
      expect.objectContaining({ line: 3, message: 'shell expansion in interpreter command source' }),
    ]);
    expect(checkInterpreterSource('multiline-suffix-safe.sh', 'node -e "\nconsole.log(process.argv[1])\n"; python3 -c "print(process.argv[1])"')).toEqual([]);
  });

  it('retains heredocs discovered in the suffix of a closed multiline source word', () => {
    expect(checkInterpreterSource('multiline-suffix-heredoc.sh', 'node -e "\nconsole.log(process.argv[1])\n"; python3 <<PY\nprint($VALUE)\nPY')).toEqual([
      expect.objectContaining({ line: 4, message: 'shell expansion in interpreter heredoc source' }),
    ]);
  });

  it('associates queued heredocs with their own command', () => {
    expect(checkInterpreterSource('mixed-heredocs.sh', "python3 <<'PY'; cat <<EOF\nprint('$')\nPY\n$VALUE\nEOF")).toEqual([]);
    expect(checkInterpreterSource('mixed-heredocs-unsafe.sh', 'python3 <<PY; cat <<\'EOF\'\nprint($VALUE)\nPY\n$LITERAL\nEOF')).toEqual([
      expect.objectContaining({ line: 2, message: 'shell expansion in interpreter heredoc source' }),
    ]);
  });

  it('keeps heredoc ownership in the outer lexical context after a completed substitution', () => {
    expect(checkInterpreterSource('outer-python.sh', 'python3 - "$(printf x)" <<PY\nprint($VALUE)\nPY')).toEqual([
      expect.objectContaining({ line: 2, message: 'shell expansion in interpreter heredoc source' }),
    ]);
    expect(checkInterpreterSource('outer-cat.sh', 'cat "$(python3 -c \'print(1)\')" <<EOF\n$VALUE\nEOF')).toEqual([]);
  });

  it.each([
    '# <<EOF',
    'echo "<<EOF"',
    "echo '<<EOF'",
    'echo <<<"literal"',
    'echo $((1<<2))',
    '((1<<2))',
  ])('does not let non-redirection %s hide a later unsafe interpreter command', (prefix) => {
    expect(checkInterpreterSource('false-heredoc-unsafe.sh', `${prefix}\nnode -e "console.log($VALUE)"`)).toEqual([
      expect.objectContaining({ sourceName: 'false-heredoc-unsafe.sh', line: 2, message: 'shell expansion in interpreter command source' }),
    ]);
  });

  it.each([
    '# <<EOF',
    'echo "<<EOF"',
    "echo '<<EOF'",
    'echo <<<"literal"',
    'echo $((1<<2))',
    '((1<<2))',
  ])('accepts static source after non-redirection %s', (prefix) => {
    expect(checkInterpreterSource('false-heredoc-safe.sh', `${prefix}\nnode -e "console.log(process.argv[1])"`)).toEqual([]);
  });
});
