# Complexity: mid-loop-pipeline-wipe-549

Tier: M

## Signals
- Models: 0
- Integrations: 0
- Auth: 0 (none)
- State machines: 0 new (modifies the conductor's existing step/kickback/teardown flow)
- Stories (est.): 6 (crash-guard happy path; scoped-cleanup happy path; root-cause
  regression test pinning finish→build kickback; negative: legitimate post-ship
  cleanup still clears; negative: crash-handler still surfaces a real HALT; negative:
  missing `.pipeline` root at an arbitrary read site degrades, not crashes)

## Rationale
Raw signal counts (0/0/0/0) read Small, but this is deliberately tiered **Medium**:
the change edits the conductor's crash/teardown/kickback semantics — a subtle,
high-blast-radius area — and carries a genuine negative path (outcome #4: legitimate
end-of-feature cleanup must still clear what it should). A lightweight
`/architecture-review` (does scoping cleanup to per-artifact paths regress post-ship
teardown? does mkdir-p-before-write mask a real "pipeline never provisioned" fault?)
and a `/conflict-check` (against the #505 build-step-marker clearing, the fresh-session
resetSession sweep, and the self-build sandbox teardown, all of which also touch
`.pipeline`) are cheap insurance against a regression in engine state durability.
Not Large: no new models, integrations, auth, or state machines.
