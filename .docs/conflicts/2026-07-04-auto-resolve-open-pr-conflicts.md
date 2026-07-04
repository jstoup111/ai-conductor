# Conflict Check: auto-resolve-open-pr-conflicts

**Date:** 2026-07-04
**New stories:** `.docs/stories/auto-resolve-open-pr-conflicts.md` (11 stories)
**Scanned against:** all `.docs/stories/*.md` (41 files), with focused pair-checks on
rebase-resolution-skill, rebase-resolution-followup, daemon-pr-labels,
daemon-halt-reconciliation, finish-force-with-lease-after-sanctioned-rebase,
make-daemon-build-push-pr-timing, remediation-comment-upsert,
finish-should-rewrite-stale-needs-remediation-titl, daemon-owner-gate,
harness-self-host-guardrails.

**Result: PASSED — zero blocking conflicts.** One alignment adjustment applied; one residual
race documented and accepted.

## Pair analysis (contention surfaces from the review)

1. **Branch-rewrite authority — rekick/build vs auto-resolve** (potential resource
   contention). Halt-reconciliation re-kicks halted worktrees after a base advance and a
   re-kicked build ends in a push; auto-resolve also rewrites PR branches. **No conflict:**
   the eligibility guard (adr-2026-07-04-resolution-worktree-lifecycle §3) skips any slug
   whose build worktree exists — exactly the population rekick operates on — and both writers
   push only `--force-with-lease`, so the residual window (build worktree created mid-
   resolution by a fresh dispatch) degrades to a lease rejection → escalation, never a
   silent overwrite. **Accepted residual race, degrading at worst, mitigation already
   storied** (lease-rejection negative path).

2. **`mergeable` / `needs-remediation` label semantics — daemon-pr-labels** (potential
   state conflict). Existing semantics: `needs-remediation` ⇒ human owns it, `mergeable`
   kept absent (sweep FR-12); `mergeable` re-added when the PR reads mergeable. New stories
   adopt the same meanings: sticky `needs-remediation` suppresses auto-resolution; the label
   pass restores `mergeable` after a successful refresh. **No conflict — semantics reused,
   not redefined.**

3. **Watch-registry schema — daemon-pr-labels enrollment** (potential resource contention).
   Existing entries `{prUrl, slug, repoCwd}`; new optional `resolveAttempts`/`lastResolveAt`
   with zero-defaults, round-tripped by the existing `rewriteWatch`. Legacy entries parse
   unchanged (negative path storied). **No conflict — backward-compatible extension.**

4. **Escalation comments — remediation-comment-upsert** (behavioral overlap). That feature
   establishes marker-tagged `upsertComment` (one comment, edited in place). The new
   escalation story originally said "one comment per occurrence", which could accumulate
   comments across occurrences. **Resolved (least-disruptive):** escalation story updated to
   post via the marker-tagged upsert convention — later occurrences update the same comment.

5. **Force-push policy — finish-force-with-lease-after-sanctioned-rebase +
   adr-2026-07-03-post-rebase-force-with-lease** (potential contradiction with "no ad-hoc
   rebase" rule). The new flow is a second *sanctioned* rebase site, formalized by the
   APPROVED amending ADR (adr-2026-07-04-widen-rebase-resolution-dispatch-to-sweep); push
   policy identical (`--force-with-lease`, never bare). **No conflict.**

6. **PR-timing configurability (make-daemon-build-push-pr-timing)** (sequencing). Deferred
   PR opening merely delays watch enrollment; auto-resolve acts only on enrolled PRs.
   **No conflict.**

7. **Finish-time behavior unchanged** (sequencing/regression). Covered by a dedicated
   story asserting existing rebase/step-runner suites pass unmodified. **No conflict.**

## Resolutions applied

- Story "Escalation marks the PR for a human with a concrete reason": comment mechanism
  aligned to the marker-tagged `upsertComment` convention (see §4 above).

## Accepted degrading notes

- Residual dispatch-vs-resolution race (§1): bounded by worktree guard + lease push;
  worst case is an escalation comment for a conflict a human then re-clears.
