**Status:** Accepted

# Stories: CHANGELOG Migration-block enforcement (fix #282)

Track: technical (no PRD). Source: `jstoup111/ai-conductor#282`. Tier: M.
Design: `.docs/track/2026-07-05-changelog-migration-block-enforcement.md`,
`.docs/architecture/2026-07-05-changelog-migration-block-enforcement.md`.
Decisions (all APPROVED): `.docs/decisions/2026-07-05-changelog-migration-block-enforcement.md`
(ADR-1 remediate routing, ADR-2 h2/h3 asymmetry, ADR-3 format-when-present).

Acceptance is stated against the gate code (`src/conductor/src/engine/self-host/release-gate.ts`),
the conductor finish-time branch (`src/conductor/src/engine/conductor.ts`), the integrity suite
(`test/test_harness_integrity.sh`), and `bin/migrate` — plus the tests that pin them.

---

## Story 1: A malformed Migration block fails integrity validation before it can ship

As the harness maintainer, I want `test/test_harness_integrity.sh` to reject a malformed
Migration block that is present in `[Unreleased]`, so the CHANGELOG build task's own
`full validation` step fails before the task can be marked complete — instead of the defect
surviving to the release gate.

### Acceptance Criteria

#### Happy Path
- Given a CHANGELOG whose `[Unreleased]` body contains **no** Migration heading, when the
  integrity suite runs, then §9d passes (format-when-present asserts nothing when absent) and
  the suite's pass/fail tally is unchanged from today.
- Given a CHANGELOG whose `[Unreleased]` body contains a well-formed block — a `## Migration`
  (h2) heading and at least one ` ```bash migration ` fence whose body has ≥1 non-blank,
  non-comment line — when the integrity suite runs, then §9d passes.

#### Negative Paths
- Given a `[Unreleased]` Migration section whose fence is a plain ` ```bash ` (no `migration`
  info-string), when the integrity suite runs, then §9d **fails** with a message naming the
  required ` ```bash migration ` info-string.
- Given a `[Unreleased]` block that uses `### Migration` (h3) instead of `## Migration` (h2),
  when the integrity suite runs, then §9d **fails** naming the required h2 heading (ADR-2).
- Given a `## Migration` section whose `bash migration` fence body is empty or only blank/`#`
  comment lines, when the integrity suite runs, then §9d **fails** naming "no runnable command"
  (the reported "commentary/examples only" case, ADR-3/C5).

### Done When
- [ ] `test/test_harness_integrity.sh` has a §9d check that parses the `[Unreleased]` body and,
      only when a Migration heading is present, asserts h2 + a `bash migration` fence + a
      non-empty non-comment body.
- [ ] §9d is format-**when-present**: it never fails a CHANGELOG that has no Migration section.
- [ ] The suite's existing checks and counts are otherwise unchanged; `test_harness_integrity.sh`
      passes on the current repo CHANGELOG.

---

## Story 2: The release gate accepts only h2, and classifies malformed vs missing

As the self-host release gate, I want `evaluateMigration` to require exactly `## Migration`
(h2) and to report *why* it failed (malformed block present vs no block at all), so the
contract matches the docs and the conductor can route a mechanical defect to remediation.

### Acceptance Criteria

#### Happy Path
- Given a breaking surface is touched and `[Unreleased]` has a `## Migration` (h2) heading with
  a valid ` ```bash migration ` fence, when TR-10 evaluates, then it returns `{ ok: true }`.
- Given **no** breaking surface is touched and the diff is determinable, when TR-10 evaluates,
  then it returns `{ ok: true }` regardless of Migration content (unchanged from today).

#### Negative Paths
- Given a breaking surface and a `### Migration` (h3) heading (even with a valid fence), when
  TR-10 evaluates, then it returns `ok:false` with kind `malformed` — h3 is no longer accepted
  by the gate (`MIGRATION_SECTION_RE` tightened `###?` → `##`).
- Given a breaking surface and a `## Migration` heading whose fence is plain ` ```bash `, when
  TR-10 evaluates, then `ok:false` kind `malformed`.
- Given a breaking surface and **no** Migration heading at all, when TR-10 evaluates, then
  `ok:false` kind `missing`.
- Given the change set cannot be determined (`changedFiles()` returns `null`), when TR-10
  evaluates, then it stays **fail-closed** (`ok:false`) exactly as today — the tightening and the
  new verdict kind never relax the uncertain-diff path (C2).

### Done When
- [ ] `MIGRATION_SECTION_RE` requires `## Migration` (h2); h3 no longer matches in the gate.
- [ ] The migration verdict carries a machine-readable kind (`malformed` | `missing`) alongside
      the human `reason`, without changing the `{ok:true}` fast paths.
- [ ] Unit tests pin: h2 accept, h3 reject, plain-fence reject, missing→`missing`,
      malformed→`malformed`, uncertain-diff fail-closed.

---

## Story 3: A migration-format gate failure routes through /remediate instead of HALTing

As the operator, I want a malformed-or-missing migration block at the self-host finish gate to
kick back through `/remediate` as a mechanical `build` fix (bounded by the existing per-gate
budget), so I am not forced into a manual CHANGELOG rewrite for a format defect — while a truly
un-fixable state still HALTs.

### Acceptance Criteria

#### Happy Path
- Given the self-host finish gate fails only on the migration sub-gate with kind `malformed`
  (or `missing`) and `remediationRounds < MAX_KICKBACKS_PER_GATE`, when the conductor handles the
  verdict, then it writes a `.pipeline/` remediation-input artifact (breaking surfaces, kind,
  required format) and dispatches `/remediate` rather than emitting an immediate `loop_halt`; the
  gate re-runs after the remediation build.
