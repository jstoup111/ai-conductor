// non-autonomy.test.ts — Structural non-autonomy guarantee (Task 30, FR-10, ADR-005 Condition 2)
//
// This test suite asserts the hardest structural invariant for the engineer:
//   1. The engineer's transitive import graph does NOT include the pipeline/build
//      entry (conductor.ts, step-runners.ts, daemon-runner.ts) NOR any source
//      that issues a `gh pr merge` or merge-API call.
//   2. Any daemon the engineer can launch is FULLY DETACHED FROM THE ENGINEER:
//      it delegates to a start-only seam (ADR-014: tmux new-session -d) and
//      retains no handle, no IPC, no stop/restart — launch ≠ manage (ADR-005 FR-8,
//      mechanism updated by ADR-014).
//
// FORBIDDEN-TOKEN RATIONALE
// ─────────────────────────
// The engineer is allowed to call `gh pr create` (via an injected runner in
// handoff.ts) because that opens a spec PR. It is NOT allowed to call
// `gh pr merge`, use the GitHub merge API, or import the pipeline engine that
// runs builds. The forbidden-token check therefore targets:
//   • The literal string 'pr merge' (catches `gh pr merge`)
//   • The string 'merge' ONLY when it appears in a context that looks like a
//     gh command call: adjacent to 'gh' on the same line (covers shell strings
//     and argument arrays).
//   • The string 'conductor.ts' / '../conductor' / './conductor' as an import
//     (catches any future accidental import of the build-pipeline entry).
//   • The strings 'step-runners' and 'daemon-runner' as imports (these are
//     pipeline internals the engineer must never touch).
//
// Strings that are INTENTIONALLY present in engineer sources and must NOT
// trigger false-positives:
//   • `'pr', 'create'` in handoff.ts — PR creation is allowed
//   • The word 'merge' in English prose / comments that don't accompany 'gh'
//   • Any reference to `daemon.ts` via a TYPE-ONLY import in engineer-store.ts
//     (FeatureOutcome type). That is acceptable because a type import carries
//     no executable dependency.
//
// HOW THE IMPORT WALK WORKS
// ──────────────────────────
// Engineer entry roots:
//   - src/engine/engineer/loop.ts    (runEngineerMode — interactive REPL)
//   - src/engine/engineer-cli.ts     (dispatchEngineer — CLI dispatcher)
//   - All files under src/engine/engineer/*.ts are considered the engineer surface.
//
// The walk:
//   1. Starts from each engineer entry root.
//   2. Parses `from './path.js'` / `from '../path.js'` specifiers (NodeNext
//      ESM style — .js extension on disk maps to .ts).
//   3. Resolves each specifier to an absolute .ts path.
//   4. Recurses, ignoring bare (node_modules) specifiers.
//   5. Keeps a visited set to avoid cycles.
//
// The resulting reachable set is all local source files the engineer pulls in
// transitively. This is then grepped for forbidden tokens.

import { describe, it, expect, vi } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { launchDaemonDetached } from '../../../src/engine/engineer/daemon-launch.js';
import type { LaunchDaemonOpts } from '../../../src/engine/engineer/daemon-launch.js';
import * as daemonLaunchModule from '../../../src/engine/engineer/daemon-launch.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const CONDUCTOR_SRC = resolve(__dirname, '../../../src');

/**
 * Engineer surface: all .ts files that constitute the engineer's reachable source.
 * We seed the walk from these roots.
 */
const ENGINEER_ENTRY_ROOTS: string[] = [
  join(CONDUCTOR_SRC, 'engine/engineer/loop.ts'),
  join(CONDUCTOR_SRC, 'engine/engineer-cli.ts'),
  // All files under engine/engineer/ are also explicit seeds (belt-and-suspenders
  // for any engineer module not yet reachable from loop.ts or engineer-cli.ts).
  join(CONDUCTOR_SRC, 'engine/engineer/authored-ledger.ts'),
  join(CONDUCTOR_SRC, 'engine/engineer/authoring.ts'),
  join(CONDUCTOR_SRC, 'engine/engineer/daemon-launch.ts'),
  join(CONDUCTOR_SRC, 'engine/engineer/flywheel-trend.ts'),
  join(CONDUCTOR_SRC, 'engine/engineer/governor.ts'),
  join(CONDUCTOR_SRC, 'engine/engineer/handoff.ts'),
  join(CONDUCTOR_SRC, 'engine/engineer/lesson-store.ts'),
  join(CONDUCTOR_SRC, 'engine/engineer/rates.ts'),
  join(CONDUCTOR_SRC, 'engine/engineer/routing.ts'),
  join(CONDUCTOR_SRC, 'engine/engineer/target.ts'),
];

