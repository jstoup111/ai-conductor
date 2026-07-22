// Shared plan-parsing utilities (relocated out of autoheal.ts).
//
// `parsePlanTaskPaths` and `TASK_ID_PATTERN` are consumed by wiring-probe.ts
// and wired-into.ts (the wiring-reachability gate) as well as by
// autoheal.ts's own evidence-derivation logic. A later phase deletes
// autoheal's evidence-derivation logic, so this standalone module is the
// stable home for the shared grammar/parser — autoheal.ts re-exports from
// here for backward compatibility with its existing call sites.
//
// autoheal.ts imports WIRED_INTO_LINE from wired-into.ts, and wired-into.ts
// imports TASK_ID_PATTERN from this module, creating a circular module
// dependency (the same shape that previously existed directly between
// autoheal.ts and wired-into.ts — see the comment at the top of
// wired-into.ts). WIRED_INTO_LINE is only referenced inside
// parsePlanTaskPaths' function body (never at module top level), so both
// import orderings remain safe under ESM's circular-import resolution.
import { WIRED_INTO_LINE } from './wired-into.js';

// Task ID pattern: alphanumeric + dots, underscores, hyphens
// Supports: 1, 1.2, task_1, task-name, rem-adr-001, etc.
// (H9 id grammar — exported so callers outside this module, e.g. the
// post-commit fast-feedback CLI dispatch, validate/derive against the SAME
// grammar instead of re-deriving a narrower ad hoc regex.)
export const TASK_ID_PATTERN = '[A-Za-z0-9._-]+';

const PATH_EXTENSIONS = /\.(?:ts|tsx|js|jsx|mjs|cjs|md|json|yml|yaml|sh|rb|py|go|rs|html|css|scss|vue|toml)$/i;
const BACKTICK_TOKEN = /`([^`\s]+)`/g;

// A task's **Files:** line is the authoritative declaration of which paths
// corroborate its commits (#424). Plans write these as plain text (no
// backticks) with `;`/`,` separators, and use `same` / `same as Task N`
// shorthand to inherit an earlier task's set. Matches `**Files:**`,
// `**Files**:`, and `**Files likely touched:**`, with an optional list bullet.
const FILES_LINE = /^\s*(?:[-*]\s+)?\*\*Files(?:\s+[^*]*?)?\s*:?\s*\*\*\s*:?\s*(.*)$/i;

/** Path-looking tokens from a **Files:** line (plain text or backticked). */
function extractFilesLinePaths(rest: string): string[] {
  const paths: string[] = [];
  for (const raw of rest.replace(/`/g, ' ').split(/[;,\s]+/)) {
    const token = raw.trim();
    if (!token) continue;
    if (!PATH_EXTENSIONS.test(token) && !token.includes('/')) continue;
    const normalized = token.replace(/^\.\//, '');
    if (!normalized || normalized.startsWith('-')) continue;
    if (!paths.includes(normalized)) paths.push(normalized);
  }
  return paths;
}

function expandTaskIds(raw: string): string[] {
  const ids: string[] = [];
  for (const piece of raw.split(',')) {
    const trimmed = piece.trim();
    if (!trimmed) continue;

    // Try numeric range expansion only for numeric ids (e.g., 1-3)
    const rangeMatch = trimmed.match(/^(\d+)\s*-\s*(\d+)$/);
    if (rangeMatch) {
      const start = parseInt(rangeMatch[1], 10);
      const end = parseInt(rangeMatch[2], 10);
      for (let n = start; n <= end; n++) ids.push(String(n));
    } else if (new RegExp(`^${TASK_ID_PATTERN}$`).test(trimmed)) {
      // Accept any id matching the TASK_ID_PATTERN (numeric, dotted, hyphenated, underscore)
      ids.push(trimmed);
    }
  }
  return ids;
}

