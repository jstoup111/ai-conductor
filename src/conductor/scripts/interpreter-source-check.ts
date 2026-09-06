export interface InterpreterSourceFinding {
  sourceName: string;
  line: number;
  message: string;
}

/**
 * Finds shell expansion in source passed directly to Python or Node.  This is
 * deliberately a small lexical check: it never evaluates either shell or the
 * candidate interpreter source.
 */
export function checkInterpreterSource(sourceName: string, text: string): InterpreterSourceFinding[] {
  const findings: InterpreterSourceFinding[] = [];
  const lines = text.split(/\r?\n/);
  const expanded = /(?<!\\)(?:\$\{|\$\(|\$[A-Za-z_][A-Za-z0-9_]*|`)/;
  const command = /(?:^|[;|&]\s*)(?:\/[^\s]+\/)?(?:python3?|node)\s+(?:-c\s+|-e\s+|--eval(?:=|\s+))([\s\S]*)$/;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(command);
    if (match) {
      const sourceStart = match[1].trimStart();
      const quote = sourceStart[0];
      // A source argument is one shell word.  Read quoted words across physical
      // lines so a continuation cannot hide an interpolation from this check.
      if (quote === "'" || quote === '"') {
        let sourceWord = '';
        let closed = false;
        let cursor = sourceStart.slice(1);
        let sourceLine = index;
        while (true) {
          for (let char = 0; char < cursor.length; char += 1) {
            if (cursor[char] === quote && cursor[char - 1] !== '\\') {
              closed = true;
              break;
            }
            sourceWord += cursor[char];
          }
          if (closed || sourceLine + 1 >= lines.length) break;
          sourceWord += '\n';
          sourceLine += 1;
          cursor = lines[sourceLine];
        }
        if (!closed) {
          findings.push({ sourceName, line: index + 1, message: 'unterminated interpreter command source' });
        } else if (quote !== "'" && expanded.test(sourceWord)) {
          findings.push({ sourceName, line: index + 1, message: 'shell expansion in interpreter command source' });
        }
        index = Math.max(index, sourceLine);
      } else if (!sourceStart || sourceStart.startsWith('#')) {
        findings.push({ sourceName, line: index + 1, message: 'missing interpreter command source' });
      } else {
        const sourceWord = sourceStart.split(/\s+/)[0];
        if (expanded.test(sourceWord)) {
          findings.push({ sourceName, line: index + 1, message: 'shell expansion in interpreter command source' });
        }
      }
    }

    const here = lines[index].match(/(?:^|\s)(?:python3?)(?:\s+[^<]*)?\s+<<-?\s*([^\s]+)/);
    if (!here) continue;
    const rawDelimiter = here[1];
    const quoted = /['"]/.test(rawDelimiter);
    const delimiter = rawDelimiter.replace(/['"]/g, '');
    let bodyEnd = index + 1;
    while (bodyEnd < lines.length && lines[bodyEnd].replace(/^\t+/, '') !== delimiter) bodyEnd += 1;
    if (bodyEnd === lines.length) {
      findings.push({ sourceName, line: index + 1, message: 'unterminated interpreter heredoc' });
      continue;
    }
    if (!quoted) {
      for (let bodyLine = index + 1; bodyLine < bodyEnd; bodyLine += 1) {
        if (expanded.test(lines[bodyLine])) {
          findings.push({ sourceName, line: bodyLine + 1, message: 'shell expansion in interpreter heredoc source' });
        }
      }
    }
    index = bodyEnd;
  }
  return findings;
}
