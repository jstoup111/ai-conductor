**Status:** Accepted

# Stories: TR-10 migration-gate waiver for non-breaking surface touches (fix #354)

**Track:** technical (no PRD — requirements from adr-2026-07-06-migration-gate-waiver, APPROVED)
**Tier:** M
**Plan stem:** `self-host-release-gate-bin-conduct-breaking-surfac`

Requirement tags trace to the ADR's decision clauses: W1–W4 (waiver validity rules),
C3 (new satisfying condition 3), HR (HALT-reason teaching), DOC (authoring guidance),
CT (containment).

> **Coordination note (#282, accepted degrading overlap — conflict report 2026-07-06):** the
> unbuilt spec `2026-07-05-changelog-migration-block-enforcement` also modifies
> `evaluateMigration` (verdict `kind: malformed | missing`) and reroutes those kinds through
> `/remediate`. Whichever spec builds SECOND must reconcile: an invalid-waiver failure carries a
> verdict kind the remediate route understands (remediation may fix the waiver OR author a
> block), and the `.pipeline/` remediation-input artifact includes waiver state (path, parse
> result, covered vs classified surfaces). The waiver check always runs BEFORE the
> missing/malformed disposition, so a waiver-satisfied build is `ok` to that route.

---

## Story: Waiver format parses into a typed structure with canonical surface names

**Requirement:** W2

As the self-host release gate, I want waiver files parsed against a machine-checkable
contract so that only explicit, well-formed waivers can satisfy the gate.

### Acceptance Criteria

#### Happy Path
- Given a waiver file with a `Waives:` list containing `bin/conduct CLI` and a non-empty
  rationale paragraph, when the waiver is parsed, then parsing succeeds and yields exactly
  the surface set {`bin/conduct CLI`} plus the rationale text.
- Given a waiver listing multiple canonical surfaces (`bin/conduct CLI`, `hook wiring`),
  when parsed, then the parsed surface set contains both, order-independent.

#### Negative Paths
- Given a waiver whose `Waives:` list contains an unknown name `bin/conduct` (not the
  canonical `bin/conduct CLI`), when parsed, then the waiver is rejected as malformed and
  the rejection names the unknown surface string.
- Given a waiver with a valid `Waives:` list but an empty/whitespace-only rationale, when
  parsed, then the waiver is rejected as malformed (rationale is mandatory).
- Given a waiver file with no `Waives:` line at all, when parsed, then the waiver is
  rejected as malformed, never treated as "waives everything" or "waives nothing silently".
- Given the canonical surface names used by the parser, when compared to the strings
  emitted by `classifyBreakingSurfaces`, then they are the same exported constants — a
  rename in one place is a compile-time/test failure, not silent drift.

### Done When
- [ ] Canonical surface names are exported as constants from one module and consumed by both
      the classifier and the waiver parser (verified by a test asserting identity).
- [ ] Parser returns a typed result (parsed waiver | malformed-with-reason); malformed
      reasons are specific (unknown name, missing list, empty rationale).
- [ ] Unit tests cover all four negative paths above and both happy paths.

---

## Story: Valid waiver satisfies TR-10 without a migration block

**Requirement:** C3, W1, W3

As a harness self-build with an internal-only edit to a breaking-surface file, I want a
committed waiver to satisfy the migration gate so that the build no longer HALTs on a
false-positive classification.

### Acceptance Criteria

#### Happy Path
- Given a change set touching `bin/conduct` (status M) and a waiver at
  `.docs/release-waivers/<plan-stem>.md` that is itself in the change set (status A) and
  waives `bin/conduct CLI`, when `runReleaseArtifactGate` evaluates TR-10 with no
  ```bash migration``` block present, then the verdict is ok and no HALT is written.
- Given a change set touching both `bin/conduct` and a hook file, and a waiver in the
  change set waiving both `bin/conduct CLI` and `hook wiring`, when TR-10 evaluates, then
  the verdict is ok.
- Given a change set with a breaking surface AND a runnable migration block AND no waiver,
  when TR-10 evaluates, then the verdict is ok (existing condition 2 unchanged — waiver is
  never required).

#### Negative Paths
- Given a waiver that waives `bin/conduct CLI` only, when the change set also touches a
  hook file (classified `hook wiring`), then the verdict is not-ok and the HALT reason
  names the uncovered surface `hook wiring` (W3 superset rule).
- Given a waiver file present at the canonical path but NOT part of the `base...HEAD`
  change set (a stale waiver merged by a previous feature), when TR-10 evaluates a new
  breaking change set, then the verdict is not-ok — the stale waiver is ignored and the
  HALT reason states the waiver was not committed with this change set (W1 freshness
  binding).
- Given a malformed waiver (per the parser story) in the change set, when TR-10 evaluates,
  then the verdict is not-ok and the HALT reason includes the malformed-waiver detail —
  a malformed waiver never silently passes and never silently degrades to "no waiver"
  without naming itself.
- Given a valid waiver in the change set and a failing TR-10 evaluation for any reason,
  when the gate falls through to not-ok, then `writeSelfHostHalt` is still invoked with the
  full reason (the HALT side effect occurs on every not-ok branch, including waiver-related
  ones — no branch returns not-ok without writing the HALT).

### Done When
- [ ] `runReleaseArtifactGate` passes with (breaking surface + valid in-diff waiver + no
      migration block) and fails with (stale waiver), (partial coverage), (malformed
      waiver) — each asserted in `release-gate.test.ts` with hermetic seams.
- [ ] Every not-ok TR-10 verdict writes a HALT via the injected `writeHalt` (asserted per
      branch).
- [ ] Existing TR-10 tests (no-surface pass, migration-block pass, no-block HALT) still pass
      unmodified.

---

## Story: Uncertain change set remains unwaivable (fail-closed)

**Requirement:** W4

As the release gate, I want an undeterminable change set to HALT regardless of any waiver
so that the fail-closed guarantee of adr-2026-06-30-halt-based-release-gates is preserved.

### Acceptance Criteria

#### Happy Path
- Given `changedFiles()` returns null (unknown base branch or git failure) and no waiver
  exists, when TR-10 evaluates, then the verdict is not-ok with the existing fail-closed
  reason (behavior unchanged from today).

#### Negative Paths
- Given `changedFiles()` returns null AND a well-formed waiver file exists on disk at the
  canonical path, when TR-10 evaluates, then the verdict is still not-ok — the waiver
  cannot prove W1 against an unknown change set, and the HALT reason states the change set
  was undeterminable (fail-closed), not that the waiver was invalid.
- Given `changedFiles()` returns an empty list (determinable, nothing changed), when TR-10
  evaluates, then the verdict is ok via condition 1 (no breaking surfaces) — the empty and
  null cases are never conflated.

### Done When
- [ ] Test: null change set + valid-looking waiver on disk → not-ok, reason cites
      undeterminable change set.
- [ ] Test: empty change set → ok (regression guard against conflating empty with null).

---

## Story: HALT reason teaches the waiver remediation path

**Requirement:** HR

As the operator (or a future build reading its own HALT), I want the migration-gate HALT
reason to name both remediation options so that an internal-only change learns to author a
waiver instead of repeatedly HALTing.

### Acceptance Criteria

#### Happy Path
- Given a breaking surface with no migration block and no waiver, when TR-10 HALTs, then
  the reason names the classified surfaces, the ```bash migration``` block option, AND the
  waiver path `.docs/release-waivers/<plan-stem>.md` with its applicability condition
  (internal-only, no consumer-visible change).

#### Negative Paths
- Given the HALT fires for an UNCERTAIN change set (W4), when the reason is written, then
  it does NOT advertise the waiver option (a waiver cannot fix undeterminable diffs —
  advertising it would teach a dead-end remediation).

### Done When
- [ ] HALT reason for the breaking-surface case includes both options verbatim-testable.
- [ ] HALT reason for the uncertain case omits the waiver option (asserted).

---

## Story: Containment — consumer pipelines and non-self-host builds are unchanged

**Requirement:** CT

As a consumer project using the harness, I want zero behavior change from the waiver
feature so that the gate remains a harness-repo-only concern.

### Acceptance Criteria

#### Happy Path
- Given a daemon build with `selfHost === false`, when the build reaches finish, then
  `runReleaseArtifactGate` is not invoked at all (existing activation unchanged) and no
  waiver-related code path executes.

#### Negative Paths
- Given a consumer repo containing a stray `.docs/release-waivers/<stem>.md` file (copied
  by accident), when its (non-self-host) build runs to finish, then the file has no effect
  on any gate, verdict, or artifact.
- Given the harness repo's skills/, hooks/, and templates/ directories, when the feature
  lands, then no new skill, hook, template, or HARNESS.md consumer-facing rule was added
  (waiver guidance lives only in the harness repo's own CLAUDE.md).

### Done When
- [ ] Existing self-host wiring tests confirm the gate activation predicate is untouched.
- [ ] `git diff` of the implementation contains no changes under `skills/`, `hooks/`,
      `templates/`, or HARNESS.md consumer-rule sections.

---

## Story: Authoring guidance documented in the harness repo

**Requirement:** DOC

As a future self-host build (or human contributor), I want CLAUDE.md to state when and how
to author a waiver so that the decision "migration block vs waiver" is made deliberately at
build time.

### Acceptance Criteria

#### Happy Path
- Given the harness repo's CLAUDE.md "Release & Update Gates" section, when the feature
  lands, then it documents: the waiver path (`.docs/release-waivers/<plan-stem>.md`), the
  `Waives:` + rationale format with the canonical surface names, and the rule that a waiver
  is appropriate ONLY when the change is internal-only with no consumer-visible effect.

#### Negative Paths
- Given the CLAUDE.md guidance, when it describes the waiver, then it explicitly states a
  waiver is NEVER appropriate for a subcommand/flag/behavior change to `bin/conduct`, a
  hook contract change, or a `settings.json` schema change — those still require a
  ```bash migration``` block (guidance cannot be read as "always waive").

### Done When
- [ ] CLAUDE.md section updated in the same implementation PR; CHANGELOG `[Unreleased]`
      entry added.
- [ ] `README.md`/`src/conductor/README.md` gate documentation mentions the waiver
      condition (docs-track-features rule).
