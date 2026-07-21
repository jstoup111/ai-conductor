# Implementation Plan: Reused halt PR ships with halt boilerplate body and slug title; halt signal laundered

Stem: reused-halt-pr-ships-with-halt-boilerplate-body-an
Track: technical
Tier: S
Source: jstoup111/ai-conductor#632

## Goal

Make the finish-time rehabilitation of a reused halt PR complete and loud: the engine-authored halt
banner body ("This PR was opened automatically after an irrecoverable daemon HALT. …",
`build-failure-escalation.ts:155-160`) becomes (a) a third stateless halt signal, (b) the target of
a deterministic `bodyFloor` mechanic mirroring the existing `retitleFloor`, and (c) a facet the
finish completion gate fails on (fail-open on gh errors). Thread a `log` fn through the repair
callback so rehabilitation outcomes are visible. After this, a ship that reuses a halt PR produces
a PR with no halt boilerplate: `## Summary` + feature description, a deterministic test-evidence
line, exactly one `Closes #N`, no `needs-remediation` label/marker, not draft — the #610 residue
class (previously #231, #249, #444, #575) cannot recur silently.

## Files

- `src/conductor/src/engine/pr-labels.ts` — Task 1. Export the shared banner constant.
- `src/conductor/src/engine/build-failure-escalation.ts` — Task 1. Compose the halt PR body from
  the shared constant (no behavior change).
- `src/conductor/src/engine/halt-pr-rehabilitation.ts` — Tasks 1, 2. Banner-aware detection;
  new `bodyFloor` + `readStaleHaltBanner`.
- `src/conductor/src/engine/conductor.ts` — Task 3. Repair callback: thread `log`, derive the
  test-evidence line, call `bodyFloor`.
- `src/conductor/src/engine/artifacts.ts` — Task 4. Completion-gate body check beside the existing
  stale-title check.
- `src/conductor/test/engine/halt-pr-rehabilitation.test.ts` — Tasks 1, 2 tests.
- `src/conductor/test/engine/artifacts.test.ts` — Task 4 tests.
- `CHANGELOG.md` — Task 5.

## Non-goals

- **No rich engine-composed body.** The floor guarantees a truthful minimal implementation-PR body;
  narrative summary/test prose remains the /finish//pr skill's job (ADR 2026-07-03 Decision 1
  stands — this extends the Decision 2 mechanics floor exactly as the #499 spec's `retitleFloor`
  did). No ADR amendment: engine body mutation is already precedented in this module
  (`cleanupHaltPresentation` edits the body to remove the marker).
- **No change to `escalateBuildFailure` behavior, the halt comment thread, or the reconciliation
  sweep** (`halt-pr-reconciliation.ts`) — the sweep keys on the body *marker* and never invokes the
  floor; in-remediation halt PRs keep their halt presentation (Story 3).
- **No change to the `mergeable` machinery.** #610 was correctly enrolled in
  `.daemon/mergeable-watch.jsonl`; the label lands when CI greens (mergeable-sweep FR-10). Removing
  `needs-remediation` (already done today) is what un-suppresses it (FR-12).
- **No new state or config.** Detection stays stateless per ADR 2026-07-03 Decision 4 — the banner
  text is observable PR state.
- **No CHANGELOG Migration block.** No `bin/conduct` CLI, `settings.json` schema, hook wiring, or
  skill symlink surface change — non-breaking PATCH; plain `### Fixed` entry.
- **Do not modify PR #610 itself** in this feature's tests or tasks — it is evidence.

## Task Dependency Graph

```
Task 1 (shared banner constant + banner-aware detection)
   ├─> Task 2 (bodyFloor + readStaleHaltBanner)          [depends on Task 1]
   │      ├─> Task 3 (repair callback wiring + log)      [depends on Task 2]
   │      └─> Task 4 (completion-gate body check)        [depends on Task 2]
Task 5 (CHANGELOG + validate)                            [depends on Tasks 1-4]
```

## Tasks

### Task 1: Shared banner constant; banner is a third stateless halt signal

In `src/conductor/src/engine/pr-labels.ts`, beside `NEEDS_REMEDIATION_BODY_MARKER` (line ~512),
export:

```ts
/** First line of the engine-authored halt PR body (build-failure-escalation.ts). Stable
 *  sentinel: its presence in a PR body is a stateless halt signal (issue #632). */
export const HALT_PR_BANNER_SENTINEL =
  'This PR was opened automatically after an irrecoverable daemon HALT.';
export const HALT_PR_BANNER_LINES = [
  HALT_PR_BANNER_SENTINEL,
  'Manual remediation is required to unblock this feature.',
  'See the comment below for the failure reason.',
] as const;
```

In `build-failure-escalation.ts:155-160`, compose the `body` from these constants (byte-identical
output — assert in an existing escalation test if one snapshots the body). In
`halt-pr-rehabilitation.ts`, extend detection in `rehabilitateHaltPr` (line ~89-91) to:

