export interface InterpreterSourceFinding {
  sourceName: string;
  line: number;
  message: string;
}

type Word = { text: string; line: number; expandable: string[]; closed: boolean; openQuote?: "'" | '"' };
type Heredoc = { delimiter: string; expanding: boolean; stripTabs: boolean; interpreter: boolean; line: number };
const expansion = /(?<!\\)(?:\$\{|\$\(|\$[A-Za-z_][A-Za-z0-9_]*|\$[0-9]|\$[@*#?$!\-$]|`)/g;
const interpreter = /^(?:\/[^\s/]+)*\/(?:python3?|node)$|^(?:python3?|node)$/;
const findingsIn = (value: string): string[] => [...value.matchAll(expansion)].map((match) => match[0]);

/** Reads one shell word without evaluating it. Single quoted parts are data. */
function wordAt(text: string, start: number, line: number): [Word, number] {
  let index = start;
  let quote: "'" | '"' | undefined;
  let substitutionDepth = 0;
  let value = '';
  let expandable = '';
  while (index < text.length) {
    const char = text[index];
    if (!quote && substitutionDepth === 0 && (/\s/.test(char) || ';|&<>'.includes(char))) break;
    if (!quote && (char === "'" || char === '"')) { quote = char; index += 1; continue; }
    if (quote && char === quote) { quote = undefined; index += 1; continue; }
    if (char === '\\' && index + 1 < text.length) { value += text[index + 1]; index += 2; continue; }
    if (quote !== "'" && char === '$' && text[index + 1] === '(') substitutionDepth += 1;
    else if (quote !== "'" && char === ')' && substitutionDepth > 0) substitutionDepth -= 1;
    value += char;
    if (quote !== "'") expandable += char;
    index += 1;
  }
  return [{ text: value, line, expandable: findingsIn(expandable), closed: !quote, openQuote: quote }, index];
}

function commandsOnLine(line: string, lineNumber: number): Word[][] {
  const commands: Word[][] = [[]];
  let cursor = 0;
  while (cursor < line.length) {
    while (/\s/.test(line[cursor] ?? '')) cursor += 1;
    if (cursor >= line.length || line[cursor] === '#') break;
    if (';|&'.includes(line[cursor])) {
      while (';|&'.includes(line[cursor] ?? '')) cursor += 1;
      commands.push([]);
      continue;
    }
    if (line.startsWith('<<', cursor) || '<>'.includes(line[cursor])) { cursor += 1; continue; }
    const [word, next] = wordAt(line, cursor, lineNumber);
    if (next === cursor) { cursor += 1; continue; }
    commands.at(-1)?.push(word);
    cursor = next;
  }
  return commands.filter((words) => words.length > 0);
}

function heredocsOnLine(line: string, words: Word[], lineNumber: number): Heredoc[] {
  const executable = words.find((word) => interpreter.test(word.text));
  return [...line.matchAll(/<<(-?)\s*([^\s;|&]+)/g)].map((match) => ({
    delimiter: match[2].replace(/["']/g, ''), expanding: !/["']/.test(match[2]), stripTabs: match[1] === '-',
    interpreter: Boolean(executable && /python3?$/.test(executable.text)), line: lineNumber,
  }));
}

/** A bounded lexical checker. Candidate shell/interpreter text is never run. */
export function checkInterpreterSource(sourceName: string, text: string): InterpreterSourceFinding[] {
  const findings: InterpreterSourceFinding[] = [];
  const lines = text.split(/\r?\n/);
  const pending: Heredoc[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (pending.length > 0) {
      const here = pending[0];
      const body = here.stripTabs ? lines[index].replace(/^\t+/, '') : lines[index];
      if (body === here.delimiter) { pending.shift(); continue; }
      if (here.interpreter && here.expanding && findingsIn(lines[index]).length > 0) findings.push({ sourceName, line: index + 1, message: 'shell expansion in interpreter heredoc source' });
      continue;
    }
    const commands = commandsOnLine(lines[index], index + 1);
    for (const words of commands) {
      const executable = words.findIndex((word) => interpreter.test(word.text));
      if (executable < 0) continue;
      const command = words[executable].text;
      const args = words.slice(executable + 1);
      const option = args.findIndex((word) => word.text === '-c' || word.text === '-e' || word.text === '--eval' || word.text.startsWith('--eval='));
      if (option < 0) continue;
      const flag = args[option];
      const source = flag.text.startsWith('--eval=') ? { ...flag, text: flag.text.slice(7) } : args[option + 1];
      if (!source || !source.text || !source.closed) {
        // A backslash-newline continues the same shell word. It is still
        // source, so inspect every physical continuation before deciding that
        // the quote is malformed.
        if (/\\\s*$/.test(lines[index])) {
          let continuation = index + 1;
          let expanded = source?.expandable.length ? true : false;
          while (continuation < lines.length) {
            expanded ||= findingsIn(lines[continuation]).length > 0;
            if (!/\\\s*$/.test(lines[continuation])) break;
            continuation += 1;
          }
          if (expanded) findings.push({ sourceName, line: index + 1, message: 'shell expansion in interpreter command source' });
          else findings.push({ sourceName, line: index + 1, message: `unterminated or missing ${command} command source` });
          index = continuation;
        } else findings.push({ sourceName, line: index + 1, message: `unterminated or missing ${command} command source` });
      }
      else if (source.expandable.length > 0) findings.push({ sourceName, line: source.line, message: 'shell expansion in interpreter command source' });
    }
    pending.push(...heredocsOnLine(lines[index], commands.flat(), index + 1));
  }
  for (const here of pending) {
    if (here.interpreter) findings.push({ sourceName, line: here.line, message: 'unterminated interpreter heredoc' });
  }
  return findings;
}
