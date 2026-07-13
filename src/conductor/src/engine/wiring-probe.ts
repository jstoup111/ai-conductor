/**
 * Wiring-probe module — Layer 1 of the wiring-reachability gate.
 *
 * Extracts newly-added exported symbols (with their defining file) from a
 * feature's git diff. This is the foundation used by later layers to verify
 * that new exports are actually wired into the system (declared-site
 * verification, orphan backstop, etc. — not implemented here).
 *
 * Base-commit derivation reuses the anchor -> origin-ref-resolve ->
 * fork-point -> merge-base fallback ladder used elsewhere in this repo for
 * evidence-range derivation (see getEvidenceRange/resolveOriginRef in
 * autoheal.ts), adapted to the injected-GitRunner convention (see
 * headPushedToUpstream in push-evidence.ts) so it is testable without a real
 * git process. The origin ref is never hardcoded to `origin/main` — it is
 * resolved via `origin/HEAD`, falling back to probing `origin/main` then
 * `origin/master`, and fails closed (returns no exports) if none resolve.
 */

import type { GitRunner } from './pr-labels.js';
import type { InertRef, WiredIntoParseResult, WiredIntoSite } from './wired-into.js';

export interface NewExport {
  file: string;
  symbol: string;
}

/**
 * Resolves the `origin/<default>` ref to derive the base against, mirroring
 * `resolveOriginRef` in autoheal.ts but adapted to the injected-GitRunner
 * convention used by this module (throws on failure rather than returning an
 * `exitCode`).
 *
 * Ladder:
 *   1. `symbolic-ref refs/remotes/origin/HEAD` — the authoritative source
 *      for origin's default branch; never a guess.
 *   2. Probe `origin/main`, then `origin/master` via `rev-parse --verify`
 *      (migration aid for repos/checkouts that never set origin/HEAD).
 *   3. null — resolution failed; caller must fail closed, never assume `main`.
 */
async function resolveOriginRef(runGit: GitRunner, cwd: string): Promise<string | null> {
  try {
    const head = await runGit(['symbolic-ref', 'refs/remotes/origin/HEAD'], { cwd });
    const trimmed = head.stdout.trim();
    const match = trimmed.match(/^refs\/remotes\/origin\/(.+)$/);
    if (match) return `origin/${match[1]}`;
  } catch {
    // origin/HEAD unset — fall through to probing candidates
  }

  for (const candidate of ['origin/main', 'origin/master']) {
    try {
      await runGit(['rev-parse', '--verify', candidate], { cwd });
      return candidate;
    } catch {
      // candidate does not exist — try the next one
    }
  }

  return null;
}

/**
 * Derives the base commit for the evidence diff via the fallback ladder:
 *   1. If `anchor` is non-empty and reachable (`rev-parse --verify
 *      <anchor>^{commit}` succeeds), use it directly.
 *   2. Otherwise, resolve origin's default branch ref (see
 *      `resolveOriginRef`); if it cannot be resolved, fail closed (return
 *      null) rather than guessing `origin/main`.
 *   3. Otherwise, try `merge-base --fork-point <originRef> HEAD`.
 *   4. Otherwise, fall back to plain `merge-base <originRef> HEAD`.
 *   5. If all of the above fail, return null (caller fails closed).
 */
async function deriveBase(runGit: GitRunner, anchor: string, cwd: string): Promise<string | null> {
  if (anchor.trim() !== '') {
    try {
      await runGit(['rev-parse', '--verify', `${anchor}^{commit}`], { cwd });
      return anchor;
    } catch {
      // anchor unreachable — fall through to the merge-base ladder
    }
  }

  const originRef = await resolveOriginRef(runGit, cwd);
  if (originRef === null) return null;

  try {
    const forkPoint = await runGit(['merge-base', '--fork-point', originRef, 'HEAD'], { cwd });
    const trimmed = forkPoint.stdout.trim();
    if (trimmed !== '') return trimmed;
  } catch {
    // fall through to plain merge-base
  }

  try {
    const mergeBase = await runGit(['merge-base', originRef, 'HEAD'], { cwd });
    const trimmed = mergeBase.stdout.trim();
    if (trimmed !== '') return trimmed;
  } catch {
    // fall through to fail-closed
  }

  return null;
}

