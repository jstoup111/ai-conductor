# Conflict Check: Guard bin/install and self-build relink against worktree-rooted global installs (#363)

**Date:** 2026-07-06
**New stories:** `.docs/stories/guard-bin-install-and-self-build-relink-against-wo.md` (TR-1…TR-5)
**Result:** PASSED — zero blocking, zero degrading conflicts

## Pairs examined (reasoned through, not assumed)

1. **TR-3 (fail-loud preflight) vs `harness-self-host-guardrails.md` relink story (as-built).**
   The as-built story specifies the preflight's negative branches: `resolveHarnessRoot()` null →
   log-and-skip; `bin/install` non-zero → `InstallStaleError`, no dispatch; missing/non-executable
   installer → keyed error. TR-3 preserves all three verbatim and ADDS a rejection branch for a
   worktree-derived root. The as-built text names `resolveHarnessRoot()` as the discovery
   mechanism; the new stories amend that mechanism (installed-root resolver) without contradicting
   any stated acceptance criterion — the worktree case was unspecified (the #363 gap), not
   specified differently. Confidence: 95% (both texts read side-by-side). **Not a conflict** —
   intended amendment, governed by APPROVED adr-2026-07-06-installed-root-resolution-for-global-writes.

2. **TR-5 (detector regression proof) vs `harness-self-host-guardrails.md` detector story.**
   Identical expectations (path-equality true, non-harness false, null root false). TR-5 exists to
   guarantee the as-built story stays true. **Reinforcing, not conflicting.**

3. **TR-4 (sandbox harnessRoot) vs `harness-self-host-guardrails.md` sandbox stories.** The
   as-built stories require settings retargeting harness→worktree and personal-hook paths
   untouched; TR-4 makes the documented retarget actually fire for worktree-run engines and
   re-asserts the personal-hook invariant. **Not a conflict.**

4. **TR-1 (installer refusal) vs `2026-07-03-daemon-auto-restart-stale-engine.md` +
   `harness-daemon-profile.md` (relink invoked → dispatch proceeds).** Those flows run the
   installer at a main-checkout root, where TR-1 changes nothing. **Not a conflict.**

5. **TR-1 vs `mermaid-renderer.md` / `2026-07-05-changelog-migration-block-enforcement.md` /
   `multi-operator-ownership-hardening.md` (mention bin/install incidentally).** No shared
   behavioral surface with the guard. **Not a conflict.**

Conflict types checked across all pairs: contradiction, behavioral overlap, state conflict,
resource contention, sequencing. No story pair shares mutable state or ordering assumptions with
the new stories beyond the pairs above.

## Notes

- No story updates required; no ADR superseded.
- Clean pass → proceed to `/plan`.
