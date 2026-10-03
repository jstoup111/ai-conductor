/**
 * Context is a property of a bounded instruction region, never of an
 * individual command occurrence.  The audit intentionally has no command
 * allow-list: the daemon-session guard remains the single policy authority.
 */
export type SessionCommandContext = 'managed' | 'operator-only' | 'prohibition';
export type SessionCommandSourceFamily = 'engine' | 'skill' | 'unknown';

export interface SessionCommandContextProblem {
  readonly line: number;
  readonly reason: string;
}

export interface SessionCommandContextRange {
  readonly context: SessionCommandContext;
  /** Inclusive, one-indexed source line. */
  readonly startLine: number;
  /** Inclusive, one-indexed source line. */
  readonly endLine: number;
}

export interface ParsedSessionCommandContexts {
  readonly ranges: readonly SessionCommandContextRange[];
  readonly problems: readonly SessionCommandContextProblem[];
}

const START = /^\s*(?:\/\/|<!--)\s*ai-conductor:session-command-context=(\S+)\s*(?:-->)?\s*$/;
const END = /^\s*(?:\/\/|<!--)\s*\/ai-conductor:session-command-context\s*(?:-->)?\s*$/;
const CONTEXTS: ReadonlySet<string> = new Set(['managed', 'operator-only', 'prohibition']);

/** Explicit source-family declarations; a new file needs no occurrence entry. */
export function defaultSessionCommandContext(family: SessionCommandSourceFamily): SessionCommandContext | undefined {
  return family === 'engine' || family === 'skill' ? 'managed' : undefined;
}

/** Parse nested-proof, closed comment regions.  A region cannot leak to EOF. */
export function parseSessionCommandContexts(source: string, family: SessionCommandSourceFamily): ParsedSessionCommandContexts {
  const ranges: SessionCommandContextRange[] = [];
  const problems: SessionCommandContextProblem[] = [];
  const lines = source.split('\n');
  let open: { context: SessionCommandContext; line: number } | undefined;

  for (let index = 0; index < lines.length; index += 1) {
    const line = index + 1;
    const start = START.exec(lines[index]!);
    if (start) {
      if (open) {
        problems.push({ line, reason: 'ambiguous session-command context: region already open' });
        continue;
      }
      if (!CONTEXTS.has(start[1]!)) {
        problems.push({ line, reason: `malformed session-command context '${start[1]}'` });
        continue;
      }
      open = { context: start[1] as SessionCommandContext, line };
      continue;
    }
    if (END.test(lines[index]!)) {
      if (!open) problems.push({ line, reason: 'stale session-command context endpoint without an open region' });
      else {
        ranges.push({ context: open.context, startLine: open.line + 1, endLine: line - 1 });
        open = undefined;
      }
    }
  }
  if (open) problems.push({ line: open.line, reason: 'stale session-command context region has no endpoint' });

  const baseline = defaultSessionCommandContext(family);
  if (baseline) ranges.push({ context: baseline, startLine: 1, endLine: lines.length });
  return { ranges, problems };
}

/** Return exactly one context for an instruction line, otherwise fail closed. */
export function sessionCommandContextAt(
  parsed: ParsedSessionCommandContexts,
  line: number,
): { readonly context?: SessionCommandContext; readonly reason?: string } {
  const matches = parsed.ranges.filter((range) => range.startLine <= line && line <= range.endLine);
  // A declared region overrides the source-family default.  More than one
  // declared region at a command is ambiguous; the family default is not.
  const declared = matches.filter((range) => !(range.context === 'managed' && range.startLine === 1));
  if (declared.length > 1) return { reason: 'ambiguous session-command context classification' };
  if (declared.length === 1) return { context: declared[0]!.context };
  if (matches.length === 1) return { context: matches[0]!.context };
  return { reason: 'missing session-command context classification' };
}
