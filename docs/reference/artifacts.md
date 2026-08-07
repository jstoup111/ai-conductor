---
title: Artifacts and state files
parent: Reference
nav_order: 1
---

# Artifacts and state files

Every file the harness writes, file by file: what creates it, what reads it, whether it is committed,
and what breaks if it disappears. For operators diagnosing a stuck feature and for contributors adding a
step or gate. The reasoning behind the design is in [evidence model](../explanation/evidence-model.md).

## The four trees

| Tree | Contents | Committed | Scope |
| --- | --- | --- | --- |
| `.docs/` | artifacts — the durable spec record | yes | repo |
| `.pipeline/` | state — one run's working evidence | no (`.gitignore`) | one worktree |
| `.daemon/` | daemon-scoped state | no (`.gitignore`) | the main checkout |
| `.worktrees/` | build and spec worktrees | no (`.gitignore`) | repo |

`.memory/` and `.memory*.bak/` are also gitignored siblings. The `.pipeline/`, `.daemon/`, and
`.worktrees/` patterns are unanchored, so they match nested copies such as `src/conductor/.pipeline/`.

`.worktrees/` is the only worktree creation target. `.claude/worktrees/` is a legacy convention the
engine reads (resume probe) and excludes (self-host fingerprint) but never writes.

> **Known limitation.** Removing a worktree directory destroys its `.pipeline/`, including
> `task-status.json` and the `task-evidence.json` sidecar. The branch survives, so already-committed work
> is safe. Reconstructible run state — `task-status.json`, the session hooks, the git hooks — is rebuilt
> mechanically at the next build entry, and completions proven by `Task:` trailers are restored with it
> (see [Reconstruction](#reconstruction-what-self-heals-and-what-must-not)). Everything else, including
> `conduct-state.json` and every gate verdict, is genuinely gone. Park the feature before touching its
> git state, and recover the rest rather than letting the build redo finished tasks — see
> [worktree and evidence recovery](../runbooks/worktree-and-evidence-recovery.md). Tracked in
> [#497](https://github.com/jstoup111/ai-conductor/issues/497).

## `.docs/` — committed artifacts

Nineteen entries. Alphabetized; the four with no code reference are marked.

| Entry | Naming | Written by | Read by / gate role |
| --- | --- | --- | --- |
| `architecture/` | `YYYY-MM-DD-<topic>.md`, plus fixed `system-context.md`, `containers.md`, `components.md`, `erd.md`, and a `sequences/` subdir | `architecture-diagram`, `architecture-review`, `bootstrap` | `architecture_diagram` completion glob; mermaid render check at land; protected-artifact seal |
| `audit/` | free-form | manual | **no code reference** |
| `audits/` | free-form JSON | a one-off backfill | `shipment-audit.ts` — one hardcoded path, nothing else |
| `coherence/` | `<plan-stem>.md` | `coherence-check` skill (M and L tiers only) | `coherence_check` completion glob; the land-time coherence validator |
| `coherence-waivers/` | `<plan-stem>.md` | operator, hand-authored | the land-time coherence waiver check. The directory appears when the first waiver is committed — see below |
| `complexity/` | `<slug>.md`, with an [undated-stem fallback](#the-undated-stem-fallback) | `complexity` step, engineer loop | `parseComplexityTier` reads a `Tier: <S\|M\|L>` line. Missing ⇒ the daemon defaults to `M`; other paths differ — see [where the tier comes from](steps.md#where-the-tier-comes-from). The land gate enforces tier agreement |
| `conflicts/` | `YYYY-MM-DD-<slug>.md` | `conflict-check` skill | `conflict_check` completion glob |
| `decisions/` | `adr-<topic>.md`, `adr-YYYY-MM-DD-<topic>.md`, `NNN-<topic>.md`, `architecture-review-*.md`, `technical-assessment-*.md` | `architecture-review`, `assess`, `bootstrap`, `prd`, `simplify`, `debugging`, `finish` | `architecture_review` and `assess` completion globs; the land gate scans every `adr-*.md` for draft status |
| `intake/` | `<plan-stem>.md` | `intake` skill | `parseIntakeSourceRef` reads `Source-Ref: owner/repo#N`; `Owner: <id>` drives the daemon owner gate |
| `manual-test-results.md` | loose file | legacy | **no code reference** — superseded by `.pipeline/manual-test-results.md` |
| `observation/` | free-form | manual | **no code reference** |
| `phase7-daemon-validation.md` | loose file | manual | **no code reference** |
| `plans/` | `YYYY-MM-DD-<slug>.md` — the stem is the canonical feature key | `plan` skill; the engineer loop writes `.docs/plans/<slug>.md` at land | `plan` completion glob; seeds `.pipeline/task-status.json`; the build predicate parses `### Task <id>` headings; protected-artifact seal |
| `release-waivers/` | `<plan-stem>.md` | operator, hand-authored in the same diff | the self-host release gate. Also the only `.docs` prefix always writable during BUILD |
| `retired/` | `<plan-stem>.md`, plus `README.md` recording why each was retired | operator, hand-authored | **no code reference** — a plan moved here leaves the backlog scan's non-recursive `.docs/plans` listing, retiring work whose intent another feature already delivered. See [`.docs/retired/README.md`](../../.docs/retired/README.md) |
| `retros/` | `YYYY-MM-DD-<feature-name>.md` | `retro` skill | `retro` completion glob, resolved by slug or by mtime at or after session start |
| `shipped/` | `<plan-stem>.md` | `conduct-ts shipped-record` | daemon backlog dedup; the only input to `conduct-ts kpi` |
| `specs/` | `YYYY-MM-DD-<slug>.md` | `prd` skill (product track only) | `prd` completion glob; protected-artifact seal |
| `stories/` | `YYYY-MM-DD-<slug>.md`, plus `epics/` and `features/<name>/` subdirs | `stories` skill | `stories` completion glob; plan-coverage check; coherence rows; protected-artifact seal |
| `track/` | `<slug>.md`, with an [undated-stem fallback](#the-undated-stem-fallback) | `explore` skill | `parseTrack` reads a `Track: product\|technical` line. Missing ⇒ defaults to `product`. Decides whether `prd` and `prd_audit` run |

Every entry above is committed.

`.docs/coherence-waivers/` is the one entry you may not find on disk. Git does not track empty
directories, so the directory appears the first time a waiver is committed — nothing pre-creates it, and
its absence is not a defect. The mechanism behind it is live: the land-time coherence gate calls
`evaluateCoherenceWaiver` (`src/conductor/src/engine/engineer/coherence-waiver.ts`, invoked from
`coherence-validator.ts`) on every run that reports gaps, and blocks unless a fresh, well-formed waiver
covers every gap id. Write the first one as a plain file at `.docs/coherence-waivers/<plan-stem>.md`.

### Naming

Artifacts are keyed by the **plan stem**: the plan file's basename with only a trailing `.md` stripped.
Interior dots survive, so `.docs/plans/phase-9.3b-intake.md` has the stem `phase-9.3b-intake`. That stem
is the shared key across the daemon backlog, the interactive conduct path, and the land gate — and the
filename of the matching `complexity/`, `track/`, `intake/`, `coherence/`, and `shipped/` entries.

#### The undated-stem fallback

Exactly two entries get a relaxed second lookup, and only in the daemon's backlog discovery:
`complexity/` and `track/`. When `<stem>.md` is absent and the stem carries a leading `YYYY-MM-DD-`
date, the daemon retries under the date-stripped stem — but only when exactly one plan maps to that
undated base. Two plans sharing one undated base refuse the fallback rather than guess between features.

The exact stem always wins. A marker that resolves to nothing after both attempts logs the paths it
tried to `daemon.log`, once per slug, before the daemon applies its default — so the miss is visible in
the log rather than hours later as gate behavior. The relaxed stem is a lookup key only; it never keys
state, and no other artifact gets it.

### Waiver grammar

Both waiver kinds share one two-line idiom:

```markdown
Waives: <comma-separated names>

Rationale: <non-empty prose>
```

A release waiver's names must be drawn from exactly four canonical breaking surfaces: `bin/conduct CLI`,
`skill symlink targets`, `hook wiring`, `settings.json schema`. A coherence waiver's names must be gap
ids the validator reported for *this* change set. Both are fail-closed on freshness: the waiver must
appear as an added or modified file in the `base...HEAD` diff, so a waiver merged by a prior feature can
never satisfy a later one. See [releases](../contributing/releases.md) and
[gates](../explanation/gates.md).

### Write guards

Two independent mechanisms protect `.docs/` during a run.

**Phase write-guard.** While a BUILD or SHIP step is dispatched, the engine stamps
`.pipeline/phase-active` with `allow: <prefix>` lines and `docs-guard.sh` default-denies every other
`.docs/` write. The allowlist is `.docs/release-waivers/` always, plus `.docs/retros/` and
`.docs/stories/` during the `retro` step.

**Protected-artifact seal.** `.pipeline/protected-artifact-seal.json` fingerprints every file under
`.docs/architecture`, `.docs/plans`, `.docs/specs`, and `.docs/stories` against a baseline commit:

```ts
interface ProtectedArtifactSeal {
  version: 2;
  baselineCommit: string;
  protectedArtifacts: { path: string; fingerprint: string }[];
  rebaselines: {
    fromCommit: string;
    toCommit: string;
    trigger: string;
    paths: string[];
  }[];
}
```

The seal is written at first BUILD entry. BUILD and SHIP agents cannot replace its baseline, but the
engine rebaselines it after a proven history rewrite. A clean engine rebase rotates it after
post-rebase evidence translation. Verification also rotates a seal stranded by an earlier rebase
when its baseline is no longer an ancestor of `HEAD`. Both paths require every changed workspace
artifact to equal the blob at `HEAD` and every `HEAD` blob to equal the base-branch tip. The engine
records each rotation in `rebaselines` and logs the trigger, old and new commits, and paths.

An accepted-artifact correction belongs to DECIDE, before that first BUILD entry. DECIDE writes the
additive note beside the original assertion:

```markdown
> **Amended YYYY-MM-DD by #NNN:** <what the assertion now says, and why>
```

The original assertion remains present, and no separate amendment artifact is created. This places the
correction in the initial seal baseline. `conduct-ts plan-protected-targets <plan-path>` prevents a
plan from assigning the same mutation to BUILD, and the land gate independently refuses a violating
plan.

An operator-approved plan or architecture amendment committed after first BUILD leaves this
baseline stale by design. The amendment must be reviewed and then resealed through the engine-owned
rotation function before the feature is re-queued. The audited rotation records the old and new
commits, trigger, and reviewed paths; editing the JSON directly is never a valid reseal.

Verification also tolerates these cases without halting:

- **Own-feature amendment** — a changed artifact whose filename stem names the current feature
  (a date prefix on either side is ignored). The engine logs a warning naming each amended path;
  the mutation is not blocked, but `build_review`'s Scope rubric item judges the diff and fails
  it unless the approved plan justifies the change.
- **Base-branch inheritance** — a changed or newly appeared artifact whose current workspace content
  is byte-identical to that path as committed at the base branch tip (`origin/<base>`, falling back
  to the local `<base>`). This is the content the feature's own rebase brought in, and the base
  branch already vouches for it.
- **Branch-untouched inheritance** — the artifact no longer matches the base-branch tip (the base has
  moved again since this feature's last rebase), but this feature never changed the path relative to
  the base (`git diff <base>...HEAD -- <path>` is empty) and the workspace copy still exactly equals
  `HEAD`'s blob. The feature is simply behind an older revision it already carried forward untouched;
  this is neither a local amendment nor an uncommitted edit, so it is tolerated the same as base-branch
  inheritance.

Everything else still halts BUILD/SHIP before dispatch: any content the base branch does not vouch
for, any addition the base branch does not contain, and any deletion the base branch still retains.
Tolerance requires the base branch name and seal baseline to be resolvable — when either is not,
the seal remains fully protected, and the halt reason is `Protected artifact provenance
undeterminable: <path>` followed by the specific cause (`Missing base ref`, `No merge-base exists
between HEAD and <base>`, or `Inheritance probe failed: git diff`) and the recovery step (supply the
base ref, or rebase onto the base branch to establish shared history). A genuine violation instead
reports either `Uncommitted protected artifact changed: <path>` (the workspace differs from `HEAD`;
restore from `HEAD`) or `Protected artifact changed: <path>` with a `Feature-authored committed
change` cause (revert to the committed DECIDE content and route any actual amendment to DECIDE). Do
not delete or hand-edit the seal to recover from a halt; follow the
[stalled-feature runbook](../runbooks/stalled-or-stuck-feature.md).

A seal rejection raised before a re-kick rebase is reported as `protected-artifact seal error`.
Because git has not started a rebase, its recovery procedure is review plus audited resealing—not
conflict resolution or `git rebase --continue`.

## Step to artifact map

`STEP_ARTIFACT_CONTRACTS` (`src/conductor/src/engine/artifacts.ts`) is the hand-authored source of
truth for which step produces which file, and the lifecycle scope each pattern belongs to.
`STEP_ARTIFACT_GLOBS` is a mechanically-derived compatibility projection — pattern strings only, no
scope — kept for callers that still need a plain glob list. Source-ordered; all 26 step names appear.

Every pattern declares one lifecycle scope:

- **`feature`** — the output belongs to the active plan/feature and must be associated with it before
  it counts. Scope is per-pattern, not per-step, so a step can pair a feature-primary report with a
  broader supplemental pattern (e.g. `architecture_review`'s ADR glob) without the second pattern
  being mislabeled feature-scoped.
- **`repository`** — the declared corpus intentionally applies to the whole checkout; no feature
  filtering is applied.
- **`run`** — stable worktree-local `.pipeline` evidence, where the step's existing freshness or
  custom predicate remains the sole authority.

| Step | Glob(s) | Scope |
| --- | --- | --- |
| `bootstrap` | *(none)* | — |
| `memory` | *(none)* | — |
| `assess` | `.docs/decisions/technical-assessment-*.md` | repository |
| `explore` | *(none — advisory and ephemeral)* | — |
| `prd` | `.docs/specs/*.md` | feature |
| `complexity` | *(none)* | — |
| `stories` | `.docs/stories/**/*.md` | feature |
| `conflict_check` | `.docs/conflicts/*.md` | feature |
| `plan` | `.docs/plans/*.md` | feature |
| `coherence_check` | `.docs/coherence/*.md` | feature |
| `architecture_diagram` | `.docs/architecture/*.md` | repository |
| `architecture_review` | `.docs/decisions/architecture-review-*.md` (feature), `.docs/decisions/adr-*.md` (repository) | mixed |
| `worktree` | *(none)* | — |
| `acceptance_specs` | 15 stack-convention test globs — `spec/acceptance/**/*`, `spec/requests/**/*`, `spec/system/**/*`, `test/acceptance/**/*`, `test/**/*`, `tests/**/*`, `__tests__/**/*`, and `*.{test,spec}.{js,ts,jsx,tsx}` — plus any `acceptance_spec_globs` the project declares | repository |
| `build` | `.pipeline/task-status.json` | run |
| `build_review` | `.pipeline/build-review.json` | run |
| `wiring_check` | `.pipeline/wiring-evidence.json` | run |
| `test_suite` | `.pipeline/test-suite-evidence.json` | run |
| `manual_test` | `.pipeline/manual-test-results.md` | run |
| `prd_audit` | `.pipeline/prd-audit.md` | run |
| `architecture_review_as_built` | `.pipeline/architecture-review-as-built.md` | run |
| `retro` | `.docs/retros/*.md` | feature |
| `rebase` | *(none — verdict computed from git state)* | — |
| `finish` | *(none)* | — |
| `remediate` | *(none — the engine reads `.pipeline/remediation.json` directly)* | — |
| `attribution_verify` | *(none — computed, not a file)* | — |

Totals: 9 steps write into `.docs/`, 7 write into `.pipeline/`, `acceptance_specs` matches project test
sources, and 9 produce no file artifact at all.

### Feature-scoped resolution

`resolveArtifactFiles(dir, step, context)` is what generic completion (`checkStepCompletion`), the
interactive artifact-review prompt, and dashboard status (`getArtifactStatus`, in both the terminal
and create renderers) actually call — never `findArtifactFiles` directly. For each `feature`-scoped
pattern it matches the raw glob, then narrows to the current feature by, in order: files in the
worktree's changed/untracked set, files whose name matches the active plan/feature identity under the
pattern's declared identity strategy (exact plan stem, or a normalized stem with date-prefix and
step-name-prefix stripping), and — only when exactly one candidate remains after those checks fail to
narrow it — a legacy singleton fallback. Several remaining candidates that cannot be associated with
the current feature resolve to an **ambiguous** diagnostic (`done: false` with a reason naming the
candidate count), never an alphabetical, newest-mtime, or first-match guess. `repository`- and
`run`-scoped patterns are returned as-is, with `run` patterns still gated by their own custom
completion predicate.

`findArtifactFiles` remains the low-level, policy-free pattern expander — the raw repository-wide
corpus for callers that explicitly want it, and the primitive `resolveArtifactFiles` builds on
internally. See `adr-2026-07-28-feature-aware-artifact-resolution` for the full design rationale.

The SHIP-tail verdict artifacts (`manual_test`, `prd_audit`, `architecture_review_as_built`,
`build_review`, `wiring_check`, `test_suite`) live in gitignored `.pipeline/` deliberately. They are
regenerated every run; committing them caused date-stamp sprawl, rebase and merge conflicts, and
dirty-tree HALTs at the finish-time rebase.

For step order, phase, tier-skip, and enforcement, see [steps](steps.md).

## `.pipeline/` — run state

One `.pipeline/` per worktree, at the worktree root. Gitignored wholesale, so nothing here survives a
worktree removal.

### Core state

| File | Shape | Writer | Lifecycle | If lost |
| --- | --- | --- | --- | --- |
| `conduct-state.json` | Backward-compatible `ConductState` formatted as 2-space JSON with a trailing newline; it includes per-step status plus `feature_desc`, `complexity_tier`, `track`, `bootstrap_mode`, `run_started_at`, `session_started_at`, `last_step`, `pr_url`, `worktree_dir`, `worktree_branch`, `feature_status`, and `artifact_approvals`. | `filesystem-conduct-state-store.ts` | Created on the first state mutation. Mutations and invariant batches run under a worktree-local lease and persist by atomic replacement; ordinary mutations preserve unowned and omitted fields. Full replacement is reserved for reset/start-over. Missing ⇒ `{}`; **empty or invalid ⇒ hard `corrupted` error**. A legacy `brainstorm` status is migrated forward onto `explore` + `prd` on every load | The feature restarts from step zero and every gate re-runs. `pr_url`, `worktree_branch`, and `session_started_at` are gone, so SHIP-tail freshness gates (which compare artifact mtimes to `session_started_at`) fail open |
| `task-evidence.json` | `{ evidenceStamps: Record<string, EvidenceStamp>, noEvidenceAttempts, noEvidenceReasons?, migrationGrandfather, lastResolvedCount? }`; each stamp is `{ sha, form, citedShas?, verdictAnchor?, testEvidence? }` with `form` ∈ `commit`, `trailer`, `evidence:satisfied-by`, `semantic-verified` | `task-evidence.ts` | Read-modify-write per gate evaluation, written atomically via a same-directory temp file plus `rename(2)`. Missing or corrupt ⇒ empty state, logged, never throws | `lastResolvedCount` reads 0, so the progress delta degrades to "no progress" rather than crashing the tick; the no-evidence retry budget resets; completed tasks may be re-attempted |
| `task-status.json` | `{ plan_ref?, tasks: [{ id, name?, status?, … }] }`. Duplicate rows merge by status rank: `completed`/`skipped` 3, `in_progress` 2, `pending` 1. A row restored from git evidence also carries `commit` and `restored_from: "task-trailer"` | `task-seed.ts::seedTaskStatus` | Re-seeded from the plan on **every** build-gate evaluation and at the build preflight. Written atomically (same-directory temp plus `rename(2)`) and re-read afterwards — a reconstruction that does not land throws rather than reporting success | Self-heals from the plan on the next evaluation, **with completions intact**: see reconstruction below |
| `engine-state.json` | `{ activePlanPath?: string, … }` | `task-seed.ts`, `conductor.ts` (atomic) | Written when the active plan is resolved | Resolution falls back to stem match, then to a single plan on disk. With several plans and no match it returns nothing and the build gate **fails closed** rather than guessing |
| `kickback-ledger.json` | `{ version: 1, gates: Record<gate, { count, treeHash, lastReason, priorVerdict, resolvedBefore }> }` | `kickback-ledger.ts` | Read-modify-write atomically (temp file + `rename(2)`) on every kickback-consuming gate check. A gate's `count` resets to 1 only when its tree hash or resolved-task count moved since the last entry; otherwise it survives daemon re-dispatch and increments toward `MAX_KICKBACKS_PER_GATE` (2). Cleared entirely on a fresh feature session | Missing, malformed, or version-mismatched ledgers fail open to an empty budget (never throw); a gate's cross-dispatch kickback count resets, so a HALT that should already have fired may take one more lap to trigger |
| `build-outcome.json` | `{ version: 1, records: BuildOutcomeRecord[] }`. Each record carries `outcome` (`moved`/`no-movement`), `terminalOutcome` (`done`/`failed`/`no-verdict`), the kicking-back `gate` (or `null`), the gate `verdict` at entry, the `rung` (`model`, `effort`) dispatched at, both movement witnesses (`treeBefore`/`treeAfter`, `headBefore`/`headAfter`), and an optional bounded `note` (the same last-200-lines tail `step_completed` carries) plus an inferred or agent-declared `category` (`disputes-gate`/`belongs-to-decide`/`silent-no-movement`) | `build-outcome.ts`, appended to at every build-step terminal outcome from `conductor.ts` | Read before every `wiring_check` kickback re-entry to `build`: when the latest record matches the pending cycle exactly on tree hash, gate, verdict, and rung, the conductor refuses to re-dispatch and halts instead of paying for an identical no-op turn (`sameNoOpCycle`) | Missing, corrupt, or version-mismatched sidecars fail open to an empty record set (never throw, never block dispatch); a lost sidecar just means one already-observed no-op cycle may be repeated once before the guard has evidence again |
| `build-dispute.json` | `{ category: 'disputes-gate' \| 'belongs-to-decide' \| 'silent-no-movement' }` | optional, hand- or agent-authored during a build step | `resolveBuildOutcomeCategory`, preferred over the note-text inference when present and well-formed | Absent, malformed, or shape-invalid content is ignored outright and the category is inferred from the build's note text instead — this artifact is never required for any behavior in the feature |

### Reconstruction: what self-heals and what must not

`.pipeline/` is gitignored and lives inside the worktree, so removing or recreating a worktree
destroys all of it. Run state therefore splits in two, and the engine treats the halves oppositely.

**Mechanically reconstructible — rebuilt at the point of use, never halted on.** Anything derivable
from the plan, from git, or from constants in the source:

| Artifact | Rebuilt from | Where |
| --- | --- | --- |
| `.pipeline/` itself | `mkdir -p` | `seedTaskStatus`, `writePhaseMarker` |
| `task-status.json` | The plan's `### Task <id>` headings, plus `Task: <id>` commit trailers on the branch for completion | `task-seed.ts::seedTaskStatus`, called from the build completion predicate and the build preflight |
| `session-hooks/*.sh` | Constants in `git-hook-assets.ts` | `worktree-prepare.ts::ensureSessionHooks`, called from the build preflight |
| `git-hooks/*` | The same constants | `worktree-prepare.ts` |
| `engine-state.json` | Plan-stem match, then a single plan on disk | `task-seed.ts` |
| `task-evidence.json` | Empty state; counters reset | `task-evidence.ts` |

When `task-status.json` is **missing, empty, or unparseable**, the re-seed treats it as a
reconstruction and restores every plan task carrying a `Task: <id>` trailer on a commit on the
branch as `status: "completed"`, stamped with that `commit` and `restored_from: "task-trailer"`.
Tasks with no such trailer stay `pending`. This grants no new authority — `resolveTaskIds` already
resolves those exact task ids from the same trailers for build-step routing
(adr-2026-07-23-trailer-union-build-step-routing), and `build_review`'s completeness rubric still
re-judges the real diff — it only stops a row-only reader from redoing finished, committed work. An
**existing** file with rows is never trailer-backfilled, so a row deliberately reverted to `pending`
stays that way.

Both reconstructions are **filesystem-authoritative**: after repairing, the engine re-reads the path
and halts if the repair itself could not land. A repair outcome is never evidence on its own.

**Irreplaceable — absence stays meaningful and is never fabricated.** Nothing below is created by
any repair path, because inventing one would let unearned work pass a gate or erase an operator's
decision:

`HALT`, `HALT.class`, `HALT.cleared`, `QUARANTINE`, `REKICK`, `DONE`, `halt-user-input-required`,
`finish-choice`, `version-approval`, `conduct-state.json`, `gates/*.json`, `protected-artifact-seal.json`,
and every verdict/evidence artifact in the two tables below (`build-review.json`,
`test-suite-evidence.json`, `acceptance-specs-red.json`, `manual-test-results.md`, `prd-audit.md`,
`architecture-review-as-built.md`, `wiring-evidence.json`, …). Losing one of these re-runs its step
or restarts its phase; that cost is correct. `events.jsonl`, `otel.jsonl`, and the audit trail are
append-only history — also never reconstructed, because a fabricated history is worse than none.

### Gate verdicts

`.pipeline/gates/<step>.json`, one per step:

```ts
interface GateVerdict {
  satisfied: boolean;
  reason?: string;
  checkedAt: number;                              // epoch ms
  kickback?: { from: StepName; evidence: string };
}
```

The loop owns objective verdicts — it recomputes them from on-disk evidence after each step rather than
trusting an agent's self-report. The only agent-authored writes are kickback invalidations, and those
must carry evidence.

### Verdict and evidence artifacts

Agent-authored, engine-validated. Alphabetized.

| File | Shape | Writer |
| --- | --- | --- |
| `acceptance-specs-red.json` | `{ command, targetSpecs[], executed, passed, failed, skipped, errors, summary? }`. Validation hard-fails on `errors > 0`, `skipped > 0`, `executed < 1`, or `failed < 1` — a RED phase must actually fail | `acceptance-red-runner.ts` |
| `architecture-review-as-built.md` | Markdown with a `Verdict: <value>` line | as-built review step |
| `architecture-review-as-built-code-stamp.json` | The HEAD sha the review was formed against | engine |
| `assessment/` | Assessment outputs | `assess` skill |
| `attribution-memo.json` | Fast-lane attribution memo | `attribution-lane.ts` |
| `attribution-verdict.json` | `{ schema?, anchor?: { head?, residue?[] }, results? }` | `attribution-verdict.ts` |
| `audit-trail/` | Per-task `review.json`, `rework-N.json`, `commit.txt`, `summary.json`, plus `events.jsonl` and a `WRITE-FAILED` marker | `audit-trail.ts`, `pipeline` skill |
| `bootstrap-detection.json`, `bootstrap-inventory.md` | Stack detection output | `bootstrap` skill |
| `build-review.json` | `{ verdict: 'PASS'\|'FAIL', reasons?, findings?, rubric: { tautology, scope, rootCause, completeness }, codeStamp? }` | `build_review` step |
| `build-review-regrade.json` | Per-feature-session regrade counter; bounds stale-mirage regrade to once per session | `build-review-disposition.ts` |
| `build-stall-question.md` | Free-form stall question surfaced to the operator | `task-progress.ts` |
| `documentation-delivery.json` | `{ version: 1, branch, prUrl, sourceRef }` with strict source-ref and PR-URL regexes and a staleness check | `documentation-delivery.ts` |
| `fr-coverage.md` | Product-track FR-to-spec coverage table | `writing-system-tests` skill |
| `intake-outcomes.md` | Staged intake outcomes | `engineer/outcome-staging.ts` |
| `manual-test-results.md` | Per-story PASS/FAIL rows. The gate fails on any FAIL row in the latest attempt, and on an mtime older than session start | `manual-test` skill |
| `manual-test-fail-evidence.json` | Failure detail for the above | engine |
| `per-task-floor.json` | Per-task commit-floor telemetry | `step-runners.ts` |
| `prd-audit.md` | Markdown table `\| FR \| Verdict \| Gap-class \| Evidence \| Accepted? \|`. Verdicts `ALIGNED`, `MISSING`, `PARTIAL`, `DIVERGED`; gap classes `impl-gap`, `intended-drift`, `plan-gap`, `unknown`. The verdict is read from the verdict **cell**, not from anywhere else in the row | `prd-audit` skill |
| `prd-audit-code-stamp.json` | The HEAD sha the audit was formed against | engine |
| `protected-artifact-seal.json` | See above | `protected-artifact-seal.ts` |
| `rebase-residue.json` | `[{ sha, citingTaskIds[], reason }]` — citations a rebase could not translate | `rebase-translate.ts` |
| `rebase-rewrites.json` | Pre-to-post rebase sha map, merged transitively; atomic temp plus rename | `rebase-translate.ts` |
| `remediation.json` | Per-gap dispositions and tasks; the engine routes deterministically from it | `remediate` skill |
| `summary.json` | At least `{ tasks_completed: number }`; read tolerantly — missing or corrupt reads as 0 | `pipeline` skill |
| `test-failures.md` | Failure detail consumed by the remediation flow | remediate flow |
| `test-suite-environment.key` | Environment fingerprint for suite evidence | `full-suite-fingerprint.ts` |
| `test-suite-evidence.json` | Version 3. PASS: `{ version, outcome: 'PASS', reason: 'exit_zero', fingerprint, categoryFingerprints, provenanceHeadSha, worktreeClean?: boolean, command, workingDirectory, startedAt, endedAt, durationMs, exitCode: 0, stdout, stderr }`. FAIL adds a `signal` discriminant and one of nine `reason` values. Diagnostics truncate at 16384 bytes | `full-suite-evidence.ts` |
| `version-signal.json` | `{ verdict, level, files, classifiedAt }` — the PATCH auto-pass audit | `self-host/version-gate.ts` |
| `wiring-evidence.json` | `{ schema, base, head, tasks: [{ id, contract, gaps: [{ kind, message }], proofs?: [{ kind: 'same-file-composition', export, caller, file, rootChain[] }] }], layer2: { applicable, reason? }, waivers[] }`; seven gap kinds; a `proofs` entry records an independently-verified same-file root-to-caller-to-export chain, corroborating context only — never authority on its own | `wiring-probe.ts` |

In a post-repair BUILD-verification round, the presence of either gate artifact or its recorded PASS
verdict does not exclude its member from dispatch. The member's own evidence rule decides reuse or
recomputation: `wiring_check` compares its recorded head with the current head, and `test_suite`
reuses only a matching content fingerprint. The round join, not a file left on disk, then decides
whether the member is satisfied.

All of these are ephemeral. Losing one re-runs its step; none of them is the durable record of anything.

### Sentinel markers

Existence is the signal. Alphabetized.

| Marker | Written by | Effect |
| --- | --- | --- |
| `.memory-count-at-start` | `session-start-context.sh` | Baseline for the stop-time memory-delta reminder |
| `.task-status.lock` | `pre-dispatch.sh` (mkdir lock) | Serializes concurrent `task-status.json` row flips |
| `DONE` | conductor on convergence | Paired with the `loop_converged` event |
| `HALT` | `halt-marker.ts::writeHaltMarker`, best-effort — write failures are swallowed | The daemon treats it as a full stop: it never advances, opens a PR, or merges past it. The first non-empty body line is the reason the dashboard shows |
| `HALT.class` | the same writer, always, plus the daemon's startup migration for halts predating it | `needs-human`, `mechanical`, `legacy`, or `protected-artifact`. `protected-artifact` identifies a genuine protected DECIDE-artifact violation; `legacy` is stamped once by the daemon's startup migration for a HALT it finds still unclassified; missing or unrecognized content reads as `unclassified` and never throws. Written atomically (temp file plus rename) after removing any stale sidecar, so a reader never observes a class from a prior HALT paired with a newer body |
| `HALT.cleared` | the re-kick sweep | Records halt lifecycle closure; pairs with the `halt_cleared` event |
| `QUARANTINE` | setup triage | The feature is quarantined from dispatch |
| `REKICK` | the re-kick sweep | Body is literally `rekick` |
| `conduct-session-id` | step runners | Durable conductor run identity. It survives daemon restart and redispatch; provider attempts use separate fresh IDs and do not rewrite it |
| `current-task` | `conduct-ts task` | Per-task stamp; the source of the `prepare-commit-msg` auto-stamp. Stale stamps are cleared during seeding |
| `dispatch-count` | `pre-dispatch.sh` | One line per dispatch. Crossing the unattributed threshold emits `unattributed_dispatch` |
| `finish-choice` | FINISH publication coordinator through `conduct-ts finish-record` | Final publication outcome; subject to the session freshness check. Interactive intent is acquired before this marker exists |
| `halt-user-input-required` | `pipeline` skill on a user-requested exit | The build predicate returns not-done while it exists |
| `phase-active` | `phase-marker.ts::writePhaseMarker` | Line-oriented on purpose so bash hooks can read it without a parser: `step: <name>`, `phase: <BUILD\|SHIP>`, `written: <ISO-8601>`, then zero or more `allow: <prefix>` lines. Removed idempotently on step exit |
| `rate-limit-hit` | `rate-limit-wait.sh` | Line 1 epoch, line 2 wait seconds. See the `StopFailure` limitation in [settings and hooks](settings-and-hooks.md) |
| `review-required-<step>` | review skills | Existence means "found issues". Observed for `prd_audit`, `architecture_review`, `conflict_check`, and `architecture-as-built` |
| `tdd-phase` | nothing in the engine or any skill | Opt-in trigger for both TDD gates. Dormant by default |
| `version-approval` | operator | Records the approved VERSION bump for the self-host approval gate |

To clear a halt safely, use the procedure in
[stalled or stuck feature](../runbooks/stalled-or-stuck-feature.md) — deleting `HALT` by hand leaves
`HALT.class` behind.

### Generated assets and logs

| Path | Contents | Notes |
| --- | --- | --- |
| `session-hooks/` | `pre-dispatch.sh`, `docs-guard.sh` | Written mode 0755 during worktree preparation; retired no-op assets are removed; see [settings and hooks](settings-and-hooks.md) |
| `git-hooks/` | `prepare-commit-msg`, `commit-msg` | Wired via the worktree-local `core.hooksPath` |
| `events.jsonl` | The run event log | Append-only, no rotation — see below |
| `audit-trail/events.jsonl` | A separate ledger with a different shape | See below |
| `otel.jsonl` | OTLP-JSON, one batch per line | Default file-transport target. Off unless the `otel:` config block is present. Append-only, unbounded |
| `conduct.log` | Session narrative | Written only by the legacy bash CLI; `conduct-ts` never writes it. Read by `rate-limit-wait.sh` |
| `progress.log` | Batch-boundary narrative | Appended by the `pipeline` skill |

> **Known limitation.** No engine code reads `.pipeline/fr-coverage.md`, `.pipeline/otel.jsonl`,
> `.pipeline/audit-trail/events.jsonl`, `.pipeline/audit-trail/WRITE-FAILED`,
> `.pipeline/bootstrap-detection.json`, or `.pipeline/bootstrap-inventory.md`. They are written every run
> and consumed only by skill prose, by external OTLP tooling, or by nobody. Do not treat their presence
> as evidence that anything acted on them. Tracked in
> [#1008](https://github.com/jstoup111/ai-conductor/issues/1008).

> **Known limitation.** Two constants named `HALT_MARKER` exist and point at different files —
> `.pipeline/HALT` and `.pipeline/halt-user-input-required`. Two types named `TaskStatusFile` declare
> incompatible shapes for `task-status.json`; the array-of-records form is the one actually written. When
> reading code, check which module a name came from. Tracked in
> [#1016](https://github.com/jstoup111/ai-conductor/issues/1016).

## `.daemon/`

Daemon-scoped state at the main checkout root. Gitignored. Fourteen paths.

| Path | Contents | Notes |
| --- | --- | --- |
| `PAUSED` | `{ pausedAt, pausedBy? }` | Existence is authoritative; the body is informational only. **Fail-closed** — any read error other than "not found" is treated as paused |
| `RESTART-PENDING` | `{ requestedAt, requestedBy?, blockingSlug? }` | Consumed once at the next daemon boot; a re-request refreshes rather than duplicating |
| `RESTART_PENDING.suppression` | Suppression record for the above | Note the underscore, where the marker uses a hyphen |
| `attribution-accuracy.jsonl` | Append-only accuracy ledger | `attribution_divergence` events are observational only — they never revoke a stamp or write a halt marker |
| `daemon.log` | The active daemon log | Rotated at open time when it exceeds 1 MB |
| `daemon.log.1` | The rotated log | Overwritten by each rotation |
| `daemon.pid` | pid, uuid, engine dir | `O_EXCL` pidfile. Fleet-wide GC cross-checks every pidfile; any read error other than "not found" aborts GC with zero deletions |
| `gated.json` | Owner-gate snapshot | — |
| `last-base-sha` | Fast-forward tracking | — |
| `mergeable-watch.jsonl` | Append-only mergeable sweep ledger | — |
| `migrations/halt-classification-v1` | `complete\n` once written | One-time watermark. The daemon stamps any pre-existing HALT still missing `.pipeline/HALT.class` as `legacy` before touching worktrees, then writes this file so the sweep never repeats. A lock loser never runs it |
| `parked/<slug>` | Per-slug operator park | Resolved against the **main** repo root via `git rev-parse --git-common-dir`, so a worktree and its main checkout share one park namespace |
| `processed/<slug>` | `{"status":"shipped","prUrl":…}` | Legacy plain-text `shipped` still parses |
| `warned/<slug>` | Per-slug warn-once record | — |

Daemon procedures live in [running the daemon](../guides/running-the-daemon.md); recovery lives in
[daemon recovery](../runbooks/daemon-recovery.md).

## Git machinery

### Worktree and branch names

| Actor | Worktree path | Branch |
| --- | --- | --- |
| Daemon build | `<projectRoot>/.worktrees/<slug>` | `feat/daemon-<slug>` |
| Engineer loop (spec authoring) | `<canonicalPath>/.worktrees/engineer-<slug>` | `spec/<slug>`, then `-2`, `-3`… on collision |
| Interactive `worktree` step | `<projectRoot>/.worktrees/<slug>` | `feature/<slug>`, then `-2`… on collision |
| Autoresolve | `<repoCwd>/.worktrees/resolve-<slug>` | *(checks out the conflicting ref)* |
| Setup triage quarantine | — | `wip/setup-quarantine-<slug>` |
| Shipment reconciliation | — | `shipment-repair/<prNumber>/<slug>` |

Five branch-name templates in total. The daemon slug is always the plan-file stem, enumerated from the
base branch tree, never from the working tree. The engineer and interactive slugs come from slugifying
the idea or feature description: lowercase, spaces to `-`, strip anything outside `[a-z0-9-]`, collapse
runs of `-`, trim trailing `-`, truncate to 50 characters.

`ensureWorktree` has three outcomes — `reused` (already registered, no git mutation), `attached`
(`git worktree add <path> <branch>`), and `created` (`git worktree add -b <branch> <path> <base>`). The
base is resolved lazily, only in the create case.

On a halt or error the daemon **deliberately leaves the worktree in place** for the operator. Only the
legacy interactive cleanup path also deletes the branch.

### Commit trailers

The engine's trailer parser recognizes exactly two keys: `Task:` and `Evidence:`. There is no `Owner:`
commit trailer (`Owner:` is a line inside `.docs/intake/<slug>.md`), no `Shipped-Record:` trailer, and
no `Co-Authored-By` handling anywhere in the engine.

**`Task: <id>`** is auto-stamped by `prepare-commit-msg` from `.pipeline/current-task`, but only when no
explicit trailer is already present. A leading `T` before a digit is folded, so `Task: T3` and `Task: 3`
are the same id.

`Task:` trailers are **partly** telemetry and **partly** load-bearing. The distinction matters:

| Consumer | Gate or telemetry? |
| --- | --- |
| `commit-msg` presence check | **Telemetry.** A commit with no `Task:` trailer is never rejected |
| `commit-msg` format check | **Gate.** A trailer that *is* supplied and uses the `task-N` form, or names an id absent from `task-status.json`, blocks the commit with exit 1 |
| Per-task commit floor | **Telemetry.** Purely additive: it never feeds the build grader, never changes success, never triggers a kickback |
| `derive-feedback` commit-evidence check | **Telemetry.** Advisory only; never writes `task-status.json` or the evidence sidecar |
| Build-completion predicate | **Gate.** Task ids resolved from `Task:` trailers are unioned with `task-status.json` rows; any plan task id in neither set returns not-done |
| Build stall and halt breaker | **Gate.** The resolved-task count drives the `no_task_progress` stall verdict |

A task evidenced **only** by a `Task:` trailer, whose `task-status.json` row was never flipped,
therefore satisfies the build gate. That union is deliberate — it fixed a false halt at 100% real
completion. Final completion authority still rests with `build_review`'s completeness rubric, which
compares the plan against the diff rather than trusting any self-report.

**`Evidence: satisfied-by <sha>` / `Evidence: skipped <reason>`** is telemetry only. The values are
extracted by `commit-msg` and never acted on. This is distinct from the `EvidenceStamp` records in
`.pipeline/task-evidence.json`, whose `form` field can be `trailer` or `evidence:satisfied-by`.

`commit-msg` skips all trailer machinery for merge commits, `--amend`, rebase replay, and any commit
made with `CONDUCT_ENGINE_COMMIT=1`.

### Shipped records

A shipped record is the durable, committed fact that a feature shipped. It lives at
`.docs/shipped/<plan-stem>.md`, committed **on the implementation branch**, so the merge that lands the
work also lands the record.

```markdown
---
slug: <slug>
spec_hash: <sha256-hex>
pr: <pr url | local>
shipped: <YYYY-MM-DD>
engine_version: <engine-version-id | dev>
---
```

`engine_version` is the engine build that shipped the feature — the same id `conduct-ts daemon status`
prints as `version:<id>`, resolved from the running engine's own module path (`dev` for an unpublished
source checkout). The line is emitted only when a value is supplied, so records written before this
field existed, backfill proposals, and repair writes stay byte-identical to the four-field form.
`conduct-ts kpi` reports an unstamped record as `engine=unknown`, keeping unattributed ships visible.

`spec_hash` is SHA-256 over the trimmed plan bytes, a `0x00` separator, and the trimmed stories bytes.
Only trailing newline runs are trimmed; interior bytes are never modified and CRLF is deliberately not
normalized. Changing that computation is a breaking change to persisted identity.

`renderShippedRecordWithCost` appends a `## Cost` block after the closing fence
(`input`, `output`, `cache_read`, `cache_creation`, `cost_usd`, `dispatches`, `retries`, `halts`,
`unmetered`, and a `providers:` sub-block when non-empty). Appending is safe because the parser stops at
the closing `---`.

A separate `## Time` block follows, computed and rendered independently of Cost so a timing failure
never blocks either section. `state` is one of `measured`, `partial`, or `unavailable`. `measured`
carries `active_ms` (the union of all active step/group execution intervals), `provider_active_ms` (the
portion of active time actually spent inside a provider process), and `no_provider_active_ms`
(`active_ms - provider_active_ms`, engine/code time). `partial` carries `active_ms` only when active
time itself was trustworthy but provider or completeness evidence was not; `unavailable` carries no
fields. Timing is derived from `.pipeline/events.jsonl` at ship time and is never a fabricated zero —
missing or incomplete evidence downgrades the state instead. Records written before this section
existed simply have no `## Time` block, and `conduct-ts kpi` reports those as `time=unavailable`.

`conduct-ts shipped-record --slug <plan-stem> --pr <pr-url-or-local>` writes it; both flags are
required and re-running with identical content is a no-op. Its exit code cannot be used to detect
success — it exits 0 even when it wrote nothing. Recording a ship and verifying it landed is in
[shipped-record reconciliation](../runbooks/shipped-record-reconciliation.md#recovery).

The daemon never writes shipped records. A daemon-side write would land on the main checkout's base
branch, never be pushed, and wedge the fast-forward advance.

Backlog dedup reads records from the **base branch tree**, not the working tree, so an uncommitted
record is invisible by construction. Two passes run: stem match, then content-hash match against
`spec_hash` for a renamed spec. A malformed record still dedups by stem, just not by hash.

Reconciliation for a merged PR whose record is missing or wrong is in
[shipped-record reconciliation](../runbooks/shipped-record-reconciliation.md).

## Observability outputs

### `.pipeline/events.jsonl`

One JSON object per line: a `ConductorEvent` spread plus a writer-stamped ISO-8601 `ts`. Append-only —
no rotation, no truncation, no size cap. Path is `<pipelineDir>/events.jsonl` for an interactive run and
`<worktreePath>/.pipeline/events.jsonl` per feature under the daemon. Gitignored, never committed.

`ConductorEvent` defines **62 variants**. `EventPersister` subscribes to the **34** names in
`ALL_EVENT_TYPES` and writes only those:

`step_started`, `step_completed`, `step_failed`, `provider_attempt`, `feature_usage_total`,
`provider_fallback`, `session_policy`, `step_retry`, `checkpoint_reached`, `recovery_needed`,
`gate_blocked`, `tier_skip`, `config_skip`, `navigation_back`, `rate_limit`, `session_reset`,
`credentials_park`, `credentials_park_progress`, `feature_complete`, `dashboard_refresh`, `auto_heal`,
`mode_skip`, `build_progress`, `unattributed_progress`, `build_no_progress`, `build_stall`,
`renderer_error`, `when_skip`, `parallel_started`, `parallel_completed`, `parallel_failure`,
`attribution_divergence`, `build_member_evidence_reused`, `build_member_evidence_recomputed`.

The BUILD-member settle events carry only a member, decision, and closed basis classification:
`build_member_evidence_reused` is `reuse` with `fingerprint-match`;
`build_member_evidence_recomputed` is `recompute` with `recorded-head-versus-current-head`,
`fingerprint-mismatch`, or `fresh-evidence-required`. They make reuse observable without becoming a
second validity authority; the BUILD group join still decides round satisfaction.

A `build` step's `step_completed` event carries two build-only witnesses, `treeBefore`/`treeAfter`
(absent on every other step and on events from an older engine). Both the daemon-log renderer and
the interactive renderer use them to annotate the line with the tree movement observed for that
step — `(tree abc1234..def5678)` when it moved, `(tree abc1234 unchanged)` when it did not, or
`(tree unknown)` when the hash could not be determined. This is a rendering-only annotation of the
same witness pair persisted in `.pipeline/build-outcome.json`; the two fields do not report the
separate HEAD-commit witness (`adr-2026-07-23-commit-movement-liveness-floor`), which can legitimately
disagree on the same turn (an empty commit moves HEAD without moving the tree).

`session_policy` records when the fail-closed `supportsSessionResume` capability seam suppresses a
would-be session resume. Both built-in providers declare the capability false, so this is diagnostic
evidence of a prevented resume rather than a path to a later resumed invocation. It is emitted by the
same session-capability contract described in
[Per-step session capability contract](../explanation/architecture.md#per-step-session-capability-contract).

Readers: `conduct-ts inline --report`, `computeCostRollup` (which feeds the shipped record's `## Cost`
block), the daemon signal emitters, the engineer-loop signal assembler, and the `retro` skill by prose.
No dashboard and no `kpi` path reads it.

> **Known limitation.** The other 28 event types — including `gate_verdict`, `kickback`, `loop_halt`,
> `loop_converged`, `auto_park`, `zero_work_product`, `unattributed_dispatch`, `halt_cleared`,
> `ci_failed`, and every `rebase_*` variant — are emitted for real but never persisted, because the
> emitter dispatches only to handlers registered for that exact type. Three read paths are structurally
> dead as a result: `cost-rollup.halts` counts `loop_halt` and is therefore **permanently 0** — and that
> zero is committed verbatim into every shipped record's `## Cost` block and re-read by `conduct-ts kpi`;
> `aggregateKickbacks` and `aggregateHalts` always return `[]`, so `--report` shows no kickbacks and no
> halts however many occurred. Read halts from `.pipeline/HALT` and the daemon log instead.
> Tracked in [#1008](https://github.com/jstoup111/ai-conductor/issues/1008).

### `.pipeline/audit-trail/events.jsonl`

A separate ledger with a different shape. Do not confuse it with the run event log.

```ts
type AuditRecord = {
  step: StepName; phase: Phase; event: string; reason?: string;
  cause?: string; attempt?: number; at: number; kickback_outcome?: string;
};
```

`at` is epoch milliseconds, not the ISO `ts` used by `events.jsonl`, and `event` is a derived string,
not a raw event type. It subscribes to six source events (`gate_verdict`, `step_retry`, `kickback`,
`loop_halt`, `step_completed`, `halt_cleared`) and emits six strings (`gate_pass`, `gate_fail`, `retry`,
`kickback`, `intervention`, `halt_cleared`). A write failure drops a `WRITE-FAILED` marker beside it.
No TypeScript reader exists; only the `retro` skill consults it, by prose.

### Daemon logs

Active log at `<repo>/.daemon/daemon.log`, rotated to `daemon.log.1`. Each line is
`<ISO-8601 timestamp> <line>`; timestamps appear only in the file, not on the live tmux console.

Rotation has a 1 MB cap applied **only at open time**, so a long-running daemon never rotates mid-run.

The log carries every daemon `log()` line, rendered inner-loop events, `console.warn` and
`console.error` tee'd with `[warn]`/`[error]` prefixes and ANSI stripped, and the startup dashboard
snapshot — which deliberately omits the PROCESSED group the console version shows with `--completed`.

#### Line shapes

Every daemon line carries the `[daemon]` prefix. A line a feature owns carries its slug tag
immediately after, with no space between the two:

| Owner | Shape |
| --- | --- |
| The daemon itself — discovery, sweeps, lock, restart | `[daemon] <message>` |
| One feature run — lifecycle records, rendered loop events, provider warnings, subprocess diagnostics | `[daemon][<slug>] <message>` |

The slug is bounded to 24 display characters: a longer one is cut to 23 and closed with `…`. A
multi-line message is split first, so every physical line gets its own prefix, tag, and timestamp
rather than only the first.

Feature-owned tagging is attribution, not routing — both shapes land in the same file and on the same
console. Untagged lines are the ones emitted directly on the daemon-wide bus; an event forwarded from a
feature's own bus renders once, tagged.

Lifecycle transitions are deduplicated per slug across both sinks: a repeated `▶ start` or an `■ done`
repeating the recorded outcome is dropped, and `↻ resume` always prints with `(was: <status>)`
appended. A line counts as a transition only when the glyph opens the message, behind at most a
bracketed tag and ANSI codes — so a line that merely quotes another feature's lifecycle text cannot
suppress that feature's real transition.

Read it with `conduct-ts daemon logs`; flags are in [cli](cli.md).

> **Known limitation.** `daemon.log.1` is produced by rotation but no CLI path ever opens it — both the
> tail and follow primitives only open the active log. Rotated history is reachable only by reading the
> file directly. Tracked in [#1008](https://github.com/jstoup111/ai-conductor/issues/1008).

### `conduct-ts kpi`

**Input:** `<cwd>/.docs/shipped/*.md` and nothing else. It re-parses the committed `## Cost` and
`## Time` markdown blocks with regexes; it does not read `events.jsonl`, `.pipeline/`, or `otel.jsonl`.

**Parsed fields** (`KpiCostFields`): `input`, `output`, `cacheRead`, `cacheCreation`, `costUsd`,
`dispatches`, `retries`, `halts`, `unmeteredCount`, `unmeteredDurationMs`, and
`costUnmetered` (from the top-level `cost_unmetered` field). Each `providers:` entry is also
parsed with its input, output, cache, cost, dispatch, and `cost_unmetered` fields.

**Parsed timing fields** (`KpiTimeFields`, mirrors `TimingRollup`): `state` (`measured`, `partial`, or
`unavailable`), plus `activeMs`, `providerActiveMs`, and `noProviderActiveMs` when present. Parsing is
independent of Cost — a missing, malformed, or absent `## Time` block never affects Cost output and is
reported as `state: unavailable`.

**Output:** a plain-text report on stdout. No file, no JSON. Per feature it prints `input`, `output`,
`tokens` (their sum), cache fields, dispatch fields, `duration_ms`, and `cost_usd`, suffixed
`[PARTIAL — unmetered dispatches present]` when any dispatch went unmetered or
`[COST-PARTIAL — cost-unmetered dispatches present]` when tokens are metered but cost is unknown.
Each provider prints its input, output, tokens, cost, `cost_unmetered`, and dispatch count; a
provider with cost-unmetered dispatches prints `cost_usd=unavailable`. A record with no parsable
`## Cost` block prints `no Cost data available (skipped)`. The aggregate line prints the counted
feature count, total tokens with an input/output breakdown, and total `cost_usd` to four decimal
places; **features with any unmetered dispatch are excluded from the aggregate**, while
cost-unmetered features still contribute tokens but not cost. If no feature has metered cost, the
aggregate cost is `unavailable`. An empty or missing directory prints `No shipped features yet —
.docs/shipped/ is empty or does not exist.`

Each feature row also appends a `time=` suffix: `time=measured active_ms=<n> provider_active_ms=<n>
no_provider_active_ms=<n>` when measured, `time=partial` (with `active_ms=<n>` when active time alone
was trustworthy), or `time=unavailable`. The aggregate line adds `timing measured=<n> partial=<n>
unavailable=<n>` counts, plus `avg_active_ms`, `avg_provider_active_ms`, and
`avg_no_provider_active_ms` averaged only over `measured` features — partial and unavailable rows
never contribute to or fabricate an average.

The command takes zero flags — anything after `kpi` is ignored — and always exits 0.