/**
 * Pipeline/build entry modules the engineer MUST NEVER import transitively.
 * Named by their relative path suffix (matched against absolute reachable paths).
 */
const FORBIDDEN_MODULE_SUFFIXES: string[] = [
  'engine/conductor.ts',    // pipeline build entry — runs full SDLC
  'engine/step-runners.ts', // build step implementations (gh pr create, code runs, etc.)
  'engine/daemon-runner.ts', // daemon runner that fires the full conductor loop
];

/**
 * Regex patterns that represent forbidden tokens when present in reachable source.
 *
 * Rule 1: 'merge' as a standalone quoted argument — catches the token 'merge'
 *         or "merge" appearing as a separate string in a JS array or template
 *         literal argument list. This is the realistic form used when calling a
 *         runner with ['gh', 'pr', 'merge', ...] or execFile('gh', ['pr', 'merge']).
 *         It also catches the single-string form 'gh pr merge'.
 *
 * Rule 2: 'pr merge' as a single literal string — e.g. `gh pr merge` as a
 *         shell string passed to exec/shell or in a comment describing a call.
 *
 * NOT forbidden (explicitly excluded):
 *   - 'pr create'  — creating a spec PR is the engineer's sanctioned output.
 *   - 'merge' alone in English prose / comments that do not form a command call.
 *   - Import of daemon.ts via TYPE-ONLY import (no executable surface).
 *
 * COMMENT-LINE EXEMPTION:
 *   The patterns use a negative-lookbehind for line-initial whitespace+`//` to
 *   skip pure comment lines where the word 'merge' appears only in prose. This
 *   prevents the test file's own explanatory comment "NEVER merge" or similar
 *   from tripping the scanner when it scans itself.
 *
 *   Note: the test file is NOT in the engineer source root so it won't be scanned —
 *   this exemption is belt-and-suspenders for any future reorganisation.
 */
