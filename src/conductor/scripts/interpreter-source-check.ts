export interface InterpreterSourceFinding {
  sourceName: string;
  line: number;
  message: string;
}

type Word = { text: string; line: number; expandable: string[]; closed: boolean; openQuote?: "'" | '"'; regions: string[]; openRegions: string[] };
type Heredoc = { delimiter: string; expanding: boolean; stripTabs: boolean; interpreter: boolean; line: number };
const expansion = /(?:\$\{|\$\(|\$[A-Za-z_][A-Za-z0-9_]*|\$[0-9]|\$[@*#?$!\-$]|`)/g;
const interpreter = /^(?:\/[^\s/]+)*\/(?:python3?|node)$|^(?:python3?|node)$/;
/** A dollar is escaped only after an odd-length run of backslashes. */
const findingsIn = (value: string): string[] => [...value.matchAll(expansion)]
  .filter((match) => {
    let backslashes = 0;
    for (let index = match.index - 1; index >= 0 && value[index] === '\\'; index -= 1) backslashes += 1;
    return backslashes % 2 === 0;
  })
  .map((match) => match[0]);

/**
 * Reads one shell word without evaluating it. Single quoted parts are data.
 * The inner text of every outermost command substitution the word spans is
 * captured verbatim so the caller can tokenize it as its own command context.
 */
function wordAt(text: string, start: number, line: number): [Word, number] {
  let index = start;
  let quote: "'" | '"' | undefined;
  let substitutionDepth = 0;
  let value = '';
  let expandable = '';
  const regions: string[] = [];
  const openRegions: string[] = [];
  const enclosing: ("'" | '"' | undefined)[] = [];
  let regionStart = -1;
  while (index < text.length) {
    const char = text[index];
    if (!quote && substitutionDepth === 0 && (/\s/.test(char) || ';|&<>'.includes(char))) break;
    if (!quote && (char === "'" || char === '"')) { quote = char; index += 1; continue; }
    if (quote && char === quote) { quote = undefined; index += 1; continue; }
    if (char === '\\' && index + 1 < text.length) { value += text[index + 1]; index += 2; continue; }
    if (quote !== "'" && char === '$' && text[index + 1] === '(') {
      // Quoting restarts inside a substitution, so stack the enclosing quote.
      enclosing.push(quote);
      quote = undefined;
      if (substitutionDepth === 0) regionStart = index + 2;
      substitutionDepth += 1;
    } else if (!quote && char === ')' && substitutionDepth > 0) {
      substitutionDepth -= 1;
      quote = enclosing.pop();
      if (substitutionDepth === 0 && regionStart >= 0) { regions.push(text.slice(regionStart, index)); regionStart = -1; }
    }
    value += char;
    if (quote !== "'") expandable += char;
    index += 1;
  }
  if (regionStart >= 0) {
    const openRegion = text.slice(regionStart);
    regions.push(openRegion);
    openRegions.push(openRegion);
  }
  return [{ text: value, line, expandable: findingsIn(expandable), closed: !quote, openQuote: quote, regions, openRegions }, index];
}

function commandsOnLine(line: string, lineNumber: number, includeNested = true): Word[][] {
  const commands: Word[][] = [[]];
  const nested: Word[][] = [];
  let cursor = 0;
  while (cursor < line.length) {
    while (/\s/.test(line[cursor] ?? '')) cursor += 1;
    if (cursor >= line.length || line[cursor] === '#') break;
    if (';|&'.includes(line[cursor])) {
      while (cursor < line.length && ';|&'.includes(line[cursor])) cursor += 1;
      commands.push([]);
      continue;
    }
    if (line.startsWith('<<', cursor) || '<>'.includes(line[cursor])) { cursor += 1; continue; }
    const [word, next] = wordAt(line, cursor, lineNumber);
    if (next === cursor) { cursor += 1; continue; }
    commands.at(-1)?.push(word);
    if (includeNested) nested.push(...word.regions.flatMap((region) => commandsOnLine(region, lineNumber)));
    cursor = next;
  }
  return [...commands, ...nested].filter((words) => words.length > 0);
}

/**
 * A here-doc belongs to the command in its lexical shell context. Completed
 * substitutions before `<<` are commands of a child context, not the owner;
 * an unterminated substitution does contain the redirection, so descend only
 * through that open region.
 */
function heredocOwner(prefix: string, lineNumber: number): Word[] | undefined {
  const owner = commandsOnLine(prefix, lineNumber, false).at(-1);
  const openRegion = owner?.flatMap((word) => word.openRegions).at(-1);
  return openRegion ? heredocOwner(openRegion, lineNumber) ?? owner : owner;
}

/**
 * Performs the shell quote removal that applies to a heredoc delimiter word.
 * The same pass records whether any quoting suppressed expansion of its body.
 */
function heredocDelimiter(word: string): Pick<Heredoc, 'delimiter' | 'expanding'> {
  let delimiter = '';
  let quote: "'" | '"' | undefined;
  let quoted = false;
  for (let index = 0; index < word.length; index += 1) {
    const char = word[index];
    if (quote === "'") {
      if (char === "'") quote = undefined;
      else delimiter += char;
      continue;
    }
    if (quote === '"') {
      if (char === '"') { quote = undefined; continue; }
      if (char === '\\' && index + 1 < word.length && '$`"\\'.includes(word[index + 1])) {
        delimiter += word[index + 1];
        index += 1;
      } else delimiter += char;
      continue;
    }
    if (char === "'" || char === '"') { quoted = true; quote = char; continue; }
    if (char === '\\') {
      quoted = true;
      if (index + 1 < word.length) { delimiter += word[index + 1]; index += 1; }
      continue;
    }
    delimiter += char;
  }
  return { delimiter, expanding: !quoted };
}

function directInterpreterIndex(words: Word[]): number {
  let index = 0;
  while (/^[A-Za-z_][A-Za-z0-9_]*=/.test(words[index]?.text ?? '')) index += 1;
  while (['env', 'command', 'exec'].includes(words[index]?.text ?? '')) {
    index += 1;
    while (/^(?:[A-Za-z_][A-Za-z0-9_]*=|-[A-Za-z])/.test(words[index]?.text ?? '')) index += 1;
  }
  return interpreter.test(words[index]?.text ?? '') ? index : -1;
}

function heredocsOnLine(line: string, lineNumber: number): Heredoc[] {
  return [...line.matchAll(/<<(-?)\s*([^\s;|&]+)/g)].map((match) => ({
    // A physical line can queue redirections for several commands. Resolve
    // each one against the command text before that redirection, rather than
    // borrowing the first interpreter found anywhere on the line.
    // Completed command substitutions do not own an outer redirection. Only
    // descend when the redirection appears in an as-yet-open substitution.
    ...(() => {
      const owner = heredocOwner(line.slice(0, match.index), lineNumber);
      const executable = owner && directInterpreterIndex(owner);
      return { interpreter: executable !== undefined && executable >= 0 && /python3?$/.test(owner[executable].text) };
    })(),
    ...heredocDelimiter(match[2]), stripTabs: match[1] === '-',
    line: lineNumber,
  }));
}

function quoteCloseIndex(line: string, quote: "'" | '"'): number {
  for (let index = 0; index < line.length; index += 1) {
    if (line[index] === '\\') { index += 1; continue; }
    if (line[index] === quote) return index;
  }
  return -1;
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
      const executable = directInterpreterIndex(words);
      if (executable < 0) continue;
      const command = words[executable].text;
      const args = words.slice(executable + 1);
      const option = args.findIndex((word) => word.text === '-c' || word.text === '-e' || word.text === '--eval' || word.text.startsWith('--eval='));
      if (option < 0) continue;
      const flag = args[option];
      const source = flag.text.startsWith('--eval=') ? { ...flag, text: flag.text.slice(7) } : args[option + 1];
      if (!source || !source.text || !source.closed) {
        if (source?.openQuote) {
          let continuation = index + 1;
          let expanded = source.expandable.length > 0;
          while (continuation < lines.length) {
            const closing = quoteCloseIndex(lines[continuation], source.openQuote);
            // Once the source quote closes, the remainder of that physical
            // line is ordinary shell data (often an argv value), not source.
            const sourceLine = closing >= 0 ? lines[continuation].slice(0, closing) : lines[continuation];
            if (source.openQuote !== "'" && findingsIn(sourceLine).length > 0) expanded = true;
            if (closing >= 0) break;
            continuation += 1;
          }
          if (continuation < lines.length) {
            if (expanded) findings.push({ sourceName, line: source.line, message: 'shell expansion in interpreter command source' });
            // Continue at the byte after the closing quote. Advancing the
            // outer line index alone used to skip a second command (or a
            // heredoc redirection) on that same physical line.
            const suffix = lines[continuation].slice(quoteCloseIndex(lines[continuation], source.openQuote) + 1);
            for (const finding of checkInterpreterSource(sourceName, suffix)) {
              findings.push({ ...finding, line: finding.line + continuation });
            }
            index = continuation;
            continue;
          }
        }
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
    pending.push(...heredocsOnLine(lines[index], index + 1));
  }
  for (const here of pending) {
    if (here.interpreter) findings.push({ sourceName, line: here.line, message: 'unterminated interpreter heredoc' });
  }
  return findings;
}