const ADDED_FUNCTION_RE = /^export\s+(?:async\s+function|function)\s+([A-Za-z_$][\w$]*)/;
const ADDED_CONST_LET_VAR_RE = /^export\s+(?:const|let|var)\s+([A-Za-z_$][\w$]*)/;
const ADDED_CLASS_RE = /^export\s+(?:default\s+)?class\s+([A-Za-z_$][\w$]*)/;
const ADDED_REEXPORT_RE = /^export\s*\{([^}]+)\}\s*from\s*['"][^'"]+['"]/;

function symbolsFromAddedLine(line: string): string[] {
  const fnMatch = line.match(ADDED_FUNCTION_RE);
  if (fnMatch) return [fnMatch[1]];

  const varMatch = line.match(ADDED_CONST_LET_VAR_RE);
  if (varMatch) return [varMatch[1]];

  const classMatch = line.match(ADDED_CLASS_RE);
  if (classMatch) return [classMatch[1]];

  const reexportMatch = line.match(ADDED_REEXPORT_RE);
  if (reexportMatch) {
    return reexportMatch[1]
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '')
      .map((part) => {
        // handle `foo as bar` — the locally-exported name is `bar`
        const asMatch = part.match(/^\S+\s+as\s+(\S+)$/);
        return asMatch ? asMatch[1] : part;
      });
  }

  return [];
}

/**
 * Parses a unified `git diff` text and returns every newly-added exported
 * symbol along with the file that defines it.
 */
function parseDiffForNewExports(diffText: string): NewExport[] {
  const results: NewExport[] = [];
  let currentFile: string | null = null;

  for (const rawLine of diffText.split('\n')) {
    if (rawLine.startsWith('+++ ')) {
      const path = rawLine.slice(4).trim();
      if (path === '/dev/null') {
        currentFile = null;
      } else {
        currentFile = path.startsWith('b/') ? path.slice(2) : path;
      }
      continue;
    }

    if (rawLine.startsWith('+++') || rawLine.startsWith('---') || rawLine.startsWith('diff --git')) {
      continue;
    }

    if (!rawLine.startsWith('+') || rawLine.startsWith('++')) {
      continue;
    }

    if (currentFile === null) continue;

    const content = rawLine.slice(1).trim();
    const symbols = symbolsFromAddedLine(content);
    for (const symbol of symbols) {
      results.push({ file: currentFile, symbol });
    }
  }

  return results;
}

/**
 * Extracts newly-added exported symbols (with their defining file) from the
 * diff between a derived base commit and HEAD.
 *
 * `anchor` is fed into the base-derivation ladder (see `deriveBase`); pass
 * an empty string to skip straight to the fork-point/merge-base fallback.
 */
export async function extractNewExports(
  runGit: GitRunner,
  anchor: string,
  cwd = '.',
): Promise<NewExport[]> {
  const { newExports } = await runWiringProbe(runGit, anchor, cwd);
  return newExports;
}

/** The exact fail-closed gap message surfaced when the base commit cannot be
 * derived by any rung of the ladder (anchor unreachable, origin ref
 * unresolvable, and merge-base both attempts failing). This is the
 * probe-level fail-closed signal: never a silent empty result, never an
 * unhandled throw. */
export const WIRING_SCOPE_UNDETERMINABLE = 'wiring scope undeterminable';

export interface WiringProbeResult {
  newExports: NewExport[];
  gaps: string[];
}

/**
 * Top-level entry point for the diff-extraction stage of the wiring probe.
 * Derives the base commit via the anchor -> origin-ref-resolve ->
 * fork-point -> merge-base fallback ladder (`deriveBase`); when every rung
 * fails, this fails closed with a single named gap
 * (`WIRING_SCOPE_UNDETERMINABLE`) rather than returning an empty (silently
 * passing) export list or letting an exception escape uncaught.
 */
export async function runWiringProbe(
  runGit: GitRunner,
  anchor: string,
  cwd = '.',
): Promise<WiringProbeResult> {
  const base = await deriveBase(runGit, anchor, cwd);
  if (base === null) {
    return { newExports: [], gaps: [WIRING_SCOPE_UNDETERMINABLE] };
  }

  const diffResult = await runGit(['diff', `${base}...HEAD`], { cwd });
  return { newExports: parseDiffForNewExports(diffResult.stdout), gaps: [] };
}

/** Injected file reader — same convention as GitRunner: real fs calls stay out of unit tests. */
export type FileReader = (path: string) => Promise<string>;

export interface VerifiedSiteEvidence {
  site: string;
  symbol: string;
  matchedLine: string;
}