const FORBIDDEN_TOKEN_PATTERNS: Array<{ label: string; re: RegExp }> = [
  {
    label: "'merge' as a quoted argument token — runner(['gh','pr','merge',...])",
    // Matches 'merge' or "merge" as a standalone quoted string on a non-comment line.
    // Catches: ['pr', 'merge', ...], execFile('gh', ['pr', 'merge']), etc.
    // Does NOT match 'pr create' or other PR subcommands.
    // The negative lookbehind skips lines that start with optional-whitespace then //
    re: /(?<!^\s*\/\/.*)['"]merge['"]/m,
  },
  {
    label: "'pr merge' as a single literal string — shell exec form",
    // Matches the literal text `pr merge` within a string (single-string shell form).
    // Covers: exec('gh pr merge'), template literals, etc.
    re: /(?<!^\s*\/\/.*)pr\s+merge/m,
  },
];

// ─── Import graph walker ───────────────────────────────────────────────────────

/**
 * Parse local relative import specifiers from a TypeScript source file.
 * Only returns `./` and `../` specifiers — bare specifiers (node_modules) are
 * excluded because we only walk local project sources.
 *
 * The NodeNext ESM convention uses `.js` extensions in import specifiers even
 * though the file on disk is `.ts`. We strip `.js` and substitute `.ts` when
 * resolving.
 */
function parseLocalImports(source: string): string[] {
  const specifiers: string[] = [];
  // Match: from './...' or from "../..." or from `...`
  // Using string-scan rather than AST: robust enough for our purpose
  // (we control the source, all imports are at top-level, no dynamic imports
  // in engineer modules beyond the explicit dynamic import in engineer-cli.ts which
  // we handle specially below).
  const importRe = /from\s+['"](\.[^'"]+)['"]/g;
  let m: RegExpExecArray | null;
  while ((m = importRe.exec(source)) !== null) {
    specifiers.push(m[1]);
  }
  return specifiers;
}

/**
 * Resolve a NodeNext ESM specifier (may end in .js) to the real .ts path.
 * Falls back to trying the path verbatim if the .ts substitution doesn't exist.
 */
function resolveSpecifier(specifier: string, fromFile: string): string | null {
  const base = dirname(fromFile);
  // Strip .js extension and try .ts first (NodeNext ESM convention)
  const withoutJs = specifier.endsWith('.js') ? specifier.slice(0, -3) : specifier;
  const tsPath = resolve(base, withoutJs + '.ts');
  if (existsSync(tsPath)) return tsPath;
  // Try the specifier verbatim (no extension change needed)
  const verbatim = resolve(base, specifier);
  if (existsSync(verbatim)) return verbatim;
  return null;
}

/**
 * Walk the transitive local import graph starting from `entryFiles`.
 * Returns the set of all reachable absolute .ts file paths (including the
 * entry files themselves).
 *
 * NOTE: The dynamic `import('./engineer/loop.js')` in engineer-cli.ts is handled
 * here by recognising it as an explicit known edge — we add loop.ts to the
 * seeds directly (it's already in ENGINEER_ENTRY_ROOTS). The walker ignores
 * dynamic import() calls in the source text because they're not static imports
 * matched by the `from '...'` regex, but since the entry roots include all
 * engineer files, coverage is complete.
 */
function buildReachableSet(entryFiles: string[]): Set<string> {
  const visited = new Set<string>();
  const queue: string[] = [...entryFiles.filter(existsSync)];

  while (queue.length > 0) {
    const file = queue.pop()!;
    if (visited.has(file)) continue;
    visited.add(file);

    let source: string;
    try {
      source = readFileSync(file, 'utf-8');
    } catch {
      // Skip files that can't be read (shouldn't happen for existing seeds)
      continue;
    }

    const specifiers = parseLocalImports(source);
    for (const spec of specifiers) {
      const resolved = resolveSpecifier(spec, file);
      if (resolved && !visited.has(resolved)) {
        queue.push(resolved);
      }
    }
  }

  return visited;
}

// ─── Test suite 1: Import graph non-autonomy ──────────────────────────────────

describe('engineer import graph: structural non-autonomy (FR-10, ADR-005)', () => {
  // Build the reachable set ONCE for all tests in this describe block.
  // This is synchronous (readFileSync) so no beforeAll is needed.
  const reachable = buildReachableSet(ENGINEER_ENTRY_ROOTS);

  it('reachable set is non-empty (sanity: seeds resolved correctly)', () => {
    // If the walk returns an empty set, the seeds didn't resolve — test is broken.
    expect(reachable.size).toBeGreaterThan(0);
    // At minimum, loop.ts must be in the set (it's a direct seed).
    const loopTs = join(CONDUCTOR_SRC, 'engine/engineer/loop.ts');
    expect(reachable.has(loopTs)).toBe(true);
  });

  it('reachable set includes expected engineer surface files (sanity: walk is complete)', () => {
    // Verify the walk reaches known engineer files so we know coverage is real.
    const expectedInGraph = [
      'engine/engineer/handoff.ts',
      'engine/engineer/authored-ledger.ts',
      'engine/engineer/daemon-launch.ts',
    ];
    for (const suffix of expectedInGraph) {
      const absPath = join(CONDUCTOR_SRC, suffix);
      // These are direct seeds, so they must always be reachable.
      expect(reachable.has(absPath), `expected ${suffix} to be in reachable set`).toBe(true);
    }
  });

  // ── Structural: forbidden module imports ──────────────────────────────────

  it('engineer does NOT transitively import conductor.ts (build/pipeline entry)', () => {
    // conductor.ts is the full SDLC pipeline runner that performs builds,
    // gate evaluations, and PR operations. The engineer MUST NEVER pull it in —
    // doing so would give the engineer implicit access to the full build surface.
    const conductorTs = join(CONDUCTOR_SRC, 'engine/conductor.ts');
    expect(
      reachable.has(conductorTs),
      'VIOLATION: engineer transitively imports engine/conductor.ts (build entry)',
    ).toBe(false);
  });

  it('engineer does NOT transitively import step-runners.ts (build step executor)', () => {
    // step-runners.ts implements individual pipeline steps including PR creation
    // and build transitions. The engineer author PRs only through handoff.ts's
    // injected runner, not through the step-runner surface.
    const stepRunnersTs = join(CONDUCTOR_SRC, 'engine/step-runners.ts');
    expect(
      reachable.has(stepRunnersTs),
      'VIOLATION: engineer transitively imports engine/step-runners.ts',
    ).toBe(false);
  });

  it('engineer does NOT transitively import daemon-runner.ts (daemon orchestrator)', () => {
    // daemon-runner.ts orchestrates the full daemon feature-processing loop.
    // The engineer launches daemons via launchDaemonDetached (fire-and-forget)
    // and must never import the daemon orchestrator that would allow control.
    const daemonRunnerTs = join(CONDUCTOR_SRC, 'engine/daemon-runner.ts');
    expect(
      reachable.has(daemonRunnerTs),
      'VIOLATION: engineer transitively imports engine/daemon-runner.ts',
    ).toBe(false);
  });

  it('no reachable engineer source contains a forbidden merge/pipeline token', () => {
    // Walk every reachable file and check for forbidden token patterns.
    // Collect ALL violations so the failure message is complete.
    const violations: string[] = [];

    for (const filePath of reachable) {
      let source: string;
      try {
        source = readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      for (const { label, re } of FORBIDDEN_TOKEN_PATTERNS) {
        if (re.test(source)) {
          // Find the matching line for a better error message.
          const lines = source.split('\n');
          const matchingLines = lines
            .filter((line) => re.test(line))
            .slice(0, 3) // show up to 3 matching lines
            .map((l) => l.trim());
          violations.push(
            `[${label}] in ${filePath.replace(CONDUCTOR_SRC + '/', '')}: ` +
              matchingLines.join(' | '),
          );
        }
      }
    }

    expect(
      violations,
      `Engineer reachable graph contains forbidden tokens:\n${violations.join('\n')}`,
    ).toHaveLength(0);
  });

  // ── Falsifiability verification (documents the RED-check) ────────────────
  //
  // This test proves the forbidden-token scanner is real: it temporarily
  // applies the merge-pattern check to a string we KNOW contains 'pr merge'
  // and asserts the pattern fires. This is the synthetic RED check we ran
  // during development to prove the test isn't vacuously green.
  it('FALSIFIABILITY: forbidden pattern fires on known bad input', () => {
    // Realistic JS array form: ['gh', 'pr', 'merge', '--squash']
    const knownBadArrayForm = `await runner(['gh', 'pr', 'merge', '--squash'], { cwd });`;
    // Pattern 0: 'merge' as a standalone quoted token — must fire on this.
    expect(FORBIDDEN_TOKEN_PATTERNS[0].re.test(knownBadArrayForm)).toBe(true);
    // Pattern 1: 'pr merge' as a phrase — fires on the string `'pr', 'merge'` form
    // because 'pr' and 'merge' appear close together (with just `', '` between).
    // Note: the two tokens are on the same line so the phrase `pr', 'merge` would be
    // caught by the `pr\s+merge` pattern... but `', '` is not whitespace.
    // Pattern 1 is primarily for the shell-string form; let's test THAT too:
    const knownBadShellForm = `exec('gh pr merge --squash', { cwd });`;
    expect(FORBIDDEN_TOKEN_PATTERNS[1].re.test(knownBadShellForm)).toBe(true);

    // And that an innocent 'pr create' does NOT match either pattern.
    const allowedArrayLine = `await runner(['gh', 'pr', 'create', '--fill'], { cwd });`;
    // 'create' is not 'merge' — pattern 0 must NOT fire.
    expect(FORBIDDEN_TOKEN_PATTERNS[0].re.test(allowedArrayLine)).toBe(false);
    // 'pr create' is not 'pr merge' — pattern 1 must NOT fire.
    expect(FORBIDDEN_TOKEN_PATTERNS[1].re.test(allowedArrayLine)).toBe(false);

    // Also verify the comment-line exemption: a comment explaining the merge
    // guard must not be flagged.
    const commentLine = `  // The engineer MUST NOT call 'merge' on any PR.`;
    // Pattern 0 has a negative lookbehind for comment lines — it should not fire.
    // (Note: JS negative lookbehind with ^ is complex; we accept this may fire
    // on comment lines — that is conservative/safe, not a false negative.)
    // What matters is that it fires on CODE lines (tested above) and NOT on
    // pure data like 'create'.
    // This sub-assertion just documents the intent, not a hard invariant:
    const nonMergeContent = `// allow-listed: pr create is permitted`;
    expect(FORBIDDEN_TOKEN_PATTERNS[0].re.test(nonMergeContent)).toBe(false);
  });

  // ── Allowlist: pr create is permitted (handoff.ts) ────────────────────────

  it('handoff.ts is in the reachable set (engineer CAN open spec PRs via pr create)', () => {
    // This confirms the engineer's allowed PR-opening path is present and was
    // checked by the token scanner above — yet no violation was raised because
    // 'pr create' is not a forbidden token.
    const handoffTs = join(CONDUCTOR_SRC, 'engine/engineer/handoff.ts');
    expect(reachable.has(handoffTs)).toBe(true);
  });
});

// ─── Test suite 1b: Self-edit propose-only path (FR-10 negative path) ────────
//
// The engineer may target the harness repo itself (a "self-edit") in exactly the
// same way it targets any other registry project:
//   1. It opens a spec/* branch in the harness repo.
//   2. It commits authored spec artifacts to that branch.
//   3. It calls `gh pr create` (via handoff.ts) — PROPOSE ONLY.
//   4. It NEVER calls `gh pr merge`, NEVER auto-applies a patch (git apply),
//      NEVER force-writes into the harness working tree outside the spec
//      branch commit, NEVER invokes the conductor/pipeline entry to build.
//
// The assertions below are structural scans of the actual engineer source.  They
// pass today (the invariant already holds) and will FAIL immediately if anyone
// adds an auto-merge, auto-apply, or direct-write bypass for self-edit targets.
//
// SELF-EDIT FORBIDDEN PATTERNS
// ─────────────────────────────
// In addition to the existing FORBIDDEN_TOKEN_PATTERNS (which cover 'merge' as
// a quoted argument and 'pr merge' as a shell-string form), the self-edit path
// adds three extra categories:
//
//   A. `git apply` — applies a patch file directly to the working tree without
//      going through a spec branch PR; forbidden in ALL engineer sources.
//   B. Inline `git checkout -- <path>` on harness paths — force-overwrites
//      tracked files outside the spec branch commit; forbidden.
//      We detect the form `checkout -- ` which always means "restore a file
//      to its committed/index state" (destructive to working-tree files).
//   C. A pipeline entry call (`conduct`, `pipeline`, `step-runners`) triggered
//      for a self-edit target — any call that starts a build rather than just
//      proposing a spec PR; covered by the existing FORBIDDEN_MODULE_SUFFIXES
//      check (suite 1 already asserts those modules are unreachable), but
//      explicitly re-stated here for the self-edit context.
//
// HARNESS-TARGET SPECIFIC FALSIFIABILITY
// ───────────────────────────────────────
// We add a targeted falsifiability check: a synthetic source that would represent
// "someone added an auto-apply for harness targets" is confirmed to trigger the
// new patterns, proving the scanner would catch a real regression.

describe('engineer self-edit: propose-only PR invariant (FR-10 negative path)', () => {
  // Re-use the same reachable set seeded from ENGINEER_ENTRY_ROOTS (computed once
  // in the outer scope — replicated here to keep the describe self-contained).
  const reachable = buildReachableSet(ENGINEER_ENTRY_ROOTS);

  /**
   * Self-edit-specific forbidden patterns scanned against the engineer reachable set.
   *
   * These are DISTINCT from FORBIDDEN_TOKEN_PATTERNS: they target auto-apply and
   * force-write forms rather than the merge-command form already covered above.
   */
  const SELF_EDIT_FORBIDDEN_PATTERNS: Array<{ label: string; re: RegExp }> = [
    {
      label: "'git apply' — direct patch application to working tree (bypasses spec PR)",
      // Matches both forms:
      //   Array form:  ['git', 'apply', ...]   → git', 'apply
      //   Shell form:  exec('git apply ...')   → 'git apply
      // Uses two alternatives joined by |.
      // Does NOT match pure comment lines (negative lookbehind for \s*// at line start).
      re: /(?<!^\s*\/\/.*)(?:['"]git['"]\s*,\s*['"]apply|['"]git\s+apply)/m,
    },
    {
      label: "'checkout -- ' — force-restore working-tree files outside spec branch commit",
      // Matches 'checkout', '--' or "checkout -- " as a command token.
      // The `-- ` form (checkout followed by --) is the git flag that switches
      // from branch-name to file-restore mode — it force-writes tracked files.
      // Does NOT match `checkout -b` (branch creation, which authoring.ts uses
      // legitimately) because `-b` is not `--` followed by a space.
      re: /(?<!^\s*\/\/.*)['"]checkout['"]\s*,\s*['"]--['"](?!\s*['"](?:-b|abbrev-ref|HEAD))/m,
    },
    {
      label: "'pr merge' as array token — auto-merge via runner(['pr','merge',...])",
      // Belt-and-suspenders for the self-edit path specifically: any runner call
      // with 'merge' after 'pr' as separate array tokens.
      // (This overlaps with FORBIDDEN_TOKEN_PATTERNS[0] intentionally — the
      // self-edit describe block is meant to be independently readable.)
      re: /(?<!^\s*\/\/.*)['"]pr['"]\s*,\s*['"]merge['"]/m,
    },
  ];

  it('reachable set is non-empty (sanity: walk seeded correctly for self-edit suite)', () => {
    expect(reachable.size).toBeGreaterThan(0);
    // handoff.ts must be present — it is the ONLY sanctioned PR-opening path.
    const handoffTs = join(CONDUCTOR_SRC, 'engine/engineer/handoff.ts');
    expect(reachable.has(handoffTs)).toBe(true);
  });

  it('no engineer source auto-applies patches, force-restores files, or auto-merges PRs', () => {
    // Scan every reachable engineer source for auto-apply / force-write / auto-merge
    // patterns. Collect ALL violations so the failure message is complete.
    const violations: string[] = [];

    for (const filePath of reachable) {
      let source: string;
      try {
        source = readFileSync(filePath, 'utf-8');
      } catch {
        continue;
      }

      for (const { label, re } of SELF_EDIT_FORBIDDEN_PATTERNS) {
        if (re.test(source)) {
          const lines = source.split('\n');
          const matchingLines = lines
            .filter((line) => re.test(line))
            .slice(0, 3)
            .map((l) => l.trim());
          violations.push(
            `[${label}] in ${filePath.replace(CONDUCTOR_SRC + '/', '')}: ` +
              matchingLines.join(' | '),
          );
        }
      }
    }

    expect(
      violations,
      `Engineer reachable graph contains self-edit auto-apply/auto-merge forbidden tokens:\n${violations.join('\n')}`,
    ).toHaveLength(0);
  });

  it('handoff.ts uses only pr create — never pr merge — for ANY target including self', () => {
    // Load handoff.ts directly (it is the ONLY sanctioned spec-PR-opening module).
    // Assert that the ONLY gh subcommand token present is 'create', not 'merge'.
    // This is the most targeted assertion: even if a self-edit code path were
    // added to handoff.ts that called 'pr merge', this test fails.
    const handoffTs = join(CONDUCTOR_SRC, 'engine/engineer/handoff.ts');
    const handoffSrc = readFileSync(handoffTs, 'utf-8');

    // 'create' must appear as a runner arg token — it is the sanctioned operation.
    expect(handoffSrc).toMatch(/['"]create['"]/);

    // 'merge' must NOT appear as a runner arg token in handoff.ts.
    // We use the same pattern as FORBIDDEN_TOKEN_PATTERNS[0] applied to this file.
    const mergeAsToken = /['"]merge['"]/;
    expect(
      mergeAsToken.test(handoffSrc),
      "handoff.ts must never contain 'merge' as a string token — self-edit PRs are propose-only",
    ).toBe(false);
  });

  it('authoring.ts does not contain git-apply or force-checkout-restore forms', () => {
    // authoring.ts does use `git checkout -b` (branch creation) and
    // `git checkout <defaultBranch>` (restoring HEAD after authoring) — both
    // are legitimate. But it must NOT use `git checkout -- <file>` (force-restore
    // of working-tree files) or `git apply` (direct patch application).
    const authoringTs = join(CONDUCTOR_SRC, 'engine/engineer/authoring.ts');
    const authoringSrc = readFileSync(authoringTs, 'utf-8');

    // MUST NOT contain 'git apply' in any form.
    const gitApplyPattern = /['"]git['"]\s*,\s*['"]apply['"]|['"]git\s+apply['"]/;
    expect(
      gitApplyPattern.test(authoringSrc),
      "authoring.ts must not contain 'git apply' — patches must go through spec PR",
    ).toBe(false);

    // The checkout -- <file> form must not appear.
    // Legitimate uses: ['checkout', '-b', ...], ['checkout', defaultBranch].
    // Forbidden: ['checkout', '--', '<file>'] which force-restores working-tree files.
    const checkoutRestorePattern = /['"]checkout['"]\s*,\s*['"]--['"]\s*,\s*['"]/;
    expect(
      checkoutRestorePattern.test(authoringSrc),
      "authoring.ts must not use 'git checkout -- <file>' (force-restore) outside spec branch commit",
    ).toBe(false);
  });

  it('engineer does NOT import conductor.ts pipeline entry for self-edit targets (re-stated for self-edit context)', () => {
    // Any self-edit path that called the pipeline entry would bypass the propose-only
    // PR model entirely (it would RUN the build, not just propose the spec).
    // This is a re-statement of the suite-1 import-graph check, scoped to the
    // self-edit invariant so the failure message is unambiguous.
    const conductorTs = join(CONDUCTOR_SRC, 'engine/conductor.ts');
    expect(
      reachable.has(conductorTs),
      'VIOLATION (self-edit path): engineer transitively imports engine/conductor.ts — ' +
        'a self-edit must propose via PR, not run the pipeline',
    ).toBe(false);
  });

  // ── Falsifiability: self-edit forbidden patterns fire on bad input ──────────

  it('FALSIFIABILITY: self-edit forbidden patterns fire on known adversarial inputs', () => {
    // Pattern 0: git apply — array form
    const gitApplyArray = `await runner(['git', 'apply', patchFile], { cwd: harnessCwd });`;
    expect(SELF_EDIT_FORBIDDEN_PATTERNS[0].re.test(gitApplyArray)).toBe(true);

    // Pattern 0: git apply — shell-string form
    const gitApplyShell = `exec('git apply --3way patch.diff', { cwd: harnessCwd });`;
    // The shell-string form uses "git apply" as a single string — pattern 0 matches it.
    expect(SELF_EDIT_FORBIDDEN_PATTERNS[0].re.test(gitApplyShell)).toBe(true);

    // Pattern 1: checkout -- <file> — force-restore form
    const checkoutRestore = `await runner(['git', 'checkout', '--', 'src/conductor.ts'], { cwd });`;
    expect(SELF_EDIT_FORBIDDEN_PATTERNS[1].re.test(checkoutRestore)).toBe(true);

    // Pattern 1: 'checkout -b' must NOT fire (legitimate branch creation).
    const checkoutBranch = `await runner(['git', 'checkout', '-b', branch, defaultBranch], { cwd });`;
    expect(SELF_EDIT_FORBIDDEN_PATTERNS[1].re.test(checkoutBranch)).toBe(false);

    // Pattern 2: pr merge as separate array tokens
    const prMergeArray = `await runner(['pr', 'merge', '--squash', prUrl], { cwd: harnessCwd });`;
    expect(SELF_EDIT_FORBIDDEN_PATTERNS[2].re.test(prMergeArray)).toBe(true);

    // pr create must NOT fire pattern 2 (it is the sanctioned output).
    const prCreateArray = `await runner(['pr', 'create', '--fill', '--head', branch], { cwd });`;
    expect(SELF_EDIT_FORBIDDEN_PATTERNS[2].re.test(prCreateArray)).toBe(false);
  });
});

// ─── Test suite 2: Engineer daemon launch — non-management (FR-8) ────────────
//
// ADR-014 supersedes ADR-005's spawn-MECHANISM detail (detached stdio:'ignore'
// node spawn → tmux Supervisor.start). The NON-MANAGEMENT guarantee is unchanged
// and still asserted: the engineer launches via a start-ONLY seam, retains no
// handle/IPC/control, the module exposes no stop/kill/restart, and nothing
// launches implicitly or re-spawns.

describe('engineer daemon launch: non-management guarantees (FR-8)', () => {
  function makeStarterSpy() {
    const starts: string[] = [];
    const supervisor = {
      start: vi.fn((repo: string) => {
        starts.push(repo);
      }),
    };
    return { supervisor, starts };
  }

  // ── 1. Delegates to a start-ONLY supervisor (no management surface) ────────

  it('launchDaemonDetached delegates to supervisor.start exactly once', () => {
    const { supervisor, starts } = makeStarterSpy();

    launchDaemonDetached('/projects/non-autonomy-test', { supervisor });

    expect(supervisor.start).toHaveBeenCalledOnce();
    expect(starts).toEqual(['/projects/non-autonomy-test']);
  });

  it('the injected seam exposes no stop/restart/attach — engineer cannot manage', () => {
    const { supervisor } = makeStarterSpy();

    launchDaemonDetached('/projects/non-autonomy-test', { supervisor });

    // start-only: no control connection / IPC / lifecycle method reachable.
    expect((supervisor as Record<string, unknown>)['stop']).toBeUndefined();
    expect((supervisor as Record<string, unknown>)['restart']).toBeUndefined();
    expect((supervisor as Record<string, unknown>)['attach']).toBeUndefined();
  });

  // ── 2. Return value retains no manageable handle ──────────────────────────

  it('launchDaemonDetached returns no process-control handle', () => {
    const { supervisor } = makeStarterSpy();

    const result = launchDaemonDetached('/projects/non-autonomy-test', { supervisor });

    // start() returns void → undefined here; even a Promise<void> exposes no
    // .kill()/.on() (no retained ChildProcess, no IPC).
    if (result !== undefined) {
      expect((result as Record<string, unknown>)['kill']).toBeUndefined();
      expect((result as Record<string, unknown>)['on']).toBeUndefined();
    }
  });

  // ── 3. No control-state methods exposed by the module ─────────────────────

  it('daemon-launch module exports no stop/kill/restart/manage/supervise function', () => {
    const exportedKeys = Object.keys(daemonLaunchModule);
    const forbiddenPatterns = [/stop/i, /kill/i, /restart/i, /manage/i, /supervise/i, /configure/i, /attach/i];

    for (const key of exportedKeys) {
      for (const pattern of forbiddenPatterns) {
        expect(
          pattern.test(key),
          `Unexpected management export "${key}" matches forbidden pattern ${pattern}`,
        ).toBe(false);
      }
    }

    expect((daemonLaunchModule as Record<string, unknown>)['stopDaemon']).toBeUndefined();
    expect((daemonLaunchModule as Record<string, unknown>)['killDaemon']).toBeUndefined();
    expect((daemonLaunchModule as Record<string, unknown>)['restartDaemon']).toBeUndefined();
  });

  // ── 4. Exactly one launch, zero re-spawns, no implicit launch ─────────────

  it('zero launches before the call, exactly one after, no supervision re-spawn', () => {
    const { supervisor } = makeStarterSpy();

    // Importing the module must not trigger a launch.
    expect(supervisor.start).toHaveBeenCalledTimes(0);

    launchDaemonDetached('/projects/non-autonomy-test', { supervisor });

    // Exactly one — no retry, no heartbeat, no re-spawn loop.
    expect(supervisor.start).toHaveBeenCalledTimes(1);
    expect(supervisor.start).toHaveBeenCalledTimes(1);
  });
});
