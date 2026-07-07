# ADR: TR-10 migration gate accepts a committed no-breaking-surface waiver

**Date:** 2026-07-06
**Status:** APPROVED
**Feature:** self-host-release-gate-bin-conduct-breaking-surfac (fix #354)
**Amends:** adr-2026-06-30-halt-based-release-gates (adds a third satisfying condition to
TR-10; the fail-closed default and HALT machinery are unchanged)
**Related:** adr-005-non-autonomy-and-read-only-governor,
.docs/architecture/2026-07-05-changelog-migration-block-enforcement.md (#282)

## Context

`classifyBreakingSurfaces` (release-gate.ts:180) is path-based: any diff touching
`bin/conduct` (or `hooks/`, `settings*.json`, `bin/install`) is classified breaking,
regardless of content. An internal-only edit (e.g. deleting a private helper) therefore
guarantees a "Migration block required" HALT even when the build's plan correctly reasoned
that no migration is warranted — the gate cannot consume that reasoning
(observed: `drop-check-harness-config-consumer-claude-md-harne`, 2026-07-05, HALTed twice).

A semantic diff of the CLI surface was rejected: bash parsing is fragile (introduces false
*negatives*, the worse failure mode for a fail-closed gate), fixes only `bin/conduct` while
the same false-positive class remains for hooks/settings, and is throwaway work — #226/#228
delete `bin/conduct` at the v1.0 cutover.

## Decision

TR-10 (`evaluateMigration` path inside `runReleaseArtifactGate`) gains a third satisfying
condition. The gate passes when ANY of:

1. no breaking surface classified and the change set is not uncertain (unchanged);
2. a runnable ```bash migration``` block exists under `## Migration` (unchanged);
3. **NEW:** a **valid waiver** exists at `.docs/release-waivers/<plan-stem>.md`.

A waiver is valid iff ALL of:

- **W1 — freshness binding:** the waiver file itself appears (status A or M) in the same
  `base...HEAD` change set the classifier consumed. A stale waiver from a previously merged
  change lives in `base` and can never waive a future diff.
- **W2 — machine-checkable format:** it parses into a `Waives:` list of canonical surface
  names plus a non-empty rationale. Canonical names are the exact strings the classifier
  emits (`bin/conduct CLI`, `hook wiring`, `settings.json schema`, `skill symlink targets`),
  exported as constants so the parser and classifier cannot drift; an unknown name is
  malformed.
- **W3 — full coverage:** the waived surface set is a superset of the classified surface
  set. A waiver naming only `bin/conduct CLI` does not stretch to a `hook wiring` touch
  added later on the same branch.
- **W4 — determinable change set:** an uncertain (null) change set is unwaivable — W1 is
  unprovable, so the gate stays fail-closed and HALTs exactly as today.

Any invalid/missing waiver falls through to today's behavior; the HALT reason additionally
names the waiver path so future builds (and the #282 remediate route, when built) learn the
remediation. The harness repo's own `CLAUDE.md` release-gate section documents when a waiver
is appropriate — repo-contained authoring guidance, not a harness-wide skill change.

**Containment:** all logic lives in `src/conductor/src/engine/self-host/release-gate.ts`
behind the existing `selfHost === true` activation; consumer-project pipelines are
byte-for-byte unchanged. `version-signal.ts` (`detectMajorSurfaces`, semver-MAJOR signal)
shares the path heuristic but is explicitly out of scope — follow-up issue.

## Evidence (verify-claims)

- Gate seams (`readText`, `changedFiles` injection) exist and are hermetically testable —
  **verified** (`ReleaseGateOptions`, `release-gate.test.ts`).
- The waiver file, committed on the spec/impl branch, necessarily appears in
  `git diff --name-status <base>...HEAD` — **verified** by construction of
  `selfBuildChangedFiles` (conductor.ts).
- `.docs/` is git-tracked in this repo — **verified** (`git ls-files .docs`).
- No existing `waiver` identifier or `.docs/release-waivers/` path collides — **verified**
  (grep over `src/conductor/src`).

## Consequences

- **Positive:** internal-only edits to breaking-surface *files* flow through without a
  guaranteed operator HALT; genuinely breaking changes still require a migration block or an
  explicit, operator-reviewed waiver.
- **Positive:** works for all four classified surfaces and survives the v1.0 deletion of
  `bin/conduct`.
- **Negative / accepted residual risk:** a build could rubber-stamp a waiver where a
  migration block was warranted. Mitigations: W2 forces an explicit rationale naming exact
  surfaces; the waiver sits in the PR diff the operator reviews before merge (ADR-005 —
  the human-merge invariant is the backstop); waiver misuse is auditable per plan-stem.
- **Negative:** a new artifact format to maintain; mitigated by exporting canonical surface
  names from one module.

## Alternatives rejected

- **Semantic bash diff of the CLI surface** — fragile, single-surface, throwaway at v1.0
  (see Context).
- **Free-prose justification consumed from the plan doc** — not machine-checkable; the gate
  would be parsing reasoning, not a contract.
- **Waiver via `.pipeline/` marker** — not part of the reviewed PR diff, violates the
  operator-review backstop, and `.pipeline/` is gitignored (fails W1 by construction).
- **Fail-open when the plan says "no migration needed"** — the gate must not trust an
  artifact it cannot validate; rejected per adr-2026-06-30 fail-closed rule.
