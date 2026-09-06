export interface InterpreterSourceFinding {
  sourceName: string;
  line: number;
  message: string;
}

type Word = { text: string; line: number; expandable: string[]; closed: boolean };
const expansion = /(?<!\\)(?:\$\{|\$\(|\$[A-Za-z_][A-Za-z0-9_]*|`)/g;
const interpreter = /^(?:\/[^\s/]+)*\/(?:python3?|node)$|^(?:python3?|node)$/;
const findingsIn = (value: string): string[] => [...value.matchAll(expansion)].map((match) => match[0]);

/** Reads one shell word without evaluating it. Single quoted parts are data. */
function wordAt(text: string, start: number, line: number): Word {
  let index = start;
  let quote: "'" | '"' | undefined;
  let value = '';
  let expandable = '';
  while (index < text.length) {
    const char = text[index];
    if (!quote && (/\s/.test(char) || ';|&<>'.includes(char))) break;
    if (!quote && (char === "'" || char === '"')) { quote = char; index += 1; continue; }
    if (quote && char === quote) { quote = undefined; index += 1; continue; }
    if (char === '\\' && index + 1 < text.length) { value += text[index + 1]; index += 2; continue; }
    value += char;
    if (quote !== "'") expandable += char;
    index += 1;
  }
  return { text: value, line, expandable: findingsIn(expandable), closed: !quote };
}

function commandWords(line: string, lineNumber: number): Word[] {
  const words: Word[] = [];
  let cursor = 0;
  while (cursor < line.length) {
    while (/\s/.test(line[cursor] ?? '')) cursor += 1;
    if (cursor >= line.length || '#;|&'.includes(line[cursor]) || line.startsWith('<<', cursor)) break;
    const word = wordAt(line, cursor, lineNumber);
    words.push(word);
    let next = cursor;
    let quote: string | undefined;
    while (next < line.length) {
      const char = line[next];
      if (!quote && (/\s/.test(char) || ';|&<>'.includes(char))) break;
      if (!quote && (char === "'" || char === '"')) quote = char;
      else if (quote === char) quote = undefined;
      else if (char === '\\') next += 1;
      next += 1;
    }
    cursor = next === cursor ? cursor + 1 : next;
  }
  return words;
}

function heredocDelimiter(line: string): { delimiter: string; expanding: boolean; stripTabs: boolean } | undefined {
  const match = /<<(-?)\s*([^\s;|&]+)/.exec(line);
  if (!match) return undefined;
  return { delimiter: match[2].replace(/["']/g, ''), expanding: !/["']/.test(match[2]), stripTabs: match[1] === '-' };
}

/** A bounded lexical checker. Candidate shell/interpreter text is never run. */
export function checkInterpreterSource(sourceName: string, text: string): InterpreterSourceFinding[] {
  const findings: InterpreterSourceFinding[] = [];
  const lines = text.split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const words = commandWords(lines[index], index + 1);
    const executable = words.findIndex((word) => interpreter.test(word.text));
    const here = heredocDelimiter(lines[index]);
    if (executable < 0) continue;
    const command = words[executable].text;
    const args = words.slice(executable + 1);
    const option = args.findIndex((word) => word.text === '-c' || word.text === '-e' || word.text === '--eval' || word.text.startsWith('--eval='));
    if (option >= 0) {
      const flag = args[option];
      const source = flag.text.startsWith('--eval=') ? { ...flag, text: flag.text.slice(7) } : args[option + 1];
      if (source && !source.closed && source.expandable.length === 0) {
        // Multiline single-quoted fixed source (the normal generated-hook
        // shape) remains literal. Skip its body so it cannot become phantom
        // shell commands.
        let closing = index + 1;
        while (closing < lines.length && !/["']/.test(lines[closing])) closing += 1;
        if (closing < lines.length) index = closing;
        else findings.push({ sourceName, line: index + 1, message: `unterminated or missing ${command} command source` });
      } else if (!source || !source.text || !source.closed) {
        if (/\\\s*$/.test(lines[index]) && findingsIn(lines[index + 1] ?? '').length > 0) {
          findings.push({ sourceName, line: index + 1, message: 'shell expansion in interpreter command source' });
          index += 1;
        } else {
          findings.push({ sourceName, line: index + 1, message: `unterminated or missing ${command} command source` });
        }
      }
      else {
        // A backslash-newline continues one shell word. Inspect its physical
        // continuation as source too; do not execute or decode it.
        let expanded = source.expandable.length > 0;
        let continuation = index;
        while (/\\\s*$/.test(lines[continuation]) && continuation + 1 < lines.length) {
          continuation += 1;
          expanded ||= findingsIn(lines[continuation]).length > 0;
        }
        if (expanded) findings.push({ sourceName, line: source.line, message: 'shell expansion in interpreter command source' });
        index = Math.max(index, continuation);
      }
    }
    if (here && /python3?$/.test(command)) {
      let body = index + 1;
      while (body < lines.length && (here.stripTabs ? lines[body].replace(/^\t+/, '') : lines[body]) !== here.delimiter) {
        if (here.expanding && findingsIn(lines[body]).length > 0) findings.push({ sourceName, line: body + 1, message: 'shell expansion in interpreter heredoc source' });
        body += 1;
      }
      if (body === lines.length) findings.push({ sourceName, line: index + 1, message: 'unterminated interpreter heredoc' });
      else index = body;
    }
  }
  return findings;
}
