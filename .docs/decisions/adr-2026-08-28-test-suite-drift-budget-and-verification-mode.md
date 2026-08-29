# ADR: test_suite drift budget and verification mode

**Date:** 2026-08-28
**Status:** APPROVED
**Deciders:** James Stoup (operator), engineer DECIDE session for jstoup111/ai-conductor#2021

## Context

The `test_suite` gate re-runs and re-passes the full project suite roughly ten times per
feature (#2021's measurements: 13 started / 10 passed on one feature, ~3 minutes each). The
re-run driver is not the post-rebase classifier: it is the combination of
`treeAttestingCompletion: true` (the fingerprint predicate is re-evaluated on every loop
pass — `conductor.ts` tree-attesting recheck), explicit `{ test_suite: 'stale' }` restages
after every tree-changing BUILD event, and a fingerprint whose reuse key covers the entire
project input set, so ANY code or test delta — including foreign main-side drift the feature
never touched — reads STALE and forces a full aggregate run. Each forced re-run is another
chance for an unrelated flake or foreign breakage to spend one of the two BUILD kickbacks
(`kickback-ledger.ts`, `MAX_KICKBACKS_PER_GATE = 2`) and halt an already-green feature
(observed `loop_halt` 2026-08-22).

Constraints established by governing APPROVED decisions:

- `adr-2026-07-25-content-addressed-full-suite-proof` D7: freshness is recalculated at every
  engine/CLI/finish entry; indeterminate freshness never reuses evidence.
- `adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch` D1: `test_suite`'s membership
  in the tree-attesting set is justified by the fingerprint being re-read on every
  evaluation; changing the set is an ADR-level act.
- `adr-2026-07-20-post-rebase-delta-aware-invalidation`: a gate's declared dependency surface
  must be a conservative superset of every input whose change could flip the verdict; when in
  doubt, widen toward re-run.
- `adr-2026-08-01-engine-owned-scoped-test-invocation` D7/D8: a scoped run never expands in
  place; aggregate verification semantics are unchanged by the scoped interface.
- `docs/explanation/gates.md`: "the fingerprint is re-inspected every time, so the evidence
  file's existence can never satisfy it."

The verified mechanical substrate (Explore sweep, 2026-08-28, file:line cites in the
architecture review):

- PASS evidence already persists `provenanceHeadSha` and all eight per-category fingerprints
  (`full-suite-evidence.ts` v3 schema; `full-suite-fingerprint.ts` categories at
  `FULL_SUITE_FINGERPRINT_CATEGORIES`).
- On a digest mismatch, `changedFingerprintInspection` already produces a typed per-category
  stale reason (`source_changed`, … `multiple_categories_changed` + `changedCategories[]`).
- A fingerprint-identical tree already reuses without running (`ensure()` → `REUSED`).
- The gate hard-requires `test_suite.command`; no path executes `scoped_command`
  (`full-suite-verifier.ts` "must declare test_suite.command").
- The verifier has no merge base or feature surface; scoped callers today receive selectors
  from the caller (scoped-run CLI argv; build_review testQuality preflight derives them from
  its own diff inputs).

## Options Considered

### Option A: Pass-once flag (skip inspection after first PASS)
- **Pros:** trivially delivers "runs once per feature".
- **Cons:** contradicts `gates.md`'s inspect-every-time contract verbatim; silently evicts
  `test_suite` from the tree-attesting set (adr-2026-08-19 D1); destroys the attestation the
  proof exists to provide. Rejected.

### Option B: Budget consulted at the conductor's restage sites
- **Pros:** verifier untouched.
- **Cons:** the tolerance logic scatters across ≥4 restage/recheck sites; the tree-attesting
  set becomes effectively per-project (exactly what D1 forbids as a code-local edit); the
  evidence cannot record what a preserved PASS covered. Rejected.

### Option C: Category-keyed drift budget judged inside the verifier; verification mode as
first-class config
- **Pros:** inspection still happens on every evaluation — the budget changes only the
  consequence of an observed mismatch; single choke point (`resolveInspection`); reuses the
  persisted category fingerprints and `provenanceHeadSha`; evidence and events record exactly
  what was tolerated; unset config is byte-for-byte today's behavior.
- **Cons:** weakens the shipped-tree attestation from "identical tree" to "tree within a
  declared, recorded drift budget" — accepted deliberately, opt-in per project, with the
  drift record preserving traceability; requires amending three governing ADRs.

## Decision

Choose **Option C**.

### D1 — The eight fingerprint categories become a public, closed config vocabulary

The category set (`additional_inputs`, `dependencies`, `environment`, `migrations`,
`project_config`, `source`, `test_infrastructure`, `tests`) is promoted from an internal enum
to the operator-facing drift-budget vocabulary. It is a **closed set**: a budget key naming
anything else is a config `validation_error` at load. Extending the category set is an
ADR-level act (supersede or amend this ADR), because every category name is now a compat
surface in project config, evidence, and events.

### D2 — New optional config block `test_suite.verification`; absence is exactly today

```yaml
test_suite:
  command: "npm test"
  scoped_command: "npm test -- {selectors}"   # existing key, unchanged semantics
  verification:
    mode: aggregate            # aggregate (default) | scoped
    drift_budget:              # absent = zero tolerance in every category
      source: 20               # max distinct changed paths tolerated since the attested PASS
      tests: none              # 'none' = any drift re-runs (the default for every category)
      test_infrastructure: none
      additional_inputs: unlimited
```

Both keys are additive and optional. With the block absent (or any key absent), behavior is
identical to today: aggregate command, zero drift tolerance, re-run on any category change.
Per `adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal` Decision 4, both
keys enter the consumer registry in the same change that introduces them.

### D3 — Budgetable and unbudgetable categories are fixed by this ADR, not by config

- **Unbudgetable** (any drift re-runs, regardless of config): `dependencies`, `migrations`,
  `environment`, `project_config`. Rationale: each invalidates the meaning of the prior run
  at n=1 — a moved dependency or migration changes what the suite would test; a
  `project_config` change can change the command itself; `environment` is HMAC'd precisely
  because its values steer execution. A `drift_budget` key naming an unbudgetable category is
  a load-time `validation_error` naming the category — never silently ignored.
- **Budgetable**: `source`, `tests`, `test_infrastructure`, `additional_inputs`. Values:
  `none` (default), a positive integer (max distinct changed paths in that category,
  cumulative since the attested PASS), or `unlimited`.

This satisfies `adr-2026-07-20`'s soundness invariant by construction rather than by
narrowing: the observed surface is untouched (the fingerprint still covers every input; the
inspection still runs); the budget is an explicit, operator-declared, bounded tolerance
applied AFTER total observation, with the fail-closed default (`none`) and the four
invalidate-at-any-drift categories locked in the engine.

### D4 — The judgement point is `FullSuiteVerifier.resolveInspection`, and it never skips
the fingerprint

On every evaluation the fingerprint is computed and compared exactly as today. On digest
match: `CURRENT` (unchanged). On mismatch, the verifier measures drift **from the attested
PASS's provenance state** — `git diff --name-only <provenanceHeadSha>..HEAD` plus
worktree-dirty paths, classified by the same category regexes the fingerprint uses — and
judges the per-category counts against the declared budget:

- Every drifted category budgeted and within its bound → **PRESERVED_WITHIN_BUDGET**: the
  recorded PASS stands; the evidence gains an appended drift record (categories, per-category
  path counts, current head); an event is emitted (D7). The suite does not run.
- Any unbudgetable category drifted, any budgeted bound exceeded, or the drift measurement
  itself is indeterminate (unresolvable provenance SHA, git failure) → **re-run**, with the
  stale reason naming the exhausted or unbudgetable category (or the indeterminacy).
  Indeterminate drift never preserves — `adr-2026-07-25` D7's fail-closed direction is
  retained.

The budget is cumulative against the attested PASS, not against the previous evaluation: a
feature cannot ratchet unlimited drift through repeated small preservations. When a re-run
records a new PASS, drift measurement restarts from that PASS's provenance state.

> **Amended 2026-08-29 by the operator (as-built review AB-3,
> `test-suite-re-runs-and-re-passes-the-full-suite-10`):** this decision requires the drift
> record to be appended when a PASS is preserved; it does **not** locate that append inside the
> completion predicate. `adr-2026-08-19-tree-attesting-gates-recheck-before-dispatch` D3 stands
> unamended: the completion re-check reads and never writes, and the rejection it holds shut
> (`adr-2026-07-11-verdict-aware-resume-entry` Option C — "side-effectful read", two authorities
> for one state) is not reopened.
>
> The append is therefore performed by a distinct recording seam, invoked by the caller that
> acted on the judgement, never by `resolveInspection` or by anything the predicate reaches.
> `FullSuiteVerifier` inspection returns the preservation outcome as a value; each caller — the
> dispatched `test_suite` evaluation, the generic tree-attesting completion path, and the daemon
> re-kick pre-verification — carries that one result forward, records it once through the seam,
> and emits D7's event from the same result. No caller re-inspects to recover a preservation
> outcome it already holds: a second inspection observes the first one's write and reports
> `CURRENT`, losing the basis it was called to obtain.
>
> **Rationale.** The two decisions were never in conflict on substance — D4 says the record must
> be written, D3 says the question is not what writes it. Both hold once the write has its own
> home. Placing it there also removes the double-inspection defect the shipped code exhibited on
> the daemon path, so one structural change satisfies both this decision and D7.

### D5 — Verification mode is a first-class, load-validated choice

`verification.mode: scoped` requires a valid `scoped_command` (with `{selectors}`) at config
load; the violation message names the missing key. In scoped mode the gate derives selectors
from the feature surface (merge-base..HEAD changed paths, the same derivation
`gate-code-validity.ts` uses) restricted to paths the fingerprint classifies as `tests`, and
executes through the existing engine-owned scoped interface (`scoped-run.ts` — argv
assembly, quoting, empty-selection refusal all unchanged). An **empty selection routes to the
aggregate verifier** — the route recorded in evidence and events, per
`adr-2026-08-01` D7's "a broad fallback routes; it never expands"; it is never a silent
degradation because the evidence names the route taken. Selector derivation stays
framework-agnostic (paths only, per
`adr-2026-08-17-framework-agnostic-tautology-scoped-run`); the engine never maps source
files to covering tests.

A scoped PASS satisfies the gate **only in scoped mode** — this is the deliberate, recorded
amendment to `adr-2026-08-01` D7/D8 and to story #588's "no gate semantics change" boundary.
In aggregate mode (and everywhere config is absent) aggregate semantics are untouched. The
scoped run's identity is captured: the fingerprint normalization additionally covers
`scoped_command` and the resolved selector set whenever mode is scoped, so a selector-set
change stales a scoped PASS.

### D6 — Evidence schema records what the PASS covered (version bump)

`.pipeline/test-suite-evidence.json` bumps its version and adds: `mode`
(`aggregate | scoped`), `selectors` (scoped mode), and `driftLedger` — append-only records
`{at, headSha, categories: {name: pathCount}}` for each PRESERVED_WITHIN_BUDGET judgement
since the attested PASS. Together with the existing `provenanceHeadSha` this delivers the
traceability outcome: an operator can name the attested commit, the mode and selection it
ran under, and every tolerated drift increment since — from `.pipeline/` alone.

### D7 — Outcomes ride the existing event spine

No new channel. The existing `test_suite_verification` event gains `mode` and a
budget-verdict field (`preserved_within_budget` with the drifted categories, or the
exhausted/unbudgetable category that forced the re-run), and is emitted on preservation as
well as on staleness. `build_member_evidence_reused` gains the same `mode` field. On the
post-rebase path a within-budget preservation surfaces through the existing
`rebase_gate_preserved` event with a budget basis. Because the gate is *preserved*, no
invalidation occurs and no `build_review` convergence refund
(`adr-2026-08-18-rebase-invalidation-refunds-build-review-convergence`) is due — the refund
stays keyed on genuine invalidation, never suppressed retroactively.

### D8 — Bootstrap asks; `conduct-ts config init` writes

`conduct-ts config init` gains optional flags (`--test-suite-mode`,
`--test-suite-drift-budget <preset>`, presets: `strict` = today, `tolerant` = the budgetable
categories at a documented bound) that substitute the answers into the generated
`test_suite.verification` block. The bootstrap skill asks the operator both questions
(auto-mode: `strict` without prompting) and records the answers **through the CLI** — the
hand-authoring prohibition stands. This amends
`adr-2026-07-27-project-config-scaffolder`'s bare-copy decision: the template remains the
sole source shape; `config init` becomes a parameterized instantiation of it rather than a
byte copy, still deterministic and refuse-to-clobber.

## Consequences

### Positive

- A feature reaches SHIP having run the full suite once under a declared budget (~30 min
  reclaimed per feature on this repo; hours on slow-suite consumers).
- Foreign main-side drift within budget can no longer force a re-run — so it can no longer
  burn a BUILD kickback via an unrelated flake; only genuine re-runs reach the kickback path.
- The chosen mode and every tolerated drift are auditable from evidence + events without
  reading engine code.
- Unset config keeps every existing project byte-for-byte on today's semantics.

### Negative

- The shipped-tree attestation weakens, opt-in, from "identical tree" to "tree within a
  declared, recorded budget" — a within-budget foreign change that would have broken the
  suite ships unverified by this gate (CI remains independently authoritative and nothing
  ships on red CI).
- Scoped mode verifies strictly less than the aggregate (changed-test selection only);
  projects choose it with that trade-off documented.
- The eight category names and the evidence/event fields become compat surfaces.
- Three governing ADRs carry amendment notes; the cross-artifact story amendment for #588's
  scope boundary must land via a companion main-based PR (foreign-stem story edits are
  rejected by the engineer land gate).

### Follow-up Actions

- [ ] Amendment notes added to `adr-2026-07-25` (D7), `adr-2026-08-19` (D1),
      `adr-2026-08-01` (D7/D8), `adr-2026-07-20` (soundness invariant),
      `adr-2026-08-18` (refund basis), `adr-2026-07-27` (config init instantiation) — same
      spec branch.
- [ ] Both new config keys registered in the `adr-2026-08-26` consumer registry in the
      implementing change.
- [ ] `docs/reference/configuration.md`, `docs/explanation/gates.md`,
      `docs/reference/cli.md`, and `skills/bootstrap/SKILL.md` updated in the implementing
      change.
- [ ] Companion main-based PR amending story
      `.docs/stories/reduce-redundant-full-test-suite-runs-in-build-shi.md`'s scope boundary.
