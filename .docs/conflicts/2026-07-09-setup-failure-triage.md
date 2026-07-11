# Conflict Check: Setup-before-dispatch wedge — deterministic setup-failure triage (#446)

**Date:** 2026-07-09
**New stories:** `.docs/stories/setup-before-dispatch-wedge-deterministic-setup-fa.md` (TS-1..TS-5)
**Corpus:** 91 story files scanned; interaction-relevant pairs reasoned individually below.
**Result:** 1 blocking conflict found and RESOLVED (operator-selected Option 1); zero remaining.

## Conflict: setup-failure terminal outcome (RESOLVED)

**Stories involved:** harness-daemon-profile TR-1 ("bin/setup builds the worktree toolchain")
vs TS-2/TS-3
**Files:** `.docs/stories/harness-daemon-profile.md` vs
`.docs/stories/setup-before-dispatch-wedge-deterministic-setup-fa.md`
**Type:** overlap (behavioral)
**Severity:** blocking (before resolution)

**Description:** TR-1's negative paths asserted setup exit≠0 ⇒ worktree kept + feature
immediately marked errored, with a pinned Done-When test. TS-2/TS-3 route the same event to
triage first (quarantine/retry, then one fix-session); errored/HALT becomes the terminal
outcome only when triage exhausts. Both cannot hold for the same event. Confidence the texts
genuinely contradicted: 95% (direct quote comparison).

**Resolution (operator-selected, Option 1 — least disruptive):** supersession notes added to
TR-1's two negative paths and its pinned Done-When checkbox, pointing at the #446 stories.
"Worktree kept" remains true and unannotated. The #446 plan must include updating the pinned
prepare-failure test (`keep-worktree/errored` → `keep-worktree/routed-to-triage`).

## Pairs examined and clean (reasoned, not assumed)

| Pair | Why clean |
|---|---|
| reenable-bin-setup-worktree-smoke (#334) | Tests the `bin/setup` script itself in a CI smoke; asserts nothing about daemon dispatch outcomes. Triage does not alter the script or its exit-code contract. |
| operator-park stories | Parked features never reach the prepare seam — `pickEligible` gates dispatch upstream (verified in daemon.ts); triage cannot resurrect a park. |
| rate-limit-episode / episode-halt sweep | TS-4 mandates park semantics identical to today's error-park, so `onHaltWritten` episode stamping is unaffected. |
| leak triage (#380/#435) | Heals the MAIN checkout; quarantine acts on the feature worktree — disjoint resources, and both follow the same preserve-then-heal discipline. |
| rebase resolver / rekick rebase stories | Triage runs at prepare, BEFORE any conductor rebase step; a quarantine-cleaned tree makes those rebases more likely to succeed (issue instance 2). No contention, no circular sequencing. |
| retry-as-escalation | Escalation applies to step-level retries inside the conductor loop; setup failure is pre-conductor. Different lifecycle stage. |
| #351 build-auth isolation spec (PR #404) | Changes build credential sourcing, not the setup seam contract. Compatible. |
| Branch namespace `wip/setup-quarantine-<slug>` | No other story/ADR claims `wip/*` refs in daemon worktrees (grep-verified); engineer authoring uses `engineer/<slug>-wip` in spec worktrees — distinct namespace and context. |
| sandbox-auth-expiry-park | Triggers on auth failure during the build (post-setup); different event, same park machinery TS-4 preserves. |

## Verdict

Conflict check passed — zero blocking conflicts remain; no degrading compromises accepted;
no ADR superseded (story-level supersession only).
