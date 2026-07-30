// plan-task-parse.ts imports WIRED_INTO_LINE from this module, creating a
// circular module dependency. This module reaches back for only the one
// grammar constant it needs (kept in lockstep per the TASK_ID_PATTERN
// comment further below). ESM circular imports resolve in whichever
// direction the entry point first pulls the cycle in, so
// AUTOHEAL_TASK_ID_PATTERN is NOT guaranteed to be initialized yet when this
// module's top level runs (e.g. when something imports plan-task-parse.ts
// before wired-into.ts, which is the real production path via
// conductor.ts). PLAN_TASK_HEADER below is therefore built lazily on first
// use — never referenced at module top-level — so both import orderings
// are safe.
import { TASK_ID_PATTERN as AUTOHEAL_TASK_ID_PATTERN } from './plan-task-parse.js';

// A task's **Wired-into:** line is the authoring-time declaration of which
// call site(s) actually reach the new code (the wiring reachability gate).
// Matches `**Wired-into:**`, with an optional list bullet — same style as
// autoheal.ts's FILES_LINE.
export const WIRED_INTO_LINE = /^\s*(?:[-*]\s+)?\*\*Wired-into(?:\s+[^*]*?)?\s*:?\s*\*\*\s*:?\s*(.*)$/i;

/** A single declared call site: `path#symbol`. */
export interface WiredIntoSite {
  path: string;
  symbol: string;
}

/**
 * Result of parsing a **Wired-into:** line. This is deliberately a
 * discriminated union — not a bare object — so follow-up kinds (e.g.
 * malformed declarations, or inheritance shorthand like plan
 * `same as Task N`) can be added as new `kind` variants without reshaping
 * callers, which should already be switching on `.kind`.
 *
 * - `declared`: an ordered list of path#symbol call sites.
 * - `no_new_surface`: `none (no new production surface)` — the task adds
 *   no new reachable surface, so there is nothing to wire in.
 * - `inert`: `none (inert until <ref>)` — the surface exists but is not
 *   yet reachable; `ref` points at what will activate it (a tracking
 *   issue or a repo-relative path).
 * - `malformed`: the line's content doesn't match any of the accepted
 *   forms; `message` names the offending text and lists the accepted
 *   forms so the author can fix it.
 */
export type WiredIntoParseResult =
  | WiredIntoDeclared
  | WiredIntoNoNewSurface
  | WiredIntoInert
  | WiredIntoMalformed; // | WiredIntoInherited (future kind)

export interface WiredIntoDeclared {
  kind: 'declared';
  sites: WiredIntoSite[];
}

export interface WiredIntoNoNewSurface {
  kind: 'no_new_surface';
}

export interface WiredIntoInert {
  kind: 'inert';
  ref: InertRef;
}

export interface WiredIntoMalformed {
  kind: 'malformed';
  message: string;
}

/**
 * The currently-implemented accepted forms, used verbatim in malformed-line
 * error messages.
 */
const ACCEPTED_FORMS = [
  'declared site(s) (e.g. `path/to/file.ts#symbol`, comma-separated)',
  '`none (no new production surface)`',
  '`none (inert until <ref>)`',
  '`same as Task N` (inheritance shorthand)',
];

function malformed(text: string): WiredIntoMalformed {
  return {
    kind: 'malformed',
    message: `**Wired-into:** value "${text}" does not match any accepted form. Accepted forms are: ${ACCEPTED_FORMS.join('; ')}.`,
  };
}

/** A GitHub issue reference: `owner/repo#number`. */
export interface InertIssueRef {
  form: 'issue';
  owner: string;
  repo: string;
  number: number;
}

/** A repo-relative path reference — anything not shaped like an issue ref. */
export interface InertPathRef {
  form: 'path';
  path: string;
}

export type InertRef = InertIssueRef | InertPathRef;

/** `none (no new production surface)`, case-insensitive. */
const NO_NEW_SURFACE = /^none\s*\(\s*no new production surface\s*\)$/i;

