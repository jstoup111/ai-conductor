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
  const command = /(?:^|[;|&]\s*)(?:\/[^\s]+\/)?(?:python3?|node)\s+(?:-c\s+|-e\s+|--eval(?:=|\s+))(.+)$/;

  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(command);
    // The command-source word ends before later argv data.  A fixed source may
    // intentionally be followed by "$VALUE", which is not interpreter source.
    const sourceWord = match?.[1].match(/^(['"])(.*?)\1/)?.[2] ?? match?.[1].split(/\s+/)[0];
    if (sourceWord && expanded.test(sourceWord)) {
      findings.push({ sourceName, line: index + 1, message: 'shell expansion in interpreter command source' });
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