export interface VerifyDeclaredSitesResult {
  gaps: string[];
  evidence: VerifiedSiteEvidence[];
}

/**
 * Verifies that each declared `Wired-into:` site actually references the new
 * symbol it claims to wire in. This is Layer 1 — a simple non-test text
 * search for the symbol as a whole word in the declared file's content, not
 * full static analysis.
 */
export async function verifyDeclaredSites(
  sites: WiredIntoSite[],
  newExports: NewExport[],
  readFile: FileReader,
): Promise<VerifyDeclaredSitesResult> {
  const gaps: string[] = [];
  const evidence: VerifiedSiteEvidence[] = [];

  for (const site of sites) {
    const label = `${site.path}#${site.symbol}`;
    let content: string;
    try {
      content = await readFile(site.path);
    } catch {
      gaps.push(`declared call site ${label}: file not found`);
      continue;
    }

    const symbolRe = new RegExp(`\\b${site.symbol.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);
    const matchedLine = content
      .split('\n')
      .map((line) => line.trim())
      .find((line) => symbolRe.test(line));

    if (matchedLine === undefined) {
      gaps.push(`declared call site ${label} has no non-test reference to «${site.symbol}» (searched: ${site.path})`);
      continue;
    }

    evidence.push({ site: label, symbol: site.symbol, matchedLine });
  }

  return { gaps, evidence };
}

// ── Orphan backstop (Layer: unreferenced-export gap) ──────────────────────────

/**
 * Injected reference-search runner — same injected-runner convention as
 * `GitRunner`/`FileReader`: production code shells out to a real search tool
 * (e.g. `git grep -n -F -- <symbol>`), tests inject a fake that returns
 * canned file paths, so this module stays testable without a real process.
 * Returns every file path that references `symbol`, including the symbol's
 * own defining file (self-references are filtered out by the caller).
 */
export type ReferenceSearchRunner = (symbol: string) => Promise<string[]>;

export interface OrphanBackstopResult {
  file: string;
  symbol: string;
  status: 'ok' | 'gap';
  message?: string;
  evidence?: string[];
}

/**
 * Test-path exclusion convention shared across the wiring-reachability gate
 * (mirrors the artifact-glob test exclusions in artifacts.ts): a path is
 * test-only if it matches `.test.` anywhere in the file name, or lives under
 * a `test/` or `__tests__/` directory.
 */
function isTestPath(path: string): boolean {
  if (path.includes('.test.')) return true;
  const segments = path.split('/');
  return segments.includes('test') || segments.includes('__tests__');
}

/**
 * Orphan backstop: a newly-added export must have at least one non-test
 * reference outside its own defining file, or it's a wiring gap. This is a
 * blunt safety net behind declared-site verification (`verifyDeclaredSites`)
 * — it catches exports that were never declared as wired-into anywhere at
 * all, including self-references (used only within the file that defines
 * them) and test-only references (imported solely by the export's own test
 * file).
 */
export async function orphanBackstop(
  newExports: NewExport[],
  searchReferences: ReferenceSearchRunner,
): Promise<OrphanBackstopResult[]> {
  const results: OrphanBackstopResult[] = [];

  for (const newExport of newExports) {
    const referencingFiles = await searchReferences(newExport.symbol);
    const outsideDefiningFile = referencingFiles.filter((file) => file !== newExport.file);

    if (outsideDefiningFile.length === 0) {
      results.push({
        file: newExport.file,
        symbol: newExport.symbol,
        status: 'gap',
        message: `${newExport.symbol} exported but referenced only within its own defining file (no external wiring)`,
      });
      continue;
    }

    const nonTestFiles = outsideDefiningFile.filter((file) => !isTestPath(file));

    if (nonTestFiles.length === 0) {
      results.push({
        file: newExport.file,
        symbol: newExport.symbol,
        status: 'gap',
        message: `${newExport.symbol} exported but referenced by no production code (${outsideDefiningFile.length} test-only references excluded)`,
      });
      continue;
    }

    results.push({
      file: newExport.file,
      symbol: newExport.symbol,
      status: 'ok',
      evidence: [...new Set(nonTestFiles)],
    });
  }

  return results;
}

// ── Contract consistency (declared-vs-actual cross-reference) ─────────────────

/**
 * A single task's declared `Wired-into:` contract, paired with the files it
 * touches so its actual new exports (scoped from `extractNewExports`) can be
 * cross-referenced against what it claims.
 *
 * `parseResult` is `null` when the task has no `Wired-into:` line at all —
 * distinct from a `declared`/`no_new_surface`/`inert` parse, which means the
 * line is present but may still be malformed.
 */
export interface TaskWiringContract {
  taskId: string;
  files: string[];
  parseResult: WiredIntoParseResult | null;
}

/**
 * Cross-references each task's declared `Wired-into:` contract against its
 * actual new exports (scoped to the task's own files) and reports two kinds
 * of contradiction:
 *
 * 1. A task declares `no_new_surface` ("no new production surface") but its
 *    files' diff adds new exports anyway — the declaration is false.
 * 2. A task has new exports but no `Wired-into:` line at all — an
 *    undeclared new-export surface. This only fires when at least one task
 *    in the set carries a contract (`declared`, `no_new_surface`, or
 *    `inert`), i.e. the plan is contract-bearing; a plan with no Wired-into
 *    convention in use at all is out of scope for this check.
 */
export function checkContractConsistency(
  tasks: TaskWiringContract[],
  newExports: NewExport[],
): string[] {
  const gaps: string[] = [];
  const planIsContractBearing = tasks.some((task) => task.parseResult !== null);

  for (const task of tasks) {
    const taskFiles = new Set(task.files);
    const taskExports = newExports.filter((exp) => taskFiles.has(exp.file));

    if (task.parseResult?.kind === 'no_new_surface') {
      if (taskExports.length > 0) {
        const symbols = taskExports.map((exp) => exp.symbol).join(', ');
        gaps.push(
          `task ${task.taskId}: declared 'no new production surface' but diff adds new export(s): ${symbols}`,
        );
      }
      continue;
    }

    if (task.parseResult === null && planIsContractBearing && taskExports.length > 0) {
      const symbols = taskExports.map((exp) => exp.symbol).join(', ');
      gaps.push(
        `task ${task.taskId}: undeclared new-export surface — diff adds new export(s): ${symbols} but task has no Wired-into declaration`,
      );
    }
  }

  return gaps;
}

// ── Plan-level disposition (legacy advisory-only vs. contract-bearing gating) ─

/** The exact advisory reason surfaced when a plan carries zero `Wired-into:`
 * lines anywhere: the wiring gate is a no-op for such plans (pre-dates the
 * Wired-into convention), so any Layer-1 findings are demoted from blocking
 * gaps to informational advisories rather than silently discarded. */
export const LEGACY_ADVISORY_REASON =
  'legacy plan (pre-Wired-into contract): wiring gate advisory-only';

export interface PlanWiringDispositionResult {
  satisfied: boolean;
  reason?: string;
  gaps: string[];
  advisories: string[];
}

/**
 * Plan-level disposition switch for the wiring-reachability gate.
 *
 * Mirrors the `planIsContractBearing` check in `checkContractConsistency`:
 * a plan is contract-bearing the moment ANY task carries a `Wired-into:`
 * line (even a single one) — that flips the WHOLE plan into full gating,
 * it does not selectively exempt tasks that happen to lack a line.
 *
 * - Zero `Wired-into:` lines anywhere in the plan: legacy plan, predates the
 *   convention. The gate never blocks such a plan — `satisfied: true` with
 *   `LEGACY_ADVISORY_REASON`, and every Layer-1 finding passed in via `gaps`
 *   is demoted to an advisory (surfaced for visibility, never blocking).
 * - One or more `Wired-into:` lines anywhere: normal full gating — `gaps`
 *   pass through unchanged and `satisfied` reflects whether any exist.
 */
export function evaluatePlanWiringDisposition(
  tasks: TaskWiringContract[],
  gaps: string[],
): PlanWiringDispositionResult {
  const planIsContractBearing = tasks.some((task) => task.parseResult !== null);

  if (!planIsContractBearing) {
    return { satisfied: true, reason: LEGACY_ADVISORY_REASON, gaps: [], advisories: gaps };
  }

  return { satisfied: gaps.length === 0, gaps, advisories: [] };
}

// ── Waiver ref resolution (inert `Wired-into:` declarations) ──────────────────

/**
 * Injected file-existence checker — same injected-runner convention as
 * `GitRunner`/`FileReader`/`ReferenceSearchRunner`: production code checks
 * the real filesystem, tests inject a fake so this module stays testable
 * without touching disk.
 */
export type FileExistsChecker = (path: string) => Promise<boolean>;

/**
 * Injected `gh` CLI runner — same injected-runner convention as `GitRunner`.
 * Not yet exercised: issue-form ref resolution (Task 20) is the only caller;
 * path-form resolution (this task) must never invoke it.
 */
export type GhRunner = (args: string[]) => Promise<{ stdout: string }>;

export interface ResolveWaiverRefResult {
  status: 'waived' | 'gap';
  message?: string;
  evidence?: string;
}

/**
 * Resolves an `inert` waiver's `ref` (see `InertRef` in wired-into.ts) to a
 * waived/gap verdict.
 *
 * Path-form: checked on disk via the injected `fileExists` checker, never
 * shelling out to `gh` — a path ref is either present in the repo or it
 * isn't, no network required.
 *
 * Issue-form: not yet implemented here (Task 20 wires up the `gh` runner to
 * check issue open/closed state); this fails closed with a placeholder gap
 * rather than silently treating an issue ref as waived.
 */
export async function resolveWaiverRef(
  ref: InertRef,
  fileExists: FileExistsChecker,
  gh: GhRunner,
): Promise<ResolveWaiverRefResult> {
  if (ref.form === 'path') {
    const exists = await fileExists(ref.path);
    if (exists) {
      return { status: 'waived', evidence: '(path exists)' };
    }
    return { status: 'gap', message: `inert waiver ref ${ref.path} not found` };
  }

  const slug = `${ref.owner}/${ref.repo}#${ref.number}`;
  let stdout: string;
  try {
    const result = await gh(['issue', 'view', slug, '--json', 'state']);
    stdout = result.stdout;
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const firstLine = raw.split('\n')[0];
    return {
      status: 'gap',
      message: `inert waiver ref #${ref.number} unverifiable (gh error: ${firstLine})`,
    };
  }

  let state: string;
  try {
    state = String(JSON.parse(stdout).state ?? '').toUpperCase();
  } catch {
    return {
      status: 'gap',
      message: `inert waiver ref #${ref.number} unverifiable (gh error: unparseable gh response)`,
    };
  }

  if (state === 'OPEN') {
    return { status: 'waived', evidence: '(gh: open)' };
  }

  return {
    status: 'gap',
    message: `inert waiver ref ${slug} is ${state.toLowerCase() || 'unknown'}`,
  };
}

// ── Inert-but-wired contradiction (waiver vs. actual diff cross-reference) ────

/**
 * Cross-references successfully-resolved `inert` waivers (see
 * `resolveWaiverRef`) against the task's actual diff: a task waived as
 * "inert" (not yet wired anywhere, pending `ref`) whose diff nonetheless adds
 * a genuine non-test production reference to the new symbol elsewhere is a
 * contradiction — the contract is stale (the plan should have declared a
 * real call site instead of waiving), not a pass. This is the production
 * call site for `resolveWaiverRef`: only tasks whose waiver resolves to
 * `waived` are checked here (a waiver that fails to resolve already surfaces
 * its own gap via `resolveWaiverRef` and is left to that path, not
 * double-reported).
 *
 * Uses the same non-test/outside-defining-file reference shape as
 * `orphanBackstop`/`verifyDeclaredSites` (via the injected
 * `ReferenceSearchRunner` and `isTestPath`).
 */
export async function checkInertContractContradiction(
  tasks: TaskWiringContract[],
  newExports: NewExport[],
  searchReferences: ReferenceSearchRunner,
  fileExists: FileExistsChecker,
  gh: GhRunner,
): Promise<string[]> {
  const gaps: string[] = [];

  for (const task of tasks) {
    if (task.parseResult?.kind !== 'inert') continue;

    const resolution = await resolveWaiverRef(task.parseResult.ref, fileExists, gh);
    if (resolution.status !== 'waived') continue;

    const taskFiles = new Set(task.files);
    const taskExports = newExports.filter((exp) => taskFiles.has(exp.file));

    for (const exp of taskExports) {
      const referencingFiles = await searchReferences(exp.symbol);
      const productionReferences = referencingFiles.filter(
        (file) => file !== exp.file && !isTestPath(file),
      );

      if (productionReferences.length > 0) {
        gaps.push(
          `task ${task.taskId}: declared inert but diff adds a production reference to «${exp.symbol}» — contract is stale, switch to a declared call site (found in: ${[...new Set(productionReferences)].join(', ')})`,
        );
      }
    }
  }

  return gaps;
}