/** `none (inert until <ref>)`, case-insensitive; captures the ref text. */
const INERT_UNTIL = /^none\s*\(\s*inert until\s+(.+?)\s*\)$/i;

/** `owner/repo#number`, e.g. `jstoup111/ai-conductor#999`. */
const ISSUE_REF = /^([^\s/]+)\/([^\s/#]+)#(\d+)$/;

function classifyInertRef(text: string): InertRef {
  const issueMatch = text.match(ISSUE_REF);
  if (issueMatch) {
    return {
      form: 'issue',
      owner: issueMatch[1],
      repo: issueMatch[2],
      number: Number(issueMatch[3]),
    };
  }
  return { form: 'path', path: text };
}

/** One `path#symbol` entry, optionally wrapped in backticks. */
const SITE_ENTRY = /^`?([^`#\s]+)#([^`\s]+?)`?$/;

/**
 * A declared site's path must be repo-relative: no leading `/` (absolute),
 * and no `..` segment escaping the repo root (e.g. `../outside.ts`).
 */
function isRepoRelativePath(path: string): boolean {
  if (path.startsWith('/')) return false;
  const segments = path.split('/');
  return !segments.includes('..');
}

/**
 * Parse a **Wired-into:** markdown line into its declared sites, in the
 * order they appear. Entries are comma-separated `path#symbol` pairs, each
 * optionally wrapped in backticks (`` `src/a.ts#foo` ``).
 */
export function parseWiredIntoLine(line: string): WiredIntoParseResult {
  const match = line.match(WIRED_INTO_LINE);
  const rest = match ? match[1].trim() : line.trim();

  if (NO_NEW_SURFACE.test(rest)) {
    return { kind: 'no_new_surface' };
  }

  const inertMatch = rest.match(INERT_UNTIL);
  if (inertMatch) {
    return { kind: 'inert', ref: classifyInertRef(inertMatch[1].trim()) };
  }

  const sites: WiredIntoSite[] = [];
  for (const raw of rest.split(',')) {
    const token = raw.trim();
    if (!token) continue;
    const entryMatch = token.match(SITE_ENTRY);
    if (!entryMatch || !isRepoRelativePath(entryMatch[1])) {
      return malformed(rest);
    }
    sites.push({ path: entryMatch[1], symbol: entryMatch[2] });
  }

  return { kind: 'declared', sites };
}

/**
 * Render a parsed **Wired-into:** result back to its canonical line text.
 * Round-trips with `parseWiredIntoLine`: `parseWiredIntoLine(serializeWiredInto(x))`
 * reproduces an equivalent parse of `x` for any well-formed result.
 */
export function serializeWiredInto(result: WiredIntoParseResult): string {
  switch (result.kind) {
    case 'declared':
      return `**Wired-into:** ${result.sites.map((s) => `${s.path}#${s.symbol}`).join(', ')}`;
    case 'no_new_surface':
      return '**Wired-into:** none (no new production surface)';
    case 'inert': {
      const refText =
        result.ref.form === 'issue'
          ? `${result.ref.owner}/${result.ref.repo}#${result.ref.number}`
          : result.ref.path;
      return `**Wired-into:** none (inert until ${refText})`;
    }
    case 'malformed':
      return `**Wired-into:** ${result.message}`;
  }
}

// Task id grammar — kept in lockstep with autoheal.ts's TASK_ID_PATTERN
// ([A-Za-z0-9._-]+), the same grammar used elsewhere in this repo (e.g.
// the `same` shorthand in autoheal.ts) for task-id references.
const TASK_ID_PATTERN = '[A-Za-z0-9._-]+';

/** `same as Task N` inheritance shorthand, case-insensitive. */
const SAME_AS_TASK = new RegExp(`^same\\s+as\\s+task\\s+(${TASK_ID_PATTERN})$`, 'i');

/**
 * Parse a **Wired-into:** line, resolving `same as Task N` inheritance
 * shorthand against `taskMap` (keyed by bare task id). Lines that don't use
 * the inheritance shorthand fall through to `parseWiredIntoLine`.
 */
export function resolveWiredInto(
  line: string,
  taskMap: Map<string, WiredIntoParseResult>,
): WiredIntoParseResult {
  const match = line.match(WIRED_INTO_LINE);
  const rest = match ? match[1].trim() : line.trim();

  const sameAsMatch = rest.match(SAME_AS_TASK);
  if (sameAsMatch) {
    const targetId = sameAsMatch[1];
    const target = taskMap.get(targetId);
    if (!target) {
      return {
        kind: 'malformed',
        message: `**Wired-into:** inheritance target Task ${targetId} not found`,
      };
    }
    return target;
  }

  return parseWiredIntoLine(line);
}

/**
 * Combine two parsed **Wired-into:** results for the same task into one,
 * accumulating `declared` sites in order. If either side is `malformed`,
 * that result propagates (first malformed side wins). Non-`declared` kinds
 * on the non-malformed side are otherwise passed through unchanged when the
 * other side contributes no sites.
 */
export function combineWiredInto(
  a: WiredIntoParseResult,
  b: WiredIntoParseResult,
): WiredIntoParseResult {
  if (a.kind === 'malformed') return a;
  if (b.kind === 'malformed') return b;

  const aSites = a.kind === 'declared' ? a.sites : [];
  const bSites = b.kind === 'declared' ? b.sites : [];

  if (a.kind !== 'declared' && b.kind !== 'declared') {
    return b;
  }

  return { kind: 'declared', sites: [...aSites, ...bSites] };
}

// Mirrors parsePlanTasks' task header grammar in autoheal.ts (`### Task ID:
// Title`, `### Task ID — Title`, or the bare `### T<N> — Title` shorthand) —
// the convention `extractWiredIntoContracts` uses to split a plan into
// per-task sections.
let _planTaskHeader: RegExp | undefined;
function getPlanTaskHeader(): RegExp {
  if (!_planTaskHeader) {
    _planTaskHeader = new RegExp(
      `^#{1,6}\\s+(?:Task\\s+(${AUTOHEAL_TASK_ID_PATTERN})|T(\\d[A-Za-z0-9._-]*))(?::\\s+|\\s+[—–]\\s+)(.+)$`,
    );
  }
  return _planTaskHeader;
}

/**
 * Walk a full plan's text and return each task's parsed **Wired-into:**
 * contract, keyed by bare task id. Multiple **Wired-into:** lines within one
 * task section are accumulated in order via `combineWiredInto`; `same as
 * Task N` inheritance shorthand is resolved via `resolveWiredInto` against
 * the contracts of tasks already seen (document order — a task can only
 * inherit from an earlier task).
 *
 * Tasks with no **Wired-into:** line at all are omitted from the returned
 * map (no contract declared, distinct from a `malformed`/`no_new_surface`
 * declaration).
 */
export function extractWiredIntoContracts(
  planText: string,
): Map<string, WiredIntoParseResult> {
  const order: string[] = [];
  const linesByTask = new Map<string, string[]>();
  let currentId: string | null = null;

  for (const line of planText.split('\n')) {
    const headerMatch = line.match(getPlanTaskHeader());
    if (headerMatch) {
      currentId = headerMatch[1] ?? headerMatch[2];
      if (!linesByTask.has(currentId)) {
        linesByTask.set(currentId, []);
        order.push(currentId);
      }
      continue;
    }
    if (!currentId) continue;
    if (WIRED_INTO_LINE.test(line)) {
      linesByTask.get(currentId)!.push(line);
    }
  }

  const contracts = new Map<string, WiredIntoParseResult>();
  for (const id of order) {
    const wiredLines = linesByTask.get(id) ?? [];
    if (wiredLines.length === 0) continue;
    let combined: WiredIntoParseResult | null = null;
    for (const line of wiredLines) {
      const parsed = resolveWiredInto(line, contracts);
      combined = combined ? combineWiredInto(combined, parsed) : parsed;
    }
    if (combined) contracts.set(id, combined);
  }

  return contracts;
}
