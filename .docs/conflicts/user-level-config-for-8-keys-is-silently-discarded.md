# Conflict Check: User-level configuration precedence (#1000)

**Date:** 2026-07-30
**Result:** CLEAN — zero blocking or degrading conflicts.

## Scope Reviewed

The inventory covered 269 story files, 42 spec files, and 142 prior conflict reports. Semantic comparison focused on the new stories plus every artifact mentioning configuration loading, validation, project/user precedence, or any of the eight affected keys. Approved active artifacts were treated as authoritative; draft or superseded specs were informational only.

All five conflict categories were evaluated: contradiction, behavioral overlap, state conflict, resource contention, and sequencing conflict.

## Findings

- **Daemon merged configuration (#967): compatible.** Its established contract says explicit project values override matching user values while unrelated user values survive. The new stories repair the validator behavior that violates that contract and preserve source-specific project validation.
- **Partial `build_review` / `ci_watch` blocks (#1002): compatible.** Those stories require valid sibling keys and per-key warnings to survive normalization. The new immutability story explicitly preserves all existing normalized results and warnings, so purity cannot reintroduce whole-block replacement.
- **Project-config scaffolding (#683): compatible.** The scaffolder controls which keys appear in the seed template; #1000 controls precedence after files exist. Supporting explicit project values does not require adding any affected key to the template.
- **Project-only full-suite and inline loading: compatible.** Existing stories rely on ordinary `loadConfig` behavior. The new source-safeguard story retains its runtime-ready defaults and confines absent-default deferral to merged loading's project pre-pass.
- **Machine identity and `spec_owner`: compatible.** Existing anti-leak decisions require project-source rejection before merge; the new stories preserve that failure verbatim.
- **Affected feature stories: compatible.** Auto-restart, engine refresh, attribution sampling, build progress halt, kickback escalation, retry routing, build review, and CI watch continue using their documented defaults and malformed-value contracts. The change only makes a valid user value observable when the project omitted that key.
- **Legacy config-loading story:** no new conflict. Its stale path and unknown-key wording are already superseded by current loader behavior; #1000 neither relies on nor expands those historical statements.

## Internal Consistency

- Story 1's pure validation result is the prerequisite for Story 2's order-independent merge behavior.
- Story 3 constrains Story 2's deferred-default behavior so it cannot leak into ordinary project-only loading.
- No story requires user precedence over an explicit project value, and no story requires injected project defaults to erase user policy.

## Resource and Sequencing Review

The change introduces no shared runtime resource, lock, database, queue, or lifecycle state. Implementation sequencing is straightforward: establish the pure/source-aware validation seam, prove precedence and compatibility, then update the canonical configuration reference. These dependencies are plan concerns, not conflicting story requirements.

## Verify-Claims Verdict

CLEAR. Each compatibility judgment was grounded in the cited story text, approved review, current source, or canonical configuration documentation. No unconfirmed load-bearing assumption was used.
