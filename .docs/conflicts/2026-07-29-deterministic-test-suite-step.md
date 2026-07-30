# Conflict Check: Deterministic test-suite step

**Date:** 2026-07-29
**Stories checked:** all 266 files under `.docs/stories/`, all 40 specs under
`.docs/specs/`, and all 139 prior reports under `.docs/conflicts/`
**Result:** **PASS — zero blocking conflicts remain.** Three blocking
contradictions were found and resolved through the operator-approved ADR and
technical stories. No degrading conflict is accepted.

## Conflict: Historical BUILD-tail stories pin model review before deterministic verification

**Stories involved:** “Automated delivery gates SHIP on the aggregate suite,”
“wiring_check step joins the gate loop between build_review and manual_test,”
and “build_review is a first-class loop member gating manual_test” vs
“Reject mechanically invalid builds before paid review”
**Files:** `.docs/stories/full-suite-verification-gate-940.md`,
`.docs/stories/2026-07-12-wiring-reachability-gate.md`,
`.docs/stories/add-a-judgement-gate-at-the-build-manual-test-seam.md`, and
`.docs/stories/deterministic-test-suite-step.md`
**Type:** sequencing
**Severity:** blocking
**Confidence:** 99% — the older acceptance text explicitly pins
`build_review → wiring_check → test_suite`, while the approved story requires
the deterministic pair to pass before `build_review` can dispatch.

**Resolution Options:**

1. Amend exact historical adjacency assertions while preserving every gate's
   evidence, kickback, and downstream safety contract.
2. Keep the old order and continue spending build-review tokens on builds that
   deterministic verification will reject.
3. Run build review concurrently with the deterministic pair, reducing latency
   but still spending review tokens on deterministic failures.

**Resolution:** Option 1, selected by the operator through the approved ADR and
stories. The three historical files now describe the joined deterministic group
before model review, with SHIP still downstream.

## Conflict: Interactive verification cannot be both a skill and deterministic machinery

**Stories involved:** “Direct Claude enforces the same pre-SHIP boundary” vs
“Expose aggregate verification as machinery, not a skill”
**Files:** `.docs/stories/full-suite-verification-gate-940.md` and
`.docs/stories/deterministic-test-suite-step.md`
**Type:** contradiction
**Severity:** blocking
**Confidence:** 99% — the older story requires a direct skill invocation while
the approved architecture removes that skill surface and retains the standalone
deterministic CLI adapter.

**Resolution Options:**

1. Replace the skill-facing clauses with `conduct-ts test-suite`, retaining the
   same `FullSuiteVerifier` and proof semantics.
2. Keep the skill as a model-driven wrapper around the deterministic adapter.
3. Remove standalone interactive verification and support only automated runs.

**Resolution:** Option 1, selected by the operator. The historical story now
requires the provider-neutral deterministic adapter and explicitly excludes
skill, model, and legacy Bash fallbacks.

## Conflict: A stale-evidence story freezes an orchestration boundary it does not own

**Stories involved:** “wiring_check: stale evidence is re-derived, not
re-dispatched” vs “Reject mechanically invalid builds before paid review”
**Files:**
`.docs/stories/wiring-check-retries-on-evidence-it-invalidated-it.md` and
`.docs/stories/deterministic-test-suite-step.md`
**Type:** behavioral overlap
**Severity:** blocking
**Confidence:** 98% — the older story declared engine-native execution and
reordering out of scope, while the newly approved feature changes exactly that
orchestration without changing stale-evidence correctness.

**Resolution Options:**

1. Preserve the stale-evidence acceptance criteria but supersede the obsolete
   orchestration boundary.
2. Preserve the old boundary and reject the deterministic fan-out.
3. Delete stale-evidence re-derivation and recompute all wiring evidence from
   scratch on every group run.

**Resolution:** Option 1, selected by the operator. The story now separates its
authoritative freshness behavior from the superseded execution placement.

## Explicitly compatible overlaps

- **SHIP validation fan-out:** the existing auto-only validation group still
  starts after `build_review`; its concurrency and interactive checkpoint
  contracts are unchanged. Confidence 99%.
- **Full-suite proof:** configuration, fingerprinting, reuse, redaction, lock,
  timeout, process cleanup, evidence, finish fallback, and CI independence are
  preserved. Confidence 99%.
- **Kickback budgets:** the shared gate-keyed counters remain authoritative;
  the deterministic join charges each failed member once and issues one rewind.
  Confidence 97%.
- **Provider routing:** engine-computed steps do not dispatch a provider;
  provider selection for judgment steps and custom skill steps is unchanged.
  Confidence 99%.
- **Catalog parity:** accepted installation stories already require updates to
  make installed discovery match a catalog after a skill is removed and to
  preserve foreign entries. Confidence 98%.
- **Custom-step skill identity:** that draft concerns configured custom skills,
  not built-in engine-native steps, so removing this built-in skill wrapper does
  not constrain custom-step dispatch. Confidence 97%.
- **Resource contention:** the approved shared concurrency cap and stable cap-one
  ordering make CPU/filesystem contention bounded policy, not an incompatible
  exclusive-resource assumption. Confidence 96%.

## Re-check

After applying the approved resolutions, all five conflict classes were
evaluated:

- no contradictory skill or execution surface remains;
- overlapping gate behavior has one authoritative ordering;
- partial, interrupted, and dual-failure states have a single join owner;
- shared resources are bounded by the existing concurrency cap and suite lock;
- no circular or competing prerequisite chain remains.

The conflict check passes with zero blocking and zero degrading conflicts.
