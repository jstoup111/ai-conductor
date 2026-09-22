# Conflict Check: attributable live-boundary fingerprint cost (#1219)

**Date:** 2026-09-21
**Result:** CLEAN — zero blocking or degrading conflicts.

## Scope Reviewed

Inventory: 470 story files and the prior conflict reports touching the self-host boundary
(`2026-06-30-harness-self-host-guardrails`, `2026-07-26-codex-safety-and-self-host-parity-907`,
`2026-07-29-boundary-aware-operator-parking`, `live-boundary-guard-cannot-attribute-a-live-checko`,
`non-daemon-projects-inherit-self-host-config-inste`). Twenty-four existing story files mention the
live boundary, its events, or `EVENT_SINKS`; semantic comparison focused on the four that assert
behavior on the same surface. All six conflict types were evaluated, and every pair sharing a
surface was tested in both directions.

## ADR Corpus (`conflict_check.adr_corpus: repo_wide`)

All 592 files under `.docs/decisions/` were swept in four non-overlapping slices during this
feature's architecture review; the full digest is in
`.docs/decisions/architecture-review-2026-09-21-generated-project-artifacts-delay-provider-startup.md`.

**Examined against the stories (subject overlaps):**

| ADR | Outcome |
|---|---|
| adr-2026-08-17-structural-live-checkout-containment | Compatible — see Finding 1 |
| adr-2026-08-09-worktree-local-provider-scratch | Compatible — it forbids exclusion widening; the stories add no exclusion and Story 3 pins the sets unchanged |
| adr-2026-07-26-event-sink-registry-exhaustiveness | Compatible — Story 2's Done When declares the new member in `EVENT_SINKS` |
| adr-2026-07-10-intra-step-build-progress-events | Compatible — Story 2 requires persistence and daemon rendering, the obligations it names |
| adr-2026-07-29-engine-observed-provider-time-partition | Compatible — the event reports engine-measured fingerprint time and writes neither elapsed-time field that ADR owns |
| adr-2026-08-26-setup-once-per-worktree-marker | Compatible — precedent for one additive render+persist variant; no shared state |
| adr-2026-07-07-audit-trail-event-sink | Compatible — `audit: false`; the audit sink is untouched |

**Narrowed out (no subject overlap after the scope was narrowed to the duration signal):**
adr-2026-06-30-self-host-detection-seam, adr-2026-07-27-project-config-scaffolder, and
adr-2026-08-26-config-key-consumer-registry-and-dead-surface-removal (no config key is added);
adr-2026-07-04-versioned-engine-store-atomic-flip, adr-2026-06-30-sandbox-build-isolation,
adr-2026-07-08-main-checkout-leak-triage-and-write-fence, adr-2026-08-19-live-provider-stream-observation,
adr-2026-08-09-hook-owned-containment-event-ledger, and the remainder of the corpus, none of which
addresses the fingerprint's return value or a fingerprint-duration event. No ADR was excluded on
supersession grounds.

## Findings

1. **`live-boundary-guard-cannot-attribute-a-live-checko` and ADR
   adr-2026-08-17-structural-live-checkout-containment D4: compatible (85%).** Both say
   `fingerprintLiveBoundary` is "unchanged", and Story 1 adds measurements to its return value.
   The story's sentence is a Done When over that feature's own shipped diff ("a diff review
   confirms no exclusion entry was added"), and D4's is the scope statement of that ADR's change
   ("nothing else changes"). Neither is a standing criterion that the function's signature is
   frozen; the standing position both protect — no exclusion is added, leak detection is
   byte-for-byte preserved — is exactly what Story 3 pins. Satisfying Story 1 leaves every
   criterion of that story true, and satisfying that story leaves Story 1 satisfiable.
2. **`live-boundary-halts-self-host-builds-when-the-oper`: compatible.** It governs
   `verifyLiveBoundary`'s operator-edit classification and `describeDiff` output. Story 3 requires
   those halts and reasons unchanged; measurements never enter the manifest comparison.
3. **`codex-safety-and-self-host-parity-907`: compatible.** It requires a live-boundary failure to
   prevent a passing verdict and live configuration to stay unchanged. The new event is emitted
   only for a completed fingerprint and alters no verdict path.
4. **`interrupted-self-host-runs-leak-provider-homes-unt`: compatible.** It adds its own union
   variants with the same "emission failure never throws into dispatch" contract Story 2 states;
   distinct event types, no shared field or resource.
5. **Remaining twenty story files:** they mention the boundary or `EVENT_SINKS` only as context
   for unrelated features (build-review events, OTel export, halt events); none asserts behavior
   about the fingerprint's result or a pre-provider event.

## Internal Consistency

- Story 1 (measurements as returned data) is the prerequisite for Story 2 (the single emission).
- Story 3 constrains Stories 1 and 2: instrumentation may not alter manifests, exclusion sets, or
  verification outcomes. Fully satisfying Story 3 leaves Stories 1 and 2 satisfiable, and the
  reverse — no oscillation.
- No story claims a latency improvement (architecture review condition C-2).

## Resource and Sequencing Review

No shared mutable resource, lock, or lifecycle state is introduced. The one new name,
`self_host_boundary_fingerprint`, collides with no existing `ConductorEvent` type.
