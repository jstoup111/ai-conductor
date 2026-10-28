# Complexity: Path policy decides feature ownership from the artifact manifest (#3418, spec 2 of 3)

Tier: L

Stacked-Delivery: approved

Rationale:
- **Breadth.** Seven independent path policies decide ownership by folder and basename today: the
  protected-artifact seal (`protected-artifact-seal.ts`, `namesOwnFeature`), the bash pre-commit hook
  (`git-hook-assets.ts`, a second copy of the stem rule), the BUILD docs write allowlist
  (`phase-marker.ts`), gate invalidation (`rebase.ts` `resolveReviewInputs`, `gate-invalidation.ts`),
  rebase conflict handling (`docsKeepBothResolver`), retention and prune (`docs-retention.ts`,
  `docs-prune.ts`) and the build_review graded diff (`build-review-inputs.ts`).
- **New enforcement.** One engine ownership result with manifest protection against any tool and a
  two-way drift check, evaluated at every BUILD/SHIP step entry and at land.
- **Contract surfaces.** The phase-marker format the shipped pre-commit hook reads gains lines, and
  the operator CLI gains a registration command, so the release gate applies.
- **Architecture.** At least six APPROVED ADRs on the seal, the docs write guard, delta-aware
  invalidation, rebase resolution and prune retention are in play, plus the manifest ADR this spec
  completes. That needs a full architecture review.
- **Consumer-facing contract.** Consumer repositories run this engine, so specs without a manifest
  must behave exactly as today under every policy.
- **Size.** Expect 5 to 6 stories and 18 to 24 plan tasks, delivered as stacked children (operator
  preference recorded 2026-10-28).