- Given `/remediate` produces a `build` disposition that fixes the block and the re-run gate now
  passes, when the loop continues, then `finish` dispatches normally (no HALT, no manual step).

#### Negative Paths
- Given the migration sub-gate keeps failing until `remediationRounds` reaches
  `MAX_KICKBACKS_PER_GATE`, when the conductor handles the next failure, then it falls back to the
  existing direct HALT (`writeSelfHostHalt` + `loop_halt`) — bounded, never an infinite kickback.
- Given the finish gate fails on a **different** sub-gate — TR-7 VERSION, TR-8 integrity suite, or
  TR-9 empty `[Unreleased]` — when the conductor handles the verdict, then it HALTs directly as
  today; only the migration-format sub-gate is rerouted (ADR-1).
- Given routing to remediate, the verdict returned by the gate is still `ok:false` — routing
  changes only the *handling*, never relaxes the gate's own pass/fail (C2).

### Done When
- [ ] `conductor.ts` finish-time branch (currently 1068–1077) routes a `malformed`/`missing`
      migration verdict through the existing remediation dispatch, budget-bounded, with HALT fallback.
- [ ] Non-migration self-host sub-gate failures retain direct-HALT behavior.
- [ ] The `.pipeline/` remediation-input artifact carries the format contract + kind + surfaces so
      remediate can emit a file-scoped `build` task without any harness-specific skill prose.
- [ ] Tests pin: malformed→remediate dispatch, budget-exhausted→HALT, TR-8 failure→direct HALT.

---

## Story 4: bin/migrate still runs already-shipped h3 blocks (backward-compat invariant)

As a consumer updating the harness, I want `bin/migrate` to keep executing historical
`### Migration` (h3) blocks in released CHANGELOG sections, so tightening the authoring contract
to h2 does not silently skip migrations I already depend on.

### Acceptance Criteria

#### Happy Path
- Given a released CHANGELOG section with a `### Migration` (h3) heading and a valid
  ` ```bash migration ` fence, when `bin/migrate` extracts blocks for that version range, then the
  block is still collected and executed — `bin/migrate`'s `^###?\s+Migration` regex is unchanged.

#### Negative Paths
- Given the gate accepts a block (h2 + valid fence), when the same block text is fed to
  `bin/migrate`'s extractor, then `bin/migrate` also matches it — the invariant
  *gate-passing ⟹ migrate-executable* holds (parity test).
- Given the deliberate asymmetry, when a reader inspects `release-gate.ts`, then a comment
  documents that the gate is intentionally stricter (h2) than `bin/migrate` (h2/h3) and must not be
  "re-synced" by loosening the gate or tightening migrate (C4).

### Done When
- [ ] `bin/migrate`'s heading regex is unchanged (still accepts h2/h3).
- [ ] A parity test asserts every gate-accepted fixture is matched by `bin/migrate`'s regex.
- [ ] `release-gate.ts` documents the intentional gate-strict / migrate-lenient asymmetry.

---

## Story 5: No harness-repo-specific CHANGELOG language leaks into shared skills/agents

As a maintainer of the shared harness surface, I want the enforcement to add **zero**
harness-repo-specific CHANGELOG/Migration prose to `skills/` or `agents/`, so consumer projects
that use the harness never inherit self-host-only instructions.

### Acceptance Criteria

#### Happy Path
- Given the feature is implemented, when the diff is inspected, then all new CHANGELOG/Migration
  enforcement lives only in `src/conductor/**` (self-host module), `test/test_harness_integrity.sh`,
  `bin/migrate`, and harness-repo docs (CLAUDE.md, PR template) — not in `skills/**` or `agents/**`.

#### Negative Paths
- Given any change to `skills/remediate/SKILL.md` (if one is needed at all), when it is reviewed,
  then it only adds a **generic** input-source mention (a new `.pipeline/` artifact) with no
  CHANGELOG, `## Migration`, or `bash migration` string — the self-host semantics stay in the
  `.pipeline/` artifact and the TS module.
- Given a guard check, when it greps `skills/**` and `agents/**` for harness-specific Migration
  strings introduced by this feature, then it finds none.

### Done When
- [ ] No new `## Migration` / `bash migration` / CHANGELOG-authoring instruction appears under
      `skills/**` or `agents/**`.
- [ ] Any `remediate` skill edit is generic (input-source only); a grep guard verifies the absence.

---

## Story 6: Docs and this PR's own CHANGELOG entry state the h2 contract correctly

As a contributor, I want the docs to state a single unambiguous `## Migration` (h2) contract and
this PR to model it, so the enforcement and its documentation agree.

### Acceptance Criteria

#### Happy Path
- Given the h2 tightening, when CLAUDE.md ("Release & Update Gates" §2), the gate HALT message, and
  `.github/pull_request_template.md` are read, then all state `## Migration` (h2) + ` ```bash
  migration ` and none imply h3 is acceptable for new blocks.
- Given this PR touches no breaking surface (`test/`, `src/conductor/`, `bin/migrate`, docs — none
  in the classifier), when its `[Unreleased]` entry is authored, then it is a plain Added/Changed/
  Fixed entry with **no** Migration block (C6) — and the new §9d passes on it.

#### Negative Paths
- Given the build agent might reflexively add a Migration block because the feature is "about
  migration blocks," when the plan is followed, then no Migration block is authored for this PR and
  the integrity suite (including new §9d) passes clean.

### Done When
- [ ] CLAUDE.md, the gate HALT message, and the PR template consistently state the h2 contract.
- [ ] This PR's `[Unreleased]` entry has no Migration block and passes §9d.
- [ ] The CHANGELOG documents the behavior change (gate/integrity h2 enforcement; remediate routing;
      `bin/migrate` intentionally unchanged).