```ts
const hasHaltBanner = (view.body ?? '').includes(HALT_PR_BANNER_SENTINEL);
if (!hasHaltTitle && !hasHaltLabel && !hasHaltBanner) return 'not-halt-pr';
```

Update the module doc comment (Decision 4 note) to name the banner as the third stateless signal.
Tests (`halt-pr-rehabilitation.test.ts`): a PR with clean title, no labels, banner body (the exact
#610 shape) is NOT `'not-halt-pr'`; a PR with no signals at all still returns `'not-halt-pr'` with
zero mutation calls recorded on the fake `GhRunner`.

Dependencies: none. Files: `pr-labels.ts`, `build-failure-escalation.ts`,
`halt-pr-rehabilitation.ts`, `halt-pr-rehabilitation.test.ts`.
Estimated: 5 min.

### Task 2: `bodyFloor` and `readStaleHaltBanner` in halt-pr-rehabilitation.ts

Mirror `retitleFloor` (same warn-only, verify-after-write shape as `ensureShipReady`):

```ts
export async function bodyFloor(
  gh: GhRunner, cwd: string, prUrl: string,
  opts: { featureDesc?: string; sourceRef?: string | null; testEvidenceLine?: string } = {},
  log?: (msg: string) => void, sleep = defaultSleep,
): Promise<'not-halt-body' | 'floored' | 'partial'>
```

Behavior:
- Read body (`gh pr view --json body`); if it does not contain `HALT_PR_BANNER_SENTINEL`, return
  `'not-halt-body'` with zero edits (Story 1 fresh-PR negative path).
- Remove every line matching one of `HALT_PR_BANNER_LINES` (and collapse the resulting blank-line
  runs). Preserve all other content byte-for-byte — including an existing `Closes` line and any
  skill-authored sections (Story 1 residue negative path).
- If the remaining body has no `## Summary` heading, prepend the floor block:
  `## Summary\n\n<featureDesc>\n\n_Rehabilitated from a reused needs-remediation halt PR; halt
  history is preserved in the PR comments._` plus, when `testEvidenceLine` is provided,
  `\n\n## Test evidence\n\n- [x] <testEvidenceLine>`.
- Write with `gh pr edit <url> --body <newBody>`, re-read to verify the sentinel is gone; bounded
  retries (3, backoff ×100ms like `ensureShipReady`); `'partial'` on exhaustion or read failure —
  never throw. `Closes` remains `injectIssueRef`'s job (already idempotent); pass `sourceRef`
  through only for the caller's convenience, do not duplicate injection here.

Also add `readStaleHaltBanner(gh, cwd, prUrl, log?)`: exact analog of `readStaleHaltTitle`
(line ~170-184) — returns the sentinel string when a SUCCESSFUL read shows it in the body, null on
clean body AND on any gh error (fail-open).

Tests: floor happy path (banner-only body → floored, `## Summary` + feature desc + test-evidence
line present, sentinel absent, verified by the fake's stored body); residue path (skill `## Summary`
above banner → banner lines removed, existing content preserved, no second `## Summary`); fresh body
→ `'not-halt-body'`, zero `pr edit` calls; edit always failing → `'partial'` after 3 attempts, no
throw; `readStaleHaltBanner` returns sentinel / null / null-on-error.

Dependencies: Task 1. Files: `halt-pr-rehabilitation.ts`, `halt-pr-rehabilitation.test.ts`.
Estimated: 10 min.

### Task 3: Wire the repair callback — bodyFloor + log threading

In `conductor.ts` `repairFinishPr` (lines 639-673):

- Create `const repairLog = (msg: string) => this.log?.(msg) ?? console.warn(msg);` (use the
  conductor's existing daemon log channel — whatever `this` exposes for `[daemon]` lines; match how
  neighboring code logs).
- Pass `log: repairLog` into `rehabilitateHaltPr` (today `conductor.ts:647-652` passes none —
  Story 4) and into `retitleFloor` / `ensureShipReady` (both already accept a log parameter).
- After the `retitleFloor` step and before `ensureShipReady`, add Step 3 `bodyFloor(gh, cwd, prUrl,
  { featureDesc, sourceRef, testEvidenceLine }, repairLog)` in its own warn-only try/catch,
  renumbering the comment for `ensureShipReady` to Step 4.
- Derive `testEvidenceLine` best-effort before the callback returns it: read
  `.pipeline/task-status.json` under `this.projectRoot` (reuse the existing task-status reader if
  one is importable in this scope; otherwise a local `readFile` + `JSON.parse` in try/catch);
  when readable, `"${completed}/${total} plan tasks completed with evidence-gated commits"`;
  on any error leave `testEvidenceLine` undefined (floor omits the section).

Tests: extend the existing repair-callback coverage (wherever `repairFinishPr` composition is
tested — the #499 spec's tests in `conductor` test files; if the callback is only integration-
covered, add a unit test at the halt-pr-rehabilitation level for the floor ordering contract
instead and assert via the fake GhRunner call sequence: view → label/marker cleanup → title edit →
body edit → ready).

Dependencies: Task 2. Files: `conductor.ts` (+ the file its repair tests live in).
Estimated: 8 min.

### Task 4: Completion gate fails while the banner is in the recorded PR's body

In `artifacts.ts`, directly after the stale-title block (lines 1259-1277), add a parallel
fail-open block:

```ts
try {
  const ghRunner = ctx.gh ?? makeProductionGh();
  const staleBanner = await readStaleHaltBanner(ghRunner, dir, prUrl);
  if (staleBanner !== null) {
    return {
      done: false,
      reason: `recorded PR ${prUrl} body still carries the halt banner ("${staleBanner}") — ` +
        `the engine bodyFloor/finish skill must rewrite the reused halt PR's body before completing`,
      missing: 'other',
    };
  }
} catch { /* fail-open — presentation never blocks a ship on gh failure */ }
```

Tests (`artifacts.test.ts`, beside the existing stale-title gate cases): banner body → `done:false`
with a reason naming the PR URL and the banner (Story 2 happy); gh read throwing → gate passes
(fail-open, Story 2 negative); clean body → passes with no extra mutations (view-only calls on the
fake).

Dependencies: Task 2. Files: `artifacts.ts`, `artifacts.test.ts`.
Estimated: 7 min.

### Task 5: CHANGELOG entry and validate

Add under `## [Unreleased]` → `### Fixed` in `CHANGELOG.md`:
"Finish no longer ships a reused needs-remediation halt PR with the halt boilerplate body: the
engine-authored banner is now a stateless halt signal, a deterministic `bodyFloor` (mirroring the
retitle floor) replaces it with an implementation-PR body (summary, test-evidence line, halt
history preserved in comments), the finish completion gate fails while the banner remains
(fail-open on gh errors), and repair outcomes are logged (`[halt-pr-rehab]`) instead of silent
(ai-conductor#632; specimen PR #610)."

Then validate, fixing any failure before completing:
- from `src/conductor`: `npx vitest run test/engine/halt-pr-rehabilitation.test.ts
  test/engine/artifacts.test.ts test/engine/halt-pr-reconciliation.test.ts` (reconciliation suite
  proves Story 3 unchanged; correct cwd per the vitest-cwd trap; verify via exit code, not piped
  tail);
- `test/test_harness_integrity.sh` from the repo root.

Dependencies: Tasks 1-4. Files: `CHANGELOG.md`.
Estimated: 5 min.

## Verification

- `halt-pr-rehabilitation.test.ts`: the exact #610 shape (clean `feat:` title, no labels, no
  marker, banner body) is detected and floored; fresh PR → zero mutations; residue body loses only
  banner lines; floor failure → `'partial'`, never throws; `readStaleHaltBanner` fail-open.
