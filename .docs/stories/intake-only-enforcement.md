**Status:** Accepted

# Stories: Intake-only criteria enforcement (priority + size + linking) — #695

**Track:** technical (no PRD — acceptance criteria live here)
**Feature area:** intake **capture/file** surfaces — `.github/ISSUE_TEMPLATE/intake.yml`,
a new `.github/workflows/intake-label-sync.yml`, the `/intake` skill + its bundled `scripts/intake-file` helper,
and a one-shot `bin/intake-backfill`. The claim path
(`src/conductor/src/engine/engineer/intake/dependency-claim.ts`) is explicitly **out of
scope for enforcement** and a story asserts it stays unchanged.

---

## Operator directive (binding — shapes every criterion)

**"No failures — enforce requirements at intake ONLY."** Every acceptance criterion
below is phrased as **intake-time behavior**. None is a downstream failure: no
pipeline gate, no HALT, no build/dispatch rejection, no CI failure for missing
priority/size/links. Where a value can't be inferred, a **sensible default** is
applied at intake — never an error.

## Context

Intake criteria are priority (`priority: critical|high|medium|low`), size
(`size: S|M|L`), and dependency-linking (an explicit `blocked_by` decision). Today
`/intake` only *prescribes* them in prose, so they drift: 100 of 107 open issues had
no size label, 3 had no priority (#691, #678, #677). The fix stamps them at **every
capture surface** so each issue is **born complete**, and makes the ~100-issue
backlog complete in one pass — with **zero** new downstream checks.

---

## Story 1: Issue-form captures are born with priority + size + linking

**Requirement:** FR-1

As anyone filing from web / mobile / phone, I want the intake form to require a
priority, a size, and a linking decision so that the issue I file is already
criteria-complete — without me remembering a labelling ritual.

### Acceptance Criteria

#### Happy Path
- Given the intake issue form (`intake.yml`), then it presents a **required**
  `Priority` single-select (critical/high/medium/low), a **required** `Size`
  single-select (S/M/L), and a `Depends on` field for linking — additive to the
  existing Observed/Impact/Desired-outcome/Hypotheses fields.
- Given a form is submitted, when the issue opens, then `intake-label-sync.yml`
  (triggered on `issues.opened`/`edited`) applies the matching `priority:` and
  `size:` labels (creating either label if absent, mirroring how `engineer:handled`
  is auto-created) and records the `Depends on` references as the issue's
  `blocked_by` linking — so the filed issue carries all three at rest.
- Given the form omits the closed-vocabulary check, when a value is nonetheless
  unparsable, then the sync applies the **default** label (`size: M` /
  `priority: medium`) — the issue is still born complete, never left unlabelled.

#### Negative Paths
- Given the label-apply call fails (outage/quota), when the sync runs, then it
  logs and exits successfully **without** failing any check that could block the
  issue, a build, or CI; the label is reconciled on the next `issues.edited` run.
  (The Action is labels-only and isolated from `ci.yml`.)
- Given the form is re-edited with the same values, when the sync re-runs, then it
  is idempotent — no duplicate labels, no error.

### Done When
- [ ] `intake.yml` has required Priority + Size selects and a Depends-on field; the
  integrity check "Issue-template YAML validity and blank-issues guard" stays green.
- [ ] A workflow test/fixture asserts a submitted form yields the correct
  `priority:`/`size:` labels + `blocked_by`, defaults on unparsable input, and is a
  no-op on re-edit.
- [ ] `.github/workflows/ci.yml` is unchanged (the sync cannot fail CI).

---

## Story 2: Agent/operator `gh issue create` files are born complete

**Requirement:** FR-2

As an agent or operator filing via `/intake` (`gh issue create`), I want a
deterministic completeness step so the issue is stamped with priority + size +
linking as part of filing, instead of relying on prose to remember the labels.

### Acceptance Criteria

#### Happy Path
- Given the intake skill's bundled `scripts/intake-file` helper is invoked with a size and priority, when it files, then
  it creates the issue **and** applies the `priority:`/`size:` labels + records
  `blocked_by` links in the same operation (via the existing REST label idiom) —
  the returned issue is criteria-complete.
- Given size/priority are not supplied, when filing interactively, then the helper
  **prompts** for them; when non-interactive, it **infers** from the drafted body
  and, failing a confident signal, applies the **default** (`size: M` /
  `priority: medium`). Filing never aborts for a missing label.
- Given the `/intake` skill's §7 GATE / §8 File, then they direct the filer through
  the skill's bundled `scripts/intake-file` helper, named relative to the skill's own directory (the deterministic step), rather than a prose "remember to add a
  label" instruction.

#### Negative Paths
- Given the label-apply REST call fails after the issue is created, when the helper
  handles it, then it reports the issue URL and the un-applied label as a warning
  and exits **success** (the issue exists; completeness is reconciled on the next
  form edit or backfill) — it never leaves the caller with a hard failure.
- Given `--depends-on` is omitted and the filing has no undecided linkable overlap
  suggestion, when filing, then linking is recorded as an explicit "no dependencies"
  acknowledgement, not left undecided.

### Done When
- [ ] An intake-filing test asserts create + label + link in one filing, prompt
  vs infer vs default for missing size/priority, and success-with-warning on a
  failed label apply.
- [ ] `skills/intake/SKILL.md` §7/§8 reference the bundled `scripts/intake-file` helper; the harness
  integrity suite (cross-skill/template refs) stays green.

---

## Story 3: The ~100-issue backlog is made complete in one pass — no HALT

**Requirement:** FR-3

As the operator, I want a one-shot backfill that stamps the missing
`size:`/`priority:` labels on the existing unsized backlog so it becomes
criteria-complete, without a per-issue confirmation gate or a HALT.

### Acceptance Criteria

#### Happy Path
- Given `bin/intake-backfill` runs over open assigned issues, when an issue lacks a
  `size:` and/or `priority:` label, then it applies one — inferring from the issue
  body where a confident signal exists, else the **default** (`size: M` /
  `priority: medium`) — writing the label directly so the issue is now complete.
- Given the run completes, then it emits a **report** listing every issue it
  labelled and which values were defaulted vs inferred, so the operator can re-band
  any of them later.
- Given a re-run, then it is idempotent — already-complete issues are skipped, no
  duplicate labels.

#### Negative Paths
- Given a single issue's label apply fails, when the sweep continues, then that one
  issue is reported as skipped and the rest of the backlog is still completed — one
  failure never aborts the pass and never HALTs.
- Given the backfill cannot infer a size, then it applies the default and records
  it in the report — it does **not** stop to ask (no confirmation gate; the
  directive's "sensible default … never a downstream error").

### Done When
- [ ] A `bin/intake-backfill` test over a fixture backlog asserts: incomplete issues
  labelled (infer ▸ default), a report of defaulted vs inferred, idempotent re-run,
  per-issue failure isolation, and **no** HALT / confirmation prompt.

---

## Story 4: Linking is decided at intake, not derived downstream

**Requirement:** FR-4

As a filer, I want the dependency-linking decision captured when I file so that "no
dependencies" and "not yet triaged" are distinct at rest — not inferred from a
downstream blocker verdict.

### Acceptance Criteria

#### Happy Path
- Given a `Depends on #N` form field or `--depends-on N` helper arg, when the issue
  is filed, then its `blocked_by` set is recorded at intake.
- Given no dependency is stated and the filing has no undecided linkable overlap
  suggestion, when filing, then an explicit "no dependencies" acknowledgement is
  recorded — the linking decision exists, it is not left blank.

#### Negative Paths
- Given a `Depends on` reference to a non-existent issue, when linking is recorded,
  then the reference is captured as stated and surfaced in the filing/backfill
  report; it does **not** fail filing.
- Given the claim path later runs, then it reads the recorded `blocked_by` as today
  — no new linking *derivation* is introduced downstream (linking is an intake
  output, consumed unchanged).

### Done When
- [ ] Tests assert linking is written at file time for stated deps and for the
  explicit "no dependencies" case, and that a bad ref is captured-and-reported, not
  fatal.

---

## Story 5: Closed-vocabulary size parsing (single source of truth)

**Requirement:** FR-5

As every surface that reads a size, I want one deterministic parser so the same
closed S/M/L vocabulary decides "sized" everywhere and near-miss labels never count.

### Acceptance Criteria

#### Happy Path
- Given labels `['size: S']`→`'S'`, `['size: M']`→`'M'`, `['size: L']`→`'L'`
  (exact `size: <S|M|L>`, one space, case-sensitive — mirroring
  `parsePriorityLabels`).
- Given `['bug','size: L','priority: low']`→`'L'` (ignores unrelated labels).
- Given `['size: S','size: L']`→ a single deterministic result (largest wins);
  repeated calls are stable.

#### Negative Paths
- Given `['size: XL']`, `['size:M']` (no space), `['Size: S']` (case),
  `['size: small']`, or `[]` → `undefined`.
- Given non-string junk in the array → filtered, never throws.

### Done When
- [ ] A `parseSizeLabel` test covers each valid value, largest-wins, and every
  near-miss/empty/junk case → `undefined`.
- [ ] `grep` shows the size vocabulary is defined once, beside `parsePriorityLabels`
  in `backlog-priority.ts`.

---

## Story 6 (NEGATIVE PATH — load-bearing): The pipeline does NOT gate on criteria

**Requirement:** FR-6

As the operator, I want proof that nothing downstream fails on missing
priority/size/links, so the directive "no failures — enforce at intake ONLY" is
mechanically guaranteed, not merely intended.

### Acceptance Criteria

#### Guarantees (all assert *absence* of a downstream failure)
- Given `dependency-claim.ts`, then `claimUnblocked` and its `ClaimOutcome` union
  (`claim` | `empty` | `all-blocked`) are **byte-identical to `main`** — no
  `needs-criteria` variant, no criteria deferral, no criteria reader.
- Given `github-issues.ts` `poll()`, then it applies **no** blocking triage flag and
  **never** withholds enqueue for a missing label — an issue is enqueued exactly as
  on `main`.
- Given the daemon build/dispatch, the pipeline gates, and `.github/workflows/ci.yml`,
  then **none** adds a check that fails on missing priority/size/links.
- Given (hypothetically) an issue that still lacked a `size:` label reached the
  claim path, then it would still be claimed and dispatched — it is **never**
  deferred, HALTed, or CI-failed for the missing label.
- Given `intake-label-sync.yml` errors, then no build, dispatch, or CI run fails as
  a result (the Action is labels-only and isolated).

### Done When
- [ ] A diff/AST test (or `git diff main -- dependency-claim.ts` assertion) proves
  the claim path is unchanged and the `ClaimOutcome` union gained no member.
- [ ] A test asserts `poll()` enqueues a criteria-incomplete issue with no blocking
  flag.
- [ ] A grep/CI-config assertion shows no pipeline/CI/daemon gate references
  `size:`/`priority:`/linking as a pass/fail condition.
