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

import { access, readFile as readFileFs } from 'fs/promises';
import { join } from 'path';
import { createRequire } from 'node:module';
// Type-only import: erased at build time so the `typescript` package is NEVER
// bundled into the ESM dist. Bundling it broke the whole binary at startup —
// tsup rewrites TypeScript's internal CommonJS `require('fs')` into a shim that
// throws "Dynamic require of \"fs\" is not supported", crashing `conduct-ts`
// before any command runs. The runtime compiler is loaded lazily via
// `loadTypescript()` only when Layer 2 actually walks the import graph.
import type * as ts from 'typescript';
import type { GitRunner } from './pr-labels.js';
import {
  extractWiredIntoContracts,
  type InertRef,
  type WiredIntoParseResult,
  type WiredIntoSite,
} from './wired-into.js';
import { parsePlanTaskPaths } from './plan-task-parse.js';
import type { HarnessConfig } from '../types/config.js';
import type { WiringEvidence, WiringGap, WiringGapKind, WiringTaskResult } from './artifacts.js';

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
export async function deriveBase(runGit: GitRunner, anchor: string, cwd: string): Promise<string | null> {
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
 * Canonical `gh` CLI runner shape — re-exported from tracker-client.ts.
 * Not yet exercised: issue-form ref resolution (Task 20) is the only caller;
 * path-form resolution (this task) must never invoke it.
 */
import type { GhRunner } from './tracker-client.js';
export type { GhRunner };

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
  cwd: string,
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
    const result = await gh(['issue', 'view', slug, '--json', 'state'], { cwd });
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
  cwd: string,
): Promise<string[]> {
  const gaps: string[] = [];

  for (const task of tasks) {
    if (task.parseResult?.kind !== 'inert') continue;

    const resolution = await resolveWaiverRef(task.parseResult.ref, fileExists, gh, cwd);
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

/**
 * Layer 2 (TS import-graph reachability) applicability/degradation result.
 * Exactly one of three degraded shapes, or the applicable shape carrying the
 * resolved entry-point roots:
 *
 *   - not-applicable: the project has no TS markers (tsconfig.json/
 *     package.json) at all — Layer 2 cannot ever apply here.
 *   - skipped: the project IS a TS project but `wiring.entry_points` is not
 *     configured — Layer 2 could apply but is opted out. Never affects
 *     Layer 1's pass/fail; it carries no `satisfied` verdict of its own.
 *   - bad-root: `wiring.entry_points` is configured but names a path that
 *     does not exist on disk — a real gap, distinct from the two degradation
 *     modes above, so it does carry `satisfied: false`.
 */
export type Layer2ApplicabilityResult =
  | { applicable: true; roots: string[] }
  | { applicable: false; reason: 'not-applicable' }
  | { applicable: false; reason: 'skipped'; message: string }
  | { applicable: false; reason: 'bad-root'; satisfied: false; message: string };

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolves whether Layer 2 (TS import-graph reachability) applies to this
 * project, and if so, the configured entry-point roots to walk from.
 *
 * Degradation ladder:
 *   1. No tsconfig.json AND no package.json in projectRoot → not-applicable
 *      (the tech stack doesn't support this layer at all).
 *   2. TS project markers present but `wiring.entry_points` absent/unset →
 *      skipped (could apply, but isn't configured). This is purely a
 *      degradation classification and must never influence Layer 1's
 *      pass/fail verdict.
 *   3. `wiring.entry_points` configured but a listed root does not exist on
 *      disk → bad-root, a real gap naming the offending path.
 *   4. Otherwise → applicable, with the configured roots (repo-relative
 *      paths, unmodified) for the caller to walk.
 */
export async function resolveLayer2Applicability(
  config: HarnessConfig,
  projectRoot: string,
): Promise<Layer2ApplicabilityResult> {
  const hasTsMarkers =
    (await pathExists(join(projectRoot, 'tsconfig.json'))) ||
    (await pathExists(join(projectRoot, 'package.json')));

  if (!hasTsMarkers) {
    return { applicable: false, reason: 'not-applicable' };
  }

  const entryPoints = config.wiring?.entry_points;
  if (!entryPoints || entryPoints.length === 0) {
    return {
      applicable: false,
      reason: 'skipped',
      message: 'Layer 2 skipped: wiring.entry_points not configured',
    };
  }

  for (const root of entryPoints) {
    if (!(await pathExists(join(projectRoot, root)))) {
      return {
        applicable: false,
        reason: 'bad-root',
        satisfied: false,
        message: `wiring.entry_points root "${root}" does not exist`,
      };
    }
  }

  return { applicable: true, roots: entryPoints };
}

// ── Import graph (TS compiler API reachability) ────────────────────────────

/**
 * Directed module-import graph: each key is an absolute file path, each
 * value the set of absolute file paths it directly imports (resolved via
 * the TS compiler's module resolution, so path aliases/extension-less
 * imports resolve the same way `tsc` itself would).
 */
export type ImportGraph = Map<string, Set<string>>;

/**
 * Builds a directed module-import graph by walking transitively from the
 * given root files, using the TypeScript compiler API (`ts.createProgram`)
 * for both parsing and import resolution rather than a hand-rolled parser
 * — this is a real TS project, so path aliases/tsconfig resolution behave
 * the same way `tsc` itself would resolve them.
 *
 * `roots` and the graph's keys/values are absolute file paths.
 */
export function buildImportGraph(roots: string[], projectRoot: string): ImportGraph {
  const graph: ImportGraph = new Map();
  if (roots.length === 0) return graph;

  // Load the TypeScript compiler lazily at call time (see the type-only import
  // note at the top of the file). `createRequire` resolves the real package
  // from node_modules instead of a bundled copy, and throws a clear
  // module-not-found error when `typescript` is absent — which the Layer 2
  // predicate catches and reports as a degraded skip rather than crashing.
  const tsc = createRequire(import.meta.url)('typescript') as typeof import('typescript');

  const compilerOptions: ts.CompilerOptions = {
    allowJs: true,
    module: tsc.ModuleKind.ESNext,
    moduleResolution: tsc.ModuleResolutionKind.Bundler,
    target: tsc.ScriptTarget.ES2020,
    noEmit: true,
  };

  const host = tsc.createCompilerHost(compilerOptions);
  const program = tsc.createProgram(roots, compilerOptions, host);

  const queue = [...roots];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const filePath = queue.shift() as string;
    if (visited.has(filePath)) continue;
    visited.add(filePath);

    const sourceFile = program.getSourceFile(filePath);
    if (!sourceFile) {
      graph.set(filePath, new Set());
      continue;
    }

    const imports = new Set<string>();

    // Test-path exclusion: edges originating FROM a test file (per the
    // same `.test.`/`test/`/`__tests__/` convention as `isTestPath`) are
    // never added to the graph. A test file importing production code is
    // normal, but it must never manufacture a false reachability path —
    // e.g. `foo.test.ts` importing `bar.ts` must not make `bar.ts`
    // reachable just because some production root happens to import
    // `foo.test.ts` (or the test runner treats it as an entry point).
    if (!isTestPath(filePath)) {
      const addEdge = (moduleSpecifier: ts.Expression) => {
        if (!tsc.isStringLiteral(moduleSpecifier)) return;
        const resolved = tsc.resolveModuleName(
          moduleSpecifier.text,
          filePath,
          compilerOptions,
          host,
        );
        const resolvedFileName = resolved.resolvedModule?.resolvedFileName;
        if (!resolvedFileName) return;

        imports.add(resolvedFileName);
        if (!visited.has(resolvedFileName)) {
          queue.push(resolvedFileName);
        }
      };

      // Recursive walk (not just top-level children): static
      // import/export declarations are always top-level in a valid ES
      // module, but a dynamic `import(...)` expression can appear
      // anywhere — nested inside a function body, an `if`, etc. (e.g.
      // `src/index.ts`'s lazy `await import('./daemon-cli.js')`, several
      // levels deep inside its dispatch function). Missing that edge
      // silently disconnects an entire dynamically-loaded subtree from
      // every configured root, which is worse than a missed edge: it
      // makes Layer 2 quietly stop protecting that subtree at all rather
      // than loudly flagging it.
      const visit = (node: ts.Node) => {
        if (
          (tsc.isImportDeclaration(node) || tsc.isExportDeclaration(node)) &&
          node.moduleSpecifier
        ) {
          addEdge(node.moduleSpecifier);
        } else if (
          tsc.isCallExpression(node) &&
          node.expression.kind === tsc.SyntaxKind.ImportKeyword &&
          node.arguments.length > 0
        ) {
          addEdge(node.arguments[0]);
        }
        tsc.forEachChild(node, visit);
      };
      visit(sourceFile);
    }

    graph.set(filePath, imports);
  }

  return graph;
}

export interface ReachabilityResult {
  reachable: boolean;
  chain?: string[];
}

/**
 * Determines whether `targetModule` is reachable from any of `roots` by
 * traversing the directed import graph (`buildImportGraph`), via BFS so the
 * returned chain is a shortest path. `roots` and `targetModule` are
 * expected to be the same absolute-path form used as graph keys/values.
 */
export function reachableFromRoots(
  graph: ImportGraph,
  roots: string[],
  targetModule: string,
): ReachabilityResult {
  const visited = new Set<string>(roots);
  const queue: string[][] = roots.map((root) => [root]);

  while (queue.length > 0) {
    const chain = queue.shift() as string[];
    const current = chain[chain.length - 1];

    if (current === targetModule) {
      return { reachable: true, chain };
    }

    const neighbors = graph.get(current);
    if (!neighbors) continue;

    for (const neighbor of neighbors) {
      if (visited.has(neighbor)) continue;
      visited.add(neighbor);
      queue.push([...chain, neighbor]);
    }
  }

  return { reachable: false };
}

export interface ExportReachabilityResult {
  file: string;
  symbol: string;
  reachable: boolean;
  message?: string;
}

/**
 * Layer 2 gap-producing function: checks each newly-added export for
 * reachability from the configured entry-point roots via the TS import
 * graph (`buildImportGraph` + `reachableFromRoots`). An unreachable export
 * is a gap — this covers both orphan islands (modules that only import each
 * other, never reached from any root — this falls out naturally from BFS,
 * since a node with no path from a root is simply never visited) and
 * exports reached only through test-path edges (excluded at
 * `buildImportGraph` construction time, per the same test-path convention
 * as `isTestPath`).
 *
 * Standalone, following the same pattern as Layer 1's exported functions
 * (`verifyDeclaredSites`, `orphanBackstop`, `checkContractConsistency`) —
 * not yet wired into a single top-level "all gaps" collector, per the
 * deferred full-orchestration note on this feature.
 *
 * `newExports` file paths and `roots` are repo-relative, matching the shape
 * produced elsewhere in this module (`extractNewExports`,
 * `resolveLayer2Applicability`); this function resolves them to absolute
 * paths against `projectRoot` before walking the graph.
 */
export function checkExportReachability(
  newExports: NewExport[],
  roots: string[],
  projectRoot: string,
): ExportReachabilityResult[] {
  const absoluteRoots = roots.map((root) => join(projectRoot, root));
  const graph = buildImportGraph(absoluteRoots, projectRoot);

  return newExports.map((newExport) => {
    const targetFile = join(projectRoot, newExport.file);
    const { reachable } = reachableFromRoots(graph, absoluteRoots, targetFile);

    if (reachable) {
      return { file: newExport.file, symbol: newExport.symbol, reachable: true };
    }

    return {
      file: newExport.file,
      symbol: newExport.symbol,
      reachable: false,
      message: `«${newExport.symbol}» exported but unreachable from any entry point (roots: ${roots.join(', ')})`,
    };
  });
}

// ── Top-level orchestrator (composes every primitive above into one WiringEvidence) ──

const UNSCOPED_TASK_ID = '(unscoped)';

/** Renders a task's parsed `Wired-into:` contract (or its absence) to the
 * freeform `WiringTaskResult.contract` string. */
function describeContract(parseResult: WiredIntoParseResult | null): string {
  if (parseResult === null) return 'undeclared (no Wired-into line)';
  switch (parseResult.kind) {
    case 'declared':
      return parseResult.sites.map((s) => `${s.path}#${s.symbol}`).join(', ') || '(empty)';
    case 'no_new_surface':
      return 'none (no new production surface)';
    case 'inert': {
      const ref = parseResult.ref;
      const refText = ref.form === 'issue' ? `${ref.owner}/${ref.repo}#${ref.number}` : ref.path;
      return `none (inert until ${refText})`;
    }
    case 'malformed':
      return parseResult.message;
  }
}

function pushGap(map: Map<string, WiringGap[]>, taskId: string, kind: WiringGapKind, message: string): void {
  const existing = map.get(taskId);
  if (existing) {
    existing.push({ kind, message });
  } else {
    map.set(taskId, [{ kind, message }]);
  }
}

/** Finds the task (by id) that owns a given repo-relative file path, i.e. the
 * task whose `**Files:**`-derived path set includes it. Returns
 * `UNSCOPED_TASK_ID` when no task claims the file (plan missing/absent, or a
 * file genuinely untouched by any declared task section). */
function ownerTaskId(file: string, tasks: TaskWiringContract[]): string {
  for (const task of tasks) {
    if (task.files.includes(file)) return task.taskId;
  }
  return UNSCOPED_TASK_ID;
}

export interface ComputeWiringEvidenceParams {
  runGit: GitRunner;
  projectRoot: string;
  planPath: string | undefined;
  config: HarnessConfig;
  gh: GhRunner;
  anchor: string;
}

/**
 * Top-level orchestrator for the wiring-reachability gate (Task 18): composes
 * every Layer-1/Layer-2 primitive in this module (plus `wired-into.ts`'s
 * `extractWiredIntoContracts` and `autoheal.ts`'s `parsePlanTaskPaths` for
 * per-task file scoping) into one `WiringEvidence` object matching
 * `validateWiringEvidence` in artifacts.ts.
 *
 * Fails closed WITHOUT throwing for expected degraded inputs (missing plan,
 * scope-undeterminable base commit, no new exports); a genuine unexpected
 * failure (e.g. a git command erroring mid-probe) propagates as a thrown
 * exception — the wiring_check predicate already catches that and reports
 * "wiring probe failed: <msg>".
 */
export async function computeWiringEvidence(
  params: ComputeWiringEvidenceParams,
): Promise<WiringEvidence> {
  const { runGit, projectRoot, planPath, config, gh, anchor } = params;

  const headResult = await runGit(['rev-parse', 'HEAD'], { cwd: projectRoot });
  const head = headResult.stdout.trim();

  const { newExports, gaps: probeGaps } = await runWiringProbe(runGit, anchor, projectRoot);

  if (probeGaps.length > 0) {
    // Base commit could not be derived by any rung of the ladder — fail
    // closed with a single scope-undeterminable gap, never a silent pass.
    return {
      schema: 1,
      base: '',
      head,
      tasks: [
        {
          id: UNSCOPED_TASK_ID,
          contract: 'unresolved (wiring scope undeterminable)',
          gaps: probeGaps.map((g) => ({ kind: 'scope-undeterminable' as WiringGapKind, message: g })),
        },
      ],
      layer2: { applicable: false, reason: 'scope undeterminable' },
      waivers: [],
    };
  }

  const base = (await deriveBase(runGit, anchor, projectRoot)) ?? '';

  // ── Plan text + per-task contracts/file-scoping ──────────────────────────
  let planText = '';
  if (planPath !== undefined) {
    try {
      planText = await readFileFs(planPath, 'utf-8');
    } catch {
      // Missing/unreadable plan — fail closed to "no contracts resolved",
      // never throw. planText stays '' (same as planPath === undefined).
      planText = '';
    }
  }

  const wiredIntoMap = extractWiredIntoContracts(planText);
  const taskPathsMap = parsePlanTaskPaths(planText);

  const taskIds = new Set<string>([...wiredIntoMap.keys(), ...taskPathsMap.keys()]);
  const tasks: TaskWiringContract[] = [...taskIds].map((id) => ({
    taskId: id,
    files: [...(taskPathsMap.get(id) ?? [])],
    parseResult: wiredIntoMap.get(id) ?? null,
  }));

  const gapsByTask = new Map<string, WiringGap[]>();

  // ── FileReader / ReferenceSearchRunner / FileExistsChecker / GhRunner adapters ──
  const readFile: FileReader = (path: string) => readFileFs(join(projectRoot, path), 'utf-8');
  const searchReferences: ReferenceSearchRunner = async (symbol: string) => {
    try {
      const result = await runGit(['grep', '-l', '-w', symbol], { cwd: projectRoot });
      return result.stdout
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line !== '');
    } catch {
      // `git grep` exits non-zero when nothing matches — no references found.
      return [];
    }
  };
  const fileExists: FileExistsChecker = async (path: string) => {
    try {
      await access(join(projectRoot, path));
      return true;
    } catch {
      return false;
    }
  };

  // ── verifyDeclaredSites (per task, so gaps attribute to the owning task) ──
  for (const task of tasks) {
    if (task.parseResult?.kind !== 'declared') continue;
    const { gaps } = await verifyDeclaredSites(task.parseResult.sites, newExports, readFile);
    for (const message of gaps) {
      pushGap(gapsByTask, task.taskId, 'unreferenced-site', message);
    }
  }

  // ── orphanBackstop (attribute each gap to the owning task by file, or unscoped) ──
  const orphanResults = await orphanBackstop(newExports, searchReferences);
  for (const result of orphanResults) {
    if (result.status !== 'gap') continue;
    const owner = ownerTaskId(result.file, tasks);
    pushGap(gapsByTask, owner, 'orphan-export', result.message ?? `${result.symbol} is orphaned`);
  }

  // ── checkContractConsistency (global call for plan-wide contract-bearing flag,
  //    gaps attributed back to their task via the `task <id>:` message prefix) ──
  const consistencyGaps = checkContractConsistency(tasks, newExports);
  for (const message of consistencyGaps) {
    const match = message.match(/^task ([^:]+): declared 'no new production surface'/);
    const kind: WiringGapKind = match ? 'contradiction' : 'undeclared-surface';
    const idMatch = message.match(/^task ([^:]+):/);
    const owner = idMatch ? idMatch[1] : UNSCOPED_TASK_ID;
    pushGap(gapsByTask, owner, kind, message);
  }

  // ── resolveWaiverRef / checkInertContractContradiction (inert declarations) ──
  const waivers: unknown[] = [];
  for (const task of tasks) {
    if (task.parseResult?.kind !== 'inert') continue;
    const resolution = await resolveWaiverRef(task.parseResult.ref, fileExists, gh, projectRoot);
    waivers.push({ taskId: task.taskId, ref: task.parseResult.ref, status: resolution.status });
    if (resolution.status !== 'waived') {
      pushGap(
        gapsByTask,
        task.taskId,
        'waiver-unresolved',
        resolution.message ?? `task ${task.taskId}: inert waiver could not be resolved`,
      );
    }
  }

  const contradictionGaps = await checkInertContractContradiction(
    tasks,
    newExports,
    searchReferences,
    fileExists,
    gh,
    projectRoot,
  );
  for (const message of contradictionGaps) {
    const idMatch = message.match(/^task ([^:]+):/);
    const owner = idMatch ? idMatch[1] : UNSCOPED_TASK_ID;
    pushGap(gapsByTask, owner, 'contradiction', message);
  }

  // ── Layer 2: TS import-graph reachability ────────────────────────────────
  const layer2Applicability = await resolveLayer2Applicability(config, projectRoot);
  let layer2: WiringEvidence['layer2'];
  if (layer2Applicability.applicable) {
    layer2 = { applicable: true };
    const reachabilityResults = checkExportReachability(
      newExports,
      layer2Applicability.roots,
      projectRoot,
    );
    for (const result of reachabilityResults) {
      if (result.reachable) continue;
      const owner = ownerTaskId(result.file, tasks);
      pushGap(
        gapsByTask,
        owner,
        'orphan-export',
        result.message ?? `${result.symbol} unreachable from any entry point`,
      );
    }
  } else if (layer2Applicability.reason === 'bad-root') {
    layer2 = { applicable: false, reason: layer2Applicability.message };
    pushGap(gapsByTask, UNSCOPED_TASK_ID, 'scope-undeterminable', layer2Applicability.message);
  } else if (layer2Applicability.reason === 'skipped') {
    layer2 = { applicable: false, reason: layer2Applicability.message };
  } else {
    layer2 = { applicable: false, reason: 'not-applicable' };
  }

  // ── Legacy advisory demotion: a plan with zero Wired-into lines anywhere
  //    never blocks — every Layer-1 finding collected above is demoted to an
  //    advisory (dropped from the blocking gaps surfaced in evidence). ──────
  const flatGapMessages = [...gapsByTask.values()].flat().map((g) => g.message);
  const disposition = evaluatePlanWiringDisposition(tasks, flatGapMessages);
  const isLegacyAdvisory = disposition.reason === LEGACY_ADVISORY_REASON;

  const taskResults: WiringTaskResult[] = tasks.map((task) => ({
    id: task.taskId,
    contract: describeContract(task.parseResult),
    gaps: isLegacyAdvisory ? [] : gapsByTask.get(task.taskId) ?? [],
  }));

  // Any gaps attributed to files/tasks outside the known task set (unscoped)
  // surface as their own synthetic task entry, so they are never silently
  // dropped from the evidence.
  const unscopedGaps = gapsByTask.get(UNSCOPED_TASK_ID);
  if (unscopedGaps && unscopedGaps.length > 0 && !isLegacyAdvisory) {
    taskResults.push({ id: UNSCOPED_TASK_ID, contract: 'unresolved', gaps: unscopedGaps });
  }

  return {
    schema: 1,
    base,
    head,
    tasks: taskResults,
    layer2,
    waivers,
  };
}