- `artifacts.test.ts`: gate fails with a facet-naming reason on banner body; passes on clean body;
  passes on gh error.
- `halt-pr-reconciliation.test.ts` still green with zero edits (Story 3).
- Acceptance restatement of the specimen: given a PR in #610's post-ship state, one finish repair
  pass yields a body with `## Summary`, no banner line, one `Closes` ref — observably the #605
  implementation-PR shape (title floor + label/draft/marker handling already covered by existing
  machinery/tests).
- `test/test_harness_integrity.sh` passes; `CHANGELOG.md` has the `## [Unreleased]` Fixed entry.

## Coverage Mapping

| Story / Scenario | Task(s) | Test / Evidence |
|---|---|---|
| Story 1 — banner is a stateless halt signal; body floored at finish | 1, 2, 3 | rehab tests: #610-shape detected + floored; call-order contract |
| Story 1 — fresh implementation PR untouched | 1, 2 | rehab tests: no-signal PR → `'not-halt-pr'`/`'not-halt-body'`, zero edit calls |
| Story 1 — residue body loses only the banner | 2 | rehab tests: skill content preserved, no duplicate `## Summary` |
| Story 2 — gate fails while banner remains, naming the facet | 4 | artifacts tests: `done:false` + reason names URL/banner |
| Story 2 — gh outage fail-open; clean body passes | 4 | artifacts tests: throwing/clean GhRunner cases |
| Story 3 — in-remediation halt PR keeps halt presentation | 5 | `halt-pr-reconciliation.test.ts` unchanged and green |
| Story 4 — repair outcomes logged | 3 | callback threads `log`; assert `[halt-pr-rehab]` lines via injected log fn |
| Release gate | 5 | CHANGELOG Fixed entry; integrity suite green |