export function parsePlanTaskPaths(text: string): Map<string, Set<string>> {
  interface TaskSection {
    ids: string[];
    filesPaths: Set<string>; // declared on **Files:** lines
    sameRef: string | null; // 'prev' or an explicit task id to inherit from
    hasFilesLine: boolean;
    prosePaths: Set<string>; // legacy whole-section backtick scan
  }
  const sections: TaskSection[] = [];
  let current: TaskSection | null = null;
  // True while consuming list-item lines that continue a **Files:** header
  // whose paths are written as bullets beneath it (the plan skill's template
  // form: `**Files likely touched:**` followed by `- path — what changes`).
  let inFilesBlock = false;

  // Match task headers and extract task ids (supports comma-separated ids, ranges like 1-3 for numeric)
  // Pattern allows: Task 1-3, rem-adr-001, 1.2: or Task 1-3, rem-adr-001, 1.2
  // Also accepts the bare `T<N>` shorthand (no "Task" word — e.g. `### T0 —
  // Title`, ids starting at T0). Without this alternative, that heading form
  // parses to zero ids → the build gate reports "no tasks in plan" → false
  // `empty/missing plan` auto-park of a completed build (#578, live-fire
  // 2026-07-12 on `2026-07-12-rtk-hook-preservation`, headers T0..T5).
  // Terminator accepts a colon, or a whitespace-preceded em-dash/en-dash title
  // separator (`### Task N — Title`, the authoring convention). Without the
  // dash alternative, em-dash headings parse to zero ids → the build gate
  // reports "no tasks in plan" → false `empty/missing plan` auto-park of a
  // completed build (#578).
  //
  // The bare end-of-line terminator requires an id CONTAINING A DIGIT
  // (#620 fix): under #615's widened grammar, a pure-alpha id at
  // end-of-line let structural headings like `## Task Graph` /
  // `## Task Dependency Graph` (present in many committed plans) parse as
  // a phantom task ("Graph"/"Dependency") that can never be completed —
  // making build completion permanently unsatisfiable (live incident
  // #620: a 4/4-complete build halted demanding a fifth task named
  // "Graph"). A real task header either carries an explicit colon/dash
  // separator (any id grammar, including `rem-adr-001` / `A8`) or is a
  // bare title-less id with a digit in it (`### Task 2`, `### Task t1`,
  // `### T0`) — never a bare `Task <digitless-word>`.
  //
  // The two `T<N>` alternatives capture WITH the leading `T` (`### T0` → `T0`,
  // not `0`) so the emitted id matches the plan header verbatim and the
  // pre-existing T-prefixed rows / `Task: T<N>` trailers / evidence stamps
  // (#636 — #615 stripped the `T`, orphaning all of that as the #417
  // id-grammar-drift class). Cross-grammar matching (`Task: 0` ↔ `T0`) is
  // handled at the comparison seams via canonicalTaskId, not by mangling here.
  const taskHeader =
    /^#{1,6}\s+(?:Task\s+([A-Za-z0-9._,\s-]+?)(?::|\s[—–])|Task\s+([A-Za-z._,-]*\d[A-Za-z0-9._,-]*)\s*$|(T\d[A-Za-z0-9._,\s-]*?)(?::|\s[—–])|(T\d[A-Za-z0-9._,-]*)\s*$)/;
  const sameShorthand = new RegExp(`^same(?:\\s+as\\s+task\\s+(${TASK_ID_PATTERN}))?\\b`, 'i');

  for (const line of text.split('\n')) {
    const headerMatch = line.match(taskHeader);
    if (headerMatch) {
      current = {
        ids: expandTaskIds(
          headerMatch[1] ?? headerMatch[2] ?? headerMatch[3] ?? headerMatch[4],
        ),
        filesPaths: new Set(),
        sameRef: null,
        hasFilesLine: false,
        prosePaths: new Set(),
      };
      sections.push(current);
      inFilesBlock = false;
      continue;
    }
    if (!current) continue;

    const filesMatch = line.match(FILES_LINE);
    if (filesMatch) {
      current.hasFilesLine = true;
      inFilesBlock = true;
      const rest = filesMatch[1].trim();
      const same = rest.match(sameShorthand);
      if (same) {
        current.sameRef = same[1] ?? 'prev';
      } else if (!/^(?:none|n\/a)\b/i.test(rest)) {
        for (const p of extractFilesLinePaths(rest)) current.filesPaths.add(p);
      }
      continue;
    }

    if (inFilesBlock) {
      const bullet = line.match(/^\s*[-*]\s+(.*)$/);
      if (bullet) {
        for (const p of extractFilesLinePaths(bullet[1])) current.filesPaths.add(p);
        continue;
      }
      inFilesBlock = false;
    }

    // A **Wired-into:** line is a distinct authoring-time declaration (the
    // wiring reachability gate) — NOT a **Files:** corroboration source.
    // It must be consumed and skipped here, BEFORE the legacy backtick
    // prose-fallback below, or its `path#symbol` site(s) would otherwise be
    // harvested as phantom **Files:** corroboration paths.
    if (WIRED_INTO_LINE.test(line)) {
      continue;
    }

    // Legacy fallback source: backtick path tokens in a section that has no
    // **Files:** line. Restricted to dedicated file-list bullet items
    // (`- \`path\``) — NOT backtick tokens embedded in a prose sentence.
    //
    // A `- \`path\`` bullet is a genuine "this task edits this file"
    // declaration (the #425 / remediation-append form). A backtick token in a
    // prose sentence is almost always an incidental reference — a runtime
    // artifact the task reads/guards, a `file:NNN-MMM` line citation, or a
    // module-import string — that must NOT become a required corroboration
    // path (#424 intent). Harvesting inline-prose tokens produced phantom
    // declared paths and rejected real single-file commits, zeroing build
    // progress and cascading into stall halts (#548 live incidents: #280 plan
    // T11's inline `task-status.json` while the commit touched task-evidence.ts;
    // `2026-07-12-rtk-hook-preservation` T1/T3/T5 inline citations like
    // `bin/install:494–506`). With no declared path, corroboration abstains and
    // the engine-stamped Task: trailer stands on its own (abstain-or-loud,
    // #519/#530), instead of contradicting valid evidence.
    const bulletBody = line.match(/^\s*[-*]\s+(.*)$/);
    if (!bulletBody) continue;
    let m: RegExpExecArray | null;
    BACKTICK_TOKEN.lastIndex = 0;
    while ((m = BACKTICK_TOKEN.exec(bulletBody[1])) !== null) {
      const token = m[1];
      if (!PATH_EXTENSIONS.test(token) && !token.includes('/')) continue;
      const normalized = token.replace(/^\.\//, '');
      if (!normalized || normalized.startsWith('-')) continue;
      current.prosePaths.add(normalized);
    }
  }

  // Resolve in document order so `same` chains (1 ← 2 ← 3) terminate at the
  // last explicit set. An unresolvable `same` (no predecessor / unknown id)
  // resolves empty — trailer-alone corroboration, same as `none`.
  const result = new Map<string, Set<string>>();
  const resolvedBySection: Set<string>[] = [];
  for (let i = 0; i < sections.length; i++) {
    const s = sections[i];
    let resolved: Set<string>;
    if (s.hasFilesLine) {
      resolved = new Set(s.filesPaths);
      if (s.sameRef) {
        let inherited: Set<string> | undefined;
        if (s.sameRef === 'prev') {
          inherited = resolvedBySection[i - 1];
        } else {
          for (let j = i - 1; j >= 0; j--) {
            if (sections[j].ids.includes(s.sameRef)) {
              inherited = resolvedBySection[j];
              break;
            }
          }
        }
        for (const p of inherited ?? []) resolved.add(p);
      }
    } else {
      resolved = s.prosePaths;
    }
    resolvedBySection.push(resolved);
    for (const id of s.ids) {
      const existing = result.get(id);
      if (existing) {
        for (const p of resolved) existing.add(p);
      } else {
        result.set(id, new Set(resolved));
      }
    }
  }

  return result;
}
